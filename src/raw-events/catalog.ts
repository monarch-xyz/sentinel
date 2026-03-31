import { toEventSelector } from "viem";
import type { RawEventQuery } from "../types/index.js";
import {
  RAW_EVENT_SWAP_PROTOCOLS,
  type RawEventKind,
  type RawEventSwapProtocol,
} from "../types/raw-events.js";
import type { RawEventSpec } from "../types/signal.js";

type StaticRawEventCatalogEntry = {
  eventSignature: string;
  normalizer?: RawEventQuery["normalizer"];
};

const STATIC_WELL_KNOWN_RAW_EVENTS: Record<
  Exclude<RawEventKind, "swap" | "contract_event">,
  StaticRawEventCatalogEntry
> = {
  erc20_transfer: {
    eventSignature: "event Transfer(address indexed from, address indexed to, uint256 value)",
  },
  erc20_approval: {
    eventSignature: "event Approval(address indexed owner, address indexed spender, uint256 value)",
  },
  erc721_transfer: {
    eventSignature: "event Transfer(address indexed from, address indexed to, uint256 tokenId)",
  },
  erc721_approval: {
    eventSignature:
      "event Approval(address indexed owner, address indexed approved, uint256 tokenId)",
  },
  erc721_approval_for_all: {
    eventSignature:
      "event ApprovalForAll(address indexed owner, address indexed operator, bool approved)",
  },
  erc1155_transfer_single: {
    eventSignature:
      "event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)",
  },
  erc1155_transfer_batch: {
    eventSignature:
      "event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values)",
  },
};

const SWAP_PROTOCOL_QUERY_MAP: Record<RawEventSwapProtocol, RawEventQuery> = {
  uniswap_v2: {
    eventSignature:
      "event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)",
    topic0: toEventSelector(
      "event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)",
    ),
    normalizer: "uniswap_v2_swap",
  },
  uniswap_v3: {
    eventSignature:
      "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)",
    topic0: toEventSelector(
      "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)",
    ),
    normalizer: "uniswap_v3_swap",
  },
};

function normalizeRawEventSignature(signature: string): string {
  const trimmed = signature.trim();
  if (!trimmed) {
    throw new Error("raw event signature is required");
  }
  return trimmed.startsWith("event ") ? trimmed : `event ${trimmed}`;
}

function buildStaticWellKnownQuery(
  kind: Exclude<RawEventKind, "swap" | "contract_event">,
): RawEventQuery {
  const catalogEntry = STATIC_WELL_KNOWN_RAW_EVENTS[kind];
  return {
    eventSignature: catalogEntry.eventSignature,
    topic0: toEventSelector(catalogEntry.eventSignature),
    normalizer: catalogEntry.normalizer ?? "none",
  };
}

function buildSwapQueries(protocols?: RawEventSwapProtocol[]): RawEventQuery[] {
  const dedupedProtocols = Array.from(
    new Set(protocols ?? [...RAW_EVENT_SWAP_PROTOCOLS]),
  ) as RawEventSwapProtocol[];

  if (dedupedProtocols.length === 0) {
    throw new Error("swap raw-events must include at least one protocol");
  }

  return dedupedProtocols.map((protocol) => {
    const query = SWAP_PROTOCOL_QUERY_MAP[protocol];
    if (!query) {
      throw new Error(`unsupported swap raw-events protocol \"${protocol}\"`);
    }
    return { ...query };
  });
}

export function validateRawEventSpec(spec: RawEventSpec): void {
  if (spec.kind === "contract_event") {
    if (!spec.signature) {
      throw new Error("signature is required for contract_event raw-events");
    }
    if (spec.protocols) {
      throw new Error("protocols are only supported for swap raw-events");
    }
    return;
  }

  if (spec.kind === "swap") {
    if (spec.signature) {
      throw new Error("signature is only supported for contract_event raw-events");
    }
    if (spec.protocols && spec.protocols.length === 0) {
      throw new Error("protocols must not be empty for swap raw-events");
    }
    return;
  }

  if (spec.signature) {
    throw new Error("signature is only supported for contract_event raw-events");
  }
  if (spec.protocols) {
    throw new Error("protocols are only supported for swap raw-events");
  }
}

export function buildRawEventQueries(spec: RawEventSpec): RawEventQuery[] {
  validateRawEventSpec(spec);

  if (spec.kind === "contract_event") {
    const signature = normalizeRawEventSignature(spec.signature ?? "");
    return [
      {
        eventSignature: signature,
        topic0: toEventSelector(signature),
        normalizer: "none",
      },
    ];
  }

  if (spec.kind === "swap") {
    return buildSwapQueries(spec.protocols);
  }

  return [buildStaticWellKnownQuery(spec.kind)];
}
