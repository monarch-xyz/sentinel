import { bindMorphoArchiveRpcExecution } from "../protocols/morpho/index.js";
import type { PlannedArchiveRpcExecution, PlannedGenericRpcStateRead } from "./source-plan.js";

/**
 * Protocol-level RPC state dispatch.
 * Entity names may overlap across protocols, so dispatch happens by protocol first.
 */
export function bindArchiveRpcExecution(
  plan: PlannedGenericRpcStateRead,
): PlannedArchiveRpcExecution {
  switch (plan.protocol) {
    case "morpho":
      return bindMorphoArchiveRpcExecution(plan);
    default:
      throw new Error(`Unsupported state protocol for RPC: ${plan.protocol}`);
  }
}
