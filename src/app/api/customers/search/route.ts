/**
 * GET /api/customers/search?q=<query>&limit=<n>
 *
 * Search a customer by phone (E.164-normalized), email, full name, or
 * external order ref. Returns lightweight rows for the operator's quick-lookup.
 */
import type { NextRequest } from "next/server";
import { handle, ok } from "@/lib/http";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { tryNormalizePhone } from "@/lib/phone";
import { customerSearchSchema } from "@/lib/validation/customer";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireSession();
    const url = new URL(req.url);
    const parsed = customerSearchSchema.parse({
      q: url.searchParams.get("q"),
      limit: url.searchParams.get("limit") ?? undefined,
    });

    const q = parsed.q;
    const phone = tryNormalizePhone(q);

    // First try a direct customer lookup by phone/email.
    const directWhere = {
      OR: [
        phone ? { phoneE164: phone.e164 } : undefined,
        { email: { equals: q, mode: "insensitive" as const } },
        { fullName: { contains: q, mode: "insensitive" as const } },
        { phoneRaw: { contains: q } },
      ].filter(Boolean) as object[],
      deletedAt: null,
    };

    const customers = await prisma.customer.findMany({
      where: directWhere,
      take: parsed.limit,
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        phoneE164: true,
        phoneRaw: true,
        email: true,
        fullName: true,
        status: true,
        riskScore: true,
        lifetimeValue: true,
      },
    });

    // Also try a customer-by-order-ref lookup (operator pastes an order id).
    if (customers.length === 0) {
      const order = await prisma.order.findUnique({
        where: { externalRef: q },
        select: { customer: true },
      });
      if (order?.customer) {
        customers.push({
          id: order.customer.id,
          phoneE164: order.customer.phoneE164,
          phoneRaw: order.customer.phoneRaw,
          email: order.customer.email,
          fullName: order.customer.fullName,
          status: order.customer.status,
          riskScore: order.customer.riskScore,
          lifetimeValue: order.customer.lifetimeValue,
        });
      }
    }

    return ok({ results: customers, query: parsed.q });
  })();
}
