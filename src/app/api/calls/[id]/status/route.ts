/**
 * PATCH /api/calls/:id/status
 * Update the call outcome. Computes durationSec when endedAt is provided.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { handle, ok, errors } from "@/lib/http";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { publish } from "@/lib/pubsub";
import { updateCallStatusSchema } from "@/lib/validation/call";

const paramsSchema = z.object({ id: z.string().uuid() });

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = await requireSession();
    const { id } = paramsSchema.parse(await ctx.params);
    const body = updateCallStatusSchema.parse(await req.json());

    const existing = await prisma.call.findUnique({ where: { id } });
    if (!existing) throw errors.notFound("Chiamata");

    // Operators can only mutate their own calls; supervisors/admins can mutate any.
    if (session.user.role === "OPERATOR" && existing.operatorId !== session.user.id) {
      throw errors.forbidden();
    }

    const endedAt = body.endedAt ?? (isTerminal(body.status) ? new Date() : null);
    const durationSec =
      endedAt && existing.startedAt
        ? Math.max(0, Math.floor((endedAt.getTime() - existing.startedAt.getTime()) / 1000))
        : existing.durationSec;

    const updated = await prisma.call.update({
      where: { id },
      data: {
        status: body.status,
        outcomeReason: body.outcomeReason ?? existing.outcomeReason,
        followUpAt: body.followUpAt ?? existing.followUpAt,
        endedAt: endedAt ?? existing.endedAt,
        durationSec: durationSec ?? existing.durationSec,
      },
    });

    await writeAudit({
      userId: session.user.id,
      action: "call.status_change",
      entityType: "Call",
      entityId: updated.id,
      oldValue: {
        status: existing.status,
        outcomeReason: existing.outcomeReason,
        followUpAt: existing.followUpAt,
      },
      newValue: {
        status: updated.status,
        outcomeReason: updated.outcomeReason,
        followUpAt: updated.followUpAt,
      },
    });

    publish({
      type: "call.updated",
      entityId: updated.id,
      status: updated.status,
      related: { customerId: updated.customerId, orderId: updated.orderId ?? undefined },
    });

    return ok(updated);
  })();
}

function isTerminal(status: string): boolean {
  return [
    "ORDER_CONFIRMED",
    "ORDER_CANCELLED",
    "RETURN_REQUESTED",
    "REFUND_REQUESTED",
    "NOT_INTERESTED",
    "CASE_RESOLVED",
    "WRONG_NUMBER",
    "COMPLAINT_OPENED",
  ].includes(status);
}
