import { describe, it, expect } from 'vitest';
import {
  compileCondition,
  compileConditions,
  isGroupCondition,
  isSimpleCondition,
  CompiledAggregateCondition,
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
    it('compiles simple threshold condition for Position', () => {
      const userCondition: ThresholdCondition = {
        type: 'threshold',
        metric: 'Morpho.Position.supplyShares',
        operator: '>',
        value: 1000000,
        chain_id: 1,
        market_id: '0xmarket123',
        address: '0xuser123',
      };

      const result = compileCondition(userCondition);

      expect(isSimpleCondition(result)).toBe(true);
      const cond = result as InternalCondition;
      expect(cond.type).toBe('condition');
      expect(cond.operator).toBe('gt');
      expect(cond.right).toEqual({ type: 'constant', value: 1000000 });
    });

    it('includes chainId, marketId, and address in filters for Position', () => {
      const userCondition: ThresholdCondition = {
        type: 'threshold',
        metric: 'Morpho.Position.supplyShares',
        operator: '>=',
        value: 500000,
        chain_id: 1,
        market_id: '0xmarket123',
        address: '0xwhale123',
      };

      const result = compileCondition(userCondition) as InternalCondition;

      expect(result.operator).toBe('gte');
      expect(result.left).toMatchObject({
        type: 'state',
        entity_type: 'Position',
        filters: expect.arrayContaining([
          { field: 'chainId', op: 'eq', value: 1 },
          { field: 'marketId', op: 'eq', value: '0xmarket123' },
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
        chain_id: 1,
        market_id: '0xmarket123',
      };

      const result = compileCondition(userCondition) as InternalCondition;

      expect(result.operator).toBe('lt');
      expect(result.left).toMatchObject({
        type: 'state',
        entity_type: 'Market',
        filters: expect.arrayContaining([
          { field: 'chainId', op: 'eq', value: 1 },
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
        chain_id: 1,
        market_id: '0xmarket123',
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
        chain_id: 1,
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
          chain_id: 1,
          market_id: '0xmarket',
          address: '0xuser',
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
        chain_id: 1,
        market_id: '0xmarket',
        address: '0xuser',
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
        chain_id: 1,
        market_id: '0xmarket',
        address: '0xuser',
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
        chain_id: 1,
        market_id: '0xmarket',
        address: '0xuser',
      };

      const result = compileCondition(userCondition) as InternalCondition;

      // (past - current) > 1000000
      expect(result.operator).toBe('gt');
      expect(result.left).toMatchObject({
        type: 'expression',
        operator: 'sub',
      });
      expect(result.right).toEqual({ type: 'constant', value: 1000000 });
    });

    it('compiles absolute increase condition', () => {
      const userCondition: ChangeCondition = {
        type: 'change',
        metric: 'Morpho.Position.supplyShares',
        direction: 'increase',
        by: { absolute: 500000 },
        chain_id: 1,
        market_id: '0xmarket',
        address: '0xuser',
      };

      const result = compileCondition(userCondition) as InternalCondition;

      // (current - past) > 500000
      expect(result.operator).toBe('gt');
      expect(result.left).toMatchObject({
        type: 'expression',
        operator: 'sub',
      });
    });

    it('includes filters from condition', () => {
      const userCondition: ChangeCondition = {
        type: 'change',
        metric: 'Morpho.Position.supplyShares',
        direction: 'decrease',
        by: { percent: 20 },
        chain_id: 1,
        market_id: '0xmarket123',
        address: '0xwhale456',
      };

      const result = compileCondition(userCondition) as InternalCondition;

      // Both current and past state refs should have the filters
      expect(result.left).toMatchObject({
        type: 'state',
        filters: expect.arrayContaining([
          { field: 'chainId', op: 'eq', value: 1 },
          { field: 'marketId', op: 'eq', value: '0xmarket123' },
          { field: 'user', op: 'eq', value: '0xwhale456' },
        ]),
      });
    });
  });

  describe('compileCondition - group', () => {
    it('compiles group condition with N-of-M requirement', () => {
      const userCondition: GroupCondition = {
        type: 'group',
        addresses: ['0xa', '0xb', '0xc', '0xd', '0xe'],
        requirement: { count: 3, of: 5 },
        condition: {
          type: 'change',
          metric: 'Morpho.Position.supplyShares',
          direction: 'decrease',
          by: { percent: 10 },
          chain_id: 1,
          market_id: '0xmarket',
          address: '0xplaceholder', // Will be replaced per-address at eval time
        },
      };

      const result = compileCondition(userCondition);

      expect(isGroupCondition(result)).toBe(true);
      const groupResult = result as CompiledGroupCondition;
      expect(groupResult.type).toBe('group');
      expect(groupResult.addresses).toEqual(['0xa', '0xb', '0xc', '0xd', '0xe']);
      expect(groupResult.requirement).toEqual({ count: 3, of: 5 });
      expect(groupResult.perAddressCondition).toBeDefined();
    });

    it('compiles inner condition correctly', () => {
      const userCondition: GroupCondition = {
        type: 'group',
        addresses: ['0xa', '0xb'],
        requirement: { count: 1, of: 2 },
        condition: {
          type: 'threshold',
          metric: 'Morpho.Position.supplyShares',
          operator: '<',
          value: 100,
          chain_id: 1,
          market_id: '0xmarket',
          address: '0xplaceholder',
        },
      };

      const result = compileCondition(userCondition) as CompiledGroupCondition;

      expect(result.perAddressCondition.type).toBe('condition');
      expect(result.perAddressCondition.operator).toBe('lt');
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
        chain_id: 1,
      };

      const result = compileCondition(userCondition) as CompiledAggregateCondition;

      expect(result.type).toBe('aggregate');
      expect(result.aggregation).toBe('sum');
      expect(result.metric).toBe('Morpho.Market.totalSupplyAssets');
      expect(result.operator).toBe('gt');
      expect(result.value).toBe(10000000);
      expect(result.chainId).toBe(1);
    });
  });

  describe('validation', () => {
    it('throws on unknown metric', () => {
      const userCondition: ThresholdCondition = {
        type: 'threshold',
        metric: 'Unknown.Metric.field',
        operator: '>',
        value: 100,
        chain_id: 1,
      };

      expect(() => compileCondition(userCondition)).toThrow('Unknown metric');
    });

    it('throws when chain_id is missing', () => {
      const userCondition = {
        type: 'threshold',
        metric: 'Morpho.Position.supplyShares',
        operator: '>',
        value: 100,
        market_id: '0xmarket',
        address: '0xuser',
      } as ThresholdCondition;

      expect(() => compileCondition(userCondition)).toThrow('chain_id is required');
    });

    it('throws when market_id is missing for Market metric', () => {
      const userCondition: ThresholdCondition = {
        type: 'threshold',
        metric: 'Morpho.Market.totalSupplyAssets',
        operator: '>',
        value: 100,
        chain_id: 1,
      };

      expect(() => compileCondition(userCondition)).toThrow('market_id is required');
    });

    it('throws when address is missing for Position metric', () => {
      const userCondition: ThresholdCondition = {
        type: 'threshold',
        metric: 'Morpho.Position.supplyShares',
        operator: '>',
        value: 100,
        chain_id: 1,
        market_id: '0xmarket',
      };

      expect(() => compileCondition(userCondition)).toThrow('address is required');
    });

    it('allows Event metrics without market_id or address', () => {
      const userCondition: ThresholdCondition = {
        type: 'threshold',
        metric: 'Morpho.Flow.netSupply',
        operator: '<',
        value: 0,
        chain_id: 1,
      };

      // Should not throw
      const result = compileCondition(userCondition);
      expect(result).toBeDefined();
    });
  });

  describe('compileConditions', () => {
    it('compiles multiple conditions with AND logic', () => {
      const conditions = [
        {
          type: 'threshold' as const,
          metric: 'Morpho.Position.supplyShares',
          operator: '>' as const,
          value: 1000,
          chain_id: 1,
          market_id: '0xmarket',
          address: '0xuser',
        },
        {
          type: 'threshold' as const,
          metric: 'Morpho.Market.totalSupplyAssets',
          operator: '<' as const,
          value: 5000000,
          chain_id: 1,
          market_id: '0xmarket',
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
          metric: 'Morpho.Position.supplyShares',
          operator: '>' as const,
          value: 1000,
          chain_id: 1,
          market_id: '0xmarket',
          address: '0xuser',
        },
      ];

      const result = compileConditions(conditions, 'OR');

      expect(result.logic).toBe('OR');
    });

    it('defaults to AND logic', () => {
      const conditions = [
        {
          type: 'threshold' as const,
          metric: 'Morpho.Position.supplyShares',
          operator: '>' as const,
          value: 1000,
          chain_id: 1,
          market_id: '0xmarket',
          address: '0xuser',
        },
      ];

      const result = compileConditions(conditions);

      expect(result.logic).toBe('AND');
    });
  });
});
