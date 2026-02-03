import { ExpressionNode, StateRef, EventRef, ComparisonOp } from '../types/index.js';
import { parseDuration } from '../utils/duration.js';

// Re-export for backwards compatibility
export { parseDuration } from '../utils/duration.js';

/**
 * Error thrown during expression evaluation
 */
export class EvaluationError extends Error {
  constructor(
    message: string,
    public readonly code: 'DIVISION_BY_ZERO' | 'FETCH_FAILED' | 'INVALID_NODE',
    public readonly node?: ExpressionNode
  ) {
    super(message);
    this.name = 'EvaluationError';
  }
}

export interface EvalContext {
  chainId: number;
  windowDuration: string;
  now: number;
  windowStart: number;
  // Methods to be implemented for data fetching
  fetchState: (ref: StateRef, timestamp?: number) => Promise<number>;
  fetchEvents: (ref: EventRef, start: number, end: number) => Promise<number>;
}

/**
 * Resolves snapshot timing to a timestamp
 */
function resolveSnapshotTimestamp(snapshot: string | undefined, context: EvalContext): number | undefined {
  if (!snapshot || snapshot === 'current') return undefined;
  if (snapshot === 'window_start') return context.windowStart;
  
  // Custom duration string (e.g., "2d", "7d")
  const durationMs = parseDuration(snapshot);
  return context.now - durationMs;
}

/**
 * Evaluates a single math node (returns numeric result)
 */
export async function evaluateNode(node: ExpressionNode, context: EvalContext): Promise<number> {
  switch (node.type) {
    case 'constant':
      return node.value;
    case 'state': {
      const ts = resolveSnapshotTimestamp(node.snapshot, context);
      return context.fetchState(node, ts);
    }
    case 'event': {
      // Use custom window if specified, otherwise use signal-level window
      let start = context.windowStart;
      if (node.window) {
        const customDuration = parseDuration(node.window);
        start = context.now - customDuration;
      }
      return context.fetchEvents(node, start, context.now);
    }
    case 'expression': {
      const left = await evaluateNode(node.left, context);
      const right = await evaluateNode(node.right, context);
      switch (node.operator) {
        case 'add': return left + right;
        case 'sub': return left - right;
        case 'mul': return left * right;
        case 'div': 
          if (right === 0) {
            throw new EvaluationError(
              'Division by zero in expression',
              'DIVISION_BY_ZERO',
              node
            );
          }
          return left / right;
        default:
          throw new EvaluationError(
            `Unknown operator: ${(node as any).operator}`,
            'INVALID_NODE',
            node
          );
      }
    }
    default:
      throw new EvaluationError(
        `Unknown node type: ${(node as any).type}`,
        'INVALID_NODE',
        node
      );
  }
}

/**
 * Evaluates a comparison condition (returns boolean result)
 */
export async function evaluateCondition(
  left: ExpressionNode, 
  operator: ComparisonOp, 
  right: ExpressionNode, 
  context: EvalContext
): Promise<boolean> {
  const leftVal = await evaluateNode(left, context);
  const rightVal = await evaluateNode(right, context);

  switch (operator) {
    case 'gt': return leftVal > rightVal;
    case 'gte': return leftVal >= rightVal;
    case 'lt': return leftVal < rightVal;
    case 'lte': return leftVal <= rightVal;
    case 'eq': return leftVal === rightVal;
    case 'neq': return leftVal !== rightVal;
    default: return false;
  }
}
