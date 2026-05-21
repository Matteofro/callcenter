/**
 * POST /api/logistics/webhook
 *
 * Webhook ingest for the logistics platform.
 *
 * Pipeline:
 *   1. Read RAW body (needed for HMAC).
 *   2. Verify X-Signature + X-Timestamp (replay window) + require X-Idempotency-Key.
 *   3. Parse + validate the canonical envelope (zod).
 *   4. Run provider adapter → normalized event.
 *   5. Apply to domain entities (LogisticsEvent persisted, Shipment/Order updated,
 *      AuditLog written, realtime events published).
 *   6. Return 200 with the eventId.
 *
 * Idempotency: enforced at two layers — the X-Idempotency-Key header AND
 * LogisticsEvent.externalId unique index. Safe to retry.
 *
 * Errors:
 *   - 401 if signature is missing/invalid → provider may retry
 *   - 400 if body is malformed → provider should NOT retry (we log and drop)
 *   - 200 on idempotent replay (with `alreadyProcessed: true`)
 *   - 500 on internal failure → provider may retry
 */
import type { NextRequest } from "next/server";
import { handle, ok, errors } from "@/lib/http";
import { verifyWebhookSignature, readWebhookHeaders } from "@/lib/hmac";
import { genericWebhookSchema } from "@/lib/validation/logistics";
import { fromGenericPayload } from "@/lib/logistics/adapters/generic";
import { applyLogisticsEvent } from "@/lib/logistics/apply";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  return handle(async () => {
    const secret = process.env.LOGISTICS_WEBHOOK_SECRET;
    if (!secret) {
      logger.error({}, "LOGISTICS_WEBHOOK_SECRET not configured");
      throw errors.internal("Webhook secret not configured");
    }

    // Read RAW body — once. Do NOT call req.json() before HMAC verification,
    // as JSON serialization is not byte-stable across libraries.
    const raw = await req.text();
    const headers = readWebhookHeaders(req.headers);

    const verify = verifyWebhookSignature({ rawBody: raw, headers, secret });
    if (!verify.ok) {
      logger.warn({ reason: verify.reason }, "Webhook signature check failed");
      throw errors.unauthorized(`webhook_${verify.reason}`);
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      throw errors.badRequest("Body is not valid JSON", "Body non in formato JSON.");
    }

    const payload = genericWebhookSchema.parse(parsedJson);

    // Safety: ensure the external id we use for idempotency matches the
    // header. If they differ we trust the header (the transport layer).
    if (headers.idempotencyKey && headers.idempotencyKey !== payload.externalId) {
      logger.warn(
        {
          headerKey: headers.idempotencyKey,
          payloadId: payload.externalId,
        },
        "X-Idempotency-Key differs from payload.externalId — using header",
      );
      payload.externalId = headers.idempotencyKey;
    }

    const normalized = fromGenericPayload(payload);
    const result = await applyLogisticsEvent(normalized, "generic");

    return ok({
      eventId: result.eventId,
      alreadyProcessed: result.alreadyProcessed,
    });
  })();
}
