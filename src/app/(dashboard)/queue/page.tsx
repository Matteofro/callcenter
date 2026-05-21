/**
 * Full-page call queue.
 */
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CallStatusBadge, CustomerStatusBadge, RiskBadge } from "@/components/shared/StatusBadge";
import { EmptyState } from "@/components/shared/EmptyState";
import { prisma } from "@/lib/db";
import { formatEur, formatPhone, formatRelativeIt } from "@/lib/i18n/format";
import { ArrowRight } from "lucide-react";
import RealtimeRefresh from "../RealtimeRefresh.client";

export const dynamic = "force-dynamic";

export default async function QueuePage() {
  const queue = await prisma.call.findMany({
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
      customer: { select: { id: true, fullName: true, phoneE164: true, status: true, riskScore: true } },
      order: { select: { id: true, externalRef: true, totalCents: true } },
    },
    orderBy: [{ followUpAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
    take: 100,
  });

  return (
    <div className="space-y-6">
      <RealtimeRefresh />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Coda chiamate</h1>
        <p className="text-sm text-muted-foreground">{queue.length} chiamate da gestire</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Da chiamare ora</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {queue.length === 0 ? (
            <EmptyState title="Coda vuota." hint="Quando ci saranno chiamate da fare le vedrai qui." />
          ) : (
            queue.map((c) => (
              <Link
                key={c.id}
                href={`/customers/${c.customer.id}`}
                className="flex items-center justify-between rounded-md border p-3 transition-colors hover:bg-accent tap-44"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{c.customer.fullName}</span>
                    <CustomerStatusBadge status={c.customer.status} />
                    {c.customer.riskScore >= 40 && <RiskBadge score={c.customer.riskScore} />}
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
    </div>
  );
}
