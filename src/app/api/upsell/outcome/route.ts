/**
 * POST /api/upsell/outcome
 * Record the result of an upsell attempt during a call.
 */
import type { NextRequest } from "next/server";
import { handle, ok, errors } from "@/lib/http";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { publish } from "@/lib/pubsub";
import { upsellOutcomeSchema } from "@/lib/validation/upsell";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return handle(async () => {
    const session = await requireSession();
    const body = upsellOutcomeSchema.parse(await req.json());

    const [call, order] = await Promise.all([
      prisma.call.findUnique({ where: { id: body.callId } }),
      prisma.order.findUnique({ where: { id: body.orderId } }),
    ]);
    if (!call) throw errors.notFound("Chiamata");
    if (!order) throw errors.notFound("Ordine");

    const outcome = await prisma.upsellOutcome.create({
      data: {
        callId: body.callId,
        orderId: body.orderId,
        suggestedSku: body.suggestedSku,
        outcome: body.outcome,
        extraValueCents: body.extraValueCents,
        notes: body.notes,
      },
    });

    // If accepted, bump the order margin and total — small, idempotent enough
    // for the MVP; a richer "upsell line item" model is for round 4.
    if (body.outcome === "ACCEPTED" && body.extraValueCents > 0) {
      await prisma.order.update({
        where: { id: body.orderId },
        data: {
          totalCents: { increment: body.extraValueCents },
          marginCents: { increment: Math.floor(body.extraValueCents * 0.3) },
        },
      });
    }

    await writeAudit({
      userId: session.user.id,
      action: "upsell.outcome",
      entityType: "UpsellOutcome",
      entityId: outcome.id,
      newValue: {
        outcome: outcome.outcome,
        sku: outcome.suggestedSku,
        extraValueCents: outcome.extraValueCents,
      },
      metadata: { callId: body.callId, orderId: body.orderId },
    });

    publish({
      type: "upsell.created",
      entityId: outcome.id,
      outcome: outcome.outcome,
      related: { customerId: call.customerId, orderId: order.id },
    });

    return ok(outcome, { status: 201 });
  })();
}
