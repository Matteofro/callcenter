"use client";
/**
 * Client table for the admin upsell list.
 * Each row has an inline "Attiva/Disattiva" toggle that PATCHes the rule and
 * triggers router.refresh() so stats stay current without page reload.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/client/api";
import { upsellKindLabel } from "@/lib/i18n/labels";
import { formatEur, formatInt, formatPercent } from "@/lib/i18n/format";
import { Power, Pencil } from "lucide-react";
import type { UpsellKind } from "@prisma/client";

export type UpsellRow = {
  id: string;
  triggerSku: string;
  suggestSku: string;
  kind: UpsellKind;
  priority: number;
  discountCents: number;
  active: boolean;
  notes: string | null;
  stats: {
    total: number;
    accepted: number;
    rejected: number;
    deferred: number;
    acceptanceRate: number;
    extraValueCents: number;
  };
};

export function UpsellRulesTable({ rows }: { rows: UpsellRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  async function toggleActive(row: UpsellRow) {
    const r = await apiFetch(`/api/admin/upsell-suggestions/${row.id}`, {
      method: "PATCH",
      body: JSON.stringify({ active: !row.active }),
    });
    if (!r.ok) return toast.error(r.error.message);
    toast.success(row.active ? "Regola disattivata." : "Regola attivata.");
    startTransition(() => router.refresh());
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs uppercase tracking-wide text-muted-foreground">
          <tr className="border-b">
            <th className="py-2 pr-3 text-left font-medium">Trigger SKU</th>
            <th className="py-2 pr-3 text-left font-medium">→ Consigliato</th>
            <th className="py-2 pr-3 text-left font-medium">Tipo</th>
            <th className="py-2 pr-3 text-right font-medium">Priorità</th>
            <th className="py-2 pr-3 text-right font-medium hidden md:table-cell">Sconto</th>
            <th className="py-2 pr-3 text-right font-medium">Esiti</th>
            <th className="py-2 pr-3 text-right font-medium">Acc. rate</th>
            <th className="py-2 pr-3 text-right font-medium hidden md:table-cell">Extra €</th>
            <th className="py-2 pr-3 text-center font-medium">Stato</th>
            <th className="py-2 text-right font-medium">Azioni</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b last:border-b-0">
              <td className="py-2.5 pr-3 font-mono">{r.triggerSku}</td>
              <td className="py-2.5 pr-3 font-mono">{r.suggestSku}</td>
              <td className="py-2.5 pr-3"><Badge variant="outline">{upsellKindLabel[r.kind]}</Badge></td>
              <td className="py-2.5 pr-3 text-right tabular-nums">{r.priority}</td>
              <td className="py-2.5 pr-3 text-right tabular-nums hidden md:table-cell">
                {r.discountCents > 0 ? `-${formatEur(r.discountCents)}` : "—"}
              </td>
              <td className="py-2.5 pr-3 text-right tabular-nums">{formatInt(r.stats.total)}</td>
              <td className="py-2.5 pr-3 text-right tabular-nums">
                {r.stats.total > 0 ? formatPercent(r.stats.acceptanceRate) : "—"}
              </td>
              <td className="py-2.5 pr-3 text-right tabular-nums hidden md:table-cell">
                {r.stats.extraValueCents > 0 ? formatEur(r.stats.extraValueCents) : "—"}
              </td>
              <td className="py-2.5 pr-3 text-center">
                {r.active ? (
                  <Badge variant="success">Attiva</Badge>
                ) : (
                  <Badge variant="muted">Disattiva</Badge>
                )}
              </td>
              <td className="py-2.5 text-right">
                <div className="flex justify-end gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => toggleActive(r)}
                    disabled={isPending}
                    title={r.active ? "Disattiva" : "Attiva"}
                  >
                    <Power className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="ghost" asChild>
                    <Link href={`/admin/upsell/${r.id}`} title="Modifica">
                      <Pencil className="h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
