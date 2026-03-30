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
