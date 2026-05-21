"use client";
/**
 * Refreshes the current server-rendered page on every realtime event so the
 * dashboard / customer card / shipment page always reflect the latest state.
 *
 * Plugs into the shared RealtimeProvider — no separate SSE connection.
 */
import { useRouter } from "next/navigation";
import { useRealtimeSubscribe } from "@/components/providers/RealtimeProvider";

export default function RealtimeRefresh() {
  const router = useRouter();
  useRealtimeSubscribe(() => {
    router.refresh();
  });
  return null;
}
