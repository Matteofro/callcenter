/**
 * GET /api/realtime/stream
 *
 * Server-Sent Events endpoint. The client opens this once; the server keeps
 * the connection open and pushes a `data: <json>\n\n` frame for every event
 * published on the in-memory bus.
 *
 * Format:
 *   event: <realtime-event-type>
 *   id: <uuid>
 *   data: <json>
 *
 * The client uses native EventSource. Reconnect is automatic — on reconnect
 * the client also runs /api/realtime/poll?since=<ts> to catch up on anything
 * missed during the gap.
 *
 * IMPORTANT: this route MUST run on the Node.js runtime. SSE doesn't work
 * on Edge runtime because of the streaming response semantics.
 */
import { requireSession } from "@/lib/auth";
import { subscribe } from "@/lib/pubsub";
import { logger } from "@/lib/logger";
import type { RealtimeEvent } from "@/types/realtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Long-lived stream — capped at 800s, the Vercel Pro max. The EventSource
// client reconnects transparently when the stream ends.
export const maxDuration = 800;

const HEARTBEAT_MS = 15_000;

export async function GET(): Promise<Response> {
  // Auth gate: only authenticated operators can subscribe.
  await requireSession();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();

      const send = (event: RealtimeEvent) => {
        try {
          const chunk =
            `event: ${event.type}\n` +
            `id: ${event.id}\n` +
            `data: ${JSON.stringify(event)}\n\n`;
          controller.enqueue(encoder.encode(chunk));
        } catch (e) {
          logger.warn({ err: String(e) }, "SSE send failed; closing stream");
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
      };

      // Initial hello — useful so the client knows the stream is live.
      controller.enqueue(encoder.encode(`: connected ${new Date().toISOString()}\n\n`));

      const unsubscribe = subscribe(send);

      // Heartbeat keeps proxies from idling the connection out.
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`));
        } catch {
          clearInterval(heartbeat);
          unsubscribe();
        }
      }, HEARTBEAT_MS);

      // No `cancel` signal here because in Web Streams the controller doesn't
      // expose abort; the underlying request abort will trigger this stream's
      // cancel() below.
      (controller as unknown as { __cleanup?: () => void }).__cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
      };
    },
    cancel(reason) {
      logger.info({ reason: String(reason ?? "client-disconnect") }, "SSE stream cancelled");
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
