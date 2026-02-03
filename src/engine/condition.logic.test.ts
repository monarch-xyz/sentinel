import { describe, it, expect } from 'vitest';
import { SignalEvaluator } from './condition.js';
import { compileSignalDefinition } from './compile-signal.js';
import type { DataFetcher } from './fetcher.js';
import type { StateRef, EventRef } from '../types/index.js';

function getFilterValue(ref: StateRef | EventRef, field: string): string | number | undefined {
  const match = ref.filters.find((filter) => filter.field === field && filter.op === 'eq');
  return match?.value as string | number | undefined;
}

describe('SignalEvaluator logic', () => {
  it('evaluates group conditions across addresses', async () => {
    const definition = {
      scope: { chains: [1], markets: ['market-1'] },
      window: { duration: '1h' },
      conditions: [
        {
          type: 'group',
          addresses: ['0x1', '0x2', '0x3'],
          requirement: { count: 2, of: 3 },
          condition: {
            type: 'threshold',
            metric: 'Morpho.Position.supplyShares',
            operator: '>',
            value: 100,
            chain_id: 1,
            market_id: 'market-1',
          },
        },
      ],
    } as const;

    const compiled = compileSignalDefinition(definition);

    const fetcher: DataFetcher = {
      fetchState: async (ref: StateRef) => {
        const user = getFilterValue(ref, 'user');
        if (user === '0x1') return 150;
        if (user === '0x2') return 50;
        if (user === '0x3') return 200;
        return 0;
      },
      fetchEvents: async () => 0,
    };

    const evaluator = new SignalEvaluator(fetcher);
    const result = await evaluator.evaluate({
      id: 'sig-1',
      chains: compiled.ast.chains,
      window: compiled.ast.window,
      conditions: compiled.ast.conditions,
      logic: compiled.ast.logic,
    });

    expect(result.triggered).toBe(true);
  });

  it('evaluates aggregate conditions across markets', async () => {
    const definition = {
      scope: { chains: [1], markets: ['m1', 'm2'] },
      window: { duration: '1h' },
      conditions: [
        {
          type: 'aggregate',
          aggregation: 'sum',
          metric: 'Morpho.Market.totalBorrowAssets',
          operator: '>',
          value: 1000,
          chain_id: 1,
        },
      ],
    } as const;

    const compiled = compileSignalDefinition(definition);

    const fetcher: DataFetcher = {
      fetchState: async (ref: StateRef) => {
        const marketId = getFilterValue(ref, 'marketId');
        if (marketId === 'm1') return 600;
        if (marketId === 'm2') return 500;
        return 0;
      },
      fetchEvents: async () => 0,
    };

    const evaluator = new SignalEvaluator(fetcher);
    const result = await evaluator.evaluate({
      id: 'sig-2',
      chains: compiled.ast.chains,
      window: compiled.ast.window,
      conditions: compiled.ast.conditions,
      logic: compiled.ast.logic,
    });

    expect(result.triggered).toBe(true);
  });

  it('evaluates multi-condition AND logic', async () => {
    const definition = {
      scope: { chains: [1], markets: ['m1'] },
      window: { duration: '1h' },
      logic: 'AND',
      conditions: [
        {
          type: 'threshold',
          metric: 'Morpho.Market.totalBorrowAssets',
          operator: '>',
          value: 100,
          chain_id: 1,
          market_id: 'm1',
        },
        {
          type: 'threshold',
          metric: 'Morpho.Market.totalSupplyAssets',
          operator: '>',
          value: 200,
          chain_id: 1,
          market_id: 'm1',
        },
      ],
    } as const;

    const compiled = compileSignalDefinition(definition);

    const fetcher: DataFetcher = {
      fetchState: async (ref: StateRef) => {
        if (ref.field === 'totalBorrowAssets') return 150;
        if (ref.field === 'totalSupplyAssets') return 500;
        return 0;
      },
      fetchEvents: async () => 0,
    };

    const evaluator = new SignalEvaluator(fetcher);
    const result = await evaluator.evaluate({
      id: 'sig-3',
      chains: compiled.ast.chains,
      window: compiled.ast.window,
      conditions: compiled.ast.conditions,
      logic: compiled.ast.logic,
    });

    expect(result.triggered).toBe(true);
  });
});
