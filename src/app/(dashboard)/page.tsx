/**
 * Operator dashboard home.
 *
 * Server Component — hits Prisma directly (no API hop) so the page paints fast.
 * Three blocks:
 *   1. KPI cards (24h)
 *   2. Call queue (TO_CALL + scheduled callbacks due now)
 *   3. Open logistics issues
 *
 * A small client component (`RealtimeRefresh`) subscribes to SSE and calls
 * router.refresh() on every event so the server-rendered content stays live.
 */
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { CallStatusBadge, ShipmentStatusBadge } from "@/components/shared/StatusBadge";
import { EmptyState } from "@/components/shared/EmptyState";
import { computeDashboardKpi } from "@/server/kpi";
import { prisma } from "@/lib/db";
import { formatEur, formatInt, formatPercent, formatPhone, formatRelativeIt } from "@/lib/i18n/format";
import { PhoneCall, AlertTriangle, ArrowRight, TrendingUp, Headset, CheckCircle2 } from "lucide-react";
import RealtimeRefresh from "./RealtimeRefresh.client";

export const dynamic = "force-dynamic";

export default async function DashboardHome() {
  const [kpi, queue, issues] = await Promise.all([
    computeDashboardKpi({ sinceHours: 24 }),
    prisma.call.findMany({
      where: {
        OR: [
          { status: "TO_CALL" },
          { status: "CALLBACK_SCHEDULED", OR: [{ followUpAt: null }, { followUpAt: { lte: new Date() } }] },
          { status: "NO_ANSWER" },
          { status: "BUSY" },
          { status: "CALL_LATER" },
        ],
      },
      include: {
        customer: { select: { id: true, fullName: true, phoneE164: true, phoneRaw: true, status: true } },
        order: { select: { id: true, externalRef: true, totalCents: true } },
      },
      orderBy: [{ followUpAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
      take: 12,
    }),
    prisma.shipment.findMany({
      where: {
        OR: [{ isDelayed: true }, { isRefused: true }, { isLost: true }, { isReturned: true }],
        deliveryStatus: { notIn: ["DELIVERED", "RETURNED"] },
      },
      include: {
        order: {
          select: {
            id: true,
            externalRef: true,
            customer: { select: { id: true, fullName: true } },
          },
        },
      },
      orderBy: { lastEventAt: { sort: "desc", nulls: "last" } },
      take: 10,
    }),
  ]);

  return (
    <div className="space-y-6">
      <RealtimeRefresh />

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Ultime 24 ore</p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard icon={<PhoneCall className="h-4 w-4" />} label="Chiamate totali" value={formatInt(kpi.callsTotal)} />
        <KpiCard icon={<Headset className="h-4 w-4" />} label="Contact rate" value={formatPercent(kpi.contactRate)} />
        <KpiCard icon={<CheckCircle2 className="h-4 w-4" />} label="Conversion rate" value={formatPercent(kpi.conversionRate)} />
        <KpiCard icon={<TrendingUp className="h-4 w-4" />} label="Extra da upsell" value={formatEur(kpi.extraRevenueCents)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Queue */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <PhoneCall className="h-4 w-4" />
              Coda chiamate
              <Badge variant="muted">{queue.length}</Badge>
            </CardTitle>
            <Button variant="ghost" asChild size="sm">
              <Link href="/queue">Vedi tutte <ArrowRight className="h-3.5 w-3.5" /></Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {queue.length === 0 ? (
              <EmptyState title="Nessuna chiamata in coda." hint="Le nuove chiamate appariranno qui automaticamente." />
            ) : (
              queue.map((c) => (
                <Link
                  key={c.id}
                  href={`/customers/${c.customer.id}`}
                  className="flex items-center justify-between rounded-md border p-3 transition-colors hover:bg-accent tap-44"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{c.customer.fullName}</span>
                      <CallStatusBadge status={c.status} />
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {formatPhone(c.customer.phoneE164)}
                      {c.order && <> · ord. <span className="font-mono">{c.order.externalRef}</span> · {formatEur(c.order.totalCents)}</>}
                      {c.followUpAt && <> · richiamare {formatRelativeIt(c.followUpAt)}</>}
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        {/* Issues */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-warning" />
              Problemi spedizione
              <Badge variant="muted">{issues.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {issues.length === 0 ? (
              <EmptyState title="Nessun problema aperto." />
            ) : (
              issues.map((s) => (
                <Link
                  key={s.id}
                  href={`/shipments/${encodeURIComponent(s.trackingNumber)}`}
                  className="block rounded-md border p-3 transition-colors hover:bg-accent"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs">{s.trackingNumber}</span>
                    <ShipmentStatusBadge status={s.deliveryStatus} />
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {s.order.customer.fullName} · {s.order.externalRef}
                  </div>
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Separator />
      <p className="text-xs text-muted-foreground">
        I dati si aggiornano automaticamente quando arrivano eventi dalla piattaforma logistica.
      </p>
    </div>
  );
}

function KpiCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between text-muted-foreground">
          <span className="text-xs uppercase tracking-wide">{label}</span>
          {icon}
        </div>
        <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}
