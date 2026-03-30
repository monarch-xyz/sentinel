import { isAddress, isHex } from "viem";
import { z } from "zod";
import type { RpcTypedArg } from "../types/index.js";

const RpcTypedArgSchema = z.object({
  type: z.string().min(1),
  value: z.unknown(),
});

const AddressValueSchema = z.string().refine((value) => isAddress(value), {
  message: "Invalid address argument",
});

const BooleanValueSchema = z.boolean();
const StringValueSchema = z.string();

const BytesValueSchema = z
  .string()
  .refine((value) => isHex(value) && (value.length - 2) % 2 === 0, {
    message: "Invalid bytes argument",
  });

const SignedIntegerNumberValueSchema = z.number().finite().int().refine(Number.isSafeInteger, {
  message: "unsafe integer number; use string or bigint for large integers",
});

const UnsignedIntegerNumberValueSchema = z
  .number()
  .finite()
  .int()
  .gte(0, {
    message: "negative value",
  })
  .refine(Number.isSafeInteger, {
    message: "unsafe integer number; use string or bigint for large integers",
  });

function parseIntegerArgValue(type: string, value: unknown): bigint {
  const isUint = /^uint(\d+)$/.test(type);
  const isInt = /^int(\d+)$/.test(type);
  if (!isUint && !isInt) {
    throw new Error(`Unsupported argument type: ${type}`);
  }

  if (typeof value === "bigint") {
    if (isUint && value < 0n) {
      throw new Error(`Invalid ${type} argument: negative value`);
    }
    return value;
  }

  if (typeof value === "number") {
    const parsed = isUint
      ? UnsignedIntegerNumberValueSchema.safeParse(value)
      : SignedIntegerNumberValueSchema.safeParse(value);
    if (!parsed.success) {
      throw new Error(
        `Invalid ${type} argument: ${parsed.error.issues[0]?.message ?? String(value)}`,
      );
    }
    return BigInt(parsed.data);
  }

  if (typeof value === "string" && value.trim() !== "") {
    try {
      const parsed = BigInt(value);
      if (isUint && parsed < 0n) {
        throw new Error(`Invalid ${type} argument: negative value`);
      }
      return parsed;
    } catch {
      throw new Error(`Invalid ${type} argument: ${String(value)}`);
    }
  }

  throw new Error(`Invalid ${type} argument: ${String(value)}`);
}

function parseFixedBytesArg(type: string, value: unknown): `0x${string}` {
  const fixedBytesMatch = type.match(/^bytes([1-9]|[12][0-9]|3[0-2])$/);
  if (!fixedBytesMatch) {
    throw new Error(`Unsupported argument type: ${type}`);
  }

  const byteLength = Number.parseInt(fixedBytesMatch[1], 10);
  const parsed = z.string().safeParse(value);
  if (!parsed.success) {
    throw new Error(`Invalid ${type} argument: ${String(value)}`);
  }

  const fixedBytesValue = parsed.data;
  if (
    !isHex(fixedBytesValue) ||
    fixedBytesValue.length !== 2 + byteLength * 2 ||
    (fixedBytesValue.length - 2) % 2 !== 0
  ) {
    throw new Error(`Invalid ${type} argument: ${String(value)}`);
  }

  return fixedBytesValue as `0x${string}`;
}

export function normalizeRpcTypedArg(arg: RpcTypedArg): unknown {
  const parsed = RpcTypedArgSchema.safeParse(arg);
  if (!parsed.success) {
    throw new Error("Invalid RPC typed argument");
  }
  const { type, value } = parsed.data;

  if (type === "address") {
    const result = AddressValueSchema.safeParse(value);
    if (!result.success) {
      throw new Error(`Invalid address argument: ${String(value)}`);
    }
    return result.data;
  }

  if (type === "bool") {
    const result = BooleanValueSchema.safeParse(value);
    if (!result.success) {
      throw new Error(`Invalid bool argument: ${String(value)}`);
    }
    return result.data;
  }

  if (type === "string") {
    const result = StringValueSchema.safeParse(value);
    if (!result.success) {
      throw new Error(`Invalid string argument: ${String(value)}`);
    }
    return result.data;
  }

  if (type === "bytes") {
    const result = BytesValueSchema.safeParse(value);
    if (!result.success) {
      throw new Error(`Invalid bytes argument: ${String(value)}`);
    }
    return result.data;
  }

  if (/^bytes([1-9]|[12][0-9]|3[0-2])$/.test(type)) {
    return parseFixedBytesArg(type, value);
  }

  if (/^(u?int)(\d+)$/.test(type)) {
    return parseIntegerArgValue(type, value);
  }

  throw new Error(`Unsupported argument type: ${type}`);
}

export function parseRpcBigIntTuple(
  value: unknown,
  expectedLength: number,
  context: string,
): bigint[] {
  if (!Number.isInteger(expectedLength) || expectedLength <= 0) {
    throw new Error(`Invalid expected tuple length for ${context}: ${expectedLength}`);
  }

  const schema = z.array(z.bigint()).length(expectedLength);
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Unexpected ${context} response shape`);
  }
  return parsed.data;
}
