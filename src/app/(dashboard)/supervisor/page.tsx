/**
 * Supervisor dashboard.
 *
 * Three columns at desktop: KPI totals + trend chart at the top, operator
 * leaderboard + top non-conversion reasons in the middle, live activity feed
 * at the bottom.
 *
 * Range toggle (24h / 7g / 30g) is a client subcomponent that links to the
 * same page with a query string — server-rendered for SEO-friendly URLs and
 * shareable bookmarks.
 */
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { computeSupervisorOverview, type SupervisorRange } from "@/server/supervisor";
import { BarChart, type BarChartDatum } from "@/components/shared/BarChart";
import { EmptyState } from "@/components/shared/EmptyState";
import { formatEur, formatInt, formatPercent, formatDuration, formatRelativeIt, formatDateTime } from "@/lib/i18n/format";
import { callStatusLabel } from "@/lib/i18n/labels";
import type { CallStatus } from "@prisma/client";
import {
  Headset,
  PhoneCall,
  CheckCircle2,
  TrendingUp,
  AlertTriangle,
  Users,
  Activity,
} from "lucide-react";
import RealtimeRefresh from "../RealtimeRefresh.client";

export const dynamic = "force-dynamic";

const RANGE_LABELS: Record<SupervisorRange, string> = {
  "24h": "24 ore",
  "7d": "7 giorni",
  "30d": "30 giorni",
};

export default async function SupervisorPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const sp = await searchParams;
  const range = (["24h", "7d", "30d"].includes(sp.range ?? "") ? sp.range : "24h") as SupervisorRange;

  const overview = await computeSupervisorOverview({ range });

  const trendData: BarChartDatum[] = overview.trend.map((b) => {
    const d = new Date(b.bucket);
    const label =
      range === "24h"
        ? `${d.getHours().toString().padStart(2, "0")}:00`
        : `${d.getDate().toString().padStart(2, "0")}/${(d.getMonth() + 1).toString().padStart(2, "0")}`;
    return {
      label,
      total: b.callsTotal,
      highlight: b.callsConfirmed,
      tooltip: `${label} · ${b.callsTotal} tot · ${b.callsConfirmed} convertiti`,
    };
  });

  return (
    <div className="space-y-6">
      <RealtimeRefresh />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Supervisore</h1>
          <p className="text-sm text-muted-foreground">
            Performance call center · ultimi {RANGE_LABELS[range]}
          </p>
        </div>
        <RangePicker current={range} />
      </div>

      {/* KPI totals */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <Kpi icon={<PhoneCall className="h-4 w-4" />} label="Chiamate" value={formatInt(overview.totals.callsTotal)} />
        <Kpi icon={<Headset className="h-4 w-4" />} label="Contact rate" value={formatPercent(overview.totals.contactRate)} />
        <Kpi icon={<CheckCircle2 className="h-4 w-4" />} label="Conversion rate" value={formatPercent(overview.totals.conversionRate)} />
        <Kpi icon={<TrendingUp className="h-4 w-4" />} label="Upsell accettati" value={formatInt(overview.totals.upsellsAccepted)} />
        <Kpi icon={<TrendingUp className="h-4 w-4" />} label="Extra ricavi" value={formatEur(overview.totals.extraRevenueCents)} />
        <Kpi icon={<AlertTriangle className="h-4 w-4" />} label="Casi logistici" value={formatInt(overview.totals.openLogisticsIssues)} />
      </div>

      {/* Trend */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Andamento chiamate
          </CardTitle>
        </CardHeader>
        <CardContent>
          <BarChart data={trendData} height={140} highlightLabel="Confermati" />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Operator leaderboard */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Performance operatori
              <Badge variant="muted">{overview.totals.activeOperators} attivi</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {overview.operators.length === 0 ? (
              <EmptyState title="Nessun operatore attivo." />
            ) : (
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-2 text-left font-medium">Operatore</th>
                    <th className="py-2 text-right font-medium">Chiamate</th>
                    <th className="py-2 text-right font-medium hidden md:table-cell">Contact</th>
                    <th className="py-2 text-right font-medium">Conv.</th>
                    <th className="py-2 text-right font-medium hidden md:table-cell">Durata avg</th>
                    <th className="py-2 text-right font-medium">Upsell</th>
                    <th className="py-2 text-right font-medium">Extra €</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.operators.map((o) => (
                    <tr key={o.operatorId} className="border-b last:border-b-0">
                      <td className="py-2.5 font-medium">{o.fullName}</td>
                      <td className="py-2.5 text-right tabular-nums">{formatInt(o.callsTotal)}</td>
                      <td className="py-2.5 text-right tabular-nums hidden md:table-cell">{formatPercent(o.contactRate)}</td>
                      <td className="py-2.5 text-right tabular-nums">{formatPercent(o.conversionRate)}</td>
                      <td className="py-2.5 text-right tabular-nums hidden md:table-cell">{formatDuration(o.avgDurationSec)}</td>
                      <td className="py-2.5 text-right tabular-nums">{formatInt(o.upsellsAccepted)}</td>
                      <td className="py-2.5 text-right tabular-nums">{formatEur(o.extraRevenueCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        {/* Top non-conversion reasons */}
        <Card>
          <CardHeader>
            <CardTitle>Motivi non conversione</CardTitle>
          </CardHeader>
          <CardContent>
            {overview.topNonConversion.length === 0 ? (
              <EmptyState title="Nessun dato." />
            ) : (
              <ul className="space-y-2">
                {overview.topNonConversion.map((r) => {
                  const maxCount = overview.topNonConversion[0]?.count ?? 1;
                  const pct = (r.count / maxCount) * 100;
                  return (
                    <li key={r.status}>
                      <div className="flex items-center justify-between text-sm">
                        <span>{callStatusLabel[r.status as CallStatus] ?? r.status}</span>
                        <span className="font-medium tabular-nums">{formatInt(r.count)}</span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-muted">
                        <div className="h-1.5 rounded-full bg-destructive/70" style={{ width: `${pct}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Activity feed */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Attività recente
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {overview.recentActivity.length === 0 ? (
            <EmptyState title="Nessuna attività nel periodo." />
          ) : (
            overview.recentActivity.map((a) => (
              <div key={a.id} className="flex items-start justify-between gap-3 rounded-md border p-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium">{prettyAction(a.action)}</span>
                    <Badge variant="outline">{a.entityType}</Badge>
                    <Badge variant={a.source === "WEBHOOK" ? "warning" : "muted"}>{a.source}</Badge>
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {a.user?.fullName ?? "Sistema"} · entità <span className="font-mono">{a.entityId.slice(0, 8)}</span>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground whitespace-nowrap">
                  {formatRelativeIt(a.createdAt)}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Separator />
      <p className="text-xs text-muted-foreground">
        Finestra: {formatDateTime(overview.windowStart)} → {formatDateTime(overview.windowEnd)}
      </p>
    </div>
  );
}

function Kpi({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between text-muted-foreground">
          <span className="text-xs uppercase tracking-wide">{label}</span>
          {icon}
        </div>
        <div className="mt-2 text-xl font-semibold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}

function RangePicker({ current }: { current: SupervisorRange }) {
  const items: Array<{ range: SupervisorRange; label: string }> = [
    { range: "24h", label: "24h" },
    { range: "7d", label: "7g" },
    { range: "30d", label: "30g" },
  ];
  return (
    <div className="inline-flex rounded-md border bg-background p-0.5">
      {items.map((it) => (
        <Button
          key={it.range}
          asChild
          variant={current === it.range ? "default" : "ghost"}
          size="sm"
          className="h-9 px-3"
        >
          <Link href={`/supervisor?range=${it.range}`}>{it.label}</Link>
        </Button>
      ))}
    </div>
  );
}

/** "call.status_change" → "Status chiamata", "shipment.shipment_delivered" → "Consegnato" */
function prettyAction(action: string): string {
  const map: Record<string, string> = {
    "call.create": "Chiamata aperta",
    "call.status_change": "Esito chiamata",
    "call.note_added": "Nota aggiunta",
    "upsell.outcome": "Upsell registrato",
    "order.status_cascade": "Stato ordine",
  };
  if (map[action]) return map[action];
  if (action.startsWith("shipment.")) return "Spedizione aggiornata";
  return action;
}
