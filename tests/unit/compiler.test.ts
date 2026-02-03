import { describe, it, expect } from 'vitest';
import {
  compileCondition,
  compileConditions,
  isGroupCondition,
  isSimpleCondition,
  CompiledGroupCondition,
} from '../../src/engine/compiler.js';
import {
  ThresholdCondition,
  ChangeCondition,
  GroupCondition,
  AggregateCondition,
} from '../../src/types/signal.js';
import { Condition as InternalCondition, BinaryExpression } from '../../src/types/index.js';

describe('Compiler', () => {
  describe('compileCondition - threshold', () => {
    it('compiles simple threshold condition', () => {
      const userCondition: ThresholdCondition = {
        type: 'threshold',
        metric: 'Morpho.Position.supplyShares',
        operator: '>',
        value: 1000000,
      };

      const result = compileCondition(userCondition);

      expect(isSimpleCondition(result)).toBe(true);
      const cond = result as InternalCondition;
      expect(cond.type).toBe('condition');
      expect(cond.operator).toBe('gt');
      expect(cond.right).toEqual({ type: 'constant', value: 1000000 });
    });

    it('compiles threshold with address filter', () => {
      const userCondition: ThresholdCondition = {
        type: 'threshold',
        metric: 'Morpho.Position.supplyShares',
        operator: '>=',
        value: 500000,
        address: '0xwhale123',
      };

      const result = compileCondition(userCondition) as InternalCondition;

      expect(result.operator).toBe('gte');
      expect(result.left).toMatchObject({
        type: 'state',
        entity_type: 'Position',
        filters: expect.arrayContaining([
          { field: 'user', op: 'eq', value: '0xwhale123' },
        ]),
      });
    });

    it('compiles threshold with market filter', () => {
      const userCondition: ThresholdCondition = {
        type: 'threshold',
        metric: 'Morpho.Market.totalSupplyAssets',
        operator: '<',
        value: 10000000,
        market_id: '0xmarket123',
      };

      const result = compileCondition(userCondition) as InternalCondition;

      expect(result.operator).toBe('lt');
      expect(result.left).toMatchObject({
        type: 'state',
        entity_type: 'Market',
        filters: expect.arrayContaining([
          { field: 'marketId', op: 'eq', value: '0xmarket123' },
        ]),
      });
    });

    it('compiles Morpho.Market.utilization as computed expression', () => {
      const userCondition: ThresholdCondition = {
        type: 'threshold',
        metric: 'Morpho.Market.utilization',
        operator: '>',
        value: 0.9,
      };

      const result = compileCondition(userCondition) as InternalCondition;

      // Utilization should be compiled as borrow/supply division
      expect(result.left).toMatchObject({
        type: 'expression',
        operator: 'div',
        left: expect.objectContaining({
          type: 'state',
          entity_type: 'Market',
          field: 'totalBorrowAssets',
        }),
        right: expect.objectContaining({
          type: 'state',
          entity_type: 'Market',
          field: 'totalSupplyAssets',
        }),
      });
    });

    it('compiles chained event metric (netSupply = Supply - Withdraw)', () => {
      const userCondition: ThresholdCondition = {
        type: 'threshold',
        metric: 'Morpho.Flow.netSupply',
        operator: '<',
        value: 0,
      };

      const result = compileCondition(userCondition) as InternalCondition;

      // Should compile to: Supply.assets - Withdraw.assets < 0
      expect(result.operator).toBe('lt');
      const leftExpr = result.left as BinaryExpression;
      expect(leftExpr.type).toBe('expression');
      expect(leftExpr.operator).toBe('sub');
      expect(leftExpr.left).toMatchObject({
        type: 'event',
        event_type: 'Morpho_Supply',
        field: 'assets',
        aggregation: 'sum',
      });
      expect(leftExpr.right).toMatchObject({
        type: 'event',
        event_type: 'Morpho_Withdraw',
        field: 'assets',
        aggregation: 'sum',
      });
    });

    it('maps all comparison operators correctly', () => {
      const operators: Array<{ input: '>' | '<' | '>=' | '<=' | '==' | '!='; expected: string }> = [
        { input: '>', expected: 'gt' },
        { input: '>=', expected: 'gte' },
        { input: '<', expected: 'lt' },
        { input: '<=', expected: 'lte' },
        { input: '==', expected: 'eq' },
        { input: '!=', expected: 'neq' },
      ];

      for (const { input, expected } of operators) {
        const result = compileCondition({
          type: 'threshold',
          metric: 'Morpho.Position.supplyShares',
          operator: input,
          value: 100,
        }) as InternalCondition;

        expect(result.operator).toBe(expected);
      }
    });
  });

  describe('compileCondition - change', () => {
    it('compiles percent decrease condition', () => {
      const userCondition: ChangeCondition = {
        type: 'change',
        metric: 'Morpho.Position.supplyShares',
        direction: 'decrease',
        by: { percent: 10 },
      };

      const result = compileCondition(userCondition) as InternalCondition;

      // current < past * 0.9
      expect(result.operator).toBe('lt');
      expect(result.left).toMatchObject({
        type: 'state',
        snapshot: 'current',
      });
      expect(result.right).toMatchObject({
        type: 'expression',
        operator: 'mul',
        left: expect.objectContaining({
          type: 'state',
          snapshot: 'window_start',
        }),
        right: { type: 'constant', value: 0.9 },
      });
    });

    it('compiles percent increase condition', () => {
      const userCondition: ChangeCondition = {
        type: 'change',
        metric: 'Morpho.Position.supplyShares',
        direction: 'increase',
        by: { percent: 20 },
      };

      const result = compileCondition(userCondition) as InternalCondition;

      // current > past * 1.2
      expect(result.operator).toBe('gt');
      expect(result.right).toMatchObject({
        type: 'expression',
        operator: 'mul',
        right: { type: 'constant', value: 1.2 },
      });
    });

    it('compiles absolute decrease condition', () => {
      const userCondition: ChangeCondition = {
        type: 'change',
        metric: 'Morpho.Position.supplyShares',
        direction: 'decrease',
        by: { absolute: 1000000 },
      };

      const result = compileCondition(userCondition) as InternalCondition;

      // (past - current) > absolute
      expect(result.operator).toBe('gt');
      expect(result.left).toMatchObject({
        type: 'expression',
        operator: 'sub',
        left: expect.objectContaining({ snapshot: 'window_start' }),
        right: expect.objectContaining({ snapshot: 'current' }),
      });
      expect(result.right).toEqual({ type: 'constant', value: 1000000 });
    });

    it('compiles absolute increase condition', () => {
      const userCondition: ChangeCondition = {
        type: 'change',
        metric: 'Morpho.Position.supplyShares',
        direction: 'increase',
        by: { absolute: 500000 },
      };

      const result = compileCondition(userCondition) as InternalCondition;

      // (current - past) > absolute
      expect(result.operator).toBe('gt');
      expect(result.left).toMatchObject({
        type: 'expression',
        operator: 'sub',
        left: expect.objectContaining({ snapshot: 'current' }),
        right: expect.objectContaining({ snapshot: 'window_start' }),
      });
    });

    it('includes address filter in change condition', () => {
      const userCondition: ChangeCondition = {
        type: 'change',
        metric: 'Morpho.Position.supplyShares',
        direction: 'decrease',
        by: { percent: 10 },
        address: '0xuser123',
      };

      const result = compileCondition(userCondition) as InternalCondition;

      // Both current and past state refs should have the address filter
      const currentState = result.left as any;
      expect(currentState.filters).toContainEqual({
        field: 'user',
        op: 'eq',
        value: '0xuser123',
      });
    });
  });

  describe('compileCondition - group', () => {
    it('compiles group condition with threshold inner', () => {
      const userCondition: GroupCondition = {
        type: 'group',
        addresses: ['0xw1', '0xw2', '0xw3', '0xw4', '0xw5'],
        requirement: { count: 3, of: 5 },
        condition: {
          type: 'threshold',
          metric: 'Morpho.Position.supplyShares',
          operator: '<',
          value: 1000,
        },
      };

      const result = compileCondition(userCondition);

      expect(isGroupCondition(result)).toBe(true);
      const group = result as CompiledGroupCondition;
      expect(group.addresses).toEqual(['0xw1', '0xw2', '0xw3', '0xw4', '0xw5']);
      expect(group.requirement).toEqual({ count: 3, of: 5 });
      expect(group.perAddressCondition).toMatchObject({
        type: 'condition',
        operator: 'lt',
      });
    });

    it('compiles group condition with change inner', () => {
      const userCondition: GroupCondition = {
        type: 'group',
        addresses: ['0xa', '0xb', '0xc'],
        requirement: { count: 2, of: 3 },
        condition: {
          type: 'change',
          metric: 'Morpho.Position.supplyShares',
          direction: 'decrease',
          by: { percent: 10 },
        },
      };

      const result = compileCondition(userCondition);

      expect(isGroupCondition(result)).toBe(true);
      const group = result as CompiledGroupCondition;
      expect(group.perAddressCondition.operator).toBe('lt');
    });

    it('throws on nested group conditions', () => {
      const userCondition: GroupCondition = {
        type: 'group',
        addresses: ['0xa'],
        requirement: { count: 1, of: 1 },
        condition: {
          type: 'group',
          addresses: ['0xb'],
          requirement: { count: 1, of: 1 },
          condition: {
            type: 'threshold',
            metric: 'Morpho.Position.supplyShares',
            operator: '>',
            value: 100,
          },
        },
      };

      expect(() => compileCondition(userCondition)).toThrow('Nested group conditions are not supported');
    });
  });

  describe('compileCondition - aggregate', () => {
    it('compiles aggregate sum condition', () => {
      const userCondition: AggregateCondition = {
        type: 'aggregate',
        aggregation: 'sum',
        metric: 'Morpho.Market.totalSupplyAssets',
        operator: '>',
        value: 10000000,
      };

      const result = compileCondition(userCondition) as InternalCondition;

      expect(result.operator).toBe('gt');
      expect(result.left).toMatchObject({
        type: 'state',
        entity_type: 'Market',
        field: 'totalSupplyAssets',
      });
      expect(result.right).toEqual({ type: 'constant', value: 10000000 });
    });
  });

  describe('compileConditions', () => {
    it('compiles multiple conditions with AND logic', () => {
      const conditions = [
        {
          type: 'threshold' as const,
          metric: 'Morpho.Position.supplyShares' as const,
          operator: '>' as const,
          value: 1000,
        },
        {
          type: 'threshold' as const,
          metric: 'Morpho.Market.utilization' as const,
          operator: '>' as const,
          value: 0.9,
        },
      ];

      const result = compileConditions(conditions, 'AND');

      expect(result.logic).toBe('AND');
      expect(result.conditions).toHaveLength(2);
    });

    it('compiles multiple conditions with OR logic', () => {
      const conditions = [
        {
          type: 'threshold' as const,
          metric: 'Morpho.Position.supplyShares' as const,
          operator: '<' as const,
          value: 100,
        },
      ];

      const result = compileConditions(conditions, 'OR');

      expect(result.logic).toBe('OR');
    });

    it('defaults to AND logic', () => {
      const conditions = [
        {
          type: 'threshold' as const,
          metric: 'Morpho.Position.supplyShares' as const,
          operator: '>' as const,
          value: 1000,
        },
      ];

      const result = compileConditions(conditions);

      expect(result.logic).toBe('AND');
    });
  });

  describe('type guards', () => {
    it('isGroupCondition returns true for group conditions', () => {
      const group: CompiledGroupCondition = {
        type: 'group',
        addresses: ['0x1'],
        requirement: { count: 1, of: 1 },
        perAddressCondition: {
          type: 'condition',
          left: { type: 'constant', value: 1 },
          operator: 'gt',
          right: { type: 'constant', value: 0 },
        },
      };

      expect(isGroupCondition(group)).toBe(true);
    });

    it('isSimpleCondition returns true for internal conditions', () => {
      const simple: InternalCondition = {
        type: 'condition',
        left: { type: 'constant', value: 1 },
        operator: 'gt',
        right: { type: 'constant', value: 0 },
      };

      expect(isSimpleCondition(simple)).toBe(true);
    });
  });
});
