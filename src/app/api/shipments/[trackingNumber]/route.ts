/**
 * GET /api/shipments/:trackingNumber
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { handle, ok, errors } from "@/lib/http";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

const paramsSchema = z.object({ trackingNumber: z.string().min(1).max(128) });

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ trackingNumber: string }> }) {
  return handle(async () => {
    await requireSession();
    const { trackingNumber } = paramsSchema.parse(await ctx.params);

    const shipment = await prisma.shipment.findUnique({
      where: { trackingNumber },
      include: {
        order: { include: { customer: true } },
        events: { orderBy: { occurredAt: "desc" }, take: 50 },
      },
    });

    if (!shipment) throw errors.notFound("Spedizione");
    return ok(shipment);
  })();
}
