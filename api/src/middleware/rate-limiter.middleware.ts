import { Request, Response, NextFunction } from 'express';
import RedisService from '../services/redis/redis.service';

interface RateLimitRecord {
  count: number;
  resetTime: number;
}

const memoryStore = new Map<string, RateLimitRecord>();

// Cleanup interval to prevent memory leaks for in-memory fallback
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of memoryStore.entries()) {
    if (now > record.resetTime) {
      memoryStore.delete(key);
    }
  }
}, 60000); // Clean every minute

export const rateLimiter = (windowMs: number, maxRequests: number) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const key = `ratelimit_${ip as string}_${req.path}`;
    const windowSeconds = Math.ceil(windowMs / 1000);

    // Try Redis first
    const count = await RedisService.incrementWithTTL(key, windowSeconds);

    if (count !== -1) {
      // Redis is available
      if (count > maxRequests) {
        console.warn(`[RateLimit] Blocked IP: ${ip} on path: ${req.path} (Redis)`);
        return res.status(429).json({
          error: 'Too many requests',
          message: 'You have exceeded the allowed frequency. Please slow down and try again later.',
        });
      }
      return next();
    }

    // Fallback to memory store if Redis is unavailable
    const now = Date.now();
    let record = memoryStore.get(key);

    if (!record) {
      record = {
        count: 1,
        resetTime: now + windowMs,
      };
      memoryStore.set(key, record);
      return next();
    }

    if (now > record.resetTime) {
      record.count = 1;
      record.resetTime = now + windowMs;
      memoryStore.set(key, record);
      return next();
    }

    record.count += 1;
    memoryStore.set(key, record);

    if (record.count > maxRequests) {
      console.warn(`[RateLimit] Blocked IP: ${ip} on path: ${req.path} (Memory Fallback)`);
      return res.status(429).json({
        error: 'Too many requests',
        message: 'You have exceeded the allowed frequency. Please slow down and try again later.',
      });
    }

    next();
  };
};
