const BYTES32_MARKET_ID_REGEX = /^0x[a-fA-F0-9]{64}$/;
const EMBEDDED_BYTES32_MARKET_ID_REGEX = /0x[a-fA-F0-9]{64}/;

export function normalizeMarketId(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }

  const embeddedMatch = trimmed.match(EMBEDDED_BYTES32_MARKET_ID_REGEX);
  if (embeddedMatch) {
    return embeddedMatch[0].toLowerCase();
  }

  return trimmed;
}

export function isBytes32MarketId(value: string): boolean {
  return BYTES32_MARKET_ID_REGEX.test(value.trim());
}
