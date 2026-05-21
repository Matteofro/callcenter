/**
 * Customer card — the operator workspace.
 *
 * Performance: this is a Server Component that runs a single Prisma query
 * with `include`s to fetch everything in one round trip. Target: <500ms TTFB.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  CallStatusBadge,
  CustomerStatusBadge,
  OrderStatusBadge,
  ShipmentStatusBadge,
  RiskBadge,
} from "@/components/shared/StatusBadge";
import { CallPanel } from "@/components/call/CallPanel";
import { UpsellPanel } from "@/components/call/UpsellPanel";
import { EmptyState } from "@/components/shared/EmptyState";
import {
  formatDateTime,
  formatDuration,
  formatEur,
  formatPhone,
  formatRelativeIt,
} from "@/lib/i18n/format";
import { Phone, Mail, Package, History, MapPin } from "lucide-react";
import RealtimeRefresh from "../../RealtimeRefresh.client";

export const dynamic = "force-dynamic";

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const customer = await prisma.customer.findUnique({
    where: { id },
    include: {
      orders: {
        orderBy: { createdAt: "desc" },
        take: 20,
        include: {
          items: true,
          shipments: { orderBy: { createdAt: "desc" } },
        },
      },
      calls: {
        orderBy: { createdAt: "desc" },
        take: 20,
        include: {
          notes: { orderBy: { createdAt: "desc" } },
          operator: { select: { id: true, fullName: true } },
        },
      },
    },
  });

  if (!customer || customer.deletedAt) notFound();

  // The "active" call is the most recent open one (no endedAt).
  const activeCall = customer.calls.find((c) => !c.endedAt) ?? null;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
      <RealtimeRefresh />

      <div className="space-y-6 min-w-0">
        {/* Customer header */}
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-semibold tracking-tight">{customer.fullName}</h1>
                  <CustomerStatusBadge status={customer.status} />
                  <RiskBadge score={customer.riskScore} />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <Phone className="h-3.5 w-3.5" />
                    <a href={`tel:${customer.phoneE164}`} className="font-medium text-foreground hover:underline">
                      {formatPhone(customer.phoneE164)}
                    </a>
                  </span>
                  {customer.email && (
                    <span className="flex items-center gap-1.5">
                      <Mail className="h-3.5 w-3.5" />
                      {customer.email}
                    </span>
                  )}
                  <span className="flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5" />
                    {customer.country}
                  </span>
                </div>
              </div>
              <div className="md:text-right">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Lifetime value</div>
                <div className="text-xl font-semibold tabular-nums">{formatEur(customer.lifetimeValue)}</div>
              </div>
            </div>
          </CardHeader>
          {customer.historyNotes && (
            <CardContent className="pt-0">
              <Separator className="mb-4" />
              <div className="flex items-start gap-2 text-sm">
                <History className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                <p className="text-muted-foreground">{customer.historyNotes}</p>
              </div>
            </CardContent>
          )}
        </Card>

        {/* Orders + shipments */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-4 w-4" />
              Ordini
              <Badge variant="muted">{customer.orders.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {customer.orders.length === 0 ? (
              <EmptyState title="Nessun ordine." />
            ) : (
              customer.orders.map((o) => (
                <div key={o.id} className="rounded-md border p-3 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Link href={`/orders/${o.id}`} className="font-mono text-sm hover:underline">
                        {o.externalRef}
                      </Link>
                      <OrderStatusBadge status={o.status} />
                    </div>
                    <div className="text-sm">
                      <span className="font-semibold">{formatEur(o.totalCents)}</span>
                      <span className="text-muted-foreground"> · {formatRelativeIt(o.createdAt)}</span>
                    </div>
                  </div>
                  {o.items.length > 0 && (
                    <ul className="text-xs text-muted-foreground space-y-0.5">
                      {o.items.map((it) => (
                        <li key={it.id}>
                          {it.quantity}× <span className="font-mono">{it.sku}</span> — {it.name}
                        </li>
                      ))}
                    </ul>
                  )}
                  {o.shipments.length > 0 && (
                    <div className="space-y-1">
                      {o.shipments.map((s) => (
                        <Link
                          key={s.id}
                          href={`/shipments/${encodeURIComponent(s.trackingNumber)}`}
                          className="flex items-center justify-between rounded-sm bg-muted/40 px-2 py-1.5 text-xs hover:bg-muted"
                        >
                          <span className="flex items-center gap-2">
                            <span className="font-mono">{s.trackingNumber}</span>
                            <Badge variant="outline">{s.carrier}</Badge>
                            <ShipmentStatusBadge status={s.deliveryStatus} />
                          </span>
                          <span className="text-muted-foreground">
                            {s.lastCarrierStatus ?? formatDateTime(s.lastEventAt)}
                          </span>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Call timeline */}
        <Card>
          <CardHeader>
            <CardTitle>Storico chiamate</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {customer.calls.length === 0 ? (
              <EmptyState title="Nessuna chiamata registrata." />
            ) : (
              customer.calls.map((c) => (
                <div key={c.id} className="rounded-md border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <CallStatusBadge status={c.status} />
                      <span className="text-xs text-muted-foreground">{c.operator.fullName}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatDateTime(c.startedAt ?? c.createdAt)} · {formatDuration(c.durationSec)}
                    </div>
                  </div>
                  {c.outcomeReason && <p className="mt-2 text-sm">{c.outcomeReason}</p>}
                  {c.notes.length > 0 && (
                    <ul className="mt-2 space-y-1.5 border-l-2 border-muted pl-3">
                      {c.notes.map((n) => (
                        <li key={n.id} className="text-sm">
                          <span className="text-muted-foreground text-xs">{formatRelativeIt(n.createdAt)} —</span>{" "}
                          {n.body}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Action sidebar */}
      <div className="space-y-4">
        <CallPanel
          customerId={customer.id}
          orderIds={customer.orders.map((o) => ({ id: o.id, externalRef: o.externalRef }))}
          activeCall={
            activeCall
              ? {
                  id: activeCall.id,
                  status: activeCall.status,
                  outcomeReason: activeCall.outcomeReason,
                  startedAt: activeCall.startedAt?.toISOString() ?? null,
                }
              : null
          }
        />
        {activeCall?.orderId && (
          <UpsellPanel callId={activeCall.id} orderId={activeCall.orderId} />
        )}
      </div>
    </div>
  );
}
