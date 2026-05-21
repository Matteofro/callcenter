/**
 * POST /api/calls
 * Open a new call session for the current operator on a given customer (and optional order).
 */
import type { NextRequest } from "next/server";
import { handle, ok, errors } from "@/lib/http";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { publish } from "@/lib/pubsub";
import { createCallSchema } from "@/lib/validation/call";

export const dynamic = "force-dynamic";

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
