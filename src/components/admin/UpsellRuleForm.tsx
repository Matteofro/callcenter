"use client";
/**
 * Create / edit form for an UpsellSuggestion.
 *
 * Same form is used in both /admin/upsell/new and /admin/upsell/[id], driven
 * by the `mode` prop. On save it routes back to the list.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiFetch } from "@/lib/client/api";
import { upsellKindLabel } from "@/lib/i18n/labels";
import type { UpsellKind } from "@prisma/client";
import { Save, Trash2 } from "lucide-react";

const KIND_OPTIONS: UpsellKind[] = ["RELATED", "BUNDLE", "COMPLEMENT", "UPGRADE"];

export interface UpsellRuleFormProps {
  mode: "create" | "edit";
  initial?: {
    id: string;
    triggerSku: string;
    suggestSku: string;
    kind: UpsellKind;
    priority: number;
    discountCents: number;
    active: boolean;
    notes: string | null;
  };
}

export function UpsellRuleForm({ mode, initial }: UpsellRuleFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [triggerSku, setTriggerSku] = useState(initial?.triggerSku ?? "");
  const [suggestSku, setSuggestSku] = useState(initial?.suggestSku ?? "");
  const [kind, setKind] = useState<UpsellKind>(initial?.kind ?? "RELATED");
  const [priority, setPriority] = useState(String(initial?.priority ?? 0));
  const [discountEur, setDiscountEur] = useState(
    initial ? (initial.discountCents / 100).toFixed(2).replace(".", ",") : "",
  );
  const [active, setActive] = useState(initial?.active ?? true);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const discountCents = Math.round((Number(discountEur.replace(",", ".")) || 0) * 100);
    const body = {
      triggerSku: triggerSku.trim(),
      suggestSku: suggestSku.trim(),
      kind,
      priority: Number(priority) || 0,
      discountCents,
      active,
      notes: notes.trim() || null,
    };

    const r =
      mode === "create"
        ? await apiFetch("/api/admin/upsell-suggestions", {
            method: "POST",
            body: JSON.stringify(body),
          })
        : await apiFetch(`/api/admin/upsell-suggestions/${initial!.id}`, {
            method: "PATCH",
            body: JSON.stringify(body),
          });

    setSaving(false);
    if (!r.ok) return toast.error(r.error.message);
    toast.success(mode === "create" ? "Regola creata." : "Regola aggiornata.");
    startTransition(() => {
      router.push("/admin/upsell");
      router.refresh();
    });
  }

  async function remove() {
    if (!initial) return;
    if (!confirm("Eliminare definitivamente questa regola? Le statistiche storiche restano.")) return;
    const r = await apiFetch(`/api/admin/upsell-suggestions/${initial.id}`, { method: "DELETE" });
    if (!r.ok) return toast.error(r.error.message);
    toast.success("Regola eliminata.");
    startTransition(() => {
      router.push("/admin/upsell");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{mode === "create" ? "Nuova regola upsell" : "Modifica regola"}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="triggerSku">SKU trigger</Label>
              <Input
                id="triggerSku"
                value={triggerSku}
                onChange={(e) => setTriggerSku(e.target.value)}
                placeholder="HYD-CR-001"
                required
              />
              <p className="text-xs text-muted-foreground">
                Quando un ordine contiene questo SKU, viene suggerito quello sotto.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="suggestSku">SKU consigliato</Label>
              <Input
                id="suggestSku"
                value={suggestSku}
                onChange={(e) => setSuggestSku(e.target.value)}
                placeholder="HYD-CR-002"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as UpsellKind)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KIND_OPTIONS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {upsellKindLabel[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="priority">Priorità (0-100)</Label>
              <Input
                id="priority"
                type="number"
                min={0}
                max={100}
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Più alto = mostrato per primo all'operatore.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="discount">Sconto (€)</Label>
              <Input
                id="discount"
                type="text"
                inputMode="decimal"
                placeholder="0,00"
                value={discountEur}
                onChange={(e) => setDiscountEur(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Stato</Label>
              <div className="flex h-11 items-center gap-3 rounded-md border px-3">
                <input
                  type="checkbox"
                  id="active"
                  checked={active}
                  onChange={(e) => setActive(e.target.checked)}
                  className="h-4 w-4"
                />
                <Label htmlFor="active" className="cursor-pointer">
                  Regola attiva
                </Label>
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes">Note (opzionale)</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Quando applicare questa regola, esempi…"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-2">
            <Button type="submit" disabled={saving || isPending}>
              <Save className="h-4 w-4" /> Salva
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => router.push("/admin/upsell")}
              disabled={saving || isPending}
            >
              Annulla
            </Button>
            {mode === "edit" && (
              <Button
                type="button"
                variant="destructive"
                className="ml-auto"
                onClick={remove}
                disabled={saving || isPending}
              >
                <Trash2 className="h-4 w-4" /> Elimina
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
