/**
 * GET /api/orders/:id
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { handle, ok, errors } from "@/lib/http";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

const idSchema = z.object({ id: z.string().uuid() });

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await requireSession();
    const { id } = idSchema.parse(await ctx.params);

    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        customer: true,
        items: true,
        shipments: { orderBy: { createdAt: "desc" } },
        calls: {
          orderBy: { createdAt: "desc" },
          include: { notes: true, operator: { select: { id: true, fullName: true } } },
          take: 10,
        },
        upsells: true,
      },
    });

    if (!order) throw errors.notFound("Ordine");
    return ok(order);
  })();
}
