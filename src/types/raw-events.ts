export const RAW_EVENT_KINDS = [
  "erc20_transfer",
  "erc20_approval",
  "erc721_transfer",
  "erc721_approval",
  "erc721_approval_for_all",
  "erc4626_deposit",
  "erc4626_withdraw",
  "swap",
  "contract_event",
] as const;

export type RawEventKind = (typeof RAW_EVENT_KINDS)[number];

export const RAW_EVENT_SWAP_PROTOCOLS = ["uniswap_v2", "uniswap_v3"] as const;

export type RawEventSwapProtocol = (typeof RAW_EVENT_SWAP_PROTOCOLS)[number];
