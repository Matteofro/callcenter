"use client";
/**
 * Realtime subscriber hook.
 *
 * Behaviour:
 *   - Opens an EventSource to /api/realtime/stream.
 *   - On any event, calls `onEvent(event)`.
 *   - On error / disconnect: closes the stream, switches to 20s polling on
 *     /api/realtime/poll?since=<latestKnown>, and attempts to reopen SSE with
 *     exponential backoff (1s, 2s, 4s, 8s, capped at 30s).
 *   - Returns the current `status` ("connected" | "polling" | "reconnecting").
 *
 * The hook is safe to mount multiple times in a tree, but typically you
 * mount it once in a top-level provider and broadcast via context or a
 * shared store. For the MVP we keep it lightweight: components that need
 * realtime can call it directly with their own handler.
 */
import { useEffect, useRef, useState } from "react";
import type { RealtimeEvent } from "@/types/realtime";

export type RealtimeStatus = "connecting" | "connected" | "polling" | "reconnecting" | "stopped";

export interface UseRealtimeOptions {
  onEvent: (event: RealtimeEvent) => void;
  /** Filter to skip events the consumer doesn't care about (called before onEvent). */
  filter?: (event: RealtimeEvent) => boolean;
  /** Disable the hook entirely (e.g. while a modal is closed). */
  enabled?: boolean;
}

const POLL_INTERVAL_MS = 20_000;
const MAX_BACKOFF_MS = 30_000;

export function useRealtime({ onEvent, filter, enabled = true }: UseRealtimeOptions): RealtimeStatus {
  const [status, setStatus] = useState<RealtimeStatus>("connecting");
  const lastTimestampRef = useRef<string>(new Date().toISOString());
  const onEventRef = useRef(onEvent);
  const filterRef = useRef(filter);

  useEffect(() => {
    onEventRef.current = onEvent;
    filterRef.current = filter;
  }, [onEvent, filter]);

  useEffect(() => {
    if (!enabled) {
      setStatus("stopped");
      return;
    }

    let es: EventSource | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let backoffMs = 1_000;
    let cancelled = false;

    const dispatch = (event: RealtimeEvent) => {
      if (filterRef.current && !filterRef.current(event)) return;
      onEventRef.current(event);
    };

    const stopPolling = () => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };

    const poll = async () => {
      try {
        const url = `/api/realtime/poll?since=${encodeURIComponent(lastTimestampRef.current)}`;
        const res = await fetch(url, { cache: "no-store" });
        const json = (await res.json()) as
          | { ok: true; data: { events: RealtimeEvent[]; latestServerTimestamp: string } }
          | { ok: false };
        if (json.ok) {
          json.data.events.forEach(dispatch);
          lastTimestampRef.current = json.data.latestServerTimestamp;
        }
      } catch {
        // swallow — we'll retry on next interval
      }
    };

    const startPolling = () => {
      stopPolling();
      setStatus("polling");
      // immediate fetch then on interval
      void poll();
      pollTimer = setInterval(poll, POLL_INTERVAL_MS);
    };

    const open = () => {
      setStatus("connecting");
      try {
        es = new EventSource("/api/realtime/stream");
      } catch {
        scheduleReconnect();
        return;
      }

      es.onopen = () => {
        if (cancelled) return;
        backoffMs = 1_000;
        stopPolling();
        setStatus("connected");
      };

      const handler = (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data) as RealtimeEvent;
          lastTimestampRef.current = data.publishedAt;
          dispatch(data);
        } catch {
          // ignore malformed
        }
      };

      // Listen on the named event types. EventSource needs explicit listeners
      // per `event:` name.
      const named: ReadonlyArray<RealtimeEvent["type"]> = [
        "customer.updated",
        "order.updated",
        "shipment.updated",
        "call.updated",
        "upsell.created",
        "logistics.issue",
      ];
      named.forEach((n) => es?.addEventListener(n, handler));

      es.onerror = () => {
        if (cancelled) return;
        es?.close();
        es = null;
        startPolling();
        scheduleReconnect();
      };
    };

    const scheduleReconnect = () => {
      setStatus("reconnecting");
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => {
        if (cancelled) return;
        open();
      }, backoffMs);
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
    };

    open();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      stopPolling();
      es?.close();
    };
  }, [enabled]);

  return status;
}
