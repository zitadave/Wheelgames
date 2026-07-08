import { Redis } from "ioredis";
import crypto from "crypto";

let redis: Redis | null = null;
const memoryStore = new Map<string, { value: string; expiresAt: number }>();
const memoryRateLimits = new Map<string, { count: number; resetAt: number }>();

if (process.env.REDIS_URL) {
  try {
    redis = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      connectTimeout: 5000,
    });
    redis.on("error", (err) => {
      console.warn("⚠️ Redis client error, falling back to memory store:", err.message);
    });
  } catch (err: any) {
    console.warn("⚠️ Failed to initialize Redis, falling back to memory store:", err.message);
  }
} else {
  console.log("ℹ️ No REDIS_URL provided, utilizing secure in-memory state store for Deep Linking.");
}

export function generateToken(): string {
  // Generates an alphanumeric secure random string
  return "share_" + crypto.randomBytes(6).toString("base64url").replace(/[^a-zA-Z0-9]/g, "").substring(0, 8);
}

export async function setShareToken(
  token: string,
  data: { referrer_id: string; room_id: string },
  ttlSeconds: number = 7200 // 2 hours
): Promise<void> {
  const payload = JSON.stringify(data);
  if (redis) {
    try {
      await redis.set(token, payload, "EX", ttlSeconds);
      return;
    } catch (err: any) {
      console.warn("⚠️ Redis set failed, saving to memory store:", err.message);
    }
  }
  // Memory store fallback
  memoryStore.set(token, {
    value: payload,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
}

export async function getShareToken(token: string): Promise<{ referrer_id: string; room_id: string } | null> {
  if (redis) {
    try {
      const data = await redis.get(token);
      if (data) {
        return JSON.parse(data);
      }
    } catch (err: any) {
      console.warn("⚠️ Redis get failed, reading from memory store:", err.message);
    }
  }

  // Memory store fallback
  const item = memoryStore.get(token);
  if (!item) return null;

  if (Date.now() > item.expiresAt) {
    memoryStore.delete(token);
    return null;
  }

  try {
    return JSON.parse(item.value);
  } catch {
    return null;
  }
}

export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<{ allowed: boolean; remaining: number }> {
  if (redis) {
    try {
      const current = await redis.incr(key);
      if (current === 1) {
        await redis.expire(key, windowSeconds);
      }
      const remaining = limit - current;
      return {
        allowed: current <= limit,
        remaining: remaining < 0 ? 0 : remaining,
      };
    } catch (err: any) {
      console.warn("⚠️ Redis rate limit failed, using memory store fallback:", err.message);
    }
  }

  // Memory rate limit fallback
  const now = Date.now();
  const record = memoryRateLimits.get(key);

  if (!record || now > record.resetAt) {
    memoryRateLimits.set(key, {
      count: 1,
      resetAt: now + windowSeconds * 1000,
    });
    return { allowed: true, remaining: limit - 1 };
  }

  record.count += 1;
  const remaining = limit - record.count;
  return {
    allowed: record.count <= limit,
    remaining: remaining < 0 ? 0 : remaining,
  };
}

export async function setPendingReferral(userId: string, referrerId: string, ttlSeconds: number = 86400): Promise<void> {
  const token = `pending_ref:${userId}`;
  if (redis) {
    try {
      await redis.set(token, referrerId, "EX", ttlSeconds);
      return;
    } catch (err: any) {
      console.warn("⚠️ Redis setPendingReferral failed, saving to memory:", err.message);
    }
  }
  memoryStore.set(token, {
    value: referrerId,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
}

export async function getPendingReferral(userId: string): Promise<string | null> {
  const token = `pending_ref:${userId}`;
  if (redis) {
    try {
      const val = await redis.get(token);
      if (val) return val;
    } catch (err: any) {
      console.warn("⚠️ Redis getPendingReferral failed, reading from memory:", err.message);
    }
  }
  const item = memoryStore.get(token);
  if (!item) return null;
  if (Date.now() > item.expiresAt) {
    memoryStore.delete(token);
    return null;
  }
  return item.value;
}

export async function deletePendingReferral(userId: string): Promise<void> {
  const token = `pending_ref:${userId}`;
  if (redis) {
    try {
      await redis.del(token);
      return;
    } catch (err: any) {
      console.warn("⚠️ Redis deletePendingReferral failed, deleting from memory:", err.message);
    }
  }
  memoryStore.delete(token);
}

// Periodically clean up expired memory entries to prevent leaks
setInterval(() => {
  const now = Date.now();
  for (const [key, item] of memoryStore.entries()) {
    if (now > item.expiresAt) {
      memoryStore.delete(key);
    }
  }
  for (const [key, record] of memoryRateLimits.entries()) {
    if (now > record.resetAt) {
      memoryRateLimits.delete(key);
    }
  }
}, 60000);
