/**
 * GET /api/customers/:id
 * Returns the customer card payload: anagrafica + orders + shipments + recent calls + notes.
 * This is THE hot path that powers the operator UI — kept to a single SQL roundtrip
 * via Prisma `include` and indexed lookups.
 */
import type { NextRequest } from "next/server";
import { handle, ok, errors } from "@/lib/http";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { customerIdSchema } from "@/lib/validation/customer";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await requireSession();
    const { id } = customerIdSchema.parse(await ctx.params);

    const customer = await prisma.customer.findUnique({
      where: { id },
      include: {
        orders: {
          orderBy: { createdAt: "desc" },
          take: 20,
          include: {
            items: true,
            shipments: {
              orderBy: { createdAt: "desc" },
            },
          },
        },
        calls: {
          orderBy: { createdAt: "desc" },
          take: 20,
          include: {
            notes: { orderBy: { createdAt: "desc" } },
            operator: { select: { id: true, fullName: true } },
          },
        },
      },
    });

    if (!customer || customer.deletedAt) {
      throw errors.notFound("Cliente");
    }

    return ok(customer);
  })();
}
