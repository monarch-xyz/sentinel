import { resolveBlockByTimestamp } from "../envio/blocks.js";
import { EnvioClient } from "../envio/client.js";
import type { ComparisonOp } from "../types/index.js";
import { isSimpleCondition } from "./compiler.js";
import { evaluateConditionSet } from "./condition.js";
import type { EvaluatableSignal } from "./condition.js";
import { type EvalContext, evaluateNode, parseDuration } from "./evaluator.js";
import type { DataFetcher } from "./fetcher.js";
import { createMorphoFetcher } from "./morpho-fetcher.js";

export interface SimulationRequest {
  signal: EvaluatableSignal; // The signal to simulate
  atTimestamp: number; // Unix timestamp (ms) to simulate at
  chainId: number; // Which chain to evaluate on
  fetcher?: DataFetcher; // Optional: reuse a fetcher across simulations
}

export interface SimulationResult {
  triggered: boolean; // Did condition evaluate to true?
  leftValue?: number; // Evaluated left side of condition (single condition only)
  rightValue?: number; // Evaluated right side of condition (single condition only)
  operator?: ComparisonOp; // The comparison operator (single condition only)
  evaluatedAt: number; // The timestamp used for evaluation
  windowStart: number; // The calculated window start
  blockNumbers: {
    current: number; // Block number for "current" state queries
    windowStart: number; // Block number for "window_start" state queries
  };
  executionTimeMs: number; // How long evaluation took
}

/**
 * Simulate a signal at a specific historical timestamp.
 *
 * This allows testing and debugging signals by evaluating them
 * as if we were at a specific point in time.
 */
export async function simulateSignal(req: SimulationRequest): Promise<SimulationResult> {
  const startTime = Date.now();

  const { signal, atTimestamp, chainId, fetcher } = req;

  // Calculate window timing
  const windowDurationMs = parseDuration(signal.window.duration);
  const windowStart = atTimestamp - windowDurationMs;

  // Resolve block numbers for both timestamps
  const [currentBlock, windowStartBlock] = await Promise.all([
    resolveBlockByTimestamp(chainId, atTimestamp),
    resolveBlockByTimestamp(chainId, windowStart),
  ]);

  // Create Envio client (for events) and morpho fetcher (for state)
  const dataFetcher = fetcher ?? createMorphoFetcher(new EnvioClient(), { chainId });

  // Create the evaluation context with simulated timestamps
  const context: EvalContext = {
    chainId,
    windowDuration: signal.window.duration,
    now: atTimestamp,
    windowStart,

    // Fetch state via RPC (uses timestamp resolution internally)
    fetchState: async (ref, timestamp?) => {
      // For simulation, we treat "current" as the simulated timestamp
      const ts = timestamp ?? atTimestamp;
      return dataFetcher.fetchState(ref, ts);
    },

    // Fetch events in a time window
    fetchEvents: async (ref, start, end) => {
      return dataFetcher.fetchEvents(ref, start, end);
    },
  };

  const conditions = signal.conditions;
  const logic = signal.logic ?? "AND";

  let leftValue: number | undefined;
  let rightValue: number | undefined;
  let operator: ComparisonOp | undefined;

  if (conditions.length === 1 && isSimpleCondition(conditions[0])) {
    const simple = conditions[0];
    [leftValue, rightValue] = await Promise.all([
      evaluateNode(simple.left, context),
      evaluateNode(simple.right, context),
    ]);
    operator = simple.operator;
  }

  const triggered = await evaluateConditionSet(conditions, logic, context);

  const executionTimeMs = Date.now() - startTime;

  return {
    triggered,
    leftValue,
    rightValue,
    operator,
    evaluatedAt: atTimestamp,
    windowStart,
    blockNumbers: {
      current: currentBlock,
      windowStart: windowStartBlock,
    },
    executionTimeMs,
  };
}

/**
 * Simulate a signal at multiple timestamps to find when it would trigger.
 * Useful for backtesting and debugging.
 */
export async function simulateSignalOverTime(
  signal: EvaluatableSignal,
  chainId: number,
  startTimestamp: number,
  endTimestamp: number,
  stepMs = 3600000, // default 1 hour
  fetcher?: DataFetcher,
): Promise<SimulationResult[]> {
  const results: SimulationResult[] = [];
  const dataFetcher = fetcher ?? createMorphoFetcher(new EnvioClient(), { chainId });

  for (let ts = startTimestamp; ts <= endTimestamp; ts += stepMs) {
    const result = await simulateSignal({ signal, atTimestamp: ts, chainId, fetcher: dataFetcher });
    results.push(result);
  }

  return results;
}

/**
 * Find the first timestamp where a signal would have triggered.
 * Uses binary search for efficiency.
 */
export async function findFirstTrigger(
  signal: EvaluatableSignal,
  chainId: number,
  startTimestamp: number,
  endTimestamp: number,
  precisionMs = 60000, // default 1 minute
  fetcher?: DataFetcher,
): Promise<SimulationResult | null> {
  const dataFetcher = fetcher ?? createMorphoFetcher(new EnvioClient(), { chainId });
  // First check if end triggers - if not, no trigger in range
  const endResult = await simulateSignal({
    signal,
    atTimestamp: endTimestamp,
    chainId,
    fetcher: dataFetcher,
  });
  if (!endResult.triggered) {
    return null;
  }

  // Check if start triggers
  const startResult = await simulateSignal({
    signal,
    atTimestamp: startTimestamp,
    chainId,
    fetcher: dataFetcher,
  });
  if (startResult.triggered) {
    return startResult;
  }

  // Binary search for the transition point
  let low = startTimestamp;
  let high = endTimestamp;

  while (high - low > precisionMs) {
    const mid = Math.floor((low + high) / 2);
    const midResult = await simulateSignal({
      signal,
      atTimestamp: mid,
      chainId,
      fetcher: dataFetcher,
    });

    if (midResult.triggered) {
      high = mid;
    } else {
      low = mid;
    }
  }

  // Return the result at high (first triggered point)
  return simulateSignal({ signal, atTimestamp: high, chainId, fetcher: dataFetcher });
}
