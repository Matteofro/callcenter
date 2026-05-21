/**
 * GET /api/upsell/suggestions?orderId=<uuid>
 *
 * Returns upsell suggestions matching any SKU present in the given order's items,
 * sorted by priority. Used by the call panel to surface "what to pitch next".
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { handle, ok, errors } from "@/lib/http";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const querySchema = z.object({ orderId: z.string().uuid() });

export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireSession();
    const url = new URL(req.url);
    const { orderId } = querySchema.parse({ orderId: url.searchParams.get("orderId") });

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!order) throw errors.notFound("Ordine");

    const skus = order.items.map((i) => i.sku);
    if (skus.length === 0) return ok({ suggestions: [] });

    const suggestions = await prisma.upsellSuggestion.findMany({
      where: { active: true, triggerSku: { in: skus } },
      orderBy: { priority: "desc" },
      take: 10,
    });

    return ok({ suggestions });
  })();
}
