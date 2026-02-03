/**
 * Integration test for block resolver - actually calls RPCs
 * 
 * Run with: pnpm test:integration
 * 
 * Supported chains: Ethereum, Base, Polygon, Arbitrum, Monad, Unichain, Hyperliquid
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { 
  resolveBlockByTimestamp, 
  clearBlockCache,
  isChainSupported
} from '../../src/envio/blocks.js';

// Test date: 2025-12-03 00:00:00 UTC
const TEST_TIMESTAMP_MS = new Date('2025-12-03T00:00:00Z').getTime();

// Expected block numbers for 2025-12-03 00:00:00 UTC
// Fill these in after running the test once to validate!
const EXPECTED_BLOCKS: Record<number, number | null> = {
  1: null,      // Ethereum - fill in after test
  8453: null,   // Base - fill in after test
  137: null,    // Polygon - fill in after test
  42161: null,  // Arbitrum - fill in after test
  10143: null,  // Monad - fill in after test (might not be live yet)
  130: null,    // Unichain - fill in after test (might not be live yet)
  999: null,    // Hyperliquid - fill in after test (might not be live yet)
};

// Chains that are definitely live and should work
const LIVE_CHAINS = [1, 8453, 137, 42161];

// Newer chains that might not be live yet - test separately
const NEWER_CHAINS = [10143, 130, 999];

beforeAll(() => {
  clearBlockCache();
});

describe('Block Resolver Integration', () => {
  const TIMEOUT = 30000;

  describe('Live chains - 2025-12-03', () => {
    it('Ethereum (chainId: 1)', async () => {
      const blockNumber = await resolveBlockByTimestamp(1, TEST_TIMESTAMP_MS);
      console.log(`\n📦 Ethereum block for 2025-12-03: ${blockNumber}`);
      
      expect(blockNumber).toBeGreaterThan(0);
      expect(blockNumber).toBeLessThan(25000000);
      
      if (EXPECTED_BLOCKS[1] !== null) {
        expect(blockNumber).toBe(EXPECTED_BLOCKS[1]);
      }
    }, TIMEOUT);

    it('Base (chainId: 8453)', async () => {
      const blockNumber = await resolveBlockByTimestamp(8453, TEST_TIMESTAMP_MS);
      console.log(`\n📦 Base block for 2025-12-03: ${blockNumber}`);
      
      expect(blockNumber).toBeGreaterThan(0);
      
      if (EXPECTED_BLOCKS[8453] !== null) {
        expect(blockNumber).toBe(EXPECTED_BLOCKS[8453]);
      }
    }, TIMEOUT);

    it('Polygon (chainId: 137)', async () => {
      const blockNumber = await resolveBlockByTimestamp(137, TEST_TIMESTAMP_MS);
      console.log(`\n📦 Polygon block for 2025-12-03: ${blockNumber}`);
      
      expect(blockNumber).toBeGreaterThan(0);
      
      if (EXPECTED_BLOCKS[137] !== null) {
        expect(blockNumber).toBe(EXPECTED_BLOCKS[137]);
      }
    }, TIMEOUT);

    it('Arbitrum (chainId: 42161)', async () => {
      const blockNumber = await resolveBlockByTimestamp(42161, TEST_TIMESTAMP_MS);
      console.log(`\n📦 Arbitrum block for 2025-12-03: ${blockNumber}`);
      
      expect(blockNumber).toBeGreaterThan(0);
      
      if (EXPECTED_BLOCKS[42161] !== null) {
        expect(blockNumber).toBe(EXPECTED_BLOCKS[42161]);
      }
    }, TIMEOUT);
  });

  describe('Newer chains (may skip if not live)', () => {
    it.skip('Monad (chainId: 10143) - skip until mainnet', async () => {
      const blockNumber = await resolveBlockByTimestamp(10143, TEST_TIMESTAMP_MS);
      console.log(`\n📦 Monad block for 2025-12-03: ${blockNumber}`);
      expect(blockNumber).toBeGreaterThan(0);
    }, TIMEOUT);

    it.skip('Unichain (chainId: 130) - skip until mainnet', async () => {
      const blockNumber = await resolveBlockByTimestamp(130, TEST_TIMESTAMP_MS);
      console.log(`\n📦 Unichain block for 2025-12-03: ${blockNumber}`);
      expect(blockNumber).toBeGreaterThan(0);
    }, TIMEOUT);

    it.skip('Hyperliquid (chainId: 999) - skip until mainnet', async () => {
      const blockNumber = await resolveBlockByTimestamp(999, TEST_TIMESTAMP_MS);
      console.log(`\n📦 Hyperliquid block for 2025-12-03: ${blockNumber}`);
      expect(blockNumber).toBeGreaterThan(0);
    }, TIMEOUT);
  });

  describe('Performance', () => {
    it('should use cache on second call (instant)', async () => {
      // First call (may hit RPC)
      const start1 = Date.now();
      await resolveBlockByTimestamp(1, TEST_TIMESTAMP_MS);
      const time1 = Date.now() - start1;

      // Second call (should hit cache)
      const start2 = Date.now();
      await resolveBlockByTimestamp(1, TEST_TIMESTAMP_MS);
      const time2 = Date.now() - start2;

      console.log(`\n⏱️ First call: ${time1}ms, Cached call: ${time2}ms`);
      
      expect(time2).toBeLessThan(5);
    }, TIMEOUT);
  });

  describe('Chain support', () => {
    it('reports correct supported chains', () => {
      // Live chains should be supported
      expect(isChainSupported(1)).toBe(true);      // Ethereum
      expect(isChainSupported(8453)).toBe(true);   // Base
      expect(isChainSupported(137)).toBe(true);    // Polygon
      expect(isChainSupported(42161)).toBe(true);  // Arbitrum
      expect(isChainSupported(10143)).toBe(true);  // Monad
      expect(isChainSupported(130)).toBe(true);    // Unichain
      expect(isChainSupported(999)).toBe(true);    // Hyperliquid
      
      // Unsupported chains
      expect(isChainSupported(10)).toBe(false);    // Optimism (not supported)
      expect(isChainSupported(56)).toBe(false);    // BSC (not supported)
      expect(isChainSupported(43114)).toBe(false); // Avalanche (not supported)
    });
  });
});
