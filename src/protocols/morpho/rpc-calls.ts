import type { GenericRpcCall } from "../../types/index.js";

export const MORPHO_POSITION_SIGNATURE =
  "position(bytes32 id, address user) returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)";
export const MORPHO_MARKET_SIGNATURE =
  "market(bytes32 id) returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)";

export function buildMorphoPositionCall(
  to: `0x${string}`,
  marketId: string,
  user: string,
): GenericRpcCall {
  return {
    to,
    signature: MORPHO_POSITION_SIGNATURE,
    args: [
      { type: "bytes32", value: marketId },
      { type: "address", value: user },
    ],
  };
}

export function buildMorphoMarketCall(to: `0x${string}`, marketId: string): GenericRpcCall {
  return {
    to,
    signature: MORPHO_MARKET_SIGNATURE,
    args: [{ type: "bytes32", value: marketId }],
  };
}
