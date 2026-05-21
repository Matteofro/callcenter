/**
 * KPI page — supervisor-friendly extended view (24h/7d/30d).
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { computeDashboardKpi } from "@/server/kpi";
import { formatEur, formatInt, formatPercent } from "@/lib/i18n/format";
import RealtimeRefresh from "../RealtimeRefresh.client";

export const dynamic = "force-dynamic";

export default async function KpiPage() {
  const [d1, d7, d30] = await Promise.all([
    computeDashboardKpi({ sinceHours: 24 }),
    computeDashboardKpi({ sinceHours: 24 * 7 }),
    computeDashboardKpi({ sinceHours: 24 * 30 }),
  ]);

  return (
    <div className="space-y-6">
      <RealtimeRefresh />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">KPI</h1>
        <p className="text-sm text-muted-foreground">Performance call center</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <KpiPanel title="Ultime 24h" k={d1} />
        <KpiPanel title="Ultimi 7 giorni" k={d7} />
        <KpiPanel title="Ultimi 30 giorni" k={d30} />
      </div>
    </div>
  );
}

function KpiPanel({ title, k }: { title: string; k: Awaited<ReturnType<typeof computeDashboardKpi>> }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <Row label="Chiamate totali" value={formatInt(k.callsTotal)} />
        <Row label="Risposto" value={formatInt(k.callsAnswered)} />
        <Row label="Contact rate" value={formatPercent(k.contactRate)} />
        <Row label="Ordini confermati" value={formatInt(k.callsConfirmed)} />
        <Row label="Conversion rate" value={formatPercent(k.conversionRate)} />
        <Row label="Upsell totali / accettati" value={`${formatInt(k.upsellsTotal)} / ${formatInt(k.upsellsAccepted)}`} />
        <Row label="Upsell rate" value={formatPercent(k.upsellRate)} />
        <Row label="Ricavo extra upsell" value={formatEur(k.extraRevenueCents)} />
        <Row label="Casi logistici aperti" value={formatInt(k.openLogisticsIssues)} />
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}
