/**
 * GET    /api/admin/upsell-suggestions/:id   — single rule + recent outcomes
 * PATCH  /api/admin/upsell-suggestions/:id   — partial update
 * DELETE /api/admin/upsell-suggestions/:id   — hard delete
 *
 * Role gate: ADMIN only.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { handle, ok, errors } from "@/lib/http";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { upsellSuggestionUpdateSchema } from "@/lib/validation/upsell-suggestion";

const idSchema = z.object({ id: z.string().uuid("ID non valido") });

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await requireRole(["ADMIN"]);
    const { id } = idSchema.parse(await ctx.params);

    const suggestion = await prisma.upsellSuggestion.findUnique({ where: { id } });
    if (!suggestion) throw errors.notFound("Regola upsell");

    const recent = await prisma.upsellOutcome.findMany({
      where: { suggestedSku: suggestion.suggestSku },
      orderBy: { createdAt: "desc" },
      take: 25,
      include: {
        order: { select: { id: true, externalRef: true } },
        call: { select: { id: true, customerId: true } },
      },
    });

    return ok({ suggestion, recent });
  })();
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = await requireRole(["ADMIN"]);
    const { id } = idSchema.parse(await ctx.params);
    const body = upsellSuggestionUpdateSchema.parse(await req.json());

    const existing = await prisma.upsellSuggestion.findUnique({ where: { id } });
    if (!existing) throw errors.notFound("Regola upsell");

    if (body.triggerSku && body.suggestSku && body.triggerSku === body.suggestSku) {
      throw errors.badRequest(
        "trigger and suggest are equal",
        "Il SKU consigliato non può essere uguale al SKU trigger.",
      );
    }

    try {
      const updated = await prisma.upsellSuggestion.update({
        where: { id },
        data: {
          triggerSku: body.triggerSku,
          suggestSku: body.suggestSku,
          kind: body.kind,
          priority: body.priority,
          discountCents: body.discountCents,
          active: body.active,
          notes: body.notes === undefined ? undefined : body.notes,
        },
      });

      await writeAudit({
        userId: session.user.id,
        action: "upsell_suggestion.update",
        entityType: "UpsellSuggestion",
        entityId: id,
        oldValue: {
          triggerSku: existing.triggerSku,
          suggestSku: existing.suggestSku,
          kind: existing.kind,
          priority: existing.priority,
          active: existing.active,
        },
        newValue: {
          triggerSku: updated.triggerSku,
          suggestSku: updated.suggestSku,
          kind: updated.kind,
          priority: updated.priority,
          active: updated.active,
        },
      });

      return ok(updated);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw errors.conflict("duplicate rule", "Esiste già una regola con questi SKU.");
      }
      throw e;
    }
  })();
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = await requireRole(["ADMIN"]);
    const { id } = idSchema.parse(await ctx.params);

    const existing = await prisma.upsellSuggestion.findUnique({ where: { id } });
    if (!existing) throw errors.notFound("Regola upsell");

    await prisma.upsellSuggestion.delete({ where: { id } });

    await writeAudit({
      userId: session.user.id,
      action: "upsell_suggestion.delete",
      entityType: "UpsellSuggestion",
      entityId: id,
      oldValue: {
        triggerSku: existing.triggerSku,
        suggestSku: existing.suggestSku,
        kind: existing.kind,
      },
    });

    return ok({ deleted: true });
  })();
}
