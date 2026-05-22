/**
 * In-memory pub/sub bus for realtime events.
 *
 * ⚠️  MVP-ONLY caveat: this works only inside a single Node process. On Vercel
 * serverless or multi-instance deployments, events published in instance A
 * are NOT seen by SSE subscribers attached to instance B. Replace with
 * Redis/Upstash pub/sub when we go multi-instance. Documented in ASSUMPTIONS.md.
 *
 * Until then, polling fallback (/api/realtime/poll) ensures correctness:
 * clients periodically read the AuditLog/LogisticsEvent tail and catch up.
 */
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { RealtimeEvent } from "@/types/realtime";

const globalForBus = globalThis as unknown as { __callcenterBus?: EventEmitter };

const bus: EventEmitter =
  globalForBus.__callcenterBus ??
  (() => {
    const e = new EventEmitter();
    e.setMaxListeners(0); // SSE subscriber count is bounded by operator count, but be generous
    globalForBus.__callcenterBus = e;
    return e;
  })();

const CHANNEL = "realtime";

/** Distributive Omit: applies Omit to each member of the union separately,
 *  so discriminated variants keep their narrowed extra fields. Without this,
 *  Omit<RealtimeEvent, "id"> collapses to a base shape and TS rejects per-
 *  variant fields like `deliveryStatus`, `issue`, `status`, `outcome`. */
type DistributiveOmit<T, K extends keyof RealtimeEvent> = T extends RealtimeEvent
  ? Omit<T, K>
  : never;

export type RealtimeEventInput = DistributiveOmit<RealtimeEvent, "id" | "publishedAt">;

export function publish(event: RealtimeEventInput): void {
  const enriched: RealtimeEvent = {
    ...event,
    id: randomUUID(),
    publishedAt: new Date().toISOString(),
  } as RealtimeEvent;
  bus.emit(CHANNEL, enriched);
}

export function subscribe(handler: (event: RealtimeEvent) => void): () => void {
  bus.on(CHANNEL, handler);
  return () => bus.off(CHANNEL, handler);
}
