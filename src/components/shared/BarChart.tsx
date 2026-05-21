"use client";
/**
 * Minimal CSS-only bar chart.
 *
 * No external chart library — for the MVP we don't need axis ticks, tooltips,
 * or animations beyond CSS transitions. Each bar is a flex column with two
 * stacked sub-bars (total + a darker overlay for the converted segment).
 *
 * Hovering a bar shows a tooltip with the bucket label + raw counts.
 */
import { cn } from "@/lib/utils";

export interface BarChartDatum {
  label: string;
  /** Top bar value */
  total: number;
  /** Optional secondary value drawn as an overlay (e.g. conversions) */
  highlight?: number;
  /** Tooltip text shown on hover */
  tooltip?: string;
}

export function BarChart({
  data,
  height = 140,
  highlightLabel = "Convertiti",
  emptyMessage = "Nessun dato.",
}: {
  data: BarChartDatum[];
  height?: number;
  highlightLabel?: string;
  emptyMessage?: string;
}) {
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyMessage}</p>;
  }
  const max = Math.max(1, ...data.map((d) => d.total));

  return (
    <div className="space-y-2">
      <div className="flex items-end gap-1" style={{ height }}>
        {data.map((d, i) => {
          const totalPct = (d.total / max) * 100;
          const hiPct = d.highlight != null ? (d.highlight / max) * 100 : 0;
          return (
            <div key={i} className="group relative flex-1 flex flex-col justify-end" title={d.tooltip ?? d.label}>
              <div
                className={cn(
                  "w-full rounded-sm bg-primary/20 transition-colors",
                  d.total === 0 && "bg-muted",
                )}
                style={{ height: `${totalPct}%` }}
              >
                {d.highlight != null && (
                  <div
                    className="w-full rounded-sm bg-primary"
                    style={{ height: `${(hiPct / Math.max(1, totalPct)) * 100}%`, marginTop: "auto" }}
                  />
                )}
              </div>
              <div className="invisible absolute -top-10 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded bg-foreground px-2 py-1 text-xs text-background group-hover:visible">
                {d.label}: {d.total}
                {d.highlight != null && ` · ${highlightLabel}: ${d.highlight}`}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-sm bg-primary/20" /> Totale
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-sm bg-primary" /> {highlightLabel}
        </span>
      </div>
    </div>
  );
}
