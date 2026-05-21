"use client";
import { useRealtimeStatus } from "@/components/providers/RealtimeProvider";
import { cn } from "@/lib/utils";

export function ConnectionStatus() {
  const status = useRealtimeStatus();

  const meta = {
    connected: { label: "Realtime", color: "bg-success" },
    polling: { label: "Polling", color: "bg-warning" },
    connecting: { label: "Connessione…", color: "bg-muted-foreground" },
    reconnecting: { label: "Riconnessione…", color: "bg-warning" },
    stopped: { label: "Offline", color: "bg-destructive" },
  }[status];

  return (
    <div className="hidden md:flex items-center gap-2 text-xs text-muted-foreground">
      <span className={cn("inline-block h-2 w-2 rounded-full", meta.color)} />
      <span>{meta.label}</span>
    </div>
  );
}
