import { Prisma } from "@admitto/db";
import type { PrismaClient } from "@admitto/db";
import { EMAIL_DELIVERY_SUCCESS_STATUSES } from "@admitto/db";

export interface FrozenMessage {
  to: string;
  subject: string;
  html: string;
}

export type ClaimResult =
  | { action: "send"; deliveryId: string; message: FrozenMessage }
  | { action: "skip"; reason: "already_sent" | "in_flight" }
  | { action: "retry_existing"; deliveryId: string; message: FrozenMessage };

export interface ClaimInitialInput {
  organizationId: string;
  eventId: string;
  attendeeId: string;
  batchId: string;
  templateId?: string;
  provider: string;
  recipientEmail: string;
  renderedSubject: string;
  renderedHtml: string;
  /** Triggering admin's IANA timezone at send time, when known. */
  timezone?: string;
  /** Triggering admin's user id and session id at send time, when known. */
  actorUserId?: string;
  sessionId?: string;
}

function frozenFromRow(row: {
  recipient_email: string | null;
  rendered_subject: string | null;
  rendered_html: string | null;
}): FrozenMessage {
  if (!row.recipient_email || !row.rendered_subject || !row.rendered_html) {
    throw new Error("Delivery row missing frozen message snapshot");
  }
  return {
    to: row.recipient_email,
    subject: row.rendered_subject,
    html: row.rendered_html,
  };
}

function deliveryCreateData(input: ClaimInitialInput, purpose: "initial" | "resend", now: Date) {
  return {
    organization_id: input.organizationId,
    event_id: input.eventId,
    attendee_id: input.attendeeId,
    purpose,
    batch_id: input.batchId,
    template_id: input.templateId,
    provider: input.provider,
    status: "queued" as const,
    attempts: 1,
    recipient_email: input.recipientEmail,
    rendered_subject: input.renderedSubject,
    rendered_html: input.renderedHtml,
    queued_at: now,
    client_timezone: input.timezone ?? null,
    actor_user_id: input.actorUserId ?? null,
    session_id: input.sessionId ?? null,
  };
}

type ClassifyResult =
  | { action: "skip"; reason: "already_sent" | "in_flight" }
  | { action: "retry_existing"; message: FrozenMessage };

function classifyExisting(row: {
  status: string;
  retryable: boolean | null;
  recipient_email: string | null;
  rendered_subject: string | null;
  rendered_html: string | null;
}): ClassifyResult {
  if (EMAIL_DELIVERY_SUCCESS_STATUSES.includes(row.status as (typeof EMAIL_DELIVERY_SUCCESS_STATUSES)[number])) {
    return { action: "skip", reason: "already_sent" };
  }
  if (row.status === "queued") {
    return { action: "skip", reason: "in_flight" };
  }
  if (row.status === "failed" && row.retryable) {
    return {
      action: "retry_existing",
      message: frozenFromRow(row),
    };
  }
  return { action: "skip", reason: "already_sent" };
}

/**
 * Atomically claim the initial delivery slot for (attendee, event).
 * Uses partial unique index on (attendee_id, event_id) WHERE purpose='initial'.
 */
export async function claimInitialDelivery(
  input: ClaimInitialInput,
  prisma: PrismaClient,
): Promise<ClaimResult> {
  const now = new Date();
  try {
    const created = await prisma.emailDelivery.create({
      data: deliveryCreateData(input, "initial", now),
    });
    return {
      action: "send",
      deliveryId: created.id,
      message: {
        to: input.recipientEmail,
        subject: input.renderedSubject,
        html: input.renderedHtml,
      },
    };
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) {
      throw err;
    }
  }

  const existing = await prisma.emailDelivery.findFirst({
    where: {
      attendee_id: input.attendeeId,
      event_id: input.eventId,
      purpose: "initial",
    },
  });
  if (!existing) {
    throw new Error("Unique constraint violated but initial delivery row not found");
  }

  const result = classifyExisting(existing);
  if (result.action === "retry_existing") {
    const claimed = await prisma.emailDelivery.updateMany({
      where: {
        id: existing.id,
        status: "failed",
        retryable: true,
      },
      data: {
        status: "queued",
        queued_at: new Date(),
        batch_id: input.batchId,
        client_timezone: input.timezone ?? null,
        actor_user_id: input.actorUserId ?? null,
        session_id: input.sessionId ?? null,
      },
    });
    if (claimed.count === 0) {
      const refreshed = await prisma.emailDelivery.findFirst({
        where: { id: existing.id },
      });
      if (!refreshed) {
        throw new Error("Retry claim lost but initial delivery row not found");
      }
      const lostRace = classifyExisting(refreshed);
      if (lostRace.action === "retry_existing") {
        return { action: "skip", reason: "in_flight" };
      }
      return lostRace;
    }
    return {
      action: "retry_existing",
      deliveryId: existing.id,
      message: result.message,
    };
  }
  return result;
}

/** Create a resend delivery row (no partial unique — each resend is a new row). */
export async function createResendDelivery(
  input: ClaimInitialInput,
  prisma: PrismaClient,
): Promise<{ deliveryId: string; message: FrozenMessage }> {
  const now = new Date();
  const created = await prisma.emailDelivery.create({
    data: deliveryCreateData(input, "resend", now),
  });
  return {
    deliveryId: created.id,
    message: {
      to: input.recipientEmail,
      subject: input.renderedSubject,
      html: input.renderedHtml,
    },
  };
}
