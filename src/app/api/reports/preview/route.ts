/**
 * GET /api/reports/preview?entity=orders|calls|upsells|shipments&from=&to=
 *
 * Lightweight "how many rows will I get" probe. Used by the /reports page
 * to show a row-count before triggering the export download.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { handle, ok } from "@/lib/http";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { reportRangeSchema } from "@/lib/validation/reports";

export const dynamic = "force-dynamic";

const entitySchema = z.enum(["orders", "calls", "upsells", "shipments"]);

export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireRole(["SUPERVISOR", "ADMIN"]);
    const url = new URL(req.url);
    const entity = entitySchema.parse(url.searchParams.get("entity") ?? "orders");
    const { from, to } = reportRangeSchema.parse({
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
    });

    let count = 0;
    if (entity === "orders") {
      count = await prisma.order.count({ where: { createdAt: { gte: from, lte: to } } });
    } else if (entity === "calls") {
      count = await prisma.call.count({ where: { createdAt: { gte: from, lte: to } } });
    } else if (entity === "upsells") {
      count = await prisma.upsellOutcome.count({ where: { createdAt: { gte: from, lte: to } } });
    } else {
      count = await prisma.shipment.count({ where: { createdAt: { gte: from, lte: to } } });
    }

    return ok({ count, entity, from: from.toISOString(), to: to.toISOString() });
  })();
}
