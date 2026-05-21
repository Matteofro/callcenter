/**
 * Apply a normalized logistics event to the domain entities.
 *
 * Responsibilities:
 *   1. Resolve the affected shipment/order/customer from the lookup hints.
 *   2. Persist the LogisticsEvent row (idempotency enforced by unique externalId).
 *   3. Update Shipment delivery status / flags accordingly.
 *   4. Cascade Order.status when the shipment terminal state changes.
 *   5. Write AuditLog entries with source = WEBHOOK.
 *   6. Publish realtime events on the in-memory bus.
 *
 * Returns the persisted LogisticsEvent record id (or the existing one on
 * idempotent retry).
 */
import type { Prisma, LogisticsEventType, ShipmentDeliveryStatus, OrderStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { publish } from "@/lib/pubsub";
import { logger } from "@/lib/logger";
import { tryNormalizePhone } from "@/lib/phone";
import type { NormalizedLogisticsEvent } from "@/lib/logistics/adapters/generic";

// Mapping of incoming event types to derived shipment statuses + flags.
type ShipmentMutation = {
  deliveryStatus?: ShipmentDeliveryStatus;
  isDelayed?: boolean;
  isRefused?: boolean;
  isLost?: boolean;
  isReturned?: boolean;
  setDeliveredAt?: boolean;
  cascadeOrderStatus?: OrderStatus;
  issueKind?: "delayed" | "refused" | "lost" | "returned" | "exception";
};

const EVENT_MAP: Record<LogisticsEventType, ShipmentMutation> = {
  SHIPMENT_CREATED: { deliveryStatus: "PENDING" },
  SHIPMENT_PICKED_UP: { deliveryStatus: "IN_TRANSIT", cascadeOrderStatus: "SHIPPED" },
  SHIPMENT_IN_TRANSIT: { deliveryStatus: "IN_TRANSIT", cascadeOrderStatus: "IN_TRANSIT" },
  SHIPMENT_OUT_FOR_DELIVERY: { deliveryStatus: "OUT_FOR_DELIVERY", cascadeOrderStatus: "OUT_FOR_DELIVERY" },
  SHIPMENT_DELIVERED: { deliveryStatus: "DELIVERED", setDeliveredAt: true, cascadeOrderStatus: "DELIVERED" },
  SHIPMENT_REFUSED: { deliveryStatus: "REFUSED", isRefused: true, cascadeOrderStatus: "RETURNED", issueKind: "refused" },
  SHIPMENT_RETURNED: { deliveryStatus: "RETURNED", isReturned: true, cascadeOrderStatus: "RETURNED", issueKind: "returned" },
  SHIPMENT_LOST: { deliveryStatus: "LOST", isLost: true, issueKind: "lost" },
  SHIPMENT_DELAYED: { deliveryStatus: "DELAYED", isDelayed: true, issueKind: "delayed" },
  SHIPMENT_EXCEPTION: { deliveryStatus: "EXCEPTION", issueKind: "exception" },
  ORDER_UPDATED: {},
  CUSTOMER_UPDATED: {},
  UNKNOWN: {},
};

export type ApplyResult = {
  eventId: string;
  alreadyProcessed: boolean;
};

export async function applyLogisticsEvent(
  ev: NormalizedLogisticsEvent,
  provider = "generic",
): Promise<ApplyResult> {
  // 1) Idempotency: short-circuit if we've already seen this externalId.
  const existing = await prisma.logisticsEvent.findUnique({
    where: { externalId: ev.externalId },
  });
  if (existing) {
    logger.info({ externalId: ev.externalId }, "Logistics event already processed");
    return { eventId: existing.id, alreadyProcessed: true };
  }

  // 2) Resolve linked entities.
  const shipment = ev.trackingNumber
    ? await prisma.shipment.findUnique({
        where: { trackingNumber: ev.trackingNumber },
        include: { order: { include: { customer: true } } },
      })
    : null;

  // Fallback resolution by orderRef / phone if we don't have a shipment match.
  const orderByRef =
    !shipment && ev.orderRef
      ? await prisma.order.findUnique({ where: { externalRef: ev.orderRef }, include: { customer: true } })
      : null;

  const phone = ev.customerPhone ? tryNormalizePhone(ev.customerPhone) : null;
  const customerByPhone =
    !shipment && !orderByRef && phone
      ? await prisma.customer.findUnique({ where: { phoneE164: phone.e164 } })
      : null;

  const orderId = shipment?.order.id ?? orderByRef?.id ?? null;
  const customerId =
    shipment?.order.customer.id ?? orderByRef?.customer.id ?? customerByPhone?.id ?? null;

  // 3) Persist the LogisticsEvent record (the unique externalId index makes this idempotent
  //    even if two webhook deliveries race).
  const created = await prisma.logisticsEvent.create({
    data: {
      externalId: ev.externalId,
      type: ev.type,
      provider,
      payload: ev.payload as Prisma.InputJsonValue,
      occurredAt: ev.occurredAt,
      shipmentId: shipment?.id ?? null,
      orderId,
      customerId,
    },
  });

  // 4) Apply mutation if we resolved a shipment.
  const mutation = EVENT_MAP[ev.type];
  if (shipment && Object.keys(mutation).length > 0) {
    const before = {
      deliveryStatus: shipment.deliveryStatus,
      isDelayed: shipment.isDelayed,
      isRefused: shipment.isRefused,
      isLost: shipment.isLost,
      isReturned: shipment.isReturned,
      deliveredAt: shipment.deliveredAt,
    };

    const data: Prisma.ShipmentUpdateInput = {
      lastCarrierStatus: ev.carrierStatus ?? shipment.lastCarrierStatus,
      lastEventAt: ev.occurredAt,
    };
    if (mutation.deliveryStatus) data.deliveryStatus = mutation.deliveryStatus;
    if (mutation.isDelayed !== undefined) data.isDelayed = mutation.isDelayed;
    if (mutation.isRefused !== undefined) data.isRefused = mutation.isRefused;
    if (mutation.isLost !== undefined) data.isLost = mutation.isLost;
    if (mutation.isReturned !== undefined) data.isReturned = mutation.isReturned;
    if (mutation.setDeliveredAt) data.deliveredAt = ev.occurredAt;

    const updated = await prisma.shipment.update({
      where: { id: shipment.id },
      data,
    });

    await writeAudit({
      action: `shipment.${ev.type.toLowerCase()}`,
      entityType: "Shipment",
      entityId: shipment.id,
      oldValue: before,
      newValue: {
        deliveryStatus: updated.deliveryStatus,
        isDelayed: updated.isDelayed,
        isRefused: updated.isRefused,
        isLost: updated.isLost,
        isReturned: updated.isReturned,
        deliveredAt: updated.deliveredAt,
      },
      source: "WEBHOOK",
      metadata: { externalId: ev.externalId, provider },
    });

    // Cascade order status when the shipment reached a terminal state.
    if (mutation.cascadeOrderStatus) {
      const order = await prisma.order.findUnique({ where: { id: shipment.order.id } });
      if (order && order.status !== mutation.cascadeOrderStatus) {
        await prisma.order.update({
          where: { id: order.id },
          data: { status: mutation.cascadeOrderStatus },
        });
        await writeAudit({
          action: "order.status_cascade",
          entityType: "Order",
          entityId: order.id,
          oldValue: { status: order.status },
          newValue: { status: mutation.cascadeOrderStatus },
          source: "WEBHOOK",
          metadata: { externalId: ev.externalId, provider, fromShipmentId: shipment.id },
        });
        publish({
          type: "order.updated",
          entityId: order.id,
          related: { customerId: customerId ?? undefined, shipmentId: shipment.id },
        });
      }
    }

    publish({
      type: "shipment.updated",
      entityId: shipment.id,
      deliveryStatus: updated.deliveryStatus,
      related: { customerId: customerId ?? undefined, orderId: orderId ?? undefined, shipmentId: shipment.id },
    });

    if (mutation.issueKind) {
      publish({
        type: "logistics.issue",
        entityId: shipment.id,
        issue: mutation.issueKind,
        related: { customerId: customerId ?? undefined, orderId: orderId ?? undefined, shipmentId: shipment.id },
      });
    }
  } else if (!shipment) {
    // No matching shipment — we still keep the raw event and emit a soft issue
    // so a supervisor can investigate.
    logger.warn({ externalId: ev.externalId, type: ev.type }, "Logistics event without resolvable shipment");
  }

  await prisma.logisticsEvent.update({
    where: { id: created.id },
    data: { processed: true, processedAt: new Date() },
  });

  return { eventId: created.id, alreadyProcessed: false };
}
