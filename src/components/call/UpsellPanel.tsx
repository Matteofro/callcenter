"use client";
/**
 * Upsell suggestions for the active call. Fetches /api/upsell/suggestions
 * for the linked order and lets the operator log Accepted/Rejected/Deferred.
 */
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { apiFetch } from "@/lib/client/api";
import { upsellKindLabel } from "@/lib/i18n/labels";
import type { UpsellKind, UpsellOutcomeStatus } from "@prisma/client";
import { TrendingUp, Check, X, Clock } from "lucide-react";
import { formatEur } from "@/lib/i18n/format";

type Suggestion = {
  id: string;
  triggerSku: string;
  suggestSku: string;
  kind: UpsellKind;
  priority: number;
  discountCents: number;
};

export function UpsellPanel({ callId, orderId }: { callId: string; orderId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [extra, setExtra] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await apiFetch<{ suggestions: Suggestion[] }>(
        `/api/upsell/suggestions?orderId=${orderId}`,
      );
      if (!cancelled && r.ok) setSuggestions(r.data.suggestions);
    })();
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  async function record(sku: string, outcome: UpsellOutcomeStatus) {
    const extraEur = Number((extra[sku] ?? "0").replace(",", "."));
    const extraValueCents = outcome === "ACCEPTED" ? Math.round((Number.isFinite(extraEur) ? extraEur : 0) * 100) : 0;
    const r = await apiFetch("/api/upsell/outcome", {
      method: "POST",
      body: JSON.stringify({
        callId,
        orderId,
        suggestedSku: sku,
        outcome,
        extraValueCents,
      }),
    });
    if (!r.ok) return toast.error(r.error.message);
    toast.success("Esito upsell registrato.");
    startTransition(() => router.refresh());
  }

  if (suggestions.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Upsell consigliati
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Nessun suggerimento per questo ordine.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4" />
          Upsell consigliati
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {suggestions.map((s) => (
          <div key={s.id} className="rounded-md border p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="font-mono text-sm">{s.suggestSku}</div>
                <div className="mt-1 flex items-center gap-2">
                  <Badge variant="outline">{upsellKindLabel[s.kind]}</Badge>
                  {s.discountCents > 0 && <Badge variant="warning">-{formatEur(s.discountCents)}</Badge>}
                </div>
              </div>
            </div>
            <div className="mt-2 grid grid-cols-[1fr_auto] gap-2 items-end">
              <div className="space-y-1">
                <Label className="text-xs">Valore extra (€)</Label>
                <Input
                  type="text"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={extra[s.suggestSku] ?? ""}
                  onChange={(e) => setExtra({ ...extra, [s.suggestSku]: e.target.value })}
                />
              </div>
            </div>
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="success" disabled={isPending} onClick={() => record(s.suggestSku, "ACCEPTED")}>
                <Check className="h-4 w-4" /> Accettato
              </Button>
              <Button size="sm" variant="outline" disabled={isPending} onClick={() => record(s.suggestSku, "REJECTED")}>
                <X className="h-4 w-4" /> Rifiutato
              </Button>
              <Button size="sm" variant="ghost" disabled={isPending} onClick={() => record(s.suggestSku, "DEFERRED")}>
                <Clock className="h-4 w-4" /> Rimandato
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
