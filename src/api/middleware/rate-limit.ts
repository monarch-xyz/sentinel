import type { NextFunction, Request, Response } from "express";
import { redis } from "../../redis/client.ts";
import { getErrorMessage } from "../../utils/errors.ts";
import { createLogger } from "../../utils/logger.ts";

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  prefix?: string;
}

const logger = createLogger("api:rate-limit");

export function rateLimit(options: RateLimitOptions) {
  const { windowMs, max, prefix = "global" } = options;

  return async function rateLimitMiddleware(req: Request, res: Response, next: NextFunction) {
    const principal = req.auth?.userId ?? req.ip ?? "unknown";
    const key = `rate_limit:${prefix}:${principal}`;

    try {
      const count = await redis.incr(key);
      let ttlMs = await redis.pttl(key);

      if (count === 1 || ttlMs < 0) {
        await redis.pexpire(key, windowMs);
        ttlMs = windowMs;
      }

      res.setHeader("X-RateLimit-Limit", String(max));
      res.setHeader("X-RateLimit-Remaining", String(Math.max(max - count, 0)));

      if (count > max) {
        res.setHeader("Retry-After", String(Math.max(1, Math.ceil(ttlMs / 1000))));
        res.status(429).json({ error: "Rate limit exceeded" });
        return;
      }

      next();
    } catch (error: unknown) {
      logger.warn({ error: getErrorMessage(error), key }, "Rate limiter failed open");
      next();
    }
  };
}
