import { createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";

type ApiKeyRecord = {
  id: string;
  user_id: string;
  key_hash: string;
  name: string | null;
  is_active: boolean;
  created_at: string;
  last_used_at?: string | null;
};

type SessionRecord = {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  created_at: string;
  last_used_at: string;
  revoked_at: string | null;
};

type MockRequest = Partial<Request> & {
  path: string;
  header: (name: string) => string | undefined;
};

type MockResponse = Partial<Response> & {
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
};

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

const loadAuthMiddleware = async ({
  apiKeysByHash = {},
  sessionsByHash = {},
}: {
  apiKeysByHash?: Record<string, ApiKeyRecord>;
  sessionsByHash?: Record<string, SessionRecord>;
} = {}) => {
  vi.resetModules();
  const getByHash = vi.fn(async (hash: string) => apiKeysByHash[hash]);
  const touchApiKeyLastUsed = vi.fn(async () => {});
  const getActiveByHash = vi.fn(async (hash: string) => sessionsByHash[hash]);
  const touchSessionLastUsed = vi.fn(async () => {});

  vi.doMock("../../src/db/index.js", () => ({
    ApiKeyRepository: class {
      getByHash = getByHash;
      touchLastUsed = touchApiKeyLastUsed;
    },
    UserSessionRepository: class {
      getActiveByHash = getActiveByHash;
      touchLastUsed = touchSessionLastUsed;
    },
  }));

  const { authMiddleware } = await import("../../src/api/middleware/auth.js");
  return { authMiddleware, getByHash, touchApiKeyLastUsed, getActiveByHash, touchSessionLastUsed };
};

const makeRes = (): MockResponse => {
  const res: MockResponse = {
    status: vi.fn(),
    json: vi.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
};

describe("auth middleware", () => {
  it("returns 401 when credentials are missing", async () => {
    const { authMiddleware } = await loadAuthMiddleware();
    const req: MockRequest = { path: "/signals", header: vi.fn(() => undefined) };
    const res = makeRes();
    const next: NextFunction = vi.fn();

    await authMiddleware(req as Request, res as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Missing authentication credentials" });
  });

  it("allows requests with a valid x-api-key header", async () => {
    const apiKey = "sentinel_test";
    const keyHash = sha256(apiKey);
    const record: ApiKeyRecord = {
      id: "key-1",
      user_id: "user-1",
      key_hash: keyHash,
      name: null,
      is_active: true,
      created_at: new Date().toISOString(),
      last_used_at: null,
    };
    const { authMiddleware, touchApiKeyLastUsed } = await loadAuthMiddleware({
      apiKeysByHash: { [keyHash]: record },
    });

    const req: MockRequest = {
      path: "/signals",
      header: vi.fn((name: string) => (name.toLowerCase() === "x-api-key" ? apiKey : undefined)),
    };
    const res = makeRes();
    const next: NextFunction = vi.fn();

    await authMiddleware(req as Request, res as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(touchApiKeyLastUsed).toHaveBeenCalledWith("key-1");
    expect((req as Request).auth).toMatchObject({
      userId: "user-1",
      apiKeyId: "key-1",
      authMethod: "api_key",
    });
  });

  it("returns 401 when x-api-key is invalid", async () => {
    const { authMiddleware } = await loadAuthMiddleware();
    const req: MockRequest = {
      path: "/signals",
      header: vi.fn((name: string) => (name.toLowerCase() === "x-api-key" ? "wrong" : undefined)),
    };
    const res = makeRes();
    const next: NextFunction = vi.fn();

    await authMiddleware(req as Request, res as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Invalid API key" });
  });

  it("allows requests with a valid session cookie", async () => {
    const sessionToken = "sentinel_session_test";
    const sessionHash = sha256(sessionToken);
    const record: SessionRecord = {
      id: "session-1",
      user_id: "user-2",
      token_hash: sessionHash,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      created_at: new Date().toISOString(),
      last_used_at: new Date().toISOString(),
      revoked_at: null,
    };
    const { authMiddleware, touchSessionLastUsed } = await loadAuthMiddleware({
      sessionsByHash: { [sessionHash]: record },
    });

    const req: MockRequest = {
      path: "/signals",
      header: vi.fn((name: string) =>
        name.toLowerCase() === "cookie" ? `sentinel_session=${sessionToken}` : undefined,
      ),
    };
    const res = makeRes();
    const next: NextFunction = vi.fn();

    await authMiddleware(req as Request, res as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(touchSessionLastUsed).toHaveBeenCalledWith("session-1");
    expect((req as Request).auth).toMatchObject({
      userId: "user-2",
      sessionId: "session-1",
      authMethod: "session",
    });
  });

  it("allows public auth bootstrap endpoints without credentials", async () => {
    const { authMiddleware } = await loadAuthMiddleware();
    const req: MockRequest = { path: "/auth/siwe/nonce", header: vi.fn(() => undefined) };
    const res = makeRes();
    const next: NextFunction = vi.fn();

    await authMiddleware(req as Request, res as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("always allows /health regardless of auth", async () => {
    const { authMiddleware } = await loadAuthMiddleware();
    const req: MockRequest = { path: "/health", header: vi.fn(() => undefined) };
    const res = makeRes();
    const next: NextFunction = vi.fn();

    await authMiddleware(req as Request, res as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("always allows /ready regardless of auth", async () => {
    const { authMiddleware } = await loadAuthMiddleware();
    const req: MockRequest = { path: "/ready", header: vi.fn(() => undefined) };
    const res = makeRes();
    const next: NextFunction = vi.fn();

    await authMiddleware(req as Request, res as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});
