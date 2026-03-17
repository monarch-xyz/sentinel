import { timingSafeEqual } from "node:crypto";
import express from "express";
import { type Address, getAddress, verifyMessage } from "viem";
import { generateSiweNonce, parseSiweMessage, validateSiweMessage } from "viem/siwe";
import { z } from "zod";
import { config } from "../../config/index.js";
import {
  ApiKeyRepository,
  AuthIdentityRepository,
  AuthNonceRepository,
  UserRepository,
  UserSessionRepository,
} from "../../db/index.js";
import { getErrorMessage, isZodError } from "../../utils/errors.js";
import { createLogger } from "../../utils/logger.js";
import {
  generateApiKey,
  generateSessionToken,
  hashApiKey,
  hashSessionToken,
} from "../middleware/auth.js";

const logger = createLogger("api:auth");
const router: express.Router = express.Router();
const users = new UserRepository();
const keys = new ApiKeyRepository();
const identities = new AuthIdentityRepository();
const sessions = new UserSessionRepository();
const nonces = new AuthNonceRepository();

const RegisterSchema = z.object({
  name: z.string().min(1).optional(),
  key_name: z.string().min(1).optional(),
});

const VerifySiweSchema = z.object({
  message: z.string().min(1),
  signature: z.string().min(1),
  name: z.string().min(1).optional(),
});

function keysMatch(provided: string, expected: string): boolean {
  const providedBuf = Buffer.from(provided, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");
  if (providedBuf.length !== expectedBuf.length) {
    return false;
  }
  return timingSafeEqual(providedBuf, expectedBuf);
}

function normalizeWalletAddress(address: string): string {
  return getAddress(address).toLowerCase();
}

function getSessionMaxAgeMs(): number {
  return Math.max(1, config.auth.sessionTtlHours) * 60 * 60 * 1000;
}

function setSessionCookie(res: express.Response, token: string): void {
  res.cookie(config.auth.sessionCookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.isProduction,
    maxAge: getSessionMaxAgeMs(),
    path: "/",
  });
}

function clearSessionCookie(res: express.Response): void {
  res.clearCookie(config.auth.sessionCookieName, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.isProduction,
    path: "/",
  });
}

router.post("/register", async (req, res) => {
  try {
    const registerAdminKey = config.auth.registerAdminKey.trim();
    if (registerAdminKey) {
      const provided = req.header("X-Admin-Key") ?? req.header("x-admin-key");
      if (!provided || !keysMatch(provided, registerAdminKey)) {
        return res.status(401).json({ error: "Unauthorized" });
      }
    }

    const { name, key_name } = RegisterSchema.parse(req.body ?? {});

    const user = await users.create(name ?? null);
    const apiKey = generateApiKey();
    const keyHash = hashApiKey(apiKey);
    const keyRecord = await keys.create(user.id, keyHash, key_name ?? null);

    res.status(201).json({
      user_id: user.id,
      api_key_id: keyRecord.id,
      api_key: apiKey,
    });
  } catch (error: unknown) {
    if (isZodError(error)) {
      return res.status(400).json({ error: "Invalid request", details: error.errors });
    }
    logger.error({ error: getErrorMessage(error) }, "Registration failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/siwe/nonce", async (_req, res) => {
  try {
    const nonce = generateSiweNonce();
    const expiresAt = new Date(Date.now() + config.auth.nonceTtlMinutes * 60 * 1000);
    await nonces.create("wallet", nonce, expiresAt);

    res.status(201).json({
      provider: "wallet",
      nonce,
      expires_at: expiresAt.toISOString(),
      domain: config.auth.siweDomain,
      uri: config.auth.siweUri,
    });
  } catch (error: unknown) {
    logger.error({ error: getErrorMessage(error) }, "Failed to issue SIWE nonce");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/siwe/verify", async (req, res) => {
  try {
    const { message, signature, name } = VerifySiweSchema.parse(req.body ?? {});

    let parsedMessage: ReturnType<typeof parseSiweMessage>;
    try {
      parsedMessage = parseSiweMessage(message);
    } catch {
      return res.status(400).json({ error: "Invalid SIWE message" });
    }

    if (
      !parsedMessage.address ||
      !parsedMessage.domain ||
      !parsedMessage.uri ||
      !parsedMessage.nonce
    ) {
      return res.status(400).json({ error: "Incomplete SIWE message" });
    }

    const normalizedAddress = normalizeWalletAddress(parsedMessage.address);

    if (parsedMessage.uri !== config.auth.siweUri) {
      return res.status(400).json({ error: "Unexpected SIWE URI" });
    }

    const validMessage = validateSiweMessage({
      message: parsedMessage,
      address: normalizedAddress as Address,
      domain: config.auth.siweDomain,
      nonce: parsedMessage.nonce,
      time: new Date(),
    });

    if (!validMessage) {
      return res.status(401).json({ error: "Invalid SIWE message" });
    }

    const nonceRecord = await nonces.consume("wallet", parsedMessage.nonce);
    if (!nonceRecord) {
      return res.status(401).json({ error: "Invalid or expired nonce" });
    }

    const validSignature = await verifyMessage({
      address: normalizedAddress as Address,
      message,
      signature: signature as `0x${string}`,
    });

    if (!validSignature) {
      return res.status(401).json({ error: "Invalid SIWE signature" });
    }

    const identityResult = await identities.findOrCreateUser({
      provider: "wallet",
      providerSubject: normalizedAddress,
      metadata: {
        address: normalizedAddress,
        chain_id: parsedMessage.chainId ?? null,
        domain: parsedMessage.domain,
        uri: parsedMessage.uri,
      },
      userName: name ?? null,
    });

    const sessionToken = generateSessionToken();
    const sessionExpiresAt = new Date(Date.now() + getSessionMaxAgeMs());
    const session = await sessions.create(
      identityResult.user.id,
      hashSessionToken(sessionToken),
      sessionExpiresAt,
    );

    setSessionCookie(res, sessionToken);

    res.status(200).json({
      user_id: identityResult.user.id,
      session_id: session.id,
      session_token: sessionToken,
      expires_at: session.expires_at,
      created: identityResult.created,
      auth_method: "session",
      identity: {
        provider: identityResult.identity.provider,
        provider_subject: identityResult.identity.provider_subject,
      },
    });
  } catch (error: unknown) {
    if (isZodError(error)) {
      return res.status(400).json({ error: "Invalid request", details: error.errors });
    }
    logger.error({ error: getErrorMessage(error) }, "SIWE verification failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/logout", async (req, res) => {
  try {
    if (!req.auth?.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (req.auth.authMethod !== "session" || !req.auth.sessionId) {
      return res.status(400).json({ error: "Logout requires session auth" });
    }

    await sessions.revoke(req.auth.sessionId);
    clearSessionCookie(res);

    res.json({ success: true });
  } catch (error: unknown) {
    logger.error({ error: getErrorMessage(error) }, "Logout failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/me", async (req, res) => {
  try {
    if (!req.auth?.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const [user, userIdentities] = await Promise.all([
      users.getById(req.auth.userId),
      identities.listByUserId(req.auth.userId),
    ]);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({
      user_id: user.id,
      name: user.name,
      created_at: user.created_at,
      auth_method: req.auth.authMethod,
      api_key_id: req.auth.apiKeyId ?? null,
      session_id: req.auth.sessionId ?? null,
      identities: userIdentities.map((identity) => ({
        id: identity.id,
        provider: identity.provider,
        provider_subject: identity.provider_subject,
        created_at: identity.created_at,
        metadata: identity.metadata,
      })),
    });
  } catch (error: unknown) {
    logger.error({ error: getErrorMessage(error) }, "Failed to fetch auth profile");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
