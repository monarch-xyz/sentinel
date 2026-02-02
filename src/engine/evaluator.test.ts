import { describe, it, expect, vi } from 'vitest';
import { evaluateNode, evaluateCondition, parseDuration, EvalContext } from './evaluator.js';
import { ExpressionNode, Constant, BinaryExpression, StateRef, EventRef, ComparisonOp } from '../types/index.js';

// Helper to create a mock context
function createMockContext(overrides: Partial<EvalContext> = {}): EvalContext {
  const now = Date.now();
  return {
    chainId: 1,
    windowDuration: '1h',
    now,
    windowStart: now - 3600000, // 1 hour ago
    fetchState: vi.fn().mockResolvedValue(0),
    fetchEvents: vi.fn().mockResolvedValue(0),
    ...overrides,
  };
}

// Helper to create constant nodes
function constant(value: number): Constant {
  return { type: 'constant', value };
}

// Helper to create binary expression nodes
function expr(left: ExpressionNode, operator: 'add' | 'sub' | 'mul' | 'div', right: ExpressionNode): BinaryExpression {
  return { type: 'expression', left, operator, right };
}

describe('parseDuration', () => {
  it('parses minutes', () => {
    expect(parseDuration('30m')).toBe(30 * 60 * 1000);
    expect(parseDuration('1m')).toBe(60 * 1000);
  });

  it('parses hours', () => {
    expect(parseDuration('1h')).toBe(60 * 60 * 1000);
    expect(parseDuration('24h')).toBe(24 * 60 * 60 * 1000);
  });

  it('parses days', () => {
    expect(parseDuration('1d')).toBe(24 * 60 * 60 * 1000);
    expect(parseDuration('7d')).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('parses weeks', () => {
    expect(parseDuration('1w')).toBe(7 * 24 * 60 * 60 * 1000);
    expect(parseDuration('2w')).toBe(14 * 24 * 60 * 60 * 1000);
  });

  it('throws on invalid format', () => {
    expect(() => parseDuration('invalid')).toThrow('Invalid duration format');
    expect(() => parseDuration('10s')).toThrow('Invalid duration format'); // seconds not supported
    expect(() => parseDuration('')).toThrow('Invalid duration format');
    expect(() => parseDuration('1')).toThrow('Invalid duration format');
  });
});

describe('evaluateNode', () => {
  describe('constant nodes', () => {
    it('returns the constant value', async () => {
      const ctx = createMockContext();
      expect(await evaluateNode(constant(42), ctx)).toBe(42);
      expect(await evaluateNode(constant(0), ctx)).toBe(0);
      expect(await evaluateNode(constant(-10), ctx)).toBe(-10);
      expect(await evaluateNode(constant(3.14159), ctx)).toBe(3.14159);
    });

    it('handles edge case numbers', async () => {
      const ctx = createMockContext();
      expect(await evaluateNode(constant(Number.MAX_SAFE_INTEGER), ctx)).toBe(Number.MAX_SAFE_INTEGER);
      expect(await evaluateNode(constant(Number.MIN_SAFE_INTEGER), ctx)).toBe(Number.MIN_SAFE_INTEGER);
      expect(await evaluateNode(constant(Infinity), ctx)).toBe(Infinity);
      expect(await evaluateNode(constant(-Infinity), ctx)).toBe(-Infinity);
    });
  });

  describe('binary expressions - add', () => {
    it('adds two constants', async () => {
      const ctx = createMockContext();
      expect(await evaluateNode(expr(constant(2), 'add', constant(3)), ctx)).toBe(5);
    });

    it('handles negative numbers', async () => {
      const ctx = createMockContext();
      expect(await evaluateNode(expr(constant(-5), 'add', constant(3)), ctx)).toBe(-2);
      expect(await evaluateNode(expr(constant(5), 'add', constant(-10)), ctx)).toBe(-5);
    });

    it('handles zero', async () => {
      const ctx = createMockContext();
      expect(await evaluateNode(expr(constant(0), 'add', constant(5)), ctx)).toBe(5);
      expect(await evaluateNode(expr(constant(5), 'add', constant(0)), ctx)).toBe(5);
    });

    it('handles decimals', async () => {
      const ctx = createMockContext();
      expect(await evaluateNode(expr(constant(1.5), 'add', constant(2.5)), ctx)).toBe(4);
    });
  });

  describe('binary expressions - sub', () => {
    it('subtracts two constants', async () => {
      const ctx = createMockContext();
      expect(await evaluateNode(expr(constant(10), 'sub', constant(3)), ctx)).toBe(7);
    });

    it('handles negative results', async () => {
      const ctx = createMockContext();
      expect(await evaluateNode(expr(constant(3), 'sub', constant(10)), ctx)).toBe(-7);
    });

    it('handles negative operands', async () => {
      const ctx = createMockContext();
      expect(await evaluateNode(expr(constant(-5), 'sub', constant(-3)), ctx)).toBe(-2);
    });
  });

  describe('binary expressions - mul', () => {
    it('multiplies two constants', async () => {
      const ctx = createMockContext();
      expect(await evaluateNode(expr(constant(4), 'mul', constant(5)), ctx)).toBe(20);
    });

    it('handles zero', async () => {
      const ctx = createMockContext();
      expect(await evaluateNode(expr(constant(100), 'mul', constant(0)), ctx)).toBe(0);
      expect(await evaluateNode(expr(constant(0), 'mul', constant(100)), ctx)).toBe(0);
    });

    it('handles negative numbers', async () => {
      const ctx = createMockContext();
      expect(await evaluateNode(expr(constant(-3), 'mul', constant(4)), ctx)).toBe(-12);
      expect(await evaluateNode(expr(constant(-3), 'mul', constant(-4)), ctx)).toBe(12);
    });

    it('handles decimals', async () => {
      const ctx = createMockContext();
      expect(await evaluateNode(expr(constant(2.5), 'mul', constant(4)), ctx)).toBe(10);
    });
  });

  describe('binary expressions - div', () => {
    it('divides two constants', async () => {
      const ctx = createMockContext();
      expect(await evaluateNode(expr(constant(20), 'div', constant(4)), ctx)).toBe(5);
    });

    it('handles division resulting in decimal', async () => {
      const ctx = createMockContext();
      expect(await evaluateNode(expr(constant(7), 'div', constant(2)), ctx)).toBe(3.5);
    });

    it('returns 0 for division by zero', async () => {
      const ctx = createMockContext();
      expect(await evaluateNode(expr(constant(10), 'div', constant(0)), ctx)).toBe(0);
      expect(await evaluateNode(expr(constant(0), 'div', constant(0)), ctx)).toBe(0);
      expect(await evaluateNode(expr(constant(-10), 'div', constant(0)), ctx)).toBe(0);
    });

    it('handles negative numbers', async () => {
      const ctx = createMockContext();
      expect(await evaluateNode(expr(constant(-12), 'div', constant(4)), ctx)).toBe(-3);
      expect(await evaluateNode(expr(constant(12), 'div', constant(-4)), ctx)).toBe(-3);
      expect(await evaluateNode(expr(constant(-12), 'div', constant(-4)), ctx)).toBe(3);
    });

    it('handles zero numerator', async () => {
      const ctx = createMockContext();
      expect(await evaluateNode(expr(constant(0), 'div', constant(5)), ctx)).toBe(0);
    });
  });

  describe('nested expressions', () => {
    it('evaluates nested addition', async () => {
      const ctx = createMockContext();
      // (1 + 2) + 3 = 6
      const nested = expr(expr(constant(1), 'add', constant(2)), 'add', constant(3));
      expect(await evaluateNode(nested, ctx)).toBe(6);
    });

    it('evaluates deeply nested expressions', async () => {
      const ctx = createMockContext();
      // ((2 + 3) * 4) - 5 = 15
      const inner = expr(constant(2), 'add', constant(3)); // 5
      const middle = expr(inner, 'mul', constant(4)); // 20
      const outer = expr(middle, 'sub', constant(5)); // 15
      expect(await evaluateNode(outer, ctx)).toBe(15);
    });

    it('evaluates complex nested with division', async () => {
      const ctx = createMockContext();
      // (10 / 2) + (8 - 3) = 5 + 5 = 10
      const left = expr(constant(10), 'div', constant(2));
      const right = expr(constant(8), 'sub', constant(3));
      const result = expr(left, 'add', right);
      expect(await evaluateNode(result, ctx)).toBe(10);
    });

    it('handles division by zero in nested expression', async () => {
      const ctx = createMockContext();
      // (10 / 0) + 5 = 0 + 5 = 5
      const divByZero = expr(constant(10), 'div', constant(0));
      const result = expr(divByZero, 'add', constant(5));
      expect(await evaluateNode(result, ctx)).toBe(5);
    });
  });

  describe('state references', () => {
    it('fetches state with current snapshot', async () => {
      const fetchState = vi.fn().mockResolvedValue(100);
      const ctx = createMockContext({ fetchState });

      const stateRef: StateRef = {
        type: 'state',
        entity_type: 'Pool',
        filters: [{ field: 'id', op: 'eq', value: '0x123' }],
        field: 'tvl',
        snapshot: 'current',
      };

      const result = await evaluateNode(stateRef, ctx);
      expect(result).toBe(100);
      expect(fetchState).toHaveBeenCalledWith(stateRef, undefined);
    });

    it('fetches state with window_start snapshot', async () => {
      const fetchState = vi.fn().mockResolvedValue(50);
      const ctx = createMockContext({ fetchState });

      const stateRef: StateRef = {
        type: 'state',
        entity_type: 'Pool',
        filters: [],
        field: 'tvl',
        snapshot: 'window_start',
      };

      const result = await evaluateNode(stateRef, ctx);
      expect(result).toBe(50);
      expect(fetchState).toHaveBeenCalledWith(stateRef, ctx.windowStart);
    });

    it('fetches state with custom duration snapshot', async () => {
      const fetchState = vi.fn().mockResolvedValue(75);
      const now = Date.now();
      const ctx = createMockContext({ fetchState, now });

      const stateRef: StateRef = {
        type: 'state',
        entity_type: 'Pool',
        filters: [],
        field: 'tvl',
        snapshot: '2d',
      };

      const result = await evaluateNode(stateRef, ctx);
      expect(result).toBe(75);
      expect(fetchState).toHaveBeenCalledWith(stateRef, now - 2 * 24 * 60 * 60 * 1000);
    });

    it('fetches state without snapshot (defaults to current)', async () => {
      const fetchState = vi.fn().mockResolvedValue(200);
      const ctx = createMockContext({ fetchState });

      const stateRef: StateRef = {
        type: 'state',
        entity_type: 'Pool',
        filters: [],
        field: 'tvl',
      };

      const result = await evaluateNode(stateRef, ctx);
      expect(result).toBe(200);
      expect(fetchState).toHaveBeenCalledWith(stateRef, undefined);
    });
  });

  describe('event references', () => {
    it('fetches events with signal-level window', async () => {
      const fetchEvents = vi.fn().mockResolvedValue(500);
      const now = Date.now();
      const windowStart = now - 3600000;
      const ctx = createMockContext({ fetchEvents, now, windowStart });

      const eventRef: EventRef = {
        type: 'event',
        event_type: 'Swap',
        filters: [],
        field: 'amountUSD',
        aggregation: 'sum',
      };

      const result = await evaluateNode(eventRef, ctx);
      expect(result).toBe(500);
      expect(fetchEvents).toHaveBeenCalledWith(eventRef, windowStart, now);
    });

    it('fetches events with custom window override', async () => {
      const fetchEvents = vi.fn().mockResolvedValue(1000);
      const now = Date.now();
      const ctx = createMockContext({ fetchEvents, now });

      const eventRef: EventRef = {
        type: 'event',
        event_type: 'Swap',
        filters: [],
        field: 'amountUSD',
        aggregation: 'sum',
        window: '2d',
      };

      const result = await evaluateNode(eventRef, ctx);
      expect(result).toBe(1000);
      const expectedStart = now - 2 * 24 * 60 * 60 * 1000;
      expect(fetchEvents).toHaveBeenCalledWith(eventRef, expectedStart, now);
    });
  });

  describe('mixed expressions', () => {
    it('combines state and constant in expression', async () => {
      const fetchState = vi.fn().mockResolvedValue(100);
      const ctx = createMockContext({ fetchState });

      const stateRef: StateRef = {
        type: 'state',
        entity_type: 'Pool',
        filters: [],
        field: 'tvl',
      };

      // state * 0.9 (10% decrease threshold)
      const result = expr(stateRef, 'mul', constant(0.9));
      expect(await evaluateNode(result, ctx)).toBe(90);
    });

    it('combines event and constant in expression', async () => {
      const fetchEvents = vi.fn().mockResolvedValue(1000);
      const ctx = createMockContext({ fetchEvents });

      const eventRef: EventRef = {
        type: 'event',
        event_type: 'Swap',
        filters: [],
        field: 'amountUSD',
        aggregation: 'sum',
      };

      // event / 1000 (convert to K)
      const result = expr(eventRef, 'div', constant(1000));
      expect(await evaluateNode(result, ctx)).toBe(1);
    });
  });
});

describe('evaluateCondition', () => {
  describe('gt (greater than)', () => {
    it('returns true when left > right', async () => {
      const ctx = createMockContext();
      expect(await evaluateCondition(constant(10), 'gt', constant(5), ctx)).toBe(true);
    });

    it('returns false when left = right', async () => {
      const ctx = createMockContext();
      expect(await evaluateCondition(constant(5), 'gt', constant(5), ctx)).toBe(false);
    });

    it('returns false when left < right', async () => {
      const ctx = createMockContext();
      expect(await evaluateCondition(constant(3), 'gt', constant(5), ctx)).toBe(false);
    });

    it('works with negative numbers', async () => {
      const ctx = createMockContext();
      expect(await evaluateCondition(constant(-3), 'gt', constant(-5), ctx)).toBe(true);
      expect(await evaluateCondition(constant(-5), 'gt', constant(-3), ctx)).toBe(false);
    });

    it('works with decimals', async () => {
      const ctx = createMockContext();
      expect(await evaluateCondition(constant(5.1), 'gt', constant(5.0), ctx)).toBe(true);
      expect(await evaluateCondition(constant(5.0), 'gt', constant(5.1), ctx)).toBe(false);
    });
  });

  describe('gte (greater than or equal)', () => {
    it('returns true when left > right', async () => {
      const ctx = createMockContext();
      expect(await evaluateCondition(constant(10), 'gte', constant(5), ctx)).toBe(true);
    });

    it('returns true when left = right', async () => {
      const ctx = createMockContext();
      expect(await evaluateCondition(constant(5), 'gte', constant(5), ctx)).toBe(true);
    });

    it('returns false when left < right', async () => {
      const ctx = createMockContext();
      expect(await evaluateCondition(constant(3), 'gte', constant(5), ctx)).toBe(false);
    });
  });

  describe('lt (less than)', () => {
    it('returns true when left < right', async () => {
      const ctx = createMockContext();
      expect(await evaluateCondition(constant(3), 'lt', constant(5), ctx)).toBe(true);
    });

    it('returns false when left = right', async () => {
      const ctx = createMockContext();
      expect(await evaluateCondition(constant(5), 'lt', constant(5), ctx)).toBe(false);
    });

    it('returns false when left > right', async () => {
      const ctx = createMockContext();
      expect(await evaluateCondition(constant(10), 'lt', constant(5), ctx)).toBe(false);
    });

    it('works with negative numbers', async () => {
      const ctx = createMockContext();
      expect(await evaluateCondition(constant(-5), 'lt', constant(-3), ctx)).toBe(true);
      expect(await evaluateCondition(constant(-3), 'lt', constant(-5), ctx)).toBe(false);
    });
  });

  describe('lte (less than or equal)', () => {
    it('returns true when left < right', async () => {
      const ctx = createMockContext();
      expect(await evaluateCondition(constant(3), 'lte', constant(5), ctx)).toBe(true);
    });

    it('returns true when left = right', async () => {
      const ctx = createMockContext();
      expect(await evaluateCondition(constant(5), 'lte', constant(5), ctx)).toBe(true);
    });

    it('returns false when left > right', async () => {
      const ctx = createMockContext();
      expect(await evaluateCondition(constant(10), 'lte', constant(5), ctx)).toBe(false);
    });
  });

  describe('eq (equal)', () => {
    it('returns true when left = right', async () => {
      const ctx = createMockContext();
      expect(await evaluateCondition(constant(5), 'eq', constant(5), ctx)).toBe(true);
    });

    it('returns false when left != right', async () => {
      const ctx = createMockContext();
      expect(await evaluateCondition(constant(5), 'eq', constant(10), ctx)).toBe(false);
    });

    it('handles zero equality', async () => {
      const ctx = createMockContext();
      expect(await evaluateCondition(constant(0), 'eq', constant(0), ctx)).toBe(true);
    });

    it('handles negative equality', async () => {
      const ctx = createMockContext();
      expect(await evaluateCondition(constant(-5), 'eq', constant(-5), ctx)).toBe(true);
    });

    it('handles decimal precision', async () => {
      const ctx = createMockContext();
      // Note: JavaScript floating point precision issues
      expect(await evaluateCondition(constant(0.1 + 0.2), 'eq', constant(0.3), ctx)).toBe(false); // Known JS behavior
      expect(await evaluateCondition(constant(0.5), 'eq', constant(0.5), ctx)).toBe(true);
    });
  });

  describe('neq (not equal)', () => {
    it('returns true when left != right', async () => {
      const ctx = createMockContext();
      expect(await evaluateCondition(constant(5), 'neq', constant(10), ctx)).toBe(true);
    });

    it('returns false when left = right', async () => {
      const ctx = createMockContext();
      expect(await evaluateCondition(constant(5), 'neq', constant(5), ctx)).toBe(false);
    });

    it('handles zero', async () => {
      const ctx = createMockContext();
      expect(await evaluateCondition(constant(0), 'neq', constant(1), ctx)).toBe(true);
      expect(await evaluateCondition(constant(0), 'neq', constant(0), ctx)).toBe(false);
    });
  });

  describe('unknown operator', () => {
    it('returns false for unknown operator', async () => {
      const ctx = createMockContext();
      // @ts-expect-error - testing invalid operator
      expect(await evaluateCondition(constant(5), 'invalid', constant(5), ctx)).toBe(false);
    });
  });

  describe('with expressions', () => {
    it('compares expression results', async () => {
      const ctx = createMockContext();
      // (2 + 3) > (1 + 2) => 5 > 3 => true
      const left = expr(constant(2), 'add', constant(3));
      const right = expr(constant(1), 'add', constant(2));
      expect(await evaluateCondition(left, 'gt', right, ctx)).toBe(true);
    });

    it('handles division by zero in condition', async () => {
      const ctx = createMockContext();
      // (10 / 0) = 0 => 0 eq 0 => true
      const left = expr(constant(10), 'div', constant(0));
      expect(await evaluateCondition(left, 'eq', constant(0), ctx)).toBe(true);
    });

    it('handles complex nested expressions in condition', async () => {
      const ctx = createMockContext();
      // ((10 - 5) * 2) >= (15 / 3) => 10 >= 5 => true
      const leftInner = expr(constant(10), 'sub', constant(5));
      const left = expr(leftInner, 'mul', constant(2));
      const right = expr(constant(15), 'div', constant(3));
      expect(await evaluateCondition(left, 'gte', right, ctx)).toBe(true);
    });
  });

  describe('with state and events', () => {
    it('compares state values', async () => {
      const fetchState = vi.fn()
        .mockResolvedValueOnce(100)  // current TVL
        .mockResolvedValueOnce(120); // TVL at window_start

      const ctx = createMockContext({ fetchState });

      const currentState: StateRef = {
        type: 'state',
        entity_type: 'Pool',
        filters: [],
        field: 'tvl',
        snapshot: 'current',
      };

      const pastState: StateRef = {
        type: 'state',
        entity_type: 'Pool',
        filters: [],
        field: 'tvl',
        snapshot: 'window_start',
      };

      // current TVL < past TVL (TVL dropped)
      expect(await evaluateCondition(currentState, 'lt', pastState, ctx)).toBe(true);
    });

    it('compares state with threshold expression', async () => {
      const fetchState = vi.fn()
        .mockResolvedValueOnce(85)   // current TVL
        .mockResolvedValueOnce(100); // TVL at window_start

      const ctx = createMockContext({ fetchState });

      const currentState: StateRef = {
        type: 'state',
        entity_type: 'Pool',
        filters: [],
        field: 'tvl',
        snapshot: 'current',
      };

      const pastState: StateRef = {
        type: 'state',
        entity_type: 'Pool',
        filters: [],
        field: 'tvl',
        snapshot: 'window_start',
      };

      // current < past * 0.9 (10% drop threshold)
      const threshold = expr(pastState, 'mul', constant(0.9)); // 100 * 0.9 = 90
      expect(await evaluateCondition(currentState, 'lt', threshold, ctx)).toBe(true); // 85 < 90
    });

    it('compares event aggregations', async () => {
      const fetchEvents = vi.fn().mockResolvedValue(50000);
      const ctx = createMockContext({ fetchEvents });

      const eventRef: EventRef = {
        type: 'event',
        event_type: 'Swap',
        filters: [],
        field: 'amountUSD',
        aggregation: 'sum',
      };

      // sum(swaps) > 10000
      expect(await evaluateCondition(eventRef, 'gt', constant(10000), ctx)).toBe(true);
    });
  });

  describe('edge cases with special numbers', () => {
    it('handles Infinity comparisons', async () => {
      const ctx = createMockContext();
      expect(await evaluateCondition(constant(Infinity), 'gt', constant(1000000), ctx)).toBe(true);
      expect(await evaluateCondition(constant(-Infinity), 'lt', constant(-1000000), ctx)).toBe(true);
      expect(await evaluateCondition(constant(Infinity), 'eq', constant(Infinity), ctx)).toBe(true);
    });

    it('handles NaN (from invalid operations)', async () => {
      const ctx = createMockContext();
      // In JS, NaN !== NaN
      const nanValue = constant(NaN);
      expect(await evaluateCondition(nanValue, 'eq', nanValue, ctx)).toBe(false);
      expect(await evaluateCondition(nanValue, 'neq', nanValue, ctx)).toBe(true);
    });

    it('handles very small differences', async () => {
      const ctx = createMockContext();
      expect(await evaluateCondition(constant(0.000001), 'gt', constant(0), ctx)).toBe(true);
      expect(await evaluateCondition(constant(0.000001), 'lt', constant(0.000002), ctx)).toBe(true);
    });
  });
});
