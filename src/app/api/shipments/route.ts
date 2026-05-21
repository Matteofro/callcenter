/**
 * GET /api/shipments?issues=true&limit=
 *
 * Returns shipments flagged with an open issue (delayed/refused/lost/returned)
 * that are not in a terminal good state. Used by the dashboard "open logistics
 * issues" widget.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { handle, ok } from "@/lib/http";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  issues: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireSession();
    const url = new URL(req.url);
    const { issues, limit } = querySchema.parse({
      issues: url.searchParams.get("issues") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });

    const where = issues
      ? {
          OR: [{ isDelayed: true }, { isRefused: true }, { isLost: true }, { isReturned: true }],
          deliveryStatus: { notIn: ["DELIVERED" as const, "RETURNED" as const] },
        }
      : {};

    const shipments = await prisma.shipment.findMany({
      where,
      orderBy: { lastEventAt: { sort: "desc", nulls: "last" } },
      take: limit,
      include: {
        order: {
          select: {
            id: true,
            externalRef: true,
            totalCents: true,
            customer: { select: { id: true, fullName: true, phoneE164: true, phoneRaw: true } },
          },
        },
      },
    });

    return ok({ shipments });
  })();
}
