/**
 * Admin — upsell rules list.
 *
 * Server-rendered with the same aggregation logic of the API endpoint
 * (we go straight to Prisma to avoid an extra hop).
 */
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/EmptyState";
import { UpsellRulesTable, type UpsellRow } from "@/components/admin/UpsellRulesTable";
import { prisma } from "@/lib/db";
import { formatEur, formatInt, formatPercent } from "@/lib/i18n/format";
import { Plus, Settings } from "lucide-react";
import RealtimeRefresh from "../../RealtimeRefresh.client";

export const dynamic = "force-dynamic";

export default async function AdminUpsellPage() {
  const suggestions = await prisma.upsellSuggestion.findMany({
    orderBy: [{ active: "desc" }, { priority: "desc" }, { createdAt: "desc" }],
  });

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

  type SkuStats = { total: number; accepted: number; rejected: number; deferred: number; extraValueCents: number };
  const statsBySku = new Map<string, SkuStats>();
  for (const g of grouped) {
    const cur = statsBySku.get(g.suggestedSku) ?? { total: 0, accepted: 0, rejected: 0, deferred: 0, extraValueCents: 0 };
    cur.total += g._count._all;
    if (g.outcome === "ACCEPTED") {
      cur.accepted += g._count._all;
      cur.extraValueCents += g._sum.extraValueCents ?? 0;
    } else if (g.outcome === "REJECTED") cur.rejected += g._count._all;
    else cur.deferred += g._count._all;
    statsBySku.set(g.suggestedSku, cur);
  }

  const rows: UpsellRow[] = suggestions.map((s) => {
    const stats = statsBySku.get(s.suggestSku) ?? { total: 0, accepted: 0, rejected: 0, deferred: 0, extraValueCents: 0 };
    const acceptanceRate = stats.total > 0 ? stats.accepted / stats.total : 0;
    return { ...s, stats: { ...stats, acceptanceRate } };
  });

  const totals = rows.reduce(
    (a, r) => ({
      active: a.active + (r.active ? 1 : 0),
      pitched: a.pitched + r.stats.total,
      accepted: a.accepted + r.stats.accepted,
      extra: a.extra + r.stats.extraValueCents,
    }),
    { active: 0, pitched: 0, accepted: 0, extra: 0 },
  );
  const acceptanceRate = totals.pitched > 0 ? totals.accepted / totals.pitched : 0;

  return (
    <div className="space-y-6">
      <RealtimeRefresh />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Regole upsell
          </h1>
          <p className="text-sm text-muted-foreground">Gestisci i suggerimenti automatici proposti agli operatori.</p>
        </div>
        <Button asChild>
          <Link href="/admin/upsell/new"><Plus className="h-4 w-4" /> Nuova regola</Link>
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Regole totali" value={formatInt(rows.length)} />
        <Kpi label="Regole attive" value={formatInt(totals.active)} />
        <Kpi label="Acceptance rate" value={formatPercent(acceptanceRate)} />
        <Kpi label="Extra generato" value={formatEur(totals.extra)} />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Regole</CardTitle>
          <Badge variant="muted">{rows.length}</Badge>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <EmptyState
              title="Nessuna regola configurata."
              hint="Crea la prima regola per iniziare a suggerire upsell agli operatori."
            />
          ) : (
            <UpsellRulesTable rows={rows} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-2 text-xl font-semibold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}
