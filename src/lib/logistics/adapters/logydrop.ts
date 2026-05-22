/**
 * Logydrop adapter — poll + reconcile.
 *
 * Polling strategy (documented in docs/LOGYDROP_INTEGRATION.md):
 *   - Logydrop's GET /orders returns ONLY the active queue (~15 records),
 *     ignores every filter/cursor, has no webhook system.
 *   - We poll every 2 minutes (Vercel Cron), diff with our DB, and emit
 *     LogisticsEvent rows for each delta — the same eventing surface the
 *     generic webhook adapter uses, so the rest of the system is unaware
 *     this is poll-driven.
 *
 * Order matching: Order.externalRef ↔ Logydrop order `id` (hex string).
 * Customer matching: phoneE164 normalized from shippingAddress.phone.
 * Shipment matching: trackingNumber = shippingExternalId (created lazily when
 * the tracking is actually assigned by Logydrop — until then we skip the shipment).
 */
import type { Prisma, OrderStatus, ShipmentDeliveryStatus, LogisticsEventType, PaymentStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { publish } from "@/lib/pubsub";
import { logger, maskPhone } from "@/lib/logger";
import { tryNormalizePhone } from "@/lib/phone";
import { logydropGet } from "@/lib/logistics/logydrop-auth";

// ─── Logydrop response shapes (subset we depend on) ───────────────────────
// See docs/LOGYDROP_INTEGRATION.md for the full schema dump.

export interface LogydropAddress {
  id?: number;
  nominative: string;
  address1: string;
  address2: string | null;
  phone: string;
  city: string;
  zip: string;
  province: string;
  country: string;
  isValid: boolean;
}

export interface LogydropLineItem {
  id: number;
  name: string;
  soldName: string;
  quantity: number;
  soldPrice: number;
  price: number;
  discount: number;
  vatPrice: number;
  sku: string;
  weight: number;
  productId: number | null;
}

export interface LogydropAmounts {
  subTotal: number;
  soldTotal: number;
  discountTotal: number;
  servicesTotal: number;
  codTotal: number;
  vatTotal: number;
  total: number;
  profit: number;
}

export interface LogydropOrder {
  id: string;
  seq: number;
  externalVendorId: string;
  externalVendorName: string;
  customerEmail: string | null;
  shopId: number;
  userId: number;
  isCashOnDelivery: boolean;
  isCalled: boolean;
  isPaid: boolean;
  shippingConnectorSlug: string | null;
  shippingExternalId: string | null;
  shippingExternalStatusCode: string | null;
  shippingExternalStatusDescription: string | null;
  shippingExternalError: string | null;
  whatsappConfirmationMessageId: string | null;
  whatsappInDeliveryMessageId: string | null;
  discount: number;
  status: string;
  createdAt: string;
  updatedAt: string;
  services?: Array<{ id: number; name: string; quantity: number; price: number; vatPrice: number }>;
  lineItems: LogydropLineItem[];
  shippingAddress: LogydropAddress;
  amounts: LogydropAmounts;
}

interface OrdersListResponse {
  data: LogydropOrder[];
}

// ─── Status mapping ───────────────────────────────────────────────────────
// Verified values: PENDING, TOPAY, PROCESSING, CONFIRMED.
// Other names guessed from the CSV export and Logydrop UI strings.
const ORDER_STATUS_MAP: Record<string, OrderStatus> = {
  PENDING: "CREATED",
  TOAUTHORIZE: "CREATED",
  TOPAY: "ON_HOLD",
  PROCESSING: "PROCESSING",
  CONFIRMED: "CONFIRMED",
  SHIPPED: "SHIPPED",
  INTRANSIT: "IN_TRANSIT",
  IN_TRANSIT: "IN_TRANSIT",
  OUTFORDELIVERY: "OUT_FOR_DELIVERY",
  DELIVERED: "DELIVERED",
  RETURNED: "RETURNED",
  CANCELLED: "CANCELLED",
  CANCELED: "CANCELLED",
  HOLD: "ON_HOLD",
};

function mapOrderStatus(s: string): OrderStatus {
  return ORDER_STATUS_MAP[s?.toUpperCase()] ?? "CREATED";
}

// Derive shipment delivery status from carrier code/description + flags. Logydrop
// gives us strings, not enums, so we keep this best-effort and lean on flags.
function deriveShipmentStatus(o: LogydropOrder): {
  status: ShipmentDeliveryStatus;
  eventType: LogisticsEventType;
  isDelayed: boolean;
  isRefused: boolean;
  isLost: boolean;
  isReturned: boolean;
} {
  const desc = (o.shippingExternalStatusDescription ?? "").toLowerCase();
  const code = (o.shippingExternalStatusCode ?? "").toLowerCase();
  const text = `${code} ${desc}`;
  if (text.includes("conseg")) return { status: "DELIVERED", eventType: "SHIPMENT_DELIVERED", isDelayed: false, isRefused: false, isLost: false, isReturned: false };
  if (text.includes("rifiut")) return { status: "REFUSED", eventType: "SHIPMENT_REFUSED", isDelayed: false, isRefused: true, isLost: false, isReturned: false };
  if (text.includes("smarr")) return { status: "LOST", eventType: "SHIPMENT_LOST", isDelayed: false, isRefused: false, isLost: true, isReturned: false };
  if (text.includes("reinviato") || text.includes("reso")) return { status: "RETURNED", eventType: "SHIPMENT_RETURNED", isDelayed: false, isRefused: false, isLost: false, isReturned: true };
  if (text.includes("ritard") || text.includes("giacenza")) return { status: "DELAYED", eventType: "SHIPMENT_DELAYED", isDelayed: true, isRefused: false, isLost: false, isReturned: false };
  if (text.includes("consegna")) return { status: "OUT_FOR_DELIVERY", eventType: "SHIPMENT_OUT_FOR_DELIVERY", isDelayed: false, isRefused: false, isLost: false, isReturned: false };
  if (text.includes("transito")) return { status: "IN_TRANSIT", eventType: "SHIPMENT_IN_TRANSIT", isDelayed: false, isRefused: false, isLost: false, isReturned: false };
  return { status: "PENDING", eventType: "SHIPMENT_CREATED", isDelayed: false, isRefused: false, isLost: false, isReturned: false };
}

// ─── Public entry points ──────────────────────────────────────────────────

export interface PollSummary {
  fetched: number;
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  errors: Array<{ orderId: string; reason: string }>;
  durationMs: number;
  startedAt: string;
}

export async function pollLogydrop(): Promise<PollSummary> {
  const start = Date.now();
  const summary: PollSummary = {
    fetched: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    errors: [],
    durationMs: 0,
    startedAt: new Date(start).toISOString(),
  };

  let payload: OrdersListResponse;
  try {
    payload = await logydropGet<OrdersListResponse>("/orders");
  } catch (e) {
    logger.error({ err: String(e) }, "Logydrop poll: fetch failed");
    summary.errors.push({ orderId: "(fetch)", reason: String(e) });
    summary.durationMs = Date.now() - start;
    return summary;
  }

  summary.fetched = payload.data?.length ?? 0;

  for (const o of payload.data ?? []) {
    try {
      const result = await reconcileOrder(o);
      summary[result] += 1;
    } catch (e) {
      logger.error({ orderId: o.id, err: String(e) }, "Logydrop reconcile failed");
      summary.errors.push({ orderId: o.id, reason: String(e) });
    }
  }

  summary.durationMs = Date.now() - start;
  logger.info({ ...summary }, "Logydrop poll complete");
  return summary;
}

type ReconcileOutcome = "created" | "updated" | "unchanged" | "skipped";

async function reconcileOrder(ld: LogydropOrder): Promise<ReconcileOutcome> {
  // 1) Phone normalization — required for Customer.phoneE164 unique index.
  const phone = tryNormalizePhone(ld.shippingAddress?.phone ?? "", "IT");
  if (!phone) {
    logger.warn({ orderId: ld.id, phoneRaw: ld.shippingAddress?.phone }, "Skipping: invalid phone");
    return "skipped";
  }

  // 2) Customer upsert by phoneE164.
  const customer = await prisma.customer.upsert({
    where: { phoneE164: phone.e164 },
    create: {
      phoneE164: phone.e164,
      phoneRaw: phone.raw,
      email: ld.customerEmail ?? null,
      fullName: ld.shippingAddress.nominative,
      country: ld.shippingAddress.country || "IT",
      status: "ACTIVE",
      address: ld.shippingAddress as unknown as Prisma.InputJsonValue,
    },
    update: {
      // Email & address may have been updated on Logydrop side
      email: ld.customerEmail ?? undefined,
      fullName: ld.shippingAddress.nominative,
      address: ld.shippingAddress as unknown as Prisma.InputJsonValue,
    },
  });

  // 3) Order upsert by externalRef.
  const desiredStatus = mapOrderStatus(ld.status);
  const desiredPaymentStatus: PaymentStatus = ld.isPaid ? "PAID" : "PENDING";
  const existing = await prisma.order.findUnique({
    where: { externalRef: ld.id },
    include: { items: true },
  });

  const itemsData = ld.lineItems.map((li) => ({
    sku: li.sku,
    name: li.soldName || li.name,
    quantity: li.quantity,
    unitPriceCents: li.soldPrice,
    totalCents: li.soldPrice * li.quantity,
    category: null as string | null,
  }));

  let order;
  let outcome: ReconcileOutcome;
  if (!existing) {
    order = await prisma.order.create({
      data: {
        externalRef: ld.id,
        customerId: customer.id,
        totalCents: ld.amounts.total,
        codAmountCents: ld.amounts.codTotal,
        marginCents: ld.amounts.profit,
        paymentMethod: ld.isCashOnDelivery ? "COD" : "OTHER",
        paymentStatus: desiredPaymentStatus,
        status: desiredStatus,
        shippingMethod: ld.shippingConnectorSlug,
        notes: ld.shippingExternalError ? `ERR: ${ld.shippingExternalError}` : null,
        createdAt: new Date(ld.createdAt),
        items: { create: itemsData },
      },
    });
    await writeAudit({
      action: "order.create",
      entityType: "Order",
      entityId: order.id,
      newValue: { externalRef: ld.id, status: desiredStatus, totalCents: ld.amounts.total },
      source: "WEBHOOK",
      metadata: { provider: "logydrop", logydropSeq: ld.seq, customerPhone: maskPhone(phone.e164) },
    });
    publish({
      type: "order.updated",
      entityId: order.id,
      related: { customerId: customer.id },
    });
    outcome = "created";
  } else {
    const changed =
      existing.status !== desiredStatus ||
      existing.paymentStatus !== desiredPaymentStatus ||
      existing.totalCents !== ld.amounts.total ||
      existing.codAmountCents !== ld.amounts.codTotal ||
      existing.marginCents !== ld.amounts.profit ||
      existing.shippingMethod !== ld.shippingConnectorSlug;

    if (!changed) {
      order = existing;
      outcome = "unchanged";
    } else {
      const before = {
        status: existing.status,
        paymentStatus: existing.paymentStatus,
        totalCents: existing.totalCents,
        codAmountCents: existing.codAmountCents,
        marginCents: existing.marginCents,
        shippingMethod: existing.shippingMethod,
      };
      order = await prisma.order.update({
        where: { id: existing.id },
        data: {
          totalCents: ld.amounts.total,
          codAmountCents: ld.amounts.codTotal,
          marginCents: ld.amounts.profit,
          paymentStatus: desiredPaymentStatus,
          status: desiredStatus,
          shippingMethod: ld.shippingConnectorSlug,
          notes: ld.shippingExternalError ? `ERR: ${ld.shippingExternalError}` : existing.notes,
        },
      });
      await writeAudit({
        action: "order.update",
        entityType: "Order",
        entityId: order.id,
        oldValue: before,
        newValue: {
          status: order.status,
          paymentStatus: order.paymentStatus,
          totalCents: order.totalCents,
          codAmountCents: order.codAmountCents,
          marginCents: order.marginCents,
          shippingMethod: order.shippingMethod,
        },
        source: "WEBHOOK",
        metadata: { provider: "logydrop", logydropSeq: ld.seq },
      });
      publish({ type: "order.updated", entityId: order.id, related: { customerId: customer.id } });
      outcome = "updated";
    }
  }

  // 4) Shipment reconciliation — only when Logydrop has actually assigned a tracking number.
  if (ld.shippingExternalId && ld.shippingConnectorSlug) {
    await reconcileShipment(order.id, customer.id, ld);
  }

  // 5) Always persist a LogisticsEvent for traceability. Use logydropSeq + updatedAt
  //    as the externalId so retries on the same state are idempotent.
  await prisma.logisticsEvent.upsert({
    where: { externalId: `logydrop:${ld.id}:${ld.updatedAt}` },
    create: {
      externalId: `logydrop:${ld.id}:${ld.updatedAt}`,
      type: "ORDER_UPDATED",
      provider: "logydrop",
      payload: ld as unknown as Prisma.InputJsonValue,
      orderId: order.id,
      customerId: customer.id,
      occurredAt: new Date(ld.updatedAt),
      processed: true,
      processedAt: new Date(),
    },
    update: {}, // idempotent: nothing to change on duplicate
  });

  return outcome;
}

async function reconcileShipment(orderId: string, customerId: string, ld: LogydropOrder): Promise<void> {
  if (!ld.shippingExternalId || !ld.shippingConnectorSlug) return;

  const derived = deriveShipmentStatus(ld);
  const existing = await prisma.shipment.findUnique({
    where: { trackingNumber: ld.shippingExternalId },
  });

  if (!existing) {
    const created = await prisma.shipment.create({
      data: {
        orderId,
        trackingNumber: ld.shippingExternalId,
        carrier: ld.shippingConnectorSlug,
        deliveryStatus: derived.status,
        isDelayed: derived.isDelayed,
        isRefused: derived.isRefused,
        isLost: derived.isLost,
        isReturned: derived.isReturned,
        lastCarrierStatus: ld.shippingExternalStatusDescription,
        lastEventAt: new Date(ld.updatedAt),
      },
    });
    await writeAudit({
      action: "shipment.create",
      entityType: "Shipment",
      entityId: created.id,
      newValue: {
        trackingNumber: created.trackingNumber,
        carrier: created.carrier,
        deliveryStatus: created.deliveryStatus,
      },
      source: "WEBHOOK",
      metadata: { provider: "logydrop" },
    });
    publish({
      type: "shipment.updated",
      entityId: created.id,
      deliveryStatus: created.deliveryStatus,
      related: { customerId, orderId, shipmentId: created.id },
    });
    return;
  }

  const changed =
    existing.deliveryStatus !== derived.status ||
    existing.isDelayed !== derived.isDelayed ||
    existing.isRefused !== derived.isRefused ||
    existing.isLost !== derived.isLost ||
    existing.isReturned !== derived.isReturned ||
    (ld.shippingExternalStatusDescription ?? null) !== existing.lastCarrierStatus;

  if (!changed) return;

  const before = {
    deliveryStatus: existing.deliveryStatus,
    isDelayed: existing.isDelayed,
    isRefused: existing.isRefused,
    isLost: existing.isLost,
    isReturned: existing.isReturned,
    lastCarrierStatus: existing.lastCarrierStatus,
  };
  const updated = await prisma.shipment.update({
    where: { id: existing.id },
    data: {
      deliveryStatus: derived.status,
      isDelayed: derived.isDelayed,
      isRefused: derived.isRefused,
      isLost: derived.isLost,
      isReturned: derived.isReturned,
      lastCarrierStatus: ld.shippingExternalStatusDescription,
      lastEventAt: new Date(ld.updatedAt),
      deliveredAt: derived.status === "DELIVERED" ? new Date(ld.updatedAt) : existing.deliveredAt,
    },
  });
  await writeAudit({
    action: `shipment.${derived.eventType.toLowerCase()}`,
    entityType: "Shipment",
    entityId: updated.id,
    oldValue: before,
    newValue: {
      deliveryStatus: updated.deliveryStatus,
      isDelayed: updated.isDelayed,
      isRefused: updated.isRefused,
      isLost: updated.isLost,
      isReturned: updated.isReturned,
      lastCarrierStatus: updated.lastCarrierStatus,
    },
    source: "WEBHOOK",
    metadata: { provider: "logydrop" },
  });
  publish({
    type: "shipment.updated",
    entityId: updated.id,
    deliveryStatus: updated.deliveryStatus,
    related: { customerId, orderId, shipmentId: updated.id },
  });

  if (derived.isDelayed || derived.isRefused || derived.isLost || derived.isReturned) {
    publish({
      type: "logistics.issue",
      entityId: updated.id,
      issue: derived.isDelayed ? "delayed" : derived.isRefused ? "refused" : derived.isLost ? "lost" : "returned",
      related: { customerId, orderId, shipmentId: updated.id },
    });
  }
}
