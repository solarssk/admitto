import type { MailerProvider, SendResult } from "./types.js";
import { emitSystemLog } from "@admitto/shared/system-log";

export function rejectedSendResult(
  provider: MailerProvider,
  error: string,
  idempotencyKey?: string,
): SendResult {
  return {
    status: "rejected",
    provider,
    retryable: false,
    error,
    idempotencyKey,
  };
}

/** Successful sends are the routine, high-volume case - a single bulk send can be hundreds of
 * attendees - unlike mail_send_failed (always logged unthrottled below; rare and operationally
 * important), logging every success into the shared 1000-entry System-logs buffer would flood
 * it during exactly the moment (a mass send) other sources like Security/Admin are also most
 * likely to have something worth seeing (external review on PR #593). Throttled the same way
 * the rate limiter's Redis fail-open warning already is: at most one mail_sent entry pushed into
 * the buffer per window, still confirming sends are succeeding without drowning out everything
 * else. stdout still gets every single line unthrottled (via emitSystemLog's own console write) -
 * this only throttles the shared live-tail buffer, not the container's durable log. */
const MAIL_SENT_BUFFER_THROTTLE_MS = 60_000;
let lastMailSentBufferedAt = 0;

/** Log a successful send: always to stdout, throttled into the System-logs buffer. */
export function logMailSent(provider: MailerProvider, to: string): void {
  const now = Date.now();
  if (now - lastMailSentBufferedAt >= MAIL_SENT_BUFFER_THROTTLE_MS) {
    emitSystemLog("mail", "info", "mail_sent", { provider, to });
    lastMailSentBufferedAt = now;
    return;
  }
  // Stdout still gets this line (matches emitSystemLog's own JSON shape) - only the buffer push
  // above is throttled, so a full record of every send still reaches docker logs / SIEM.
  console.info(JSON.stringify({ level: "info", msg: "mail_sent", ts: new Date().toISOString(), provider, to }));
}

/** @internal test-only - resets the mail_sent buffer throttle between test cases, since this
 * module's state is a process-wide singleton shared across an entire test file (same class of
 * gotcha as @admitto/shared/system-log's own resetSystemLogBufferForTest). */
export function resetMailSentThrottleForTest(): void {
  lastMailSentBufferedAt = 0;
}
