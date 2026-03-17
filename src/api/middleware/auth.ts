import { createHash, randomBytes } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { config } from "../../config/index.js";
import { ApiKeyRepository, UserSessionRepository } from "../../db/index.js";
import { getErrorMessage } from "../../utils/errors.js";

export interface AuthContext {
  userId: string;
  authMethod: "api_key" | "session";
  apiKeyId?: string;
  sessionId?: string;
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
  return `sentinel_${raw}`;
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateSessionToken(): string {
  const raw = randomBytes(32).toString("base64url");
  return `sentinel_session_${raw}`;
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
      req.auth = { userId: record.user_id, apiKeyId: record.id, authMethod: "api_key" };
      return next();
    } catch (error: unknown) {
      return res.status(500).json({ error: "Auth failed", details: getErrorMessage(error) });
    }
  };
}

const apiKeyRepo = new ApiKeyRepository();
const sessionRepo = new UserSessionRepository();

const PUBLIC_AUTH_PATHS = new Set(["/auth/register", "/auth/siwe/nonce", "/auth/siwe/verify"]);

function readCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;

  const cookies = cookieHeader.split(";");
  for (const cookie of cookies) {
    const [rawName, ...rawValue] = cookie.trim().split("=");
    if (rawName === name) {
      const value = rawValue.join("=");
      return value ? decodeURIComponent(value) : undefined;
    }
  }

  return undefined;
}

function getSessionToken(req: Request): string | undefined {
  const authorization = req.header("Authorization") ?? req.header("authorization");
  if (authorization?.toLowerCase().startsWith("bearer ")) {
    const token = authorization.slice(7).trim();
    return token || undefined;
  }

  return readCookie(req.header("Cookie") ?? req.header("cookie"), config.auth.sessionCookieName);
}

export const authMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  if (req.path === "/health" || PUBLIC_AUTH_PATHS.has(req.path)) return next();

  try {
    const apiKey = req.header("X-API-Key") ?? req.header("x-api-key");
    if (apiKey) {
      const keyHash = hashApiKey(apiKey);
      const record = await apiKeyRepo.getByHash(keyHash);
      if (!record || !record.is_active) {
        return res.status(401).json({ error: "Invalid API key" });
      }

      await apiKeyRepo.touchLastUsed(record.id);
      req.auth = { userId: record.user_id, apiKeyId: record.id, authMethod: "api_key" };
      return next();
    }

    const sessionToken = getSessionToken(req);
    if (sessionToken) {
      const sessionHash = hashSessionToken(sessionToken);
      const record = await sessionRepo.getActiveByHash(sessionHash);
      if (!record) {
        return res.status(401).json({ error: "Invalid session" });
      }

      await sessionRepo.touchLastUsed(record.id);
      req.auth = { userId: record.user_id, sessionId: record.id, authMethod: "session" };
      return next();
    }

    return res.status(401).json({ error: "Missing authentication credentials" });
  } catch (error: unknown) {
    return res.status(500).json({ error: "Auth failed", details: getErrorMessage(error) });
  }
};
