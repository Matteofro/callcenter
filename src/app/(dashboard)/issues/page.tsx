/**
 * Open logistics issues — full list.
 */
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShipmentStatusBadge } from "@/components/shared/StatusBadge";
import { EmptyState } from "@/components/shared/EmptyState";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/i18n/format";
import RealtimeRefresh from "../RealtimeRefresh.client";

export const dynamic = "force-dynamic";

export default async function IssuesPage() {
  const issues = await prisma.shipment.findMany({
    where: {
      OR: [{ isDelayed: true }, { isRefused: true }, { isLost: true }, { isReturned: true }],
      deliveryStatus: { notIn: ["DELIVERED", "RETURNED"] },
    },
    include: {
      order: { select: { id: true, externalRef: true, customer: { select: { id: true, fullName: true } } } },
    },
    orderBy: { lastEventAt: { sort: "desc", nulls: "last" } },
    take: 200,
  });

  return (
    <div className="space-y-6">
      <RealtimeRefresh />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Problemi spedizione</h1>
        <p className="text-sm text-muted-foreground">{issues.length} casi aperti</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Spedizioni con anomalia</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {issues.length === 0 ? (
            <EmptyState title="Nessun problema aperto." />
          ) : (
            issues.map((s) => (
              <Link
                key={s.id}
                href={`/shipments/${encodeURIComponent(s.trackingNumber)}`}
                className="flex flex-col gap-1 rounded-md border p-3 transition-colors hover:bg-accent md:flex-row md:items-center md:justify-between"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs">{s.trackingNumber}</span>
                    <Badge variant="outline">{s.carrier}</Badge>
                    <ShipmentStatusBadge status={s.deliveryStatus} />
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {s.order.customer.fullName} · {s.order.externalRef}
                    {s.lastCarrierStatus && <> · {s.lastCarrierStatus}</>}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground md:text-right">
                  Ultimo evento: {formatDateTime(s.lastEventAt)}
                </div>
              </Link>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
