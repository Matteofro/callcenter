"use client";
/**
 * The action card on the customer page. Lets the operator:
 *   - Start a new call (POST /api/calls)
 *   - Change the status of an existing active call (PATCH /api/calls/:id/status)
 *   - Add a note (POST /api/calls/:id/notes)
 *
 * All mutations call router.refresh() on success so the timeline updates
 * without a full reload.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiFetch } from "@/lib/client/api";
import { callStatusLabel } from "@/lib/i18n/labels";
import type { CallStatus } from "@prisma/client";
import { PhoneCall, Save, MessageSquarePlus } from "lucide-react";

type ActiveCall = {
  id: string;
  status: CallStatus;
  outcomeReason: string | null;
  startedAt: string | null;
} | null;

interface Props {
  customerId: string;
  orderIds: Array<{ id: string; externalRef: string }>;
  activeCall: ActiveCall;
}

const STATUS_OPTIONS: CallStatus[] = [
  "ANSWERED",
  "NO_ANSWER",
  "WRONG_NUMBER",
  "BUSY",
  "CALL_LATER",
  "CALLBACK_SCHEDULED",
  "ORDER_CONFIRMED",
  "ORDER_CANCELLED",
  "RETURN_REQUESTED",
  "REFUND_REQUESTED",
  "SHIPPING_ISSUE",
  "UPSELL_DONE",
  "CROSSSELL_DONE",
  "NOT_INTERESTED",
  "COMPLAINT_OPENED",
  "CASE_RESOLVED",
];

export function CallPanel({ customerId, orderIds, activeCall }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [orderId, setOrderId] = useState<string>(orderIds[0]?.id ?? "");
  const [status, setStatus] = useState<CallStatus | "">(activeCall?.status ?? "");
  const [reason, setReason] = useState(activeCall?.outcomeReason ?? "");
  const [note, setNote] = useState("");

  async function startCall() {
    const r = await apiFetch<{ id: string }>("/api/calls", {
      method: "POST",
      body: JSON.stringify({ customerId, orderId: orderId || undefined }),
    });
    if (!r.ok) return toast.error(r.error.message);
    toast.success("Chiamata aperta.");
    startTransition(() => router.refresh());
  }

  async function updateStatus() {
    if (!activeCall || !status) return;
    const r = await apiFetch(`/api/calls/${activeCall.id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status, outcomeReason: reason || undefined }),
    });
    if (!r.ok) return toast.error(r.error.message);
    toast.success("Esito salvato.");
    startTransition(() => router.refresh());
  }

  async function addNote() {
    if (!activeCall || !note.trim()) return;
    const r = await apiFetch(`/api/calls/${activeCall.id}/notes`, {
      method: "POST",
      body: JSON.stringify({ body: note.trim() }),
    });
    if (!r.ok) return toast.error(r.error.message);
    toast.success("Nota aggiunta.");
    setNote("");
    startTransition(() => router.refresh());
  }

  if (!activeCall) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PhoneCall className="h-4 w-4" />
            Chiamata
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {orderIds.length > 0 && (
            <div className="space-y-1.5">
              <Label>Ordine collegato</Label>
              <Select value={orderId} onValueChange={setOrderId}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleziona…" />
                </SelectTrigger>
                <SelectContent>
                  {orderIds.map((o) => (
                    <SelectItem key={o.id} value={o.id}>{o.externalRef}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <Button onClick={startCall} disabled={isPending} className="w-full">
            <PhoneCall className="h-4 w-4" /> Apri chiamata
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PhoneCall className="h-4 w-4 text-success" />
          Chiamata attiva
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label>Esito</Label>
          <Select value={status} onValueChange={(v) => setStatus(v as CallStatus)}>
            <SelectTrigger>
              <SelectValue placeholder="Seleziona esito…" />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((s) => (
                <SelectItem key={s} value={s}>{callStatusLabel[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Motivo (opzionale)</Label>
          <Textarea
            placeholder="Dettaglio dell'esito…"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
          />
        </div>

        <Button onClick={updateStatus} disabled={!status || isPending} className="w-full">
          <Save className="h-4 w-4" /> Salva esito
        </Button>

        <div className="border-t pt-4 space-y-1.5">
          <Label>Nota chiamata</Label>
          <Textarea
            placeholder="Scrivi una nota…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
          />
          <Button onClick={addNote} disabled={!note.trim() || isPending} variant="secondary" className="w-full">
            <MessageSquarePlus className="h-4 w-4" /> Aggiungi nota
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
