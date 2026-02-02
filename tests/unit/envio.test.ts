import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EnvioClient, BatchQuery, StateQuery, EventQuery } from '../../src/envio/client.js';

// Mock the GraphQL client
const mockRequest = vi.fn();
vi.mock('graphql-request', () => {
  return {
    GraphQLClient: vi.fn().mockImplementation(() => ({
      request: mockRequest,
    })),
    gql: (s: string) => s,
  };
});

// Mock the block resolver
vi.mock('../../src/envio/blocks.js', () => ({
  resolveBlockByTimestamp: vi.fn().mockImplementation((chainId: number, timestampMs: number) => {
    // Simple mock: return timestamp / 12000 for Ethereum-like chains
    return Math.floor(timestampMs / 12000);
  }),
}));

describe('EnvioClient', () => {
  let client: EnvioClient;

  beforeEach(() => {
    mockRequest.mockReset();
    client = new EnvioClient('https://mock-envio.endpoint');
  });

  describe('fetchState', () => {
    it('translates simple equality filters correctly', async () => {
      mockRequest.mockResolvedValue({
        result: [{ supplyShares: '1000' }]
      });

      const result = await client.fetchState({
        type: 'state',
        entity_type: 'Position',
        filters: [{ field: 'user', op: 'eq', value: '0x123' }],
        field: 'supplyShares'
      });

      expect(mockRequest).toHaveBeenCalledWith(
        expect.stringContaining('Position'),
        expect.objectContaining({ result_where: { user: { _eq: '0x123' } } })
      );
      expect(result).toBe(1000);
    });

    it('handles multiple filter operators', async () => {
      mockRequest.mockResolvedValue({
        result: [{ totalSupply: '5000000' }]
      });

      await client.fetchState({
        type: 'state',
        entity_type: 'Market',
        filters: [
          { field: 'chainId', op: 'eq', value: 1 },
          { field: 'totalSupply', op: 'gte', value: 1000000 }
        ],
        field: 'totalSupply'
      });

      expect(mockRequest).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          result_where: {
            chainId: { _eq: 1 },
            totalSupply: { _gte: 1000000 }
          }
        })
      );
    });

    it('handles block number for time-travel queries', async () => {
      mockRequest.mockResolvedValue({
        result: [{ supplyShares: '500' }]
      });

      await client.fetchState({
        type: 'state',
        entity_type: 'Position',
        filters: [{ field: 'user', op: 'eq', value: '0x123' }],
        field: 'supplyShares'
      }, 1000000);

      expect(mockRequest).toHaveBeenCalledWith(
        expect.stringContaining('block: {number: 1000000}'),
        expect.any(Object)
      );
    });

    it('returns 0 when entity not found', async () => {
      mockRequest.mockResolvedValue({ result: [] });

      const result = await client.fetchState({
        type: 'state',
        entity_type: 'Position',
        filters: [{ field: 'user', op: 'eq', value: '0xnonexistent' }],
        field: 'supplyShares'
      });

      expect(result).toBe(0);
    });

    it('returns 0 on GraphQL error', async () => {
      mockRequest.mockRejectedValue(new Error('GraphQL error'));

      const result = await client.fetchState({
        type: 'state',
        entity_type: 'Position',
        filters: [{ field: 'user', op: 'eq', value: '0x123' }],
        field: 'supplyShares'
      });

      expect(result).toBe(0);
    });
  });

  describe('fetchStateAtTimestamp', () => {
    it('resolves timestamp to block and fetches state', async () => {
      mockRequest.mockResolvedValue({
        result: [{ supplyShares: '2000' }]
      });

      const timestampMs = 1200000000; // Should resolve to block 100000
      const result = await client.fetchStateAtTimestamp(
        {
          type: 'state',
          entity_type: 'Position',
          filters: [{ field: 'user', op: 'eq', value: '0x123' }],
          field: 'supplyShares'
        },
        1, // chainId
        timestampMs
      );

      expect(mockRequest).toHaveBeenCalledWith(
        expect.stringContaining('block: {number: 100000}'),
        expect.any(Object)
      );
      expect(result).toBe(2000);
    });
  });

  describe('fetchEvents', () => {
    it('aggregates raw events in-memory with sum', async () => {
      mockRequest.mockResolvedValue({
        result: [
          { assets: '1000' },
          { assets: '2000' },
          { assets: '500' }
        ]
      });

      const result = await client.fetchEvents({
        type: 'event',
        event_type: 'Supply',
        filters: [{ field: 'user', op: 'eq', value: '0x123' }],
        field: 'assets',
        aggregation: 'sum'
      }, 1700000000000, 1700003600000);

      expect(mockRequest).toHaveBeenCalledWith(
        expect.stringContaining('Morpho_Supply'),
        expect.objectContaining({
          result_where: expect.objectContaining({
            user: { _eq: '0x123' },
            timestamp: { _gte: 1700000000, _lte: 1700003600 }
          })
        })
      );
      expect(result).toBe(3500);
    });

    it('calculates count correctly', async () => {
      mockRequest.mockResolvedValue({
        result: [{}, {}, {}, {}]
      });

      const result = await client.fetchEvents({
        type: 'event',
        event_type: 'Withdraw',
        filters: [],
        field: 'any',
        aggregation: 'count'
      }, 0, Date.now());

      expect(result).toBe(4);
    });

    it('calculates average correctly', async () => {
      mockRequest.mockResolvedValue({
        result: [
          { amount: '100' },
          { amount: '200' },
          { amount: '300' }
        ]
      });

      const result = await client.fetchEvents({
        type: 'event',
        event_type: 'Supply',
        filters: [],
        field: 'amount',
        aggregation: 'avg'
      }, 0, Date.now());

      expect(result).toBe(200);
    });

    it('calculates min correctly', async () => {
      mockRequest.mockResolvedValue({
        result: [
          { amount: '500' },
          { amount: '100' },
          { amount: '300' }
        ]
      });

      const result = await client.fetchEvents({
        type: 'event',
        event_type: 'Supply',
        filters: [],
        field: 'amount',
        aggregation: 'min'
      }, 0, Date.now());

      expect(result).toBe(100);
    });

    it('calculates max correctly', async () => {
      mockRequest.mockResolvedValue({
        result: [
          { amount: '500' },
          { amount: '100' },
          { amount: '900' }
        ]
      });

      const result = await client.fetchEvents({
        type: 'event',
        event_type: 'Supply',
        filters: [],
        field: 'amount',
        aggregation: 'max'
      }, 0, Date.now());

      expect(result).toBe(900);
    });

    it('handles Morpho_ prefix in event type', async () => {
      mockRequest.mockResolvedValue({
        result: [{ assets: '1000' }]
      });

      await client.fetchEvents({
        type: 'event',
        event_type: 'Morpho_Supply',
        filters: [],
        field: 'assets',
        aggregation: 'sum'
      }, 0, Date.now());

      expect(mockRequest).toHaveBeenCalledWith(
        expect.stringContaining('Morpho_Supply'),
        expect.any(Object)
      );
    });

    it('returns 0 for empty result set', async () => {
      mockRequest.mockResolvedValue({ result: [] });

      const result = await client.fetchEvents({
        type: 'event',
        event_type: 'Supply',
        filters: [],
        field: 'assets',
        aggregation: 'sum'
      }, 0, Date.now());

      expect(result).toBe(0);
    });

    it('handles null/undefined field values', async () => {
      mockRequest.mockResolvedValue({
        result: [
          { amount: '100' },
          { amount: null },
          { amount: undefined },
          { amount: '200' }
        ]
      });

      const result = await client.fetchEvents({
        type: 'event',
        event_type: 'Supply',
        filters: [],
        field: 'amount',
        aggregation: 'sum'
      }, 0, Date.now());

      expect(result).toBe(300); // 100 + 0 + 0 + 200
    });
  });

  describe('batchQueries', () => {
    it('executes multiple state queries in a single request', async () => {
      mockRequest.mockResolvedValue({
        position1: [{ supplyShares: '1000' }],
        position2: [{ supplyShares: '2000' }]
      });

      const queries: BatchQuery[] = [
        {
          type: 'state',
          ref: {
            type: 'state',
            entity_type: 'Position',
            filters: [{ field: 'user', op: 'eq', value: '0x111' }],
            field: 'supplyShares'
          },
          alias: 'position1'
        },
        {
          type: 'state',
          ref: {
            type: 'state',
            entity_type: 'Position',
            filters: [{ field: 'user', op: 'eq', value: '0x222' }],
            field: 'supplyShares'
          },
          alias: 'position2'
        }
      ];

      const results = await client.batchQueries(queries);

      // Should only make one request
      expect(mockRequest).toHaveBeenCalledTimes(1);
      expect(mockRequest).toHaveBeenCalledWith(
        expect.stringContaining('position1'),
        expect.any(Object)
      );
      expect(mockRequest).toHaveBeenCalledWith(
        expect.stringContaining('position2'),
        expect.any(Object)
      );

      expect(results).toEqual({
        position1: 1000,
        position2: 2000
      });
    });

    it('executes multiple event queries in a single request', async () => {
      mockRequest.mockResolvedValue({
        supplies: [{ assets: '1000' }, { assets: '2000' }],
        withdrawals: [{ assets: '500' }]
      });

      const queries: BatchQuery[] = [
        {
          type: 'event',
          ref: {
            type: 'event',
            event_type: 'Supply',
            filters: [],
            field: 'assets',
            aggregation: 'sum'
          },
          startTimeMs: 0,
          endTimeMs: Date.now(),
          alias: 'supplies'
        },
        {
          type: 'event',
          ref: {
            type: 'event',
            event_type: 'Withdraw',
            filters: [],
            field: 'assets',
            aggregation: 'sum'
          },
          startTimeMs: 0,
          endTimeMs: Date.now(),
          alias: 'withdrawals'
        }
      ];

      const results = await client.batchQueries(queries);

      expect(mockRequest).toHaveBeenCalledTimes(1);
      expect(results).toEqual({
        supplies: 3000,
        withdrawals: 500
      });
    });

    it('handles mixed state and event queries', async () => {
      mockRequest.mockResolvedValue({
        currentPosition: [{ supplyShares: '5000' }],
        recentSupplies: [{ assets: '1000' }, { assets: '500' }]
      });

      const queries: BatchQuery[] = [
        {
          type: 'state',
          ref: {
            type: 'state',
            entity_type: 'Position',
            filters: [{ field: 'user', op: 'eq', value: '0x123' }],
            field: 'supplyShares'
          },
          alias: 'currentPosition'
        },
        {
          type: 'event',
          ref: {
            type: 'event',
            event_type: 'Supply',
            filters: [{ field: 'user', op: 'eq', value: '0x123' }],
            field: 'assets',
            aggregation: 'sum'
          },
          startTimeMs: 0,
          endTimeMs: Date.now(),
          alias: 'recentSupplies'
        }
      ];

      const results = await client.batchQueries(queries);

      expect(mockRequest).toHaveBeenCalledTimes(1);
      expect(results).toEqual({
        currentPosition: 5000,
        recentSupplies: 1500
      });
    });

    it('returns empty object for empty query list', async () => {
      const results = await client.batchQueries([]);
      expect(results).toEqual({});
      expect(mockRequest).not.toHaveBeenCalled();
    });

    it('returns zeros for all queries on error', async () => {
      mockRequest.mockRejectedValue(new Error('GraphQL error'));

      const queries: BatchQuery[] = [
        {
          type: 'state',
          ref: {
            type: 'state',
            entity_type: 'Position',
            filters: [],
            field: 'supplyShares'
          },
          alias: 'q1'
        },
        {
          type: 'event',
          ref: {
            type: 'event',
            event_type: 'Supply',
            filters: [],
            field: 'assets',
            aggregation: 'sum'
          },
          startTimeMs: 0,
          endTimeMs: Date.now(),
          alias: 'q2'
        }
      ];

      const results = await client.batchQueries(queries);

      expect(results).toEqual({
        q1: 0,
        q2: 0
      });
    });

    it('includes block number in state query with time-travel', async () => {
      mockRequest.mockResolvedValue({
        historicalPosition: [{ supplyShares: '3000' }]
      });

      const queries: BatchQuery[] = [
        {
          type: 'state',
          ref: {
            type: 'state',
            entity_type: 'Position',
            filters: [{ field: 'user', op: 'eq', value: '0x123' }],
            field: 'supplyShares'
          },
          blockNumber: 15000000,
          alias: 'historicalPosition'
        }
      ];

      await client.batchQueries(queries);

      expect(mockRequest).toHaveBeenCalledWith(
        expect.stringContaining('block: {number: 15000000}'),
        expect.any(Object)
      );
    });
  });

  describe('fetchPositions', () => {
    it('fetches raw positions for a chain', async () => {
      mockRequest.mockResolvedValue({
        Position: [
          {
            id: 'pos1',
            chainId: 1,
            user: '0x123',
            marketId: 'market1',
            supplyShares: '1000',
            borrowShares: '0',
            collateral: '5000',
            lastUpdateTimestamp: 1700000000
          }
        ]
      });

      const positions = await client.fetchPositions(1, [
        { field: 'marketId', op: 'eq', value: 'market1' }
      ]);

      expect(positions).toHaveLength(1);
      expect(positions[0].user).toBe('0x123');
      expect(mockRequest).toHaveBeenCalledWith(
        expect.stringContaining('Position'),
        expect.objectContaining({
          where: {
            marketId: { _eq: 'market1' },
            chainId: { _eq: 1 }
          }
        })
      );
    });

    it('includes block number for historical positions', async () => {
      mockRequest.mockResolvedValue({ Position: [] });

      await client.fetchPositions(1, [], 15000000);

      expect(mockRequest).toHaveBeenCalledWith(
        expect.stringContaining('block: {number: 15000000}'),
        expect.any(Object)
      );
    });

    it('returns empty array on error', async () => {
      mockRequest.mockRejectedValue(new Error('GraphQL error'));

      const positions = await client.fetchPositions(1, []);
      expect(positions).toEqual([]);
    });
  });

  describe('fetchMarkets', () => {
    it('fetches raw markets for a chain', async () => {
      mockRequest.mockResolvedValue({
        Market: [
          {
            id: 'market1',
            chainId: 1,
            loanToken: '0xtoken1',
            collateralToken: '0xtoken2',
            oracle: '0xoracle',
            irm: '0xirm',
            lltv: '800000000000000000',
            totalSupplyAssets: '1000000',
            totalSupplyShares: '1000000',
            totalBorrowAssets: '500000',
            totalBorrowShares: '500000',
            fee: '0',
            lastUpdate: 1700000000
          }
        ]
      });

      const markets = await client.fetchMarkets(1);

      expect(markets).toHaveLength(1);
      expect(markets[0].id).toBe('market1');
      expect(mockRequest).toHaveBeenCalledWith(
        expect.stringContaining('Market'),
        expect.objectContaining({
          where: { chainId: { _eq: 1 } }
        })
      );
    });

    it('returns empty array on error', async () => {
      mockRequest.mockRejectedValue(new Error('GraphQL error'));

      const markets = await client.fetchMarkets(1);
      expect(markets).toEqual([]);
    });
  });

  describe('fetchRawEvents', () => {
    it('fetches raw events for a chain and time range', async () => {
      mockRequest.mockResolvedValue({
        Morpho_Supply: [
          {
            id: 'event1',
            chainId: 1,
            timestamp: 1700000000,
            transactionHash: '0xabc',
            logIndex: 0
          },
          {
            id: 'event2',
            chainId: 1,
            timestamp: 1700001000,
            transactionHash: '0xdef',
            logIndex: 1
          }
        ]
      });

      const events = await client.fetchRawEvents(
        'Supply',
        1,
        1700000000000,
        1700003600000,
        [{ field: 'user', op: 'eq', value: '0x123' }]
      );

      expect(events).toHaveLength(2);
      expect(events[0].id).toBe('event1');
      expect(mockRequest).toHaveBeenCalledWith(
        expect.stringContaining('Morpho_Supply'),
        expect.objectContaining({
          where: {
            user: { _eq: '0x123' },
            chainId: { _eq: 1 },
            timestamp: { _gte: 1700000000, _lte: 1700003600 }
          }
        })
      );
    });

    it('returns empty array on error', async () => {
      mockRequest.mockRejectedValue(new Error('GraphQL error'));

      const events = await client.fetchRawEvents('Supply', 1, 0, Date.now());
      expect(events).toEqual([]);
    });
  });

  describe('filter operators', () => {
    it.each([
      ['eq', '_eq'],
      ['neq', '_neq'],
      ['gt', '_gt'],
      ['gte', '_gte'],
      ['lt', '_lt'],
      ['lte', '_lte'],
      ['in', '_in'],
      ['contains', '_ilike'],
    ])('translates %s operator to %s', async (op, gqlOp) => {
      mockRequest.mockResolvedValue({ result: [] });

      await client.fetchState({
        type: 'state',
        entity_type: 'Position',
        filters: [{ field: 'testField', op: op as any, value: 'testValue' }],
        field: 'any'
      });

      expect(mockRequest).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          result_where: { testField: { [gqlOp]: 'testValue' } }
        })
      );
    });
  });
});
