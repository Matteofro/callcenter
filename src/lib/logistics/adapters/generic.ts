/**
 * Generic webhook adapter.
 *
 * This is the default translation layer: it assumes the upstream platform
 * already sends events in our canonical envelope shape (see logistics
 * validation schema). When we wire the real provider, we'll add another
 * adapter file alongside this one and dispatch by `provider` field.
 */
import type { GenericWebhookEvent } from "@/lib/validation/logistics";

export interface NormalizedLogisticsEvent {
  externalId: string;
  type: GenericWebhookEvent["type"];
  occurredAt: Date;
  payload: Record<string, unknown>;
  trackingNumber?: string;
  orderRef?: string;
  customerPhone?: string;
  carrierStatus?: string;
}

export function fromGenericPayload(input: GenericWebhookEvent): NormalizedLogisticsEvent {
  return {
    externalId: input.externalId,
    type: input.type,
    occurredAt: input.occurredAt,
    payload: input.payload,
    trackingNumber: input.trackingNumber,
    orderRef: input.orderRef,
    customerPhone: input.customerPhone,
    carrierStatus: input.carrierStatus,
  };
}
