/**
 * HMAC-SHA256 webhook signature verification.
 *
 * Expected request headers:
 *   X-Signature: hex(hmac_sha256(secret, `${timestamp}.${rawBody}`))
 *   X-Timestamp: unix epoch seconds
 *   X-Idempotency-Key: stable unique id per logical event (UUID recommended)
 *
 * Timestamp must be within LOGISTICS_WEBHOOK_MAX_AGE_SECONDS (default 300s)
 * to mitigate replay attacks. The signature is compared with timingSafeEqual.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export type WebhookHeaders = {
  signature: string | null;
  timestamp: string | null;
  idempotencyKey: string | null;
};

export function readWebhookHeaders(headers: Headers): WebhookHeaders {
  return {
    signature: headers.get("x-signature"),
    timestamp: headers.get("x-timestamp"),
    idempotencyKey: headers.get("x-idempotency-key"),
  };
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: "missing_headers" | "stale_timestamp" | "bad_signature" };

export function verifyWebhookSignature(opts: {
  rawBody: string;
  headers: WebhookHeaders;
  secret: string;
  maxAgeSeconds?: number;
  nowSeconds?: number;
}): VerifyResult {
  const { rawBody, headers, secret } = opts;
  const maxAge = opts.maxAgeSeconds ?? Number(process.env.LOGISTICS_WEBHOOK_MAX_AGE_SECONDS ?? 300);
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);

  if (!headers.signature || !headers.timestamp || !headers.idempotencyKey) {
    return { ok: false, reason: "missing_headers" };
  }

  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > maxAge) {
    return { ok: false, reason: "stale_timestamp" };
  }

  const expected = createHmac("sha256", secret).update(`${headers.timestamp}.${rawBody}`).digest("hex");

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(headers.signature, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_signature" };
  }

  return { ok: true };
}
