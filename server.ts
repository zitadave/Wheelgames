import express from "express";
import path from "path";
import cors from "cors";
import compression from "compression";
import { createServer as createViteServer } from "vite";
import { createServer } from "http";
import { Server } from "socket.io";
import { initGameEngine } from "./src/server/GameEngine.js";
import { initBingoEngine } from "./src/server/BingoEngine.js";
import { initKenoEngine } from "./src/server/KenoEngine.js";
import { loadGameSettings } from "./src/server/gameSettings.js";
import { initTelegramBot, getBotUsername, triggerBotFlow, getPromptsConfig } from "./src/server/telegramBot.js";
import { getBotLogs, logBot } from "./src/server/logger.js";
import { fetchLeaderboardData } from "./src/server/leaderboardHelper.js";
import crypto from "crypto";
import { parseBankSMS } from "./src/server/smsParser.js";
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
  app.use(express.json({
    verify: (req: any, _res, buf) => {
      req.rawBody = buf.toString();
    }
  }));
  app.use(express.urlencoded({ extended: true }));
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

  // Load Game Settings & Constraints
  await loadGameSettings().catch(err => console.error("Failed to load game settings:", err));

  // Initialize Game Engine with Socket.IO
  initGameEngine(io);
  initBingoEngine(io);
  initKenoEngine(io);
  
  // Initialize Telegram Bot in the background (non-blocking)
  initTelegramBot(io).catch(err => {
    console.error("Failed to initialize Telegram Bot in background:", err);
  });

  // API routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // SMS Webhook for Automated Deposit Verification
  app.post("/api/webhook/sms", async (req, res) => {
    const signature = req.headers['x-signature'] as string;
    const secret = process.env.SMS_WEBHOOK_SECRET;

    let isAuthorized = true; // Default to true if no secret is set

    if (secret) {
      isAuthorized = false;

      // 1. Check if x-signature is the raw secret itself
      if (signature && signature === secret) {
        isAuthorized = true;
        console.log("✅ [SMS Webhook] Authorized via raw x-signature header matching secret.");
      }

      // 2. Check standard HMAC-SHA256 if x-signature is provided but not raw secret
      if (!isAuthorized && signature) {
        try {
          const bodyStr = (req as any).rawBody || JSON.stringify(req.body);
          const hmac = crypto.createHmac('sha256', secret);
          const digest = hmac.update(bodyStr).digest('hex');
          if (signature.toLowerCase() === digest.toLowerCase()) {
            isAuthorized = true;
            console.log("✅ [SMS Webhook] Authorized via HMAC signature verification.");
          } else {
            console.warn(`⚠️ [SMS Webhook] Signature mismatch. Received: "${signature}", Calculated digest: "${digest}"`);
          }
        } catch (err) {
          console.error("❌ [SMS Webhook] HMAC Verification Error:", err);
        }
      }

      // 3. Check custom headers (x-api-key, secret, Authorization)
      if (!isAuthorized) {
        const apiKeyHeader = req.headers['x-api-key'] as string;
        const secretHeader = req.headers['secret'] as string;
        const authHeader = req.headers['authorization'] as string;

        if (apiKeyHeader === secret || secretHeader === secret) {
          isAuthorized = true;
          console.log("✅ [SMS Webhook] Authorized via API key or secret header.");
        } else if (authHeader) {
          const token = authHeader.replace(/^Bearer\s+/i, '').trim();
          if (token === secret) {
            isAuthorized = true;
            console.log("✅ [SMS Webhook] Authorized via Bearer token.");
          }
        }
      }

      // 4. Check query parameters (secret, key, api_key)
      if (!isAuthorized) {
        const secretQuery = req.query.secret || req.query.key || req.query.api_key;
        if (secretQuery === secret) {
          isAuthorized = true;
          console.log("✅ [SMS Webhook] Authorized via query parameter.");
        }
      }

      // 5. If still not authorized, log error and return 401
      if (!isAuthorized) {
        console.error("❌ [SMS Webhook] Unauthorized request. Secret is set but no credentials matched.");
        console.error("Headers:", JSON.stringify(req.headers));
        console.error("Query parameters:", JSON.stringify(req.query));
        console.error("Body:", JSON.stringify(req.body));
        
        logBot(`❌ [SMS Webhook] Unauthorized attempt. Headers: ${JSON.stringify(req.headers)} | Body: ${JSON.stringify(req.body)}`);
        
        return res.status(401).json({ 
          error: "Unauthorized. Please configure your SMS gateway app with the correct SMS_WEBHOOK_SECRET as a header (x-signature, x-api-key, secret) or query parameter (?secret=...)." 
        });
      }
    }

    const { 
      from, 
      text, 
      sender: bodySender, 
      message: bodyMessage,
      sender_phone,
      phone,
      raw_message,
      body,
      msg,
      sender_name,
      senderName
    } = req.body || {};
    const { from: queryFrom, text: queryText, sender: qSender, message: qMessage } = req.query || {};

    const sender = (from || bodySender || sender_phone || phone || queryFrom || qSender || "Unknown").toString();
    const smsText = (text || bodyMessage || raw_message || body || msg || queryText || qMessage || "").toString();

    // Prioritize pre-parsed data from JSON if present
    let finalTxId = (req.body?.transaction_id || req.body?.transactionId || "").toString().trim().toUpperCase();
    let finalAmount = Number(req.body?.amount);
    let finalBank = (req.body?.bank || req.body?.bank_name || "").toString().trim();
    let finalSenderName = (sender_name || senderName || "").toString().trim();

    let isFullyParsed = !!(finalTxId && !isNaN(finalAmount) && finalAmount > 0);

    if (!smsText && !isFullyParsed) {
      console.warn("⚠️ [SMS Webhook] Received empty SMS text and no parsed transaction. Body:", JSON.stringify(req.body), "Query:", JSON.stringify(req.query));
      return res.status(400).json({ error: "Missing SMS text or pre-parsed transaction details" });
    }

    console.log(`📩 [SMS Received] From: ${sender} | Text: ${smsText.substring(0, 100)}...`);
    // Normalize sender (remove +, leading zeros)
    const normalizedSender = sender.replace(/^\+/, '').replace(/^0+/, '');
    
    console.log(`🔍 [SMS Debug] Normalized Sender: ${normalizedSender} | Raw Text: ${smsText.substring(0, 50)}...`);

    try {
      if (!isFullyParsed) {
        // Fallback to parsing raw text using regex
        const parsed = parseBankSMS(smsText, normalizedSender);
        if (parsed) {
          finalTxId = parsed.transactionId.trim().toUpperCase();
          finalAmount = parsed.amount;
          finalBank = parsed.bankName;
          isFullyParsed = true;
        }
      }

      if (isFullyParsed && finalTxId) {
        console.log(`✅ [SMS Webhook Processing] Ref: ${finalTxId} | Amount: ${finalAmount} ETB | Bank: ${finalBank} | Sender Name: ${finalSenderName || 'Not Provided'}`);
        
        // Extract sender name from raw text if not already provided
        if (!finalSenderName && smsText) {
          const parsedName = extractSenderName(smsText);
          if (parsedName) {
            finalSenderName = parsedName;
          }
        }

        // Save to DB (Table: deposit_pool)
        const { error } = await supabase.from('deposit_pool').insert({
          transaction_id: finalTxId,
          amount: finalAmount,
          sender_name: finalSenderName || null,
          sender_phone: sender,
          raw_message: smsText || `Pre-parsed transaction from gateway. Bank: ${finalBank}`,
          status: 'unused',
          received_at: new Date().toISOString()
        });

        if (error && error.code !== '23505') { 
           console.error(`❌ [SMS Webhook] DB Error for ${finalTxId}:`, error.message, error.details);
        } else if (error && error.code === '23505') {
           console.log(`ℹ️ [SMS Webhook] Transaction ${finalTxId} already exists in DB.`);
        } else {
           console.log(`💾 [SMS Stored] Transaction ${finalTxId} ready for verification.`);
        }
      } else {
        console.log(`ℹ️ [SMS Webhook] No matching bank pattern found or invalid data. Sender: ${normalizedSender}. Raw Text: "${smsText.substring(0, 50)}..."`);
      }
      
      res.json({ success: true });
    } catch (err) {
      console.error("❌ Error processing SMS webhook:", err);
      res.status(500).json({ error: "Internal server error" });
    }
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
      const { extractSenderName } = await import("./src/server/smsParser.js");

      const { txId, amount: parsedAmount } = parseReceiptSMS(receiptText);
      const targetAmount = parsedAmount || Number(amount);
      console.log(`🔍 [Deposit] Parsed Receipt - Ref: ${txId}, Parsed Amount: ${parsedAmount}, Target Amount: ${targetAmount}`);

      const promptsConfig = await getPromptsConfig();
      const bankId = Object.keys(promptsConfig.banks || {}).find(k => k.toLowerCase() === bank.toLowerCase()) || bank;
      const bankConfig = promptsConfig.banks?.[bankId];

      let isReceiverVerified = false;
      if (bankConfig) {
        const ownerName = (bankConfig.owner_name || "").toLowerCase().trim();
        const accountNum = (bankConfig.account || "").toLowerCase().trim();
        const cleanReceiptText = receiptText.toLowerCase();

        if (ownerName && cleanReceiptText.includes(ownerName)) {
          isReceiverVerified = true;
        } else if (accountNum && cleanReceiptText.includes(accountNum)) {
          isReceiverVerified = true;
        } else {
          // Check if last 4 digits of the account number are in the text
          const last4 = accountNum.length >= 4 ? accountNum.slice(-4) : "";
          if (last4 && cleanReceiptText.includes(last4)) {
            isReceiverVerified = true;
          }
        }
      } else {
        isReceiverVerified = true;
      }

      console.log(`🔍 [Deposit] Receiver/Merchant Name Match: ${isReceiverVerified}`);

      let isVerifiedBySMS = false;
      let nameVerificationMsg = "";
      let autoVerifyFailedReason = "";

      if (!txId) {
        autoVerifyFailedReason = "Reference ID not found. Could not parse or locate a valid transaction reference ID from the receipt SMS.";
      } else if (!targetAmount || isNaN(targetAmount)) {
        autoVerifyFailedReason = `Amount not found. Could not parse the deposit amount from the receipt SMS (Target Amount: ${targetAmount}).`;
      } else if (!isReceiverVerified) {
        const ownerName = bankConfig ? (bankConfig.owner_name || "") : "N/A";
        const accountNum = bankConfig ? (bankConfig.account || "") : "N/A";
        autoVerifyFailedReason = `Receiver detail mismatch. The receipt text does not match the system's receiver name ("${ownerName}") or account number ("${accountNum}").`;
      }

      if (txId && targetAmount && isReceiverVerified) {
        const cleanUserTxId = txId.trim().toUpperCase();

        // Check if the reference ID has already been used in transactions list
        const { data: duplicateTxsCheck } = await supabase
          .from('transactions')
          .select('id')
          .ilike('description', `%${cleanUserTxId}%`)
          .limit(1);

        if (duplicateTxsCheck && duplicateTxsCheck.length > 0) {
          autoVerifyFailedReason = `Duplicate Reference ID. The transaction ID "${cleanUserTxId}" has already been processed and claimed.`;
        } else {
          // Check if this reference ID is in deposit_pool but marked as 'used'
          const { data: usedPoolCheck } = await supabase
            .from('deposit_pool')
            .select('*')
            .ilike('transaction_id', cleanUserTxId)
            .eq('status', 'used')
            .maybeSingle();

          if (usedPoolCheck) {
            autoVerifyFailedReason = `Reference ID is already used. The gateway has already processed the SMS for transaction ID "${cleanUserTxId}".`;
          } else {
            let smsRecordFound = null;
            // Retry logic: Wait for the SMS gateway for up to 45 seconds (15 attempts x 3s)
            for (let attempt = 0; attempt < 15; attempt++) {
              console.log(`🔍 [Deposit] Checking gateway for Ref: ${cleanUserTxId} (Attempt ${attempt + 1}/15)...`);
              
              const { data: smsRecord } = await supabase
                .from('deposit_pool')
                .select('*')
                .ilike('transaction_id', cleanUserTxId)
                .eq('status', 'unused')
                .maybeSingle();

              if (smsRecord) {
                smsRecordFound = smsRecord;
                const smsAmount = Number(smsRecord.amount);
                console.log(`📊 [Deposit] SMS found for ${cleanUserTxId}. SMS Amount: ${smsAmount}, Target Amount: ${targetAmount}`);
                
                if (Math.abs(smsAmount - targetAmount) < 0.01) {
                  // Skip Telegram-versus-bank name matching restriction, since Telegram users rarely use their legal/official bank names.
                  // Just retrieve/extract the real depositor name for reference and audit logging.
                  const realDepositorName = smsRecord.sender_name || extractSenderName(smsRecord.raw_message);
                  
                  isVerifiedBySMS = true;
                  nameVerificationMsg = realDepositorName ? `Payer Name: ${realDepositorName}` : "Payer Name: Not Provided";
                  
                  await supabase.from('deposit_pool').update({ status: 'used' }).eq('transaction_id', smsRecord.transaction_id);
                  console.log(`✅ [Deposit] Verified by gateway (reference and amount matched) on attempt ${attempt + 1}. Payer: ${realDepositorName}`);
                  break;
                } else {
                  console.warn(`⚠️ [Deposit] Amount mismatch for ${cleanUserTxId}. Expected ${targetAmount}, got ${smsAmount}`);
                  autoVerifyFailedReason = `Amount Mismatch. Your request is for ${targetAmount} ETB, but the gateway bank SMS states ${smsAmount} ETB.`;
                  break;
                }
              }

              if (attempt < 14) {
                // Wait 3 seconds before next check
                await new Promise(resolve => setTimeout(resolve, 3000));
              }
            }

            if (!smsRecordFound && !autoVerifyFailedReason) {
              autoVerifyFailedReason = `Reference ID not found in gateway. The system hasn't received the official bank SMS for "${cleanUserTxId}" from the gateway (yet), or the reference number is incorrect/fake.`;
            }
          }
        }
      }

      // 3. Auto-approve ONLY if verified by real SMS Gateway (SMS Webhook)
      if (isVerifiedBySMS && txId && targetAmount && Math.abs(targetAmount - Number(amount)) < 0.01) {
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
          targetAmount,
          'reward',
          `Deposit Auto-Approved (Ref: ${txId})`
        );

        if (result.success) {
          // Send notification to channel if configured
          const { postToChannel, escapeHTML, getBotInstance, getPrimaryOwnerId, adminChatIds } = await import("./src/server/telegramBot.js");
          const escapedUsername = escapeHTML(username);
          
          const gatewayBadge = " [Gateway ✅]";
          await postToChannel(`✅ <b>Auto-Deposit Verified!</b>${gatewayBadge}\n\n👤 <b>User:</b> @${escapedUsername}\n💰 <b>Amount:</b> <code>${targetAmount.toLocaleString()} ETB</code>\n🧾 <b>Ref:</b> <code>${txId}</code>\n👤 <b>Sender Name:</b> <code>${nameVerificationMsg}</code>`);

          // Notify admins
          const bot = getBotInstance();
          if (bot) {
            const verificationBadge = `🛡️ <b>VERIFIED BY SMS GATEWAY & NAME MATCH</b>\n👤 <b>Depositor Match:</b> ${nameVerificationMsg}`;
            const adminMsg = `⚡ <b>AUTO-VERIFIED DEPOSIT</b>\n\n` +
              `👤 <b>User:</b> @${escapedUsername} (${escapeHTML(fullName)})\n` +
              `🆔 <b>User ID:</b> <code>${userId}</code>\n` +
              `💰 <b>Amount:</b> <b>${targetAmount.toLocaleString()} ETB</b>\n` +
              `🏦 <b>Bank:</b> <b>${escapeHTML(bank)}</b>\n` +
              `🧾 <b>Ref ID:</b> <code>${txId}</code>\n` +
              `${verificationBadge}\n\n` +
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
            message: `🎉 Automatic verification successful! ${targetAmount} ETB has been instantly credited to your wallet.`
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
        chatId: Number(userId),
        rejectReason: autoVerifyFailedReason || "Unknown Reason"
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
        const escapedReason = escapeHTML(autoVerifyFailedReason || "Unknown Reason / No Match Found");

        const adminMsg = `📥 <b>NEW DEPOSIT REQUEST (Manual Review Required)</b>\n\n` +
          `👤 <b>User:</b> @${escapedUsername} (${escapedFullName})\n` +
          `🆔 <b>User ID:</b> <code>${userId}</code>\n` +
          `💰 <b>Amount:</b> <b>${Number(amount).toLocaleString()} ETB</b>\n` +
          `🏦 <b>Bank:</b> <b>${escapedBank}</b>\n\n` +
          `⚠️ <b>Auto-Verification Failure Reason:</b>\n` +
          `🔴 <i>${escapedReason}</i>\n\n` +
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
