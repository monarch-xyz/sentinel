/**
 * SignalEvaluator - Orchestrates signal evaluation
 *
 * This module is protocol-agnostic. Protocol-specific data fetching
 * is handled by DataFetcher implementations (e.g., MorphoDataFetcher).
 */

import {
  type ComparisonOp,
  EventRef,
  type ExpressionNode,
  type Filter,
  StateRef,
} from "../types/index.js";
import { parseDuration } from "../utils/duration.js";
import { createLogger } from "../utils/logger.js";
import {
  type CompiledAggregateCondition,
  type CompiledCondition,
  buildMetricExpression,
  isSimpleCondition,
} from "./compiler.js";
import { type EvalContext, evaluateCondition, evaluateNode } from "./evaluator.js";
import type { DataFetcher } from "./fetcher.js";
import { getMetric } from "./metrics.js";

const logger = createLogger("signal-evaluator");

function getMetricEntity(metricName: string): "Position" | "Market" | "Event" | "Unknown" {
  const metric = getMetric(metricName);
  if (!metric) return "Unknown";
  if (metric.kind === "state") return metric.entity as "Position" | "Market";
  if (metric.kind === "computed") {
    return getMetricEntity(metric.operands[0]);
  }
  if (metric.kind === "event" || metric.kind === "chained_event") return "Event";
  return "Unknown";
}

function upsertUserFilter(filters: Filter[], address: string): Filter[] {
  const next = filters.filter((filter) => filter.field !== "user");
  next.push({ field: "user", op: "eq", value: address });
  return next;
}

function applyUserFilterToNode(node: ExpressionNode, address: string): ExpressionNode {
  switch (node.type) {
    case "constant":
      return node;
    case "state":
      return { ...node, filters: upsertUserFilter(node.filters, address) };
    case "event":
      return { ...node, filters: upsertUserFilter(node.filters, address) };
    case "expression":
      return {
        ...node,
        left: applyUserFilterToNode(node.left, address),
        right: applyUserFilterToNode(node.right, address),
      };
    default:
      return node;
  }
}

function compareValues(left: number, operator: ComparisonOp, right: number): boolean {
  switch (operator) {
    case "gt":
      return left > right;
    case "gte":
      return left >= right;
    case "lt":
      return left < right;
    case "lte":
      return left <= right;
    case "eq":
      return left === right;
    case "neq":
      return left !== right;
    default:
      return false;
  }
}

function aggregateValues(
  values: number[],
  aggregation: CompiledAggregateCondition["aggregation"],
): number {
  if (values.length === 0) return 0;
  switch (aggregation) {
    case "sum":
      return values.reduce((acc, value) => acc + value, 0);
    case "avg":
      return values.reduce((acc, value) => acc + value, 0) / values.length;
    case "min":
      return Math.min(...values);
    case "max":
      return Math.max(...values);
    case "count":
      return values.length;
    default:
      return 0;
  }
}

function withWindowOverride(context: EvalContext, windowOverride?: string): EvalContext {
  if (!windowOverride) return context;
  const durationMs = parseDuration(windowOverride);
  return {
    ...context,
    windowDuration: windowOverride,
    windowStart: context.now - durationMs,
  };
}

function buildAggregateTargets(
  cond: CompiledAggregateCondition,
): Array<{ marketId?: string; address?: string }> {
  const metricEntity = getMetricEntity(cond.metric);
  const marketIds = cond.marketIds && cond.marketIds.length > 0 ? cond.marketIds : undefined;
  const addresses = cond.addresses && cond.addresses.length > 0 ? cond.addresses : undefined;

  if (metricEntity === "Market") {
    if (!marketIds) return [];
    return marketIds.map((marketId) => ({ marketId }));
  }

  if (metricEntity === "Position") {
    if (!marketIds || !addresses) return [];
    const targets: Array<{ marketId?: string; address?: string }> = [];
    for (const marketId of marketIds) {
      for (const address of addresses) {
        targets.push({ marketId, address });
      }
    }
    return targets;
  }

  const targets: Array<{ marketId?: string; address?: string }> = [];
  const marketsForEvents = marketIds ?? [undefined];
  const addressesForEvents = addresses ?? [undefined];
  for (const marketId of marketsForEvents) {
    for (const address of addressesForEvents) {
      targets.push({ marketId, address });
    }
  }
  return targets;
}

async function evaluateAggregateCondition(
  cond: CompiledAggregateCondition,
  context: EvalContext,
): Promise<boolean> {
  const scopedContext = withWindowOverride(context, cond.window);
  const targets = buildAggregateTargets(cond);
  if (targets.length === 0) {
    throw new Error("Aggregate condition has no targets to evaluate");
  }

  const values: number[] = [];

  for (const target of targets) {
    const expression = buildMetricExpression(
      cond.metric,
      "current",
      cond.chainId,
      target.marketId,
      target.address,
      cond.filters,
    );
    const value = await evaluateNode(expression, scopedContext);
    values.push(value);
  }

  const aggregated = aggregateValues(values, cond.aggregation);
  return compareValues(aggregated, cond.operator, cond.value);
}

async function evaluateGroupCondition(
  cond: Extract<CompiledCondition, { type: "group" }>,
  context: EvalContext,
): Promise<boolean> {
  const groupContext = withWindowOverride(context, cond.window);
  let triggeredCount = 0;
  const total = cond.addresses.length;
  const required = cond.requirement.count;
  const innerLogic = cond.logic ?? "AND";

  for (let i = 0; i < total; i++) {
    const address = cond.addresses[i];
    let innerTriggered = innerLogic === "AND";
    for (const innerCondition of cond.perAddressConditions) {
      const left = applyUserFilterToNode(innerCondition.left, address);
      const right = applyUserFilterToNode(innerCondition.right, address);
      const innerContext = withWindowOverride(groupContext, innerCondition.window);
      const triggered = await evaluateCondition(left, innerCondition.operator, right, innerContext);

      if (innerLogic === "AND" && !triggered) {
        innerTriggered = false;
        break;
      }
      if (innerLogic === "OR" && triggered) {
        innerTriggered = true;
        break;
      }
      if (innerLogic === "OR") innerTriggered = false;
    }

    if (innerTriggered) {
      triggeredCount += 1;
      if (triggeredCount >= required) return true;
    }

    const remaining = total - (i + 1);
    if (triggeredCount + remaining < required) return false;
  }

  return triggeredCount >= required;
}

async function evaluateCompiledCondition(
  cond: CompiledCondition,
  context: EvalContext,
): Promise<boolean> {
  if (isSimpleCondition(cond)) {
    const scopedContext = withWindowOverride(context, cond.window);
    return evaluateCondition(cond.left, cond.operator, cond.right, scopedContext);
  }
  if (cond.type === "group") {
    return evaluateGroupCondition(cond, context);
  }
  return evaluateAggregateCondition(cond, context);
}

export async function evaluateConditionSet(
  conditions: CompiledCondition[],
  logic: "AND" | "OR",
  context: EvalContext,
): Promise<boolean> {
  if (conditions.length === 0) {
    throw new Error("No conditions provided for evaluation");
  }

  if (logic === "AND") {
    for (const condition of conditions) {
      const triggered = await evaluateCompiledCondition(condition, context);
      if (!triggered) return false;
    }
    return true;
  }

  for (const condition of conditions) {
    const triggered = await evaluateCompiledCondition(condition, context);
    if (triggered) return true;
  }
  return false;
}

export interface SignalEvaluationResult {
  signalId: string;
  triggered: boolean;
  timestamp: number;
  /** If evaluation failed, this contains the error */
  error?: string;
  /** Whether the result is conclusive (false if data fetch failed) */
  conclusive: boolean;
}

export interface EvaluatableSignal {
  id: string;
  name?: string;
  description?: string;
  chains: number[];
  window: { duration: string };
  conditions: CompiledCondition[];
  logic?: "AND" | "OR";
  webhook_url?: string;
  cooldown_minutes?: number;
  is_active?: boolean;
  last_triggered_at?: string | Date;
  last_evaluated_at?: string | Date;
}

export class SignalEvaluator {
  private fetcher: DataFetcher;

  /**
   * Create a SignalEvaluator with a protocol-specific DataFetcher
   *
   * @param fetcher - DataFetcher implementation (e.g., from createMorphoFetcher)
   */
  constructor(fetcher: DataFetcher) {
    this.fetcher = fetcher;
  }

  async evaluate(signal: EvaluatableSignal): Promise<SignalEvaluationResult> {
    const now = Date.now();
    const defaultChainId = signal.chains[0] ?? 1;

    try {
      const durationMs = parseDuration(signal.window.duration);
      const windowStart = now - durationMs;

      const context: EvalContext = {
        chainId: defaultChainId,
        windowDuration: signal.window.duration,
        now,
        windowStart,
        // Delegate to the protocol-specific DataFetcher
        fetchState: (ref, ts) => this.fetcher.fetchState(ref, ts),
        fetchEvents: (ref, start, end) => this.fetcher.fetchEvents(ref, start, end),
      };

      const conditions = signal.conditions;
      const logic = signal.logic ?? "AND";
      const triggered = await evaluateConditionSet(conditions, logic, context);

      return {
        signalId: signal.id,
        triggered,
        timestamp: now,
        conclusive: true,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error({ signalId: signal.id, error }, "Signal evaluation failed");
      return {
        signalId: signal.id,
        triggered: false,
        timestamp: now,
        error,
        conclusive: false,
      };
    }
  }
}
