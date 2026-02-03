/**
 * Morpho Blue ABI - minimal subset for reading position and market state
 *
 * Full contract: https://github.com/morpho-org/morpho-blue
 * Deployed addresses: https://docs.morpho.org/addresses
 */

/**
 * Morpho Blue contract addresses by chain
 */
export const MORPHO_ADDRESSES: Record<number, `0x${string}`> = {
  1: '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb', // Ethereum Mainnet
  8453: '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb', // Base
  137: '0x1bf0c2541f820e775182832f06c0b7fc27a25f67', // Polygon
  130: '0x8f5ae9cddb9f68de460c77730b018ae7e04a140a', // Unichain
  42161: '0x6c247b1F6182318877311737BaC0844bAa518F5e', // Arbitrum
  999: '0x68e37dE8d93d3496ae143F2E900490f6280C57cD', // HyperEVM
  10143: '0xD5D960E8C380B724a48AC59E2DfF1b2CB4a1eAee', // Monad
};

/**
 * Morpho Blue ABI - just the view functions we need
 *
 * Note: Market ID is bytes32, Position returns struct-like tuple
 */
export const morphoAbi = [
  // position(bytes32 id, address user) returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)
  {
    type: 'function',
    name: 'position',
    stateMutability: 'view',
    inputs: [
      { name: 'id', type: 'bytes32' },
      { name: 'user', type: 'address' },
    ],
    outputs: [
      { name: 'supplyShares', type: 'uint256' },
      { name: 'borrowShares', type: 'uint128' },
      { name: 'collateral', type: 'uint128' },
    ],
  },
  // market(bytes32 id) returns Market struct
  {
    type: 'function',
    name: 'market',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'bytes32' }],
    outputs: [
      { name: 'totalSupplyAssets', type: 'uint128' },
      { name: 'totalSupplyShares', type: 'uint128' },
      { name: 'totalBorrowAssets', type: 'uint128' },
      { name: 'totalBorrowShares', type: 'uint128' },
      { name: 'lastUpdate', type: 'uint128' },
      { name: 'fee', type: 'uint128' },
    ],
  },
] as const;

/**
 * Type for position result from contract
 */
export type PositionResult = {
  supplyShares: bigint;
  borrowShares: bigint;
  collateral: bigint;
};

/**
 * Type for market result from contract
 */
export type MarketResult = {
  totalSupplyAssets: bigint;
  totalSupplyShares: bigint;
  totalBorrowAssets: bigint;
  totalBorrowShares: bigint;
  lastUpdate: bigint;
  fee: bigint;
};
