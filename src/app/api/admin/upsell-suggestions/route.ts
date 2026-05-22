/**
 * GET  /api/admin/upsell-suggestions
 *   List rules with aggregated outcomes (acceptance rate + extra revenue).
 *
 * POST /api/admin/upsell-suggestions
 *   Create a new rule. Conflicts on (triggerSku, suggestSku) return 409.
 *
 * Role gate: ADMIN only.
 */
import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { handle, ok, errors } from "@/lib/http";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { upsellSuggestionCreateSchema } from "@/lib/validation/upsell-suggestion";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => {
    await requireRole(["ADMIN"]);

    const suggestions = await prisma.upsellSuggestion.findMany({
      orderBy: [{ active: "desc" }, { priority: "desc" }, { createdAt: "desc" }],
    });

    // For each suggestSku, aggregate the outcomes that ever pitched it.
    const skuList = Array.from(new Set(suggestions.map((s) => s.suggestSku)));
    const grouped =
      skuList.length === 0
        ? []
        : await prisma.upsellOutcome.groupBy({
            by: ["suggestedSku", "outcome"],
            where: { suggestedSku: { in: skuList } },
            _count: { _all: true },
            _sum: { extraValueCents: true },
          });

    type SkuStats = {
      total: number;
      accepted: number;
      rejected: number;
      deferred: number;
      extraValueCents: number;
    };
    const statsBySku = new Map<string, SkuStats>();
    for (const g of grouped) {
      const cur =
        statsBySku.get(g.suggestedSku) ??
        ({ total: 0, accepted: 0, rejected: 0, deferred: 0, extraValueCents: 0 } satisfies SkuStats);
      const n = g._count._all;
      cur.total += n;
      if (g.outcome === "ACCEPTED") {
        cur.accepted += n;
        cur.extraValueCents += g._sum.extraValueCents ?? 0;
      } else if (g.outcome === "REJECTED") {
        cur.rejected += n;
      } else {
        cur.deferred += n;
      }
      statsBySku.set(g.suggestedSku, cur);
    }

    const enriched = suggestions.map((s) => {
      const stats = statsBySku.get(s.suggestSku) ?? {
        total: 0,
        accepted: 0,
        rejected: 0,
        deferred: 0,
        extraValueCents: 0,
      };
      const acceptanceRate = stats.total > 0 ? stats.accepted / stats.total : 0;
      return { ...s, stats: { ...stats, acceptanceRate } };
    });

    return ok({ suggestions: enriched });
  })();
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const session = await requireRole(["ADMIN"]);
    const body = upsellSuggestionCreateSchema.parse(await req.json());

    if (body.triggerSku === body.suggestSku) {
      throw errors.badRequest(
        "trigger and suggest are equal",
        "Il SKU consigliato non può essere uguale al SKU trigger.",
      );
    }

    try {
      const created = await prisma.upsellSuggestion.create({
        data: {
          triggerSku: body.triggerSku,
          suggestSku: body.suggestSku,
          kind: body.kind,
          priority: body.priority,
          discountCents: body.discountCents,
          active: body.active,
          notes: body.notes ?? null,
        },
      });

      await writeAudit({
        userId: session.user.id,
        action: "upsell_suggestion.create",
        entityType: "UpsellSuggestion",
        entityId: created.id,
        newValue: {
          triggerSku: created.triggerSku,
          suggestSku: created.suggestSku,
          kind: created.kind,
          priority: created.priority,
        },
      });

      return ok(created, { status: 201 });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw errors.conflict(
          "duplicate rule",
          "Esiste già una regola con questi SKU.",
        );
      }
      throw e;
    }
  })();
}
