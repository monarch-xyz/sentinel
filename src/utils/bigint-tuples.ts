/**
 * Validates and returns a bigint tuple-like RPC result.
 */
export function requireBigIntTuple(
  value: unknown,
  expectedLength: number,
  context: string,
): bigint[] {
  if (
    !Array.isArray(value) ||
    value.length < expectedLength ||
    value.some((entry) => typeof entry !== "bigint")
  ) {
    throw new Error(`Unexpected ${context} response shape`);
  }
  return value as bigint[];
}

/**
 * Safely converts bigint values to number without precision loss.
 */
export function requireSafeNumberFromBigInt(value: bigint, context: string): number {
  const maxSafeInteger = BigInt(Number.MAX_SAFE_INTEGER);
  const minSafeInteger = BigInt(Number.MIN_SAFE_INTEGER);
  if (value > maxSafeInteger || value < minSafeInteger) {
    throw new Error(
      `Cannot convert ${context}=${value.toString()} to number without precision loss`,
    );
  }
  return Number(value);
}
