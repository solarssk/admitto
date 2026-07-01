import type { Context } from "hono";
import type { PrismaClient } from "@prisma/client";
import type { AdmitResult } from "@admitto/tickets";
import { publish } from "./sse-channel.js";

/** Publish SSE check-in event after a successful VALID admit. */
export async function publishCheckinIfValid(
  c: Context,
  db: PrismaClient,
  eventId: string,
  result: AdmitResult,
): Promise<void> {
  if (result.status !== "VALID") return;

  const operatorId = (c.get("operatorUserId") as string | undefined) ?? null;
  let deviceLabel: string | null = null;

  const sessionId = c.get("checkinSessionId") as string | undefined;
  if (sessionId) {
    const session = await db.session.findUnique({
      where: { id: sessionId },
      select: { device_label: true },
    });
    deviceLabel = session?.device_label ?? null;
  }

  publish(eventId, {
    type: "checkin",
    attendeeId: result.card.id,
    attendeeName: result.card.name,
    ticketType: result.card.ticket_type,
    admittedAt: result.admittedAt.toISOString(),
    operatorId,
    deviceLabel,
  });
}
