/**
 * Smoke tests - verify critical files exist and can be imported
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Startup smoke tests", () => {
  const ROOT = resolve(__dirname, "../../");

  it("API entry point exists", () => {
    const apiPath = resolve(ROOT, "src/api/index.ts");
    expect(existsSync(apiPath)).toBe(true);
  });

  it("Worker entry point exists", () => {
    const workerPath = resolve(ROOT, "src/worker/index.ts");
    expect(existsSync(workerPath)).toBe(true);
  });

  it("Config can be imported", async () => {
    const { config } = await import("../../src/config/index.ts");
    expect(config).toBeDefined();
    expect(config.api.port).toBeDefined();
  });

  it("Compiler can be imported", async () => {
    const { compileCondition } = await import("../../src/engine/compiler.ts");
    expect(compileCondition).toBeDefined();
  });

  it("Evaluator can be imported", async () => {
    const { evaluateNode } = await import("../../src/engine/evaluator.ts");
    expect(evaluateNode).toBeDefined();
  });
});
