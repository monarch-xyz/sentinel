import crypto from "node:crypto";
import { env } from "./env.js";

/**
 * Verify Sentinel webhook signature
 *
 * Header format: X-Sentinel-Signature: t=<timestamp>,v1=<signature>
 */
interface VerifyWebhookOptions {
  maxAgeSeconds?: number;
}

function parseTimestampToUnixSeconds(timestamp: string): number | null {
  if (/^\d+$/.test(timestamp)) {
    return Number.parseInt(timestamp, 10);
  }

  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return Math.floor(parsed / 1000);
}

export function verifyWebhookSignature(
  body: string,
  signatureHeader: string,
  options: VerifyWebhookOptions = {},
): boolean {
  const maxAgeSeconds = options.maxAgeSeconds ?? 300;

  try {
    const normalized = signatureHeader.trim();
    let timestamp: string | undefined;
    let signature: string | undefined;

    // New format: t=<timestamp>,v1=<signature>
    const parts = normalized.split(",");
    const tPart = parts.find((p) => p.startsWith("t="));
    const v1Part = parts.find((p) => p.startsWith("v1="));
    if (tPart && v1Part) {
      timestamp = tPart.slice(2);
      signature = v1Part.slice(3);
    }

    if (!timestamp || !signature) {
      return false;
    }

    // Check timestamp freshness (prevent replay attacks)
    const timestampNum = parseTimestampToUnixSeconds(timestamp);
    if (timestampNum === null) {
      return false;
    }

    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - timestampNum) > maxAgeSeconds) {
      return false;
    }

    // Compute expected signature
    const payload = `${timestamp}.${body}`;
    const expected = crypto
      .createHmac("sha256", env.WEBHOOK_SECRET)
      .update(payload)
      .digest("hex");

    // Constant-time comparison
    const actualBytes = Buffer.from(signature, "hex");
    const expectedBytes = Buffer.from(expected, "hex");
    if (actualBytes.length !== expectedBytes.length) {
      return false;
    }
    return crypto.timingSafeEqual(actualBytes, expectedBytes);
  } catch {
    return false;
  }
}
