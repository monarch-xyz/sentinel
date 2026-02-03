/**
 * RPC module for historical state queries
 *
 * Provides direct contract reads via viem for cases where Envio
 * can't be used (historical state queries).
 */

export {
  getPublicClient,
  readPositionAtBlock,
  readMarketAtBlock,
  readPosition,
  readMarket,
  clearClientCache,
  isChainSupportedForRpc,
  RpcQueryError,
} from './client.js';

export { morphoAbi, MORPHO_ADDRESSES, type PositionResult, type MarketResult } from './abi.js';
