import type { NextFunction, Request, Response } from "express";

export interface RateLimitOptions {
  windowMs: number;
  max: number;
}

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const store = new Map<string, RateLimitEntry>();

export function rateLimit(options: RateLimitOptions) {
  const { windowMs, max } = options;

  return function rateLimitMiddleware(req: Request, res: Response, next: NextFunction) {
    const key = req.ip || "unknown";
    const now = Date.now();

    const existing = store.get(key);
    if (!existing || now - existing.windowStart >= windowMs) {
      store.set(key, { count: 1, windowStart: now });
      return next();
    }

    if (existing.count >= max) {
      res.status(429).json({ error: "Rate limit exceeded" });
      return;
    }

    existing.count += 1;
    store.set(key, existing);
    next();
  };
}
