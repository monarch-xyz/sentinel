import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EnvioClient } from '../../src/envio/client.js';

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

describe('EnvioClient', () => {
  let client: EnvioClient;

  beforeEach(() => {
    mockRequest.mockReset();
    client = new EnvioClient('https://mock-envio.endpoint');
  });

  it('translates simple equality filters correctly', async () => {
    mockRequest.mockResolvedValue({
      Position: [{ supplyShares: '1000' }]
    });

    const result = await client.fetchState({
      type: 'state',
      entity_type: 'Position',
      filters: [{ field: 'user', op: 'eq', value: '0x123' }],
      field: 'supplyShares'
    });

    expect(mockRequest).toHaveBeenCalledWith(
      expect.stringContaining('Position'),
      { where: { user: { _eq: '0x123' } } }
    );
    expect(result).toBe(1000);
  });

  it('aggregates raw events in-memory correctly', async () => {
    // Scenario: Sum of 'assets' from raw Supply events
    mockRequest.mockResolvedValue({
      Morpho_Supply: [
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

    // Verify it used the raw query (not _aggregate)
    expect(mockRequest).toHaveBeenCalledWith(
      expect.stringContaining('Morpho_Supply(where: $where)'),
      expect.anything()
    );
    
    // Verify in-memory sum: 1000 + 2000 + 500 = 3500
    expect(result).toBe(3500);
  });

  it('calculates counts correctly in-memory', async () => {
    mockRequest.mockResolvedValue({
      Morpho_Withdraw: [{}, {}, {}, {}] // 4 events
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
});
