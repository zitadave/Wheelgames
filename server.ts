import express from "express";
import path from "path";
import cors from "cors";
import compression from "compression";
import { createServer as createViteServer } from "vite";
import { createServer } from "http";
import { Server } from "socket.io";
import { initGameEngine } from "./src/server/GameEngine.js";
import { initBingoEngine } from "./src/server/BingoEngine.js";
import { initTelegramBot, getBotUsername, triggerBotFlow } from "./src/server/telegramBot.js";
import { getBotLogs } from "./src/server/logger.js";
import { fetchLeaderboardData } from "./src/server/leaderboardHelper.js";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";
import { generateToken, setShareToken, getShareToken, setPendingReferral } from "./src/server/redisClient.js";
import { supabase } from "./src/server/supabase.js";
import { txManager } from "./src/server/transactionManager.js";

dotenv.config();

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(cors());
  app.use(compression());
  app.use(express.json());
  const PORT = 3000;
  
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
    perMessageDeflate: {
      threshold: 1024, // Only compress if over 1KB
    },
    pingInterval: 25000,
    pingTimeout: 60000,
  });

  // Initialize Game Engine with Socket.IO
  initGameEngine(io);
  initBingoEngine(io);
  
  // Initialize Telegram Bot in the background (non-blocking)
  initTelegramBot(io).catch(err => {
    console.error("Failed to initialize Telegram Bot in background:", err);
  });

  // API routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Rate limiter for Mini App Initialization Endpoint (max 10 per minute per user/IP)
  const initLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10,
    keyGenerator: (req: any) => {
      return (req.body?.userId || req.query?.userId || req.ip)?.toString();
    },
    handler: (req, res) => {
      res.status(429).json({ error: "Too many app initializations. Please wait 1 minute." });
    },
    legacyHeaders: false,
    standardHeaders: true,
    validate: { keyGeneratorIpFallback: false },
  });

  // Generate secure sharing token mapping (short unpredictable crypt token)
  app.post("/api/share/generate", async (req, res) => {
    const { referrer_id, room_id } = req.body;
    if (!referrer_id || !room_id) {
      return res.status(400).json({ error: "Missing referrer_id or room_id" });
    }
    try {
      const token = generateToken();
      // Map inside Redis/Memory with expiration time (TTL) of 2 hours (7200 seconds)
      await setShareToken(token, { referrer_id: referrer_id.toString(), room_id: room_id.toString() }, 7200);
      res.json({ success: true, token });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Mini App Initialization & Decoding Endpoint
  app.post("/api/init", initLimiter, async (req, res) => {
    const { userId, startParam } = req.body;
    if (!userId) {
      return res.status(400).json({ error: "Missing userId" });
    }
    try {
      let referrerId: string | null = null;
      let roomId: string | null = null;

      if (startParam && startParam.startsWith("share_")) {
        const decoded = await getShareToken(startParam);
        if (decoded) {
          referrerId = decoded.referrer_id;
          roomId = decoded.room_id;

          // Save pending referral state for when they buy a slot/bet
          if (referrerId && referrerId !== userId.toString()) {
            await setPendingReferral(userId.toString(), referrerId.toString());
          }
        }
      }

      res.json({
        success: true,
        referrerId,
        roomId
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  
  app.get("/api/referrals", async (req, res) => {
    let { userId } = req.query;
    if (!userId) return res.status(400).json({ error: "Missing userId" });
    userId = userId.toString().trim();
    
    try {
      // 1. Get user IDs from transactions where they were referred by this user
      // This matches the legacy logic used in GameEngine.ts for the total count
      const { data: refTx, error: txError } = await supabase
        .from('transactions')
        .select('user_id')
        .eq('type', 'referral_link')
        .ilike('description', `Referred by ${userId}%`);

      if (txError) throw txError;

      const referredUserIds = [...new Set((refTx || []).map(tx => tx.user_id))];

      // 2. Also check the users table directly (for newer referrals)
      const { data: directUsers, error: userError } = await supabase
        .from('users')
        .select('id')
        .eq('referrer_id', userId);

      if (userError) throw userError;
      
      if (directUsers) {
        directUsers.forEach(u => {
          if (!referredUserIds.includes(u.id)) {
            referredUserIds.push(u.id);
          }
        });
      }

      if (referredUserIds.length === 0) {
        return res.json({ success: true, referrals: [] });
      }

      // 3. Fetch details for all identified referred users
      const { data: users, error: detailsError } = await supabase
        .from('users')
        .select('id, username, created_at')
        .in('id', referredUserIds)
        .order('created_at', { ascending: false });

      if (detailsError) throw detailsError;
      res.json({ success: true, referrals: users || [] });
    } catch (err: any) {
      console.error(`[API] Referral fetch error:`, err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/bot-info", (req, res) => {
    res.json({ username: getBotUsername() });
  });

  app.get("/api/bot-logs", (req, res) => {
    res.json({ logs: getBotLogs() });
  });

  app.get("/api/leaderboard", async (req, res) => {
    try {
      const stats = await fetchLeaderboardData();
      res.json(stats);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/trigger-bot-flow", async (req, res) => {
    const { userId, flowType } = req.body;
    if (!userId || !flowType) {
      return res.status(400).json({ error: "Missing userId or flowType" });
    }
    try {
      const success = await triggerBotFlow(userId.toString(), flowType);
      if (success) {
        res.json({ success: true });
      } else {
        res.status(500).json({ error: "Failed to trigger bot flow. Check if bot is active." });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/user-payout-info", async (req, res) => {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: "Missing userId" });
    try {
      const { data: user, error } = await supabase
        .from('users')
        .select('bank_name, bank_account')
        .eq('id', userId.toString())
        .maybeSingle();
      if (error) throw error;
      res.json({ success: true, bankName: user?.bank_name, bankAccount: user?.bank_account });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/config/banks", async (req, res) => {
    try {
      const { getPromptsConfig } = await import("./src/server/telegramBot.js");
      const config = await getPromptsConfig();
      res.json({ success: true, banks: config.banks });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/deposit-request", async (req, res) => {
    const { userId, amount, bank, receiptText } = req.body;
    if (!userId || !amount || !bank || !receiptText) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    try {
      // 1. Fetch user to confirm they exist
      const { data: user, error: userError } = await supabase
        .from('users')
        .select('username, first_name, last_name, balance')
        .eq('id', userId.toString())
        .maybeSingle();

      if (userError || !user) {
        return res.status(404).json({ error: "User not found" });
      }

      const username = user.username || "no_username";
      const fullName = `${user.first_name || ""} ${user.last_name || ""}`.trim() || "Player";

      // 2. Try Automatic Parsing & Verification
      const { parseReceiptSMS } = await import("./src/server/transactionManager.js");
      const { txId, amount: parsedAmount } = parseReceiptSMS(receiptText);

      if (txId && parsedAmount && parsedAmount === Number(amount)) {
        // Double-check duplicates in DB
        const { data: duplicateTxs, error: dupError } = await supabase
          .from('transactions')
          .select('id')
          .ilike('description', `%${txId}%`)
          .limit(1);

        if (!dupError && duplicateTxs && duplicateTxs.length > 0) {
          return res.status(400).json({ error: "❌ This transaction ID has already been verified and claimed." });
        }

        // Auto approve!
        const result = await txManager.modifyBalance(
          userId.toString(),
          parsedAmount,
          'reward',
          `Deposit Auto-Approved (Ref: ${txId})`
        );

        if (result.success) {
          // Send notification to channel if configured
          const { postToChannel, escapeHTML, getBotInstance, getPrimaryOwnerId, adminChatIds } = await import("./src/server/telegramBot.js");
          const escapedUsername = escapeHTML(username);
          
          await postToChannel(`✅ <b>Auto-Deposit Verified!</b>\n\n👤 <b>User:</b> @${escapedUsername}\n💰 <b>Amount:</b> <code>${parsedAmount.toLocaleString()} ETB</code>\n🧾 <b>Ref:</b> <code>${txId}</code>`);

          // Notify admins
          const bot = getBotInstance();
          if (bot) {
            const adminMsg = `⚡ <b>AUTO-VERIFIED DEPOSIT</b>\n\n` +
              `👤 <b>User:</b> @${escapedUsername} (${escapeHTML(fullName)})\n` +
              `🆔 <b>User ID:</b> <code>${userId}</code>\n` +
              `💰 <b>Amount:</b> <b>${parsedAmount.toLocaleString()} ETB</b>\n` +
              `🏦 <b>Bank:</b> <b>${escapeHTML(bank)}</b>\n` +
              `🧾 <b>Ref ID:</b> <code>${txId}</code>\n\n` +
              `🟢 <i>Credited instantly to user's wallet!</i>`;

            const primaryId = getPrimaryOwnerId();
            adminChatIds.add(primaryId);
            adminChatIds.forEach(async (adminId) => {
              try {
                await bot.sendMessage(adminId, adminMsg, { parse_mode: "HTML" });
              } catch (e) {}
            });
          }

          // Emit real-time balance update
          io.emit('balanceUpdated', { userId: userId.toString(), balance: result.newBalance });

          return res.json({
            success: true,
            autoApproved: true,
            newBalance: result.newBalance,
            message: `🎉 Automatic verification successful! ${parsedAmount} ETB has been instantly credited to your wallet.`
          });
        }
      }

      // 3. Fallback to manual admin approval
      const { pendingRequests, savePendingRequestsToDB, generateRef, escapeHTML, getBotInstance, getPrimaryOwnerId, adminChatIds } = await import("./src/server/telegramBot.js");
      const requestId = "DEP_" + generateRef(8);

      const requestPayload = {
        id: requestId,
        type: 'deposit',
        userId: userId.toString(),
        username,
        fullName,
        amount: Number(amount),
        bank,
        receiptText,
        chatId: Number(userId)
      };

      pendingRequests.set(requestId, requestPayload);
      await savePendingRequestsToDB();

      // Notify Admins for manual approval
      const bot = getBotInstance();
      if (bot) {
        const escapedUsername = escapeHTML(username);
        const escapedFullName = escapeHTML(fullName);
        const escapedText = escapeHTML(receiptText);
        const escapedBank = escapeHTML(bank);

        const adminMsg = `📥 <b>NEW DEPOSIT REQUEST (Manual Review)</b>\n\n` +
          `👤 <b>User:</b> @${escapedUsername} (${escapedFullName})\n` +
          `🆔 <b>User ID:</b> <code>${userId}</code>\n` +
          `💰 <b>Amount:</b> <b>${Number(amount).toLocaleString()} ETB</b>\n` +
          `🏦 <b>Bank:</b> <b>${escapedBank}</b>\n\n` +
          `📝 <b>Receipt SMS text:</b>\n` +
          `<pre>${escapedText}</pre>\n\n` +
          `<b>Request ID:</b> <code>${requestId}</code>`;

        const primaryId = getPrimaryOwnerId();
        adminChatIds.add(primaryId);
        adminChatIds.forEach(async (adminId) => {
          try {
            await bot.sendMessage(adminId, adminMsg, {
              parse_mode: "HTML",
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: "Approve ✅", callback_data: `approve_dep_${requestId}` },
                    { text: "Decline ❌", callback_data: `decline_dep_${requestId}` }
                  ]
                ]
              }
            });
          } catch (e) {}
        });
      }

      return res.json({
        success: true,
        autoApproved: false,
        message: "📥 Your request has been sent to our verification agents. It will be approved within 1 minute!"
      });

    } catch (err: any) {
      console.error("Deposit request API error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/withdraw-request", async (req, res) => {
    const { userId, amount, bank, account } = req.body;
    if (!userId || !amount || !bank || !account) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const numAmount = Math.floor(Math.abs(parseFloat(amount)));
    if (isNaN(numAmount) || numAmount < 100) {
      return res.status(400).json({ error: "Minimum withdrawal is 100 ETB." });
    }

    try {
      // 1. Fetch user to verify balance
      const { data: user, error: userError } = await supabase
        .from('users')
        .select('username, first_name, last_name, balance')
        .eq('id', userId.toString())
        .maybeSingle();

      if (userError || !user) {
        return res.status(404).json({ error: "User not found" });
      }

      const currentBalance = Number(user.balance);
      if (numAmount > currentBalance) {
        return res.status(400).json({ error: "Insufficient balance." });
      }

      const username = user.username || "no_username";
      const fullName = `${user.first_name || ""} ${user.last_name || ""}`.trim() || "Player";

      // 2. Generate unique request code
      const { pendingRequests, savePendingRequestsToDB, generateRef, escapeHTML, getBotInstance, getPrimaryOwnerId, adminChatIds } = await import("./src/server/telegramBot.js");
      const requestId = "WD_" + generateRef(8);

      // 3. Deduct balance instantly
      const result = await txManager.modifyBalance(
        userId.toString(),
        -numAmount,
        'bet',
        `Withdrawal Pending (Ref: ${requestId})`
      );

      if (!result.success) {
        return res.status(400).json({ error: result.error || "Failed to deduct balance." });
      }

      const newBalance = result.newBalance;

      // 4. Register pending request
      const requestPayload = {
        id: requestId,
        type: 'withdraw',
        userId: userId.toString(),
        username,
        fullName,
        amount: numAmount,
        bank,
        account: account.toString(),
        chatId: Number(userId)
      };

      pendingRequests.set(requestId, requestPayload);
      await savePendingRequestsToDB();

      // Emit real-time balance update to socket clients instantly
      io.emit('balanceUpdated', { userId: userId.toString(), balance: newBalance });

      // 5. Notify Admins
      const bot = getBotInstance();
      if (bot) {
        const escapedUsername = escapeHTML(username);
        const escapedFullName = escapeHTML(fullName);
        const escapedBank = escapeHTML(bank);
        const escapedAccount = escapeHTML(account.toString());

        const adminMsg = `📤 <b>NEW WITHDRAWAL REQUEST (Web Portal)</b>\n\n` +
          `👤 <b>User:</b> @${escapedUsername} (${escapedFullName})\n` +
          `🆔 <b>User ID:</b> <code>${userId}</code>\n` +
          `💰 <b>Amount:</b> <b>${numAmount.toLocaleString()} ETB</b>\n` +
          `🏦 <b>Bank:</b> <b>${escapedBank}</b>\n` +
          `💳 <b>Account/Phone:</b> <code>${escapedAccount}</code>\n\n` +
          `<b>Request ID:</b> <code>${requestId}</code>`;

        const primaryId = getPrimaryOwnerId();
        adminChatIds.add(primaryId);
        adminChatIds.forEach(async (adminId) => {
          try {
            await bot.sendMessage(adminId, adminMsg, {
              parse_mode: "HTML",
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: "Approve ✅", callback_data: `approve_wd_${requestId}` },
                    { text: "Decline ❌", callback_data: `decline_wd_${requestId}` }
                  ]
                ]
              }
            });
          } catch (e) {}
        });
      }

      return res.json({
        success: true,
        newBalance,
        message: `📤 Withdrawal request of ${numAmount} ETB submitted successfully! Admin will transfer the funds shortly.`
      });

    } catch (err: any) {
      console.error("Withdrawal request API error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Serve uploaded announcement photos statically
  app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
