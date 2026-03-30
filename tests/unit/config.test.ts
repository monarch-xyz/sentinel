import { afterEach, describe, expect, it, vi } from "vitest";

type HyperSyncEnvKey =
  | "HYPERSYNC_MAX_LOGS_PER_REQUEST"
  | "HYPERSYNC_MAX_LOGS_PER_QUERY"
  | "HYPERSYNC_MAX_PAGES_PER_QUERY";

describe("config hypersync numeric env parsing", () => {
  const originalEnv: Record<HyperSyncEnvKey, string | undefined> = {
    HYPERSYNC_MAX_LOGS_PER_REQUEST: process.env.HYPERSYNC_MAX_LOGS_PER_REQUEST,
    HYPERSYNC_MAX_LOGS_PER_QUERY: process.env.HYPERSYNC_MAX_LOGS_PER_QUERY,
    HYPERSYNC_MAX_PAGES_PER_QUERY: process.env.HYPERSYNC_MAX_PAGES_PER_QUERY,
  };

  afterEach(() => {
    for (const [key, value] of Object.entries(originalEnv) as Array<
      [HyperSyncEnvKey, string | undefined]
    >) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    vi.resetModules();
  });

  it("falls back to safe defaults when hypersync numeric env values are malformed", async () => {
    process.env.HYPERSYNC_MAX_LOGS_PER_REQUEST = "abc";
    process.env.HYPERSYNC_MAX_LOGS_PER_QUERY = "0";
    process.env.HYPERSYNC_MAX_PAGES_PER_QUERY = "-1";
    vi.resetModules();

    const { config } = await import("../../src/config/index.ts");

    expect(config.hypersync.maxLogsPerRequest).toBe(10000);
    expect(config.hypersync.maxLogsPerQuery).toBe(100000);
    expect(config.hypersync.maxPagesPerQuery).toBe(25);
  });

  it("accepts valid positive integer hypersync numeric env values", async () => {
    process.env.HYPERSYNC_MAX_LOGS_PER_REQUEST = "123";
    process.env.HYPERSYNC_MAX_LOGS_PER_QUERY = "456";
    process.env.HYPERSYNC_MAX_PAGES_PER_QUERY = "7";
    vi.resetModules();

    const { config } = await import("../../src/config/index.ts");

    expect(config.hypersync.maxLogsPerRequest).toBe(123);
    expect(config.hypersync.maxLogsPerQuery).toBe(456);
    expect(config.hypersync.maxPagesPerQuery).toBe(7);
  });
});
