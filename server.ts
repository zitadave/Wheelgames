import express from "express";
import path from "path";
import cors from "cors";
import compression from "compression";
import { createServer as createViteServer } from "vite";
import { createServer } from "http";
import { Server } from "socket.io";
import { initGameEngine } from "./src/server/GameEngine.js";
import { initBingoEngine } from "./src/server/BingoEngine.js";
import { initTelegramBot, getBotUsername, getBotLogs, triggerBotFlow } from "./src/server/telegramBot.js";
import { fetchLeaderboardData } from "./src/server/leaderboardHelper.js";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";
import { generateToken, setShareToken, getShareToken, setPendingReferral } from "./src/server/redisClient.js";

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
