import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { releaseCheckinStreamSlot } from "../checkin-stream-limit.js";
import { subscribe, type SseEvent } from "./sse-channel.js";

const HEARTBEAT_MS = 25_000;

/**
 * GET /api/checkin/events/:eventId/stream - live check-in SSE feed.
 *
 * `stillAuthorized` is asked on every heartbeat; when it answers false (the session was revoked,
 * the operator lost access to the event, the event was archived) the stream is closed, so the
 * connect-time authorization is not the only one a long-lived stream ever gets.
 */
export function handleEventStream(c: Context, stillAuthorized?: () => Promise<boolean>): Response {
  const eventId = c.req.param("eventId");
  if (!eventId) {
    releaseCheckinStreamSlot(c);
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

    let heartbeat: ReturnType<typeof setInterval> | undefined;

    const cleanup = () => {
      clearInterval(heartbeat);
      unsubscribe();
      releaseCheckinStreamSlot(c);
    };

    await new Promise<void>((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        cleanup();
        resolve();
      };

      heartbeat = setInterval(() => {
        void (async () => {
          if (stillAuthorized && !(await stillAuthorized())) {
            finish();
            return;
          }
          await writeEvent({ type: "ping" });
        })();
      }, HEARTBEAT_MS);

      stream.onAbort(finish);

      if (stream.aborted) {
        finish();
        return;
      }

      void writeEvent({ type: "ping" });
    });
  });
}

export { HEARTBEAT_MS };
