"use client";
/**
 * Export form: pick entity + date range, see a row-count preview, then
 * download the CSV.
 *
 * The download itself is a plain navigation to the streamed endpoint so the
 * browser handles the file save dialog natively (and a long stream doesn't
 * tie up an XHR).
 */
import { useState, useEffect, useTransition } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiFetch } from "@/lib/client/api";
import { formatInt } from "@/lib/i18n/format";
import { Download, RefreshCcw } from "lucide-react";

type Entity = "orders" | "calls" | "upsells" | "shipments";

const ENTITY_LABELS: Record<Entity, string> = {
  orders: "Ordini",
  calls: "Chiamate",
  upsells: "Upsell",
  shipments: "Spedizioni",
};

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const DEFAULT_TO = new Date();
const DEFAULT_FROM = new Date(DEFAULT_TO.getTime() - 30 * 86_400_000);

export function ExportForm() {
  const [entity, setEntity] = useState<Entity>("orders");
  const [from, setFrom] = useState(toIsoDate(DEFAULT_FROM));
  const [to, setTo] = useState(toIsoDate(DEFAULT_TO));
  const [count, setCount] = useState<number | null>(null);
  const [previewing, startPreview] = useTransition();

  const buildQuery = () =>
    `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

  function refreshPreview() {
    startPreview(async () => {
      setCount(null);
      const r = await apiFetch<{ count: number }>(
        `/api/reports/preview?entity=${entity}&${buildQuery()}`,
      );
      if (!r.ok) {
        toast.error(r.error.message);
        return;
      }
      setCount(r.data.count);
    });
  }

  // Auto-preview on mount and whenever entity/range changes
  useEffect(() => {
    refreshPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity, from, to]);

  function download() {
    if (count === 0) {
      toast.warning("Nessun dato nell'intervallo selezionato.");
      return;
    }
    const url = `/api/reports/${entity}?${buildQuery()}`;
    window.location.href = url;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Configura export</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Cosa esportare</Label>
            <Select value={entity} onValueChange={(v) => setEntity(v as Entity)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(ENTITY_LABELS) as Entity[]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {ENTITY_LABELS[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div />
          <div className="space-y-1.5">
            <Label htmlFor="from">Da</Label>
            <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="to">A</Label>
            <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <div className="text-sm">
            <span className="text-muted-foreground">Righe stimate:</span>{" "}
            {previewing ? (
              <Badge variant="muted">conteggio…</Badge>
            ) : count == null ? (
              <Badge variant="muted">—</Badge>
            ) : (
              <Badge variant="secondary">{formatInt(count)}</Badge>
            )}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={refreshPreview}
            disabled={previewing}
            aria-label="Ricalcola anteprima"
          >
            <RefreshCcw className="h-4 w-4" />
          </Button>
          <div className="ml-auto">
            <Button onClick={download} disabled={previewing || count === 0}>
              <Download className="h-4 w-4" /> Scarica CSV
            </Button>
          </div>
        </div>

        <p className="mt-4 text-xs text-muted-foreground">
          Il file viene generato in streaming: anche con decine di migliaia di righe
          il server non carica tutto in memoria. Codifica UTF-8 con BOM per Excel.
        </p>
      </CardContent>
    </Card>
  );
}
