import { Prisma, type PrismaClient, EMAIL_DELIVERY_SUCCESS_STATUSES } from "@admitto/db";

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
  /** The resolved template's label, snapshotted onto EmailDelivery.template_label_snapshot so a
   * later template deletion (SetNull on template_id) doesn't erase what it was called. */
  templateLabel?: string;
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
    template_label_snapshot: input.templateLabel ?? null,
    provider: input.provider,
    status: "queued" as const,
    attempts: 1,
    recipient_email: input.recipientEmail.toLowerCase(),
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
  | { action: "retry_existing"; message: FrozenMessage }
  // Unlike retry_existing (transient transport failure, moments/hours old - resend the exact
  // same frozen content), a cancelled row can be arbitrarily old: the operator stopped a batch,
  // then later ran a fresh "Not yet emailed"/"Send unsent tickets" pass, possibly against a
  // different template or updated attendee data. No frozen message here on purpose - the caller
  // re-freezes from the new request instead of resurrecting stale content.
  | { action: "reclaim_cancelled" };

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
  if (row.status === "cancelled") {
    return { action: "reclaim_cancelled" };
  }
  return { action: "skip", reason: "already_sent" };
}

/**
 * Shared loser's-side handling for both retry_existing and reclaim_cancelled: another
 * request's guarded updateMany won the race on this exact row first. Anything other than a
 * plain "skip" here means that concurrent request is itself mid-way through retrying/
 * reclaiming this row (classifyExisting no longer sees "failed"/"cancelled" because it
 * already flipped the row to "queued") - report in-flight rather than recursing into the
 * same race.
 */
async function resolveLostRace(
  prisma: PrismaClient,
  deliveryId: string,
  notFoundMessage: string,
): Promise<ClaimResult> {
  const refreshed = await prisma.emailDelivery.findFirst({ where: { id: deliveryId } });
  if (!refreshed) {
    throw new Error(notFoundMessage);
  }
  const lostRace = classifyExisting(refreshed);
  if (lostRace.action !== "skip") {
    return { action: "skip", reason: "in_flight" };
  }
  return lostRace;
}

async function claimRetryExisting(
  input: ClaimInitialInput,
  existingId: string,
  message: FrozenMessage,
  prisma: PrismaClient,
): Promise<ClaimResult> {
  const claimed = await prisma.emailDelivery.updateMany({
    where: {
      id: existingId,
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
    return resolveLostRace(prisma, existingId, "Retry claim lost but initial delivery row not found");
  }
  return {
    action: "retry_existing",
    deliveryId: existingId,
    message,
  };
}

async function claimReclaimCancelled(
  input: ClaimInitialInput,
  existingId: string,
  now: Date,
  prisma: PrismaClient,
): Promise<ClaimResult> {
  // Full refresh, not just a status flip: a cancelled row can be arbitrarily old, so this
  // reclaims it with this request's fresh template/content/actor - not the stale frozen
  // message (or template) it originally queued under.
  const claimed = await prisma.emailDelivery.updateMany({
    where: {
      id: existingId,
      status: "cancelled",
    },
    data: {
      status: "queued",
      queued_at: now,
      batch_id: input.batchId,
      template_id: input.templateId,
      template_label_snapshot: input.templateLabel ?? null,
      provider: input.provider,
      recipient_email: input.recipientEmail.toLowerCase(),
      rendered_subject: input.renderedSubject,
      rendered_html: input.renderedHtml,
      attempts: 1,
      retryable: null,
      error: null,
      error_code: null,
      client_timezone: input.timezone ?? null,
      actor_user_id: input.actorUserId ?? null,
      session_id: input.sessionId ?? null,
    },
  });
  if (claimed.count === 0) {
    return resolveLostRace(prisma, existingId, "Reclaim lost but initial delivery row not found");
  }
  return {
    action: "send",
    deliveryId: existingId,
    message: {
      to: input.recipientEmail,
      subject: input.renderedSubject,
      html: input.renderedHtml,
    },
  };
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
    return claimRetryExisting(input, existing.id, result.message, prisma);
  }
  if (result.action === "reclaim_cancelled") {
    return claimReclaimCancelled(input, existing.id, now, prisma);
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
