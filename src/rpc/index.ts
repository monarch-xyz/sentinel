/**
 * RPC module for historical state queries
 *
 * Provides direct contract reads via viem for cases where Envio
 * can't be used (historical state queries).
 */

export {
  getPublicClient,
  executeArchiveRpcCall,
  readPositionAtBlock,
  readMarketAtBlock,
  readPosition,
  readMarket,
  clearClientCache,
  isChainSupportedForRpc,
  RpcQueryError,
} from "./client.ts";

export { morphoAbi, MORPHO_ADDRESSES, type PositionResult, type MarketResult } from "./abi.ts";
