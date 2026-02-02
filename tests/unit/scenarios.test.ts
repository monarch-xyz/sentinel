import { describe, it, expect, vi } from 'vitest';
import { evaluateNode, evaluateCondition, parseDuration, EvalContext } from '../../src/engine/evaluator.js';
import { ExpressionNode, StateRef, Condition } from '../../src/types/index.js';
import scenarios from '../fixtures/scenarios.json';

describe('parseDuration', () => {
  it('parses minutes', () => {
    expect(parseDuration('30m')).toBe(30 * 60 * 1000);
  });

  it('parses hours', () => {
    expect(parseDuration('1h')).toBe(60 * 60 * 1000);
  });

  it('parses days', () => {
    expect(parseDuration('2d')).toBe(2 * 24 * 60 * 60 * 1000);
    expect(parseDuration('7d')).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('parses weeks', () => {
    expect(parseDuration('1w')).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('throws on invalid format', () => {
    expect(() => parseDuration('invalid')).toThrow();
    expect(() => parseDuration('2x')).toThrow();
  });
});

describe('Scenario 1: Multi-Timeframe Whale Position Tracking', () => {
  const NOW = Date.now();
  const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

  // Mock data based on fixtures
  const whalePositions = scenarios.whales.positions;

  /**
   * Creates a mock context that returns position data based on timestamp
   */
  function createMockContext(address: string): EvalContext {
    const positions = whalePositions[address as keyof typeof whalePositions];
    
    return {
      chainId: 1,
      windowDuration: '7d',
      now: NOW,
      windowStart: NOW - SEVEN_DAYS_MS,
      fetchState: vi.fn(async (ref: StateRef, timestamp?: number) => {
        if (!timestamp || timestamp >= NOW - 1000) {
          return positions.current.supply_assets;
        } else if (timestamp >= NOW - TWO_DAYS_MS - 1000 && timestamp < NOW - 1000) {
          return positions['2d_ago'].supply_assets;
        } else {
          return positions['7d_ago'].supply_assets;
        }
      }),
      fetchEvents: vi.fn(async () => 0),
    };
  }

  /**
   * Builds a "position dropped > X% in Y time" condition
   * Formula: (current - pastValue) / pastValue < -threshold
   * Simplified: current / pastValue < (1 - threshold)
   */
  function buildPositionDropCondition(
    address: string,
    lookbackDuration: string,
    dropThreshold: number // e.g., 0.30 for 30%
  ): Condition {
    // current_position / position_at_lookback < (1 - threshold)
    return {
      type: 'condition',
      operator: 'lt',
      left: {
        type: 'expression',
        operator: 'div',
        left: {
          type: 'state',
          entity_type: 'Position',
          filters: [{ field: 'user', op: 'eq', value: address }],
          field: 'supply_assets',
          snapshot: 'current'
        } as StateRef,
        right: {
          type: 'state',
          entity_type: 'Position',
          filters: [{ field: 'user', op: 'eq', value: address }],
          field: 'supply_assets',
          snapshot: lookbackDuration
        } as StateRef
      },
      right: { type: 'constant', value: 1 - dropThreshold }
    };
  }

  it('detects whale with >30% drop in 2d AND >40% drop in 7d (Bob)', async () => {
    const context = createMockContext('0xwhale2_bob_dumping');
    
    // Bob: 5M now, 8M 2d ago, 12M 7d ago
    // 2d drop: 5/8 = 0.625 < 0.70 (30% threshold) ✓
    // 7d drop: 5/12 = 0.417 < 0.60 (40% threshold) ✓
    
    const condition2d = buildPositionDropCondition('0xwhale2_bob_dumping', '2d', 0.30);
    const condition7d = buildPositionDropCondition('0xwhale2_bob_dumping', '7d', 0.40);
    
    const result2d = await evaluateCondition(condition2d.left, condition2d.operator, condition2d.right, context);
    const result7d = await evaluateCondition(condition7d.left, condition7d.operator, condition7d.right, context);
    
    expect(result2d).toBe(true);
    expect(result7d).toBe(true);
  });

  it('detects whale with extreme exit (Eve)', async () => {
    const context = createMockContext('0xwhale5_eve_exiting');
    
    // Eve: 2M now, 6M 2d ago, 15M 7d ago
    // 2d drop: 2/6 = 0.333 < 0.70 (30% threshold) ✓
    // 7d drop: 2/15 = 0.133 < 0.60 (40% threshold) ✓
    
    const condition2d = buildPositionDropCondition('0xwhale5_eve_exiting', '2d', 0.30);
    const condition7d = buildPositionDropCondition('0xwhale5_eve_exiting', '7d', 0.40);
    
    const result2d = await evaluateCondition(condition2d.left, condition2d.operator, condition2d.right, context);
    const result7d = await evaluateCondition(condition7d.left, condition7d.operator, condition7d.right, context);
    
    expect(result2d).toBe(true);
    expect(result7d).toBe(true);
  });

  it('does NOT trigger for steady whale (Alice)', async () => {
    const context = createMockContext('0xwhale1_alice_steady');
    
    // Alice: 10M now, 10.2M 2d ago, 10.5M 7d ago
    // 2d drop: 10/10.2 = 0.98 > 0.70 ✗
    // 7d drop: 10/10.5 = 0.95 > 0.60 ✗
    
    const condition2d = buildPositionDropCondition('0xwhale1_alice_steady', '2d', 0.30);
    const condition7d = buildPositionDropCondition('0xwhale1_alice_steady', '7d', 0.40);
    
    const result2d = await evaluateCondition(condition2d.left, condition2d.operator, condition2d.right, context);
    const result7d = await evaluateCondition(condition7d.left, condition7d.operator, condition7d.right, context);
    
    expect(result2d).toBe(false);
    expect(result7d).toBe(false);
  });

  it('does NOT trigger for accumulating whale (Carol)', async () => {
    const context = createMockContext('0xwhale3_carol_accumulating');
    
    // Carol: 15M now, 12M 2d ago, 8M 7d ago (increasing!)
    // 2d: 15/12 = 1.25 > 0.70 ✗
    // 7d: 15/8 = 1.875 > 0.60 ✗
    
    const condition2d = buildPositionDropCondition('0xwhale3_carol_accumulating', '2d', 0.30);
    const condition7d = buildPositionDropCondition('0xwhale3_carol_accumulating', '7d', 0.40);
    
    const result2d = await evaluateCondition(condition2d.left, condition2d.operator, condition2d.right, context);
    const result7d = await evaluateCondition(condition7d.left, condition7d.operator, condition7d.right, context);
    
    expect(result2d).toBe(false);
    expect(result7d).toBe(false);
  });

  it('handles mixed signals (Dave - up short-term, down long-term)', async () => {
    const context = createMockContext('0xwhale4_dave_volatile');
    
    // Dave: 7M now, 5M 2d ago, 10M 7d ago
    // 2d: 7/5 = 1.4 > 0.70 (not dropping in 2d) ✗
    // 7d: 7/10 = 0.7 > 0.60 (not quite 40% drop) ✗
    
    const condition2d = buildPositionDropCondition('0xwhale4_dave_volatile', '2d', 0.30);
    const condition7d = buildPositionDropCondition('0xwhale4_dave_volatile', '7d', 0.40);
    
    const result2d = await evaluateCondition(condition2d.left, condition2d.operator, condition2d.right, context);
    const result7d = await evaluateCondition(condition7d.left, condition7d.operator, condition7d.right, context);
    
    expect(result2d).toBe(false);
    expect(result7d).toBe(false);
  });
});

describe('Scenario 2: Supply Drop but Borrow Stable (Market Risk Signal)', () => {
  const NOW = Date.now();
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

  const marketData = scenarios.market;

  function createMarketContext(): EvalContext {
    return {
      chainId: 1,
      windowDuration: '7d',
      now: NOW,
      windowStart: NOW - SEVEN_DAYS_MS,
      fetchState: vi.fn(async (ref: StateRef, timestamp?: number) => {
        const field = ref.field;
        if (!timestamp || timestamp >= NOW - 1000) {
          return marketData.current[field as keyof typeof marketData.current] || 0;
        } else {
          return marketData['7d_ago'][field as keyof typeof marketData['7d_ago']] || 0;
        }
      }),
      fetchEvents: vi.fn(async () => 0),
    };
  }

  it('detects supply drop >25% while borrow change <10%', async () => {
    const context = createMarketContext();
    
    // Market: 
    // Supply: 100M now vs 150M 7d ago → 100/150 = 0.667 < 0.75 (25% drop) ✓
    // Borrow: 75M now vs 73M 7d ago → 75/73 = 1.027 (2.7% increase, within 10%) ✓
    
    // Supply dropped >25%: current/past < 0.75
    const supplyDropCondition: Condition = {
      type: 'condition',
      operator: 'lt',
      left: {
        type: 'expression',
        operator: 'div',
        left: {
          type: 'state',
          entity_type: 'Market',
          filters: [{ field: 'id', op: 'eq', value: marketData.id }],
          field: 'total_supply_assets',
          snapshot: 'current'
        } as StateRef,
        right: {
          type: 'state',
          entity_type: 'Market',
          filters: [{ field: 'id', op: 'eq', value: marketData.id }],
          field: 'total_supply_assets',
          snapshot: '7d'
        } as StateRef
      },
      right: { type: 'constant', value: 0.75 }
    };

    // Borrow stable (change within ±10%): 0.9 < current/past < 1.1
    // We check: current/past > 0.9 AND current/past < 1.1
    const borrowRatioNode: ExpressionNode = {
      type: 'expression',
      operator: 'div',
      left: {
        type: 'state',
        entity_type: 'Market',
        filters: [{ field: 'id', op: 'eq', value: marketData.id }],
        field: 'total_borrow_assets',
        snapshot: 'current'
      } as StateRef,
      right: {
        type: 'state',
        entity_type: 'Market',
        filters: [{ field: 'id', op: 'eq', value: marketData.id }],
        field: 'total_borrow_assets',
        snapshot: '7d'
      } as StateRef
    };

    const supplyDropped = await evaluateCondition(
      supplyDropCondition.left, 
      supplyDropCondition.operator, 
      supplyDropCondition.right, 
      context
    );
    
    const borrowRatio = await evaluateNode(borrowRatioNode, context);
    const borrowStable = borrowRatio > 0.9 && borrowRatio < 1.1;

    expect(supplyDropped).toBe(true);
    expect(borrowStable).toBe(true);
    expect(supplyDropped && borrowStable).toBe(true); // Combined signal triggers
  });
});
