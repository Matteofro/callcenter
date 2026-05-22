/**
 * GET /api/reports/:entity?from=&to=
 *
 * Streams a CSV download for one of: orders, calls, upsells, shipments.
 * Role gate: SUPERVISOR or ADMIN.
 *
 * Performance: we use Prisma cursor pagination to read the table in chunks
 * of 500 rows and pipe each row directly into the ReadableStream — peak
 * memory stays bounded regardless of result size.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { handle, errors } from "@/lib/http";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import {
  callStatusLabel,
  orderStatusLabel,
  paymentMethodLabel,
  paymentStatusLabel,
  shipmentStatusLabel,
  upsellKindLabel,
  upsellOutcomeLabel,
} from "@/lib/i18n/labels";
import { attachmentHeader, paginate, streamCsv } from "@/server/csv";
import { reportRangeSchema } from "@/lib/validation/reports";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const entitySchema = z.enum(["orders", "calls", "upsells", "shipments"]);

const PAGE_SIZE = 500;

export async function GET(req: NextRequest, ctx: { params: Promise<{ entity: string }> }) {
  // We need to control the response shape (CSV stream), so we don't use
  // the standard ok()/err() helpers here. We still rely on handle() for
  // auth and validation error mapping by wrapping the validation part.
  try {
    const session = await requireRole(["SUPERVISOR", "ADMIN"]);
    const { entity: rawEntity } = await ctx.params;
    const entity = entitySchema.parse(rawEntity);
    const url = new URL(req.url);
    const { from, to } = reportRangeSchema.parse({
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
    });

    const fileTag = `${from.toISOString().slice(0, 10)}_${to.toISOString().slice(0, 10)}`;
    const filename = `${entity}_${fileTag}.csv`;

    await writeAudit({
      userId: session.user.id,
      action: "report.export",
      entityType: "Report",
      entityId: entity,
      metadata: { from: from.toISOString(), to: to.toISOString() },
    });

    const stream = buildStream(entity, from, to);

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": attachmentHeader(filename),
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (e) {
    // Reuse handle() to format errors as JSON
    return handle(async () => {
      throw e;
    })();
  }
}

function buildStream(entity: "orders" | "calls" | "upsells" | "shipments", from: Date, to: Date) {
  if (entity === "orders") return ordersStream(from, to);
  if (entity === "calls") return callsStream(from, to);
  if (entity === "upsells") return upsellsStream(from, to);
  if (entity === "shipments") return shipmentsStream(from, to);
  throw errors.badRequest("Unknown entity", "Entità non supportata.");
}

// ─── Orders ────────────────────────────────────────────────────────────
function ordersStream(from: Date, to: Date) {
  const headers = [
    "Order ID",
    "External ref",
    "Data creazione",
    "Cliente",
    "Telefono",
    "Email",
    "Stato",
    "Metodo pagamento",
    "Stato pagamento",
    "Totale EUR",
    "Contrassegno EUR",
    "Margine EUR",
    "Numero spedizioni",
    "Numero righe",
  ];
  const rows = paginate(
    PAGE_SIZE,
    (cursor) =>
      prisma.order.findMany({
        where: { createdAt: { gte: from, lte: to } },
        orderBy: { id: "asc" },
        take: PAGE_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        include: {
          customer: { select: { fullName: true, phoneE164: true, email: true } },
          _count: { select: { shipments: true, items: true } },
        },
      }),
    (o) => o.id,
  );
  return streamCsv(headers, rows, (o) => [
    o.id,
    o.externalRef,
    o.createdAt,
    o.customer.fullName,
    o.customer.phoneE164,
    o.customer.email ?? "",
    orderStatusLabel[o.status],
    paymentMethodLabel[o.paymentMethod],
    paymentStatusLabel[o.paymentStatus],
    (o.totalCents / 100).toFixed(2),
    (o.codAmountCents / 100).toFixed(2),
    (o.marginCents / 100).toFixed(2),
    o._count.shipments,
    o._count.items,
  ]);
}

// ─── Calls ─────────────────────────────────────────────────────────────
function callsStream(from: Date, to: Date) {
  const headers = [
    "Call ID",
    "Data inizio",
    "Data fine",
    "Operatore",
    "Cliente",
    "Telefono",
    "Ordine",
    "Esito",
    "Motivo",
    "Durata (s)",
    "Richiamare il",
  ];
  const rows = paginate(
    PAGE_SIZE,
    (cursor) =>
      prisma.call.findMany({
        where: { createdAt: { gte: from, lte: to } },
        orderBy: { id: "asc" },
        take: PAGE_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        include: {
          operator: { select: { fullName: true } },
          customer: { select: { fullName: true, phoneE164: true } },
          order: { select: { externalRef: true } },
        },
      }),
    (c) => c.id,
  );
  return streamCsv(headers, rows, (c) => [
    c.id,
    c.startedAt ?? c.createdAt,
    c.endedAt,
    c.operator.fullName,
    c.customer.fullName,
    c.customer.phoneE164,
    c.order?.externalRef ?? "",
    callStatusLabel[c.status],
    c.outcomeReason ?? "",
    c.durationSec ?? "",
    c.followUpAt,
  ]);
}

// ─── Upsells ───────────────────────────────────────────────────────────
function upsellsStream(from: Date, to: Date) {
  const headers = [
    "Upsell ID",
    "Data",
    "SKU consigliato",
    "Esito",
    "Extra EUR",
    "Ordine",
    "Chiamata",
    "Operatore",
    "Note",
  ];
  const rows = paginate(
    PAGE_SIZE,
    (cursor) =>
      prisma.upsellOutcome.findMany({
        where: { createdAt: { gte: from, lte: to } },
        orderBy: { id: "asc" },
        take: PAGE_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        include: {
          order: { select: { externalRef: true } },
          call: { select: { id: true, operator: { select: { fullName: true } } } },
        },
      }),
    (u) => u.id,
  );
  return streamCsv(headers, rows, (u) => [
    u.id,
    u.createdAt,
    u.suggestedSku,
    upsellOutcomeLabel[u.outcome],
    (u.extraValueCents / 100).toFixed(2),
    u.order.externalRef,
    u.call.id,
    u.call.operator.fullName,
    u.notes ?? "",
  ]);
}

// ─── Shipments ─────────────────────────────────────────────────────────
function shipmentsStream(from: Date, to: Date) {
  const headers = [
    "Shipment ID",
    "Tracking",
    "Corriere",
    "Stato",
    "Spedito il",
    "Consegnato il",
    "ETA",
    "Ritardo",
    "Rifiutato",
    "Smarrito",
    "Reso",
    "Ordine",
    "Cliente",
    "Ultimo stato corriere",
  ];
  const rows = paginate(
    PAGE_SIZE,
    (cursor) =>
      prisma.shipment.findMany({
        where: { createdAt: { gte: from, lte: to } },
        orderBy: { id: "asc" },
        take: PAGE_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        include: {
          order: { select: { externalRef: true, customer: { select: { fullName: true } } } },
        },
      }),
    (s) => s.id,
  );
  return streamCsv(headers, rows, (s) => [
    s.id,
    s.trackingNumber,
    s.carrier,
    shipmentStatusLabel[s.deliveryStatus],
    s.shippedAt,
    s.deliveredAt,
    s.etaAt,
    s.isDelayed,
    s.isRefused,
    s.isLost,
    s.isReturned,
    s.order.externalRef,
    s.order.customer.fullName,
    s.lastCarrierStatus ?? "",
  ]);
}

// Keep an unused import alive so TS doesn't strip the label maps when the
// per-entity functions are tree-shaken in some build configurations.
void upsellKindLabel;
