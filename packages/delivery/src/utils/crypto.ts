import crypto from "node:crypto";
import { verifyMessage } from "viem";
import { env } from "./env.js";

/**
 * Verify wallet ownership via EIP-191 signature
 */
export async function verifyWalletSignature(
  wallet: string,
  message: string,
  signature: `0x${string}`,
): Promise<boolean> {
  try {
    const recoveredAddress = await verifyMessage({
      address: wallet as `0x${string}`,
      message,
      signature,
    });
    return recoveredAddress;
  } catch {
    return false;
  }
}

/**
 * Generate the message users must sign to link their wallet
 */
export function generateLinkMessage(token: string): string {
  return `Link wallet to Monarch Sentinel notifications.

Token: ${token}

This signature proves you own this wallet. It does not authorize any transactions.`;
}

/**
 * Verify Sentinel webhook signature
 *
 * Sentinel signs webhooks with: HMAC-SHA256(timestamp + '.' + body, secret)
 * Header format: X-Sentinel-Signature: t=<timestamp>,v1=<signature>
 */
export function verifyWebhookSignature(
  body: string,
  signatureHeader: string,
  maxAgeSeconds = 300,
): boolean {
  try {
    // Parse header
    const parts = signatureHeader.split(",");
    const timestamp = parts.find((p) => p.startsWith("t="))?.slice(2);
    const signature = parts.find((p) => p.startsWith("v1="))?.slice(3);

    if (!timestamp || !signature) {
      return false;
    }

    // Check timestamp freshness (prevent replay attacks)
    const timestampNum = Number.parseInt(timestamp, 10);
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
    return crypto.timingSafeEqual(
      Buffer.from(signature, "hex"),
      Buffer.from(expected, "hex"),
    );
  } catch {
    return false;
  }
}
