import { z } from "zod";
import { LogisticsEventType } from "@prisma/client";

/**
 * Canonical logistics webhook envelope.
 *
 * The provider posts something free-form; the adapter normalises it into
 * this envelope before persistence and dispatch.
 */
export const genericWebhookSchema = z.object({
  /** Provider-supplied unique event id (idempotency key) */
  externalId: z.string().min(1).max(128),
  type: z.nativeEnum(LogisticsEventType),
  occurredAt: z.coerce.date(),
  /** Free-form payload kept verbatim */
  payload: z.record(z.unknown()),
  /** Optional links — at least one is usually present */
  trackingNumber: z.string().min(1).max(128).optional(),
  orderRef: z.string().min(1).max(128).optional(),
  customerPhone: z.string().min(3).max(32).optional(),
  /** Optional carrier-reported status text */
  carrierStatus: z.string().max(255).optional(),
});

export type GenericWebhookEvent = z.infer<typeof genericWebhookSchema>;
