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

type MockRequest = Partial<Request> & {
  path: string;
  header: (name: string) => string | undefined;
};

type MockResponse = Partial<Response> & {
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
};

const hashApiKey = (key: string) => createHash("sha256").update(key).digest("hex");

const loadAuthMiddleware = async (recordsByHash: Record<string, ApiKeyRecord> = {}) => {
  vi.resetModules();
  const getByHash = vi.fn(async (hash: string) => recordsByHash[hash]);
  const touchLastUsed = vi.fn(async () => {});
  vi.doMock("../../src/db/index.js", () => ({
    ApiKeyRepository: class {
      getByHash = getByHash;
      touchLastUsed = touchLastUsed;
    },
  }));
  const { authMiddleware } = await import("../../src/api/middleware/auth.js");
  return { authMiddleware, getByHash, touchLastUsed };
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
  it("Should return 401 when x-api-key is missing", async () => {
    const { authMiddleware } = await loadAuthMiddleware();
    const req: MockRequest = { path: "/api/v1/foo", header: vi.fn(() => undefined) };
    const res = makeRes();
    const next: NextFunction = vi.fn();

    await authMiddleware(req as Request, res as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Missing API key" });
  });

  it("Should allow requests with valid x-api-key header", async () => {
    const apiKey = "secret";
    const keyHash = hashApiKey(apiKey);
    const record: ApiKeyRecord = {
      id: "key-1",
      user_id: "user-1",
      key_hash: keyHash,
      name: null,
      is_active: true,
      created_at: new Date().toISOString(),
      last_used_at: null,
    };
    const { authMiddleware, touchLastUsed } = await loadAuthMiddleware({ [keyHash]: record });
    const req: MockRequest = {
      path: "/api/v1/foo",
      header: vi.fn((name: string) => (name === "x-api-key" ? apiKey : undefined)),
    };
    const res = makeRes();
    const next: NextFunction = vi.fn();

    await authMiddleware(req as Request, res as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    expect(touchLastUsed).toHaveBeenCalledWith("key-1");
    expect((req as Request).auth).toMatchObject({ userId: "user-1", apiKeyId: "key-1" });
  });

  it("Should return 401 when x-api-key is invalid", async () => {
    const apiKey = "secret";
    const keyHash = hashApiKey(apiKey);
    const record: ApiKeyRecord = {
      id: "key-1",
      user_id: "user-1",
      key_hash: keyHash,
      name: null,
      is_active: true,
      created_at: new Date().toISOString(),
      last_used_at: null,
    };
    const { authMiddleware } = await loadAuthMiddleware({ [keyHash]: record });
    const req: MockRequest = {
      path: "/api/v1/foo",
      header: vi.fn((name: string) => (name === "x-api-key" ? "wrong" : undefined)),
    };
    const res = makeRes();
    const next: NextFunction = vi.fn();

    await authMiddleware(req as Request, res as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Invalid API key" });
  });

  it("Should always allow /health endpoint regardless of auth", async () => {
    const { authMiddleware } = await loadAuthMiddleware();
    const req: MockRequest = { path: "/health", header: vi.fn(() => undefined) };
    const res = makeRes();
    const next: NextFunction = vi.fn();

    await authMiddleware(req as Request, res as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });
});
