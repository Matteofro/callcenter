/**
 * GET  /api/calls?view=queue|today|mine&limit=
 *   View the call queue. Defaults to "queue" (TO_CALL + CALLBACK_SCHEDULED with
 *   followUpAt in the past or null).
 *
 * POST /api/calls
 *   Open a new call session for the current operator.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { handle, ok, errors } from "@/lib/http";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { publish } from "@/lib/pubsub";
import { createCallSchema } from "@/lib/validation/call";

export const dynamic = "force-dynamic";

const listQuerySchema = z.object({
  view: z.enum(["queue", "today", "mine"]).default("queue"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export async function GET(req: NextRequest) {
  return handle(async () => {
    const session = await requireSession();
    const url = new URL(req.url);
    const { view, limit } = listQuerySchema.parse({
      view: url.searchParams.get("view") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });

    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);

    const where =
      view === "mine"
        ? { operatorId: session.user.id }
        : view === "today"
        ? { createdAt: { gte: startOfDay } }
        : {
            OR: [
              { status: "TO_CALL" as const },
              {
                status: "CALLBACK_SCHEDULED" as const,
                OR: [{ followUpAt: null }, { followUpAt: { lte: now } }],
              },
              { status: "NO_ANSWER" as const },
              { status: "BUSY" as const },
              { status: "CALL_LATER" as const },
            ],
          };

    const calls = await prisma.call.findMany({
      where,
      orderBy: [
        { followUpAt: { sort: "asc", nulls: "last" } },
        { createdAt: "desc" },
      ],
      take: limit,
      include: {
        customer: {
          select: {
            id: true,
            fullName: true,
            phoneE164: true,
            phoneRaw: true,
            status: true,
            riskScore: true,
          },
        },
        order: {
          select: { id: true, externalRef: true, totalCents: true, status: true },
        },
        operator: { select: { id: true, fullName: true } },
      },
    });

    return ok({ calls, view });
  })();
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const session = await requireSession();
    const body = createCallSchema.parse(await req.json());

    const customer = await prisma.customer.findUnique({ where: { id: body.customerId } });
    if (!customer || customer.deletedAt) throw errors.notFound("Cliente");

    if (body.orderId) {
      const order = await prisma.order.findUnique({ where: { id: body.orderId } });
      if (!order) throw errors.notFound("Ordine");
      if (order.customerId !== customer.id) {
        throw errors.badRequest(
          "Order does not belong to customer",
          "L'ordine selezionato non appartiene a questo cliente.",
        );
      }
    }

    const call = await prisma.call.create({
      data: {
        customerId: body.customerId,
        orderId: body.orderId ?? null,
        operatorId: session.user.id,
        status: body.status ?? "TO_CALL",
        startedAt: new Date(),
      },
    });

    await writeAudit({
      userId: session.user.id,
      action: "call.create",
      entityType: "Call",
      entityId: call.id,
      newValue: { status: call.status, customerId: call.customerId, orderId: call.orderId },
    });

    publish({
      type: "call.updated",
      entityId: call.id,
      status: call.status,
      related: { customerId: call.customerId, orderId: call.orderId ?? undefined },
    });

    return ok(call, { status: 201 });
  })();
}
