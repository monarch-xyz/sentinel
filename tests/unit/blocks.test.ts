import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import {
  resolveBlockByTimestamp,
  getSupportedChains,
  isChainSupported,
  clearBlockCache,
  getBlockCacheSize,
  addChainConfig,
  CHAIN_CONFIGS,
  LRUCache,
} from '../../src/envio/blocks.js';

// Mock axios
vi.mock('axios');
const mockedAxios = vi.mocked(axios, true);

describe('Block Resolver', () => {
  beforeEach(() => {
    clearBlockCache();
    vi.clearAllMocks();
  });

  afterEach(() => {
    clearBlockCache();
  });

  describe('LRUCache', () => {
    it('stores and retrieves values', () => {
      const cache = new LRUCache<string, number>(3);
      cache.set('a', 1);
      cache.set('b', 2);
      expect(cache.get('a')).toBe(1);
      expect(cache.get('b')).toBe(2);
    });

    it('evicts oldest entry when full', () => {
      const cache = new LRUCache<string, number>(3);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      cache.set('d', 4); // Should evict 'a'

      expect(cache.get('a')).toBeUndefined();
      expect(cache.get('b')).toBe(2);
      expect(cache.get('c')).toBe(3);
      expect(cache.get('d')).toBe(4);
    });

    it('updates access order on get', () => {
      const cache = new LRUCache<string, number>(3);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);

      cache.get('a'); // Access 'a', making it most recently used
      cache.set('d', 4); // Should evict 'b' (now oldest)

      expect(cache.get('a')).toBe(1);
      expect(cache.get('b')).toBeUndefined();
      expect(cache.get('c')).toBe(3);
      expect(cache.get('d')).toBe(4);
    });

    it('handles size correctly', () => {
      const cache = new LRUCache<string, number>(3);
      expect(cache.size()).toBe(0);
      cache.set('a', 1);
      expect(cache.size()).toBe(1);
      cache.set('b', 2);
      cache.set('c', 3);
      expect(cache.size()).toBe(3);
      cache.set('d', 4);
      expect(cache.size()).toBe(3); // Still 3 after eviction
    });

    it('clears all entries', () => {
      const cache = new LRUCache<string, number>(3);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.clear();
      expect(cache.size()).toBe(0);
      expect(cache.get('a')).toBeUndefined();
    });

    it('updates existing keys without increasing size', () => {
      const cache = new LRUCache<string, number>(3);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('a', 10); // Update 'a'

      expect(cache.size()).toBe(2);
      expect(cache.get('a')).toBe(10);
    });
  });

  describe('resolveBlockByTimestamp', () => {
    function mockRpcResponse(blockNumber: number, timestamp: number) {
      return {
        data: {
          result: {
            number: `0x${blockNumber.toString(16)}`,
            timestamp: `0x${timestamp.toString(16)}`,
          },
        },
      };
    }

    it('resolves timestamp using binary search', async () => {
      const targetTimestamp = 1700000000;
      const targetBlock = 18500000;

      // Mock RPC calls for binary search
      mockedAxios.post.mockImplementation(async (_url, data: any) => {
        const params = data.params;
        if (params[0] === 'latest') {
          return mockRpcResponse(19000000, 1706000000);
        }

        const blockNum = parseInt(params[0], 16);
        // Simulate realistic block-timestamp relationship
        // Ethereum: ~12s per block from genesis (1438269973)
        const estimatedTimestamp = 1438269973 + Math.floor(blockNum * 12);

        return mockRpcResponse(blockNum, estimatedTimestamp);
      });

      const result = await resolveBlockByTimestamp(1, targetTimestamp * 1000);

      // Should find a block close to target
      expect(typeof result).toBe('number');
      expect(result).toBeGreaterThan(0);
      expect(mockedAxios.post).toHaveBeenCalled();
    });

    it('returns cached result on second call', async () => {
      const targetTimestamp = 1700000000;

      mockedAxios.post.mockImplementation(async (_url, data: any) => {
        const params = data.params;
        if (params[0] === 'latest') {
          return mockRpcResponse(19000000, 1706000000);
        }
        const blockNum = parseInt(params[0], 16);
        const estimatedTimestamp = 1438269973 + Math.floor(blockNum * 12);
        return mockRpcResponse(blockNum, estimatedTimestamp);
      });

      // First call
      const result1 = await resolveBlockByTimestamp(1, targetTimestamp * 1000);
      const callCount1 = mockedAxios.post.mock.calls.length;

      // Second call - should use cache
      const result2 = await resolveBlockByTimestamp(1, targetTimestamp * 1000);
      const callCount2 = mockedAxios.post.mock.calls.length;

      expect(result1).toBe(result2);
      expect(callCount2).toBe(callCount1); // No additional RPC calls
    });

    it('returns 0 for timestamp before genesis', async () => {
      // Ethereum genesis is 1438269973
      const beforeGenesis = 1400000000 * 1000; // Well before genesis

      const result = await resolveBlockByTimestamp(1, beforeGenesis);

      expect(result).toBe(0);
      expect(mockedAxios.post).not.toHaveBeenCalled(); // No RPC needed
    });

    it('returns latest block for future timestamp', async () => {
      const futureTimestamp = (Date.now() + 365 * 24 * 60 * 60 * 1000); // 1 year in future
      const latestBlock = 19500000;
      const latestTimestamp = Math.floor(Date.now() / 1000);

      mockedAxios.post.mockResolvedValue(
        mockRpcResponse(latestBlock, latestTimestamp)
      );

      const result = await resolveBlockByTimestamp(1, futureTimestamp);

      expect(result).toBe(latestBlock);
    });

    it('falls back to estimation when RPC fails', async () => {
      mockedAxios.post.mockRejectedValue(new Error('RPC error'));

      // Should not throw, instead fallback to estimation
      const timestamp = 1700000000 * 1000;
      const result = await resolveBlockByTimestamp(1, timestamp);

      expect(typeof result).toBe('number');
      expect(result).toBeGreaterThan(0);
    });

    it('uses estimation for unsupported chains', async () => {
      const unsupportedChainId = 99999;
      const timestamp = 1700000000 * 1000;

      const result = await resolveBlockByTimestamp(unsupportedChainId, timestamp);

      // Should estimate based on default 12s blocks
      expect(typeof result).toBe('number');
      expect(result).toBeGreaterThan(0);
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('tries multiple RPC endpoints on failure', async () => {
      let callCount = 0;

      mockedAxios.post.mockImplementation(async (url: string, data: any) => {
        callCount++;

        // First two endpoints fail
        if (callCount <= 2) {
          throw new Error('RPC error');
        }

        // Third endpoint succeeds
        const params = data.params;
        if (params[0] === 'latest') {
          return mockRpcResponse(19000000, 1706000000);
        }
        const blockNum = parseInt(params[0], 16);
        const estimatedTimestamp = 1438269973 + Math.floor(blockNum * 12);
        return mockRpcResponse(blockNum, estimatedTimestamp);
      });

      const result = await resolveBlockByTimestamp(1, 1700000000 * 1000);

      expect(typeof result).toBe('number');
      // Should have tried multiple endpoints
      expect(callCount).toBeGreaterThan(1);
    });

    it('handles exact timestamp match', async () => {
      const exactTimestamp = 1700000000;
      const exactBlock = 18500000;

      mockedAxios.post.mockImplementation(async (_url, data: any) => {
        const params = data.params;
        if (params[0] === 'latest') {
          return mockRpcResponse(19000000, 1706000000);
        }
        const blockNum = parseInt(params[0], 16);
        // Return exact match for target block
        if (blockNum === exactBlock) {
          return mockRpcResponse(exactBlock, exactTimestamp);
        }
        // Otherwise estimate
        const estimatedTimestamp = 1438269973 + Math.floor(blockNum * 12);
        return mockRpcResponse(blockNum, estimatedTimestamp);
      });

      // This test verifies the code handles exact matches
      const result = await resolveBlockByTimestamp(1, exactTimestamp * 1000);
      expect(typeof result).toBe('number');
    });

    it('works correctly for Base chain', async () => {
      const targetTimestamp = 1700000000;

      mockedAxios.post.mockImplementation(async (url: string, data: any) => {
        // Verify Base endpoint is used
        expect(url).toMatch(/base/i);

        const params = data.params;
        if (params[0] === 'latest') {
          return mockRpcResponse(10000000, 1706000000);
        }
        const blockNum = parseInt(params[0], 16);
        // Base: ~2s per block from genesis (1686789347)
        const estimatedTimestamp = 1686789347 + Math.floor(blockNum * 2);
        return mockRpcResponse(blockNum, estimatedTimestamp);
      });

      const result = await resolveBlockByTimestamp(8453, targetTimestamp * 1000);

      expect(typeof result).toBe('number');
      expect(result).toBeGreaterThan(0);
    });
  });

  describe('getSupportedChains', () => {
    it('returns array of supported chain IDs', () => {
      const chains = getSupportedChains();

      expect(Array.isArray(chains)).toBe(true);
      expect(chains).toContain(1); // Ethereum
      expect(chains).toContain(8453); // Base
    });
  });

  describe('isChainSupported', () => {
    it('returns true for supported chains', () => {
      expect(isChainSupported(1)).toBe(true);
      expect(isChainSupported(8453)).toBe(true);
    });

    it('returns false for unsupported chains', () => {
      expect(isChainSupported(99999)).toBe(false);
    });
  });

  describe('clearBlockCache', () => {
    it('clears all cached entries', async () => {
      // Pre-populate cache via direct estimation (unsupported chain)
      await resolveBlockByTimestamp(99999, 1700000000 * 1000);
      expect(getBlockCacheSize()).toBeGreaterThan(0);

      clearBlockCache();

      expect(getBlockCacheSize()).toBe(0);
    });
  });

  describe('getBlockCacheSize', () => {
    it('returns current cache size', async () => {
      expect(getBlockCacheSize()).toBe(0);

      // Add entries via unsupported chain (uses estimation, no RPC)
      await resolveBlockByTimestamp(99999, 1700000000 * 1000);
      expect(getBlockCacheSize()).toBe(1);

      await resolveBlockByTimestamp(99999, 1700001000 * 1000);
      expect(getBlockCacheSize()).toBe(2);
    });
  });

  describe('addChainConfig', () => {
    it('adds new chain configuration', async () => {
      const newChainId = 12345;

      expect(isChainSupported(newChainId)).toBe(false);

      addChainConfig(newChainId, {
        name: 'TestChain',
        rpcEndpoints: ['https://test.rpc'],
        genesisTimestamp: 1600000000,
        avgBlockTimeMs: 5000,
      });

      expect(isChainSupported(newChainId)).toBe(true);
      expect(getSupportedChains()).toContain(newChainId);
    });

    it('updates existing chain configuration', () => {
      const originalEndpoints = CHAIN_CONFIGS[1].rpcEndpoints.length;

      addChainConfig(1, {
        name: 'Ethereum Updated',
        rpcEndpoints: ['https://custom.rpc'],
        genesisTimestamp: 1438269973,
        avgBlockTimeMs: 12000,
      });

      expect(CHAIN_CONFIGS[1].rpcEndpoints).toHaveLength(1);
      expect(CHAIN_CONFIGS[1].rpcEndpoints[0]).toBe('https://custom.rpc');

      // Restore original config
      addChainConfig(1, {
        name: 'Ethereum',
        rpcEndpoints: [
          'https://eth.llamarpc.com',
          'https://rpc.ankr.com/eth',
          'https://ethereum.publicnode.com',
        ],
        genesisTimestamp: 1438269973,
        avgBlockTimeMs: 12000,
      });
    });
  });

  describe('edge cases', () => {
    it('handles timestamp at exactly genesis', async () => {
      // Ethereum genesis timestamp
      const genesisTimestamp = 1438269973 * 1000;

      const result = await resolveBlockByTimestamp(1, genesisTimestamp);

      expect(result).toBe(0);
    });

    it('handles very old timestamp (before genesis)', async () => {
      // Unix epoch
      const oldTimestamp = 0;

      const result = await resolveBlockByTimestamp(1, oldTimestamp);

      expect(result).toBe(0);
    });

    it('handles negative timestamp', async () => {
      const negativeTimestamp = -1000;

      const result = await resolveBlockByTimestamp(1, negativeTimestamp);

      expect(result).toBe(0);
    });

    it('handles RPC returning error in response', async () => {
      mockedAxios.post.mockResolvedValue({
        data: {
          error: { message: 'Block not found' },
        },
      });

      // Should fallback to estimation
      const result = await resolveBlockByTimestamp(1, 1700000000 * 1000);

      expect(typeof result).toBe('number');
      expect(result).toBeGreaterThan(0);
    });

    it('handles RPC timeout', async () => {
      mockedAxios.post.mockRejectedValue(new Error('ETIMEDOUT'));

      const result = await resolveBlockByTimestamp(1, 1700000000 * 1000);

      // Should fallback to estimation
      expect(typeof result).toBe('number');
      expect(result).toBeGreaterThan(0);
    });

    it('caches results with second precision', async () => {
      // Two timestamps that round to same second
      const ts1 = 1700000000100; // ms
      const ts2 = 1700000000900; // ms

      await resolveBlockByTimestamp(99999, ts1);
      const size1 = getBlockCacheSize();

      await resolveBlockByTimestamp(99999, ts2);
      const size2 = getBlockCacheSize();

      // Both should use same cache entry
      expect(size2).toBe(size1);
    });

    it('different chains have separate cache entries', async () => {
      const timestamp = 1700000000 * 1000;

      await resolveBlockByTimestamp(99998, timestamp);
      await resolveBlockByTimestamp(99999, timestamp);

      expect(getBlockCacheSize()).toBe(2);
    });
  });
});
