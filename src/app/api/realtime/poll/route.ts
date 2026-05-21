/**
 * GET /api/realtime/poll?since=<iso-or-epoch-ms>
 *
 * Polling fallback for clients whose SSE connection has dropped. Returns the
 * tail of recent audit + logistics events newer than `since`, transformed
 * into the same RealtimeEvent envelope the SSE channel emits.
 *
 * Recommended client cadence: every 20s while SSE is down. The client should
 * remember `latestServerTimestamp` from the response and use it as `since`
 * on the next call.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { handle, ok } from "@/lib/http";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import type { RealtimeEvent } from "@/types/realtime";

const sinceSchema = z.object({
  since: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => {
      if (v === undefined) return new Date(Date.now() - 60_000);
      const n = typeof v === "string" ? (Number.isFinite(Number(v)) ? Number(v) : Date.parse(v)) : v;
      return Number.isFinite(n) ? new Date(n) : new Date(Date.now() - 60_000);
    }),
});

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireSession();
    const url = new URL(req.url);
    const { since } = sinceSchema.parse({ since: url.searchParams.get("since") ?? undefined });

    const audits = await prisma.auditLog.findMany({
      where: { createdAt: { gt: since } },
      orderBy: { createdAt: "asc" },
      take: 500,
    });

    const events: RealtimeEvent[] = audits.map((a) => {
      const id = a.id;
      const publishedAt = a.createdAt.toISOString();
      switch (a.entityType) {
        case "Shipment":
          return {
            id,
            type: "shipment.updated",
            publishedAt,
            entityId: a.entityId,
          } satisfies RealtimeEvent;
        case "Order":
          return {
            id,
            type: "order.updated",
            publishedAt,
            entityId: a.entityId,
          } satisfies RealtimeEvent;
        case "Call":
          return {
            id,
            type: "call.updated",
            publishedAt,
            entityId: a.entityId,
          } satisfies RealtimeEvent;
        case "UpsellOutcome":
          return {
            id,
            type: "upsell.created",
            publishedAt,
            entityId: a.entityId,
          } satisfies RealtimeEvent;
        default:
          return {
            id,
            type: "customer.updated",
            publishedAt,
            entityId: a.entityId,
          } satisfies RealtimeEvent;
      }
    });

    return ok({
      events,
      latestServerTimestamp: new Date().toISOString(),
    });
  })();
}
