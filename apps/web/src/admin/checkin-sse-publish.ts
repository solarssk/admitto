import type { Context } from "hono";
import type { AdmitResult } from "@admitto/tickets";
import { publish } from "./sse-channel.js";

/** Publish SSE check-in event after a successful VALID admit. Failures are non-fatal. */
export function publishCheckinIfValid(
  c: Context,
  eventId: string,
  result: AdmitResult,
  deviceLabel?: string | null,
): void {
  if (result.status !== "VALID") return;

  try {
    const operatorId = (c.get("operatorUserId") as string | undefined) ?? null;

    publish(eventId, {
      type: "checkin",
      attendeeId: result.card.id,
      attendeeName: result.card.name,
      ticketType: result.card.ticket_type,
      admittedAt: result.admittedAt.toISOString(),
      operatorId,
      deviceLabel: deviceLabel ?? null,
    });
  } catch (err) {
    console.error("SSE publish failed (non-fatal):", err);
  }
}

/** Publish a lightweight "something changed" SSE signal after an attendee-add or item
 * issue/return/revoke write. No payload: the client just refetches the overview. */
export function publishActivityChanged(eventId: string): void {
  try {
    publish(eventId, { type: "activity_changed" });
  } catch (err) {
    console.error("SSE publish failed (non-fatal):", err);
  }
}
