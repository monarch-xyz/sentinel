import { createHash, randomBytes } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { ApiKeyRepository } from "../../db/index.js";
import { getErrorMessage } from "../../utils/errors.js";

export interface AuthContext {
  userId: string;
  apiKeyId: string;
  isAdmin?: boolean;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function generateApiKey(): string {
  const raw = randomBytes(32).toString("base64url");
  return `flare_${raw}`;
}

export function requireApiKey() {
  const repo = new ApiKeyRepository();

  return async function apiKeyMiddleware(req: Request, res: Response, next: NextFunction) {
    try {
      const apiKey = req.header("X-API-Key") ?? req.header("x-api-key");
      if (!apiKey) {
        return res.status(401).json({ error: "Missing API key" });
      }

      const keyHash = hashApiKey(apiKey);
      const record = await repo.getByHash(keyHash);
      if (!record || !record.is_active) {
        return res.status(401).json({ error: "Invalid API key" });
      }

      await repo.touchLastUsed(record.id);
      req.auth = { userId: record.user_id, apiKeyId: record.id };
      return next();
    } catch (error: unknown) {
      return res.status(500).json({ error: "Auth failed", details: getErrorMessage(error) });
    }
  };
}

const apiKeyMiddleware = requireApiKey();

export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
  if (req.path === "/health" || req.path.startsWith("/auth")) return next();
  return apiKeyMiddleware(req, res, next);
};
