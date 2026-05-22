import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UpsellRuleForm } from "@/components/admin/UpsellRuleForm";
import { UpsellOutcomeBadge } from "@/components/shared/StatusBadge";
import { EmptyState } from "@/components/shared/EmptyState";
import { formatEur, formatRelativeIt } from "@/lib/i18n/format";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function EditUpsellRulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const suggestion = await prisma.upsellSuggestion.findUnique({ where: { id } });
  if (!suggestion) notFound();

  const recent = await prisma.upsellOutcome.findMany({
    where: { suggestedSku: suggestion.suggestSku },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: {
      order: { select: { id: true, externalRef: true } },
      call: { select: { id: true, customerId: true } },
    },
  });

  return (
    <div className="space-y-6 max-w-4xl">
      <Button variant="ghost" size="sm" asChild>
        <Link href="/admin/upsell">
          <ArrowLeft className="h-4 w-4" /> Torna alle regole
        </Link>
      </Button>

      <UpsellRuleForm mode="edit" initial={suggestion} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Esiti recenti
            <Badge variant="muted">{recent.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {recent.length === 0 ? (
            <EmptyState title="Nessun esito ancora registrato per questo SKU." />
          ) : (
            recent.map((o) => (
              <div key={o.id} className="flex items-center justify-between rounded-md border p-3">
                <div className="flex items-center gap-2">
                  <UpsellOutcomeBadge status={o.outcome} />
                  {o.order && (
                    <Link href={`/orders/${o.order.id}`} className="font-mono text-sm hover:underline">
                      {o.order.externalRef}
                    </Link>
                  )}
                  {o.call && (
                    <Link
                      href={`/customers/${o.call.customerId}`}
                      className="text-xs text-muted-foreground hover:underline"
                    >
                      → cliente
                    </Link>
                  )}
                </div>
                <div className="flex items-center gap-3 text-sm">
                  {o.outcome === "ACCEPTED" && o.extraValueCents > 0 && (
                    <span className="font-semibold text-success">+ {formatEur(o.extraValueCents)}</span>
                  )}
                  <span className="text-xs text-muted-foreground">{formatRelativeIt(o.createdAt)}</span>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
