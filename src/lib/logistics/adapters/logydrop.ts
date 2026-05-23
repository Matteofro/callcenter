/**
 * Logydrop adapter — poll + reconcile.
 *
 * Polling strategy (confirmed via live API inspection):
 *   - Logydrop exposes GET /orders at api.logydrop.com — cookie-JWT auth,
 *     no webhook system, no API keys.
 *   - Supports: perPage up to 100, page cursor, where[updatedAt][gte] filter.
 *   - We poll every 2 minutes (Vercel Cron) using INCREMENTAL delta:
 *       GET /orders?perPage=100&page=N&where[updatedAt][gte]=<lastPollAt>
 *     We loop pages until we get an empty page, then persist `lastPollAt`.
 *   - First run (no lastPollAt): fetches orders updated in the last 7 days.
 *   - Each delta is reconciled against our DB and emits LogisticsEvent rows —
 *     same eventing surface as the generic webhook adapter.
 *
 * Confirmed order statuses (from live data 2026-05-22):
 *   PENDING, TOPAY, CONFIRMED, PROCESSING, WAITING_FOR_WITHDRAW,
 *   ACCREDITED, DELIVERED, CANCELED, RETURNED_TO_SENDER
 *
 * Order matching: Order.externalRef ↔ Logydrop order `id` (hex string).
 * Customer matching: phoneE164 normalized from shippingAddress.phone.
 * Shipment matching: trackingNumber = shippingExternalId (created lazily when
 * the tracking is actually assigned by Logydrop — until then we skip).
 */
import type { Prisma, OrderStatus, ShipmentDeliveryStatus, LogisticsEventType, PaymentStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { publish } from "@/lib/pubsub";
import { logger, maskPhone } from "@/lib/logger";
import { tryNormalizePhone } from "@/lib/phone";
import { logydropGet, PROVIDER as AUTH_PROVIDER } from "@/lib/logistics/logydrop-auth";

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
// Confirmed live values (2026-05-22): PENDING, TOPAY, CONFIRMED, PROCESSING,
// WAITING_FOR_WITHDRAW, ACCREDITED, DELIVERED, CANCELED, RETURNED_TO_SENDER
const ORDER_STATUS_MAP: Record<string, OrderStatus> = {
  // Active / pre-shipment
  PENDING: "CREATED",             // received, not yet processed
  TOPAY: "ON_HOLD",               // Anticipato — waiting for upfront payment
  CONFIRMED: "CONFIRMED",         // confirmed by call center (COD)
  PROCESSING: "PROCESSING",       // being packed / label generated
  WAITING_FOR_WITHDRAW: "SHIPPED", // handed to carrier, awaiting pickup scan
  // Post-delivery
  ACCREDITED: "DELIVERED",        // COD collected, payment settled
  DELIVERED: "DELIVERED",         // physically delivered
  // Cancelled / returned
  CANCELED: "CANCELLED",
  RETURNED_TO_SENDER: "RETURNED",
  // Legacy / fallback (keep for CSV import compatibility)
  TOAUTHORIZE: "CREATED",
  CANCELLED: "CANCELLED",
  RETURNED: "RETURNED",
  SHIPPED: "SHIPPED",
  IN_TRANSIT: "IN_TRANSIT",
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

const PER_PAGE = 100;
// Default lookback for first run (no lastPollAt stored yet)
// On first run we look back 24h only. The first cron tick scans this window;
// subsequent ticks use the actual lastPollAt and are quick (delta only).
// For older history, run scripts/import-logydrop-csv.ts manually.
const FIRST_RUN_LOOKBACK_MS = 24 * 60 * 60_000;

/**
 * Read lastPollAt from SystemToken.metadata (persisted by previous runs).
 * Falls back to 7-day lookback on first run.
 */
async function getLastPollAt(): Promise<Date> {
  try {
    const row = await prisma.systemToken.findUnique({ where: { provider: AUTH_PROVIDER } });
    const meta = row?.metadata as Record<string, unknown> | null;
    if (meta?.lastPollAt && typeof meta.lastPollAt === "string") {
      return new Date(meta.lastPollAt);
    }
  } catch { /* DB not ready yet — fall through */ }
  return new Date(Date.now() - FIRST_RUN_LOOKBACK_MS);
}

/** Persist lastPollAt into the SystemToken metadata, merging with existing fields. */
async function saveLastPollAt(ts: Date): Promise<void> {
  try {
    const row = await prisma.systemToken.findUnique({ where: { provider: AUTH_PROVIDER } });
    if (!row) return; // no token row yet — will be created on next sign-in
    const existingMeta = (row.metadata as Record<string, unknown>) ?? {};
    await prisma.systemToken.update({
      where: { provider: AUTH_PROVIDER },
      data: {
        metadata: { ...existingMeta, lastPollAt: ts.toISOString() } as Prisma.InputJsonValue,
      },
    });
  } catch (e) {
    logger.warn({ err: String(e) }, "Could not persist lastPollAt");
  }
}

export async function pollLogydrop(): Promise<PollSummary> {
  const start = Date.now();
  const pollStart = new Date(start);
  const summary: PollSummary = {
    fetched: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    errors: [],
    durationMs: 0,
    startedAt: pollStart.toISOString(),
  };

  const since = await getLastPollAt();
  const sinceIso = since.toISOString();
  logger.info({ since: sinceIso }, "Logydrop poll: incremental delta fetch");

  // Paginate until we get an empty page
  let page = 1;
  let fetchError = false;
  while (true) {
    let payload: OrdersListResponse;
    try {
      payload = await logydropGet<OrdersListResponse>(
        `/orders?page=${page}&perPage=${PER_PAGE}&where[updatedAt][gte]=${encodeURIComponent(sinceIso)}`
      );
    } catch (e) {
      logger.error({ err: String(e), page }, "Logydrop poll: fetch failed");
      summary.errors.push({ orderId: `(fetch page ${page})`, reason: String(e) });
      fetchError = true;
      break;
    }

    const orders = payload.data ?? [];
    if (orders.length === 0) break;

    summary.fetched += orders.length;
    logger.debug({ page, count: orders.length }, "Logydrop poll: page fetched");

    for (const o of orders) {
      try {
        const result = await reconcileOrder(o);
        summary[result] += 1;
      } catch (e) {
        logger.error({ orderId: o.id, err: String(e) }, "Logydrop reconcile failed");
        summary.errors.push({ orderId: o.id, reason: String(e) });
      }
    }

    // If less than a full page, there are no more pages
    if (orders.length < PER_PAGE) break;
    page++;
  }

  // Persist the poll timestamp only if the fetch didn't fail at page 1
  if (!fetchError) {
    await saveLastPollAt(pollStart);
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

  // 6) Call queue task — preventive, only for orders we can still influence.
  await reconcileCallTask(order.id, customer.id, order.status, order.paymentMethod);

  return outcome;
}

/** "Active" call statuses — a TO_CALL stays open until the operator works it. */
const ACTIVE_CALL_STATUSES = [
  "TO_CALL",
  "NO_ANSWER",
  "BUSY",
  "CALL_LATER",
  "CALLBACK_SCHEDULED",
] as const;

/**
 * Maintains the "Coda chiamate" automatically based on order state.
 *
 * - Order in CREATED+COD  → ensure a TO_CALL exists (confirm before shipping)
 * - Order in ON_HOLD+OTHER → ensure a TO_CALL exists (payment reminder)
 * - Order in any closed/shipped/transit state → close any open TO_CALL
 *   (because there is nothing preventive left to do; refused/lost cases
 *   are surfaced via the "Problemi spedizione" section instead).
 *
 * Idempotent: safe to run on every reconcile.
 */
async function reconcileCallTask(
  orderId: string,
  customerId: string,
  status: OrderStatus,
  paymentMethod: string,
): Promise<void> {
  const needsCall =
    (status === "CREATED" && paymentMethod === "COD") ||
    (status === "ON_HOLD" && paymentMethod !== "COD");

  const existing = await prisma.call.findFirst({
    where: {
      orderId,
      status: { in: [...ACTIVE_CALL_STATUSES] },
    },
    select: { id: true, status: true },
  });

  if (needsCall && !existing) {
    // Pick the admin as default operator. Production should round-robin
    // across ACTIVE operators; that's a future improvement.
    const operator = await prisma.user.findFirst({
      where: { status: "ACTIVE", deletedAt: null, role: { in: ["ADMIN", "OPERATOR", "SUPERVISOR"] } },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (!operator) return; // no one to assign to yet
    await prisma.call.create({
      data: {
        customerId,
        orderId,
        operatorId: operator.id,
        status: "TO_CALL",
      },
    });
    publish({ type: "call.updated", entityId: orderId, related: { customerId, orderId }, status: "TO_CALL" });
  } else if (!needsCall && existing && existing.status === "TO_CALL") {
    // Order moved out of "needs call" state without an operator working it —
    // auto-close so the queue stays accurate.
    await prisma.call.update({
      where: { id: existing.id },
      data: { status: "CASE_RESOLVED", endedAt: new Date(), outcomeReason: "auto_closed_by_status_change" },
    });
  }
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
