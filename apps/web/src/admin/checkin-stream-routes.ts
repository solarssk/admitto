import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { subscribe, type SseEvent } from "./sse-channel.js";

const HEARTBEAT_MS = 25_000;

/** GET /api/checkin/events/:eventId/stream — live check-in SSE feed. */
export function handleEventStream(c: Context): Response {
  const eventId = c.req.param("eventId");
  if (!eventId) {
    return c.json({ error: "eventId required" }, 400);
  }

  return streamSSE(c, async (stream) => {
    c.header("Cache-Control", "no-cache");
    c.header("X-Accel-Buffering", "no");

    const writeEvent = async (event: SseEvent) => {
      await stream.writeSSE({
        data: JSON.stringify(event),
      });
    };

    const unsubscribe = subscribe(eventId, (event) => {
      void writeEvent(event);
    });

    const heartbeat = setInterval(() => {
      void writeEvent({ type: "ping" });
    }, HEARTBEAT_MS);

    stream.onAbort(() => {
      clearInterval(heartbeat);
      unsubscribe();
    });

    await writeEvent({ type: "ping" });

    // Keep connection open until client disconnects.
    await new Promise<void>((resolve) => {
      stream.onAbort(() => resolve());
    });
  });
}

export { HEARTBEAT_MS };
