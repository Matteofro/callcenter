/**
 * /reports — supervisor/admin tool to download CSV exports.
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ExportForm } from "@/components/reports/ExportForm";
import { FileBarChart, Info } from "lucide-react";

export const dynamic = "force-dynamic";

export default function ReportsPage() {
  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <FileBarChart className="h-5 w-5" />
          Report
        </h1>
        <p className="text-sm text-muted-foreground">
          Esporta i dati operativi in CSV. Massimo 365 giorni per export.
        </p>
      </div>

      <ExportForm />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Info className="h-4 w-4" />
            Cosa contiene ogni export
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <Section
            title="Ordini"
            cols="Order ID · Ref · Data · Cliente · Telefono · Email · Stato · Pagamento · Totale · COD · Margine · Numero spedizioni · Numero righe"
          />
          <Section
            title="Chiamate"
            cols="Call ID · Inizio · Fine · Operatore · Cliente · Telefono · Ordine · Esito · Motivo · Durata · Richiamare il"
          />
          <Section
            title="Upsell"
            cols="ID · Data · SKU · Esito · Extra € · Ordine · Chiamata · Operatore · Note"
          />
          <Section
            title="Spedizioni"
            cols="Shipment ID · Tracking · Corriere · Stato · Spedito · Consegnato · ETA · Flag (ritardo/rifiuto/smarrito/reso) · Ordine · Cliente · Ultimo stato corriere"
          />
        </CardContent>
      </Card>
    </div>
  );
}

function Section({ title, cols }: { title: string; cols: string }) {
  return (
    <div>
      <div className="font-medium">{title}</div>
      <div className="text-xs text-muted-foreground">{cols}</div>
    </div>
  );
}
