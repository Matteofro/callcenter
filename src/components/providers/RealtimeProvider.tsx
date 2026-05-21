"use client";
/**
 * One single SSE subscription per session. Exposes:
 *   - the current connection `status` (for the indicator pill)
 *   - a `subscribe(handler)` function any descendant can use to react to events
 *
 * This lets the dashboard mount the SSE channel once and lets multiple
 * consumers (status pill, page refresher, future toasts) plug in.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { useRealtime, type RealtimeStatus } from "@/lib/client/useRealtime";
import type { RealtimeEvent } from "@/types/realtime";

type Handler = (event: RealtimeEvent) => void;

interface RealtimeContextValue {
  status: RealtimeStatus;
  subscribe: (handler: Handler) => () => void;
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const handlersRef = useRef<Set<Handler>>(new Set());

  const onEvent = useCallback((event: RealtimeEvent) => {
    handlersRef.current.forEach((h) => {
      try {
        h(event);
      } catch {
        // ignore individual handler errors
      }
    });
  }, []);

  const status = useRealtime({ onEvent });

  const subscribe = useCallback((handler: Handler) => {
    handlersRef.current.add(handler);
    return () => {
      handlersRef.current.delete(handler);
    };
  }, []);

  const value = useMemo<RealtimeContextValue>(() => ({ status, subscribe }), [status, subscribe]);

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtimeStatus(): RealtimeStatus {
  const ctx = useContext(RealtimeContext);
  return ctx?.status ?? "stopped";
}

export function useRealtimeSubscribe(handler: Handler, deps: React.DependencyList = []): void {
  const ctx = useContext(RealtimeContext);
  // Keep the handler ref fresh so consumers don't need to memoize.
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    if (!ctx) return;
    return ctx.subscribe((e) => ref.current(e));
  }, [ctx]);
}
