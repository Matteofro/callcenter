/**
 * Order detail page.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  OrderStatusBadge,
  PaymentStatusBadge,
  ShipmentStatusBadge,
  UpsellOutcomeBadge,
} from "@/components/shared/StatusBadge";
import { EmptyState } from "@/components/shared/EmptyState";
import { formatDateTime, formatEur, formatRelativeIt } from "@/lib/i18n/format";
import { paymentMethodLabel } from "@/lib/i18n/labels";
import { ArrowLeft, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import RealtimeRefresh from "../../RealtimeRefresh.client";

export const dynamic = "force-dynamic";

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      customer: true,
      items: true,
      shipments: { orderBy: { createdAt: "desc" } },
      upsells: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!order) notFound();

  return (
    <div className="space-y-6">
      <RealtimeRefresh />

      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/customers/${order.customer.id}`}>
            <ArrowLeft className="h-4 w-4" /> Torna al cliente
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Package className="h-5 w-5" />
                Ordine <span className="font-mono">{order.externalRef}</span>
              </CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                {order.customer.fullName} · {formatRelativeIt(order.createdAt)}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <OrderStatusBadge status={order.status} />
              <PaymentStatusBadge status={order.paymentStatus} />
              <Badge variant="outline">{paymentMethodLabel[order.paymentMethod]}</Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <Info label="Totale" value={formatEur(order.totalCents)} />
            <Info label="Contrassegno" value={formatEur(order.codAmountCents)} />
            <Info label="Margine" value={formatEur(order.marginCents)} />
            <Info label="Spedizione" value={order.shippingMethod ?? "—"} />
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Prodotti</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {order.items.length === 0 ? (
              <EmptyState title="Nessun prodotto." />
            ) : (
              order.items.map((it) => (
                <div key={it.id} className="flex items-center justify-between rounded-md border p-3">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{it.name}</div>
                    <div className="text-xs text-muted-foreground">
                      <span className="font-mono">{it.sku}</span>
                      {it.category && <> · {it.category}</>}
                    </div>
                  </div>
                  <div className="text-right text-sm">
                    <div>{it.quantity}× {formatEur(it.unitPriceCents)}</div>
                    <div className="font-semibold">{formatEur(it.totalCents)}</div>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Spedizioni</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {order.shipments.length === 0 ? (
              <EmptyState title="Nessuna spedizione collegata." />
            ) : (
              order.shipments.map((s) => (
                <Link
                  key={s.id}
                  href={`/shipments/${encodeURIComponent(s.trackingNumber)}`}
                  className="block rounded-md border p-3 hover:bg-accent"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-sm">{s.trackingNumber}</span>
                    <ShipmentStatusBadge status={s.deliveryStatus} />
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {s.carrier} · ult. evento {formatDateTime(s.lastEventAt)}
                  </div>
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Upsell registrati</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {order.upsells.length === 0 ? (
            <EmptyState title="Nessun upsell registrato." />
          ) : (
            order.upsells.map((u) => (
              <div key={u.id} className="flex items-center justify-between rounded-md border p-3">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm">{u.suggestedSku}</span>
                  <UpsellOutcomeBadge status={u.outcome} />
                </div>
                <div className="text-sm">
                  {u.outcome === "ACCEPTED" && <span className="font-semibold text-success">+ {formatEur(u.extraValueCents)}</span>}
                  <span className="ml-3 text-xs text-muted-foreground">{formatRelativeIt(u.createdAt)}</span>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 font-semibold tabular-nums">{value}</div>
    </div>
  );
}
