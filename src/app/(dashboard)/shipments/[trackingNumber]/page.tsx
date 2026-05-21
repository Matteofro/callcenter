/**
 * Shipment detail with the full logistics event timeline.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShipmentStatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { formatDateTime, formatRelativeIt } from "@/lib/i18n/format";
import { logisticsEventLabel } from "@/lib/i18n/labels";
import { ArrowLeft, Truck, AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import RealtimeRefresh from "../../RealtimeRefresh.client";
import type { LogisticsEventType } from "@prisma/client";

export const dynamic = "force-dynamic";

export default async function ShipmentPage({ params }: { params: Promise<{ trackingNumber: string }> }) {
  const { trackingNumber } = await params;
  const shipment = await prisma.shipment.findUnique({
    where: { trackingNumber: decodeURIComponent(trackingNumber) },
    include: {
      order: { include: { customer: true } },
      events: { orderBy: { occurredAt: "desc" }, take: 100 },
    },
  });
  if (!shipment) notFound();

  return (
    <div className="space-y-6">
      <RealtimeRefresh />

      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/customers/${shipment.order.customer.id}`}>
            <ArrowLeft className="h-4 w-4" /> Torna al cliente
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Truck className="h-5 w-5" />
                <span className="font-mono">{shipment.trackingNumber}</span>
              </CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                {shipment.order.customer.fullName} · ordine{" "}
                <Link href={`/orders/${shipment.order.id}`} className="font-mono hover:underline">
                  {shipment.order.externalRef}
                </Link>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{shipment.carrier}</Badge>
              <ShipmentStatusBadge status={shipment.deliveryStatus} />
              {shipment.isDelayed && <Badge variant="warning">In ritardo</Badge>}
              {shipment.isRefused && <Badge variant="destructive">Rifiutato</Badge>}
              {shipment.isLost && <Badge variant="destructive">Smarrito</Badge>}
              {shipment.isReturned && <Badge variant="warning">Reso al mittente</Badge>}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <Info label="Spedito il" value={formatDateTime(shipment.shippedAt)} />
            <Info label="ETA" value={formatDateTime(shipment.etaAt)} />
            <Info label="Consegnato il" value={formatDateTime(shipment.deliveredAt)} />
            <Info label="Ultimo evento" value={formatDateTime(shipment.lastEventAt)} />
          </div>
          {shipment.lastCarrierStatus && (
            <p className="mt-4 rounded-md bg-muted/40 p-3 text-sm">
              <span className="text-muted-foreground">Ultimo stato corriere:</span> {shipment.lastCarrierStatus}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Timeline eventi</CardTitle>
        </CardHeader>
        <CardContent>
          {shipment.events.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nessun evento.</p>
          ) : (
            <ol className="relative border-l border-border space-y-4 ml-2">
              {shipment.events.map((e) => (
                <li key={e.id} className="ml-4">
                  <span className="absolute -left-1.5 flex h-3 w-3 items-center justify-center">
                    <EventDot type={e.type} />
                  </span>
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-medium">{logisticsEventLabel[e.type]}</span>
                    <span className="text-xs text-muted-foreground">{formatDateTime(e.occurredAt)}</span>
                    <span className="text-xs text-muted-foreground">({formatRelativeIt(e.occurredAt)})</span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    provider: {e.provider} · externalId: <span className="font-mono">{e.externalId}</span>
                  </p>
                </li>
              ))}
            </ol>
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

function EventDot({ type }: { type: LogisticsEventType }) {
  if (type === "SHIPMENT_DELIVERED") return <CheckCircle2 className="h-3 w-3 text-success" />;
  if (
    type === "SHIPMENT_REFUSED" ||
    type === "SHIPMENT_LOST" ||
    type === "SHIPMENT_RETURNED" ||
    type === "SHIPMENT_EXCEPTION"
  )
    return <AlertTriangle className="h-3 w-3 text-destructive" />;
  if (type === "SHIPMENT_DELAYED") return <AlertTriangle className="h-3 w-3 text-warning" />;
  return <Clock className="h-3 w-3 text-muted-foreground" />;
}
