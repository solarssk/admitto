import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@admitto/db";
import { decryptFromString } from "@admitto/crypto";
import {
  buildEventLocationTemplateVars,
  formatEventDate,
  formatEventHours,
  materializeStoredDeliveryMessage,
  renderTemplateTrustedForStorage,
  resolveBrandingFromEvent,
  resolveEventImageAssetVars,
  resolveTemplateForEvent,
  resolveTemplateById,
  type BrandingUrls,
  type EventImageAssetPlaceholders,
  type ResolvedTemplate,
} from "@admitto/mail-templates";
import {
  createMailer,
  sendBatch,
  type ExportSink,
  type MailerAdapter,
  type MailMessage,
} from "@admitto/mailer";
import { resolveMailConfig } from "@admitto/mailer-config";
import { issueTicket, loadEventTicketTypes } from "@admitto/tickets";
import { resolveBaseUrl } from "./baseUrl.js";
import { claimInitialDelivery, createResendDelivery, type ClaimInitialInput } from "./claim.js";
import {
  buildAttendeeMailLinks,
  type AttendeeLinkInput,
  type AttendeeMailLinks,
  type EventLinkInput,
} from "./links.js";
import { mapSendResultToDelivery, type DeliveryStatusUpdate } from "./mapSendResult.js";
import { splitDisplayName } from "./name.js";
import { sanitizeDeliveryError } from "./sanitizeError.js";
import type { SendTicketEmailsResult } from "./types.js";

/** Options for `sendTicketEmails()` batch send. */
export interface SendTicketEmailsOptions {
  attendeeIds?: string[];
  /** MailTemplate row id; falls back to event/org ticket template when omitted. */
  templateId?: string;
  purpose?: "initial" | "resend";
  /** Override delivery recipient for a single-attendee resend (does not mutate Attendee.email). */
  recipientEmail?: string;
  /** Resolved public instance URL (env BASE_URL or DB instance_url). */
  baseUrl?: string;
  /** Triggering admin's IANA timezone at send time, when known. */
  timezone?: string;
  /** Triggering admin's user id and session id at send time, when known. */
  actorUserId?: string;
  sessionId?: string;
  /**
   * When true, deliver via the provider in-process (legacy/tests).
   * Default false: claim+render only; Admitto worker drains `queued` rows.
   */
  deliverImmediately?: boolean;
}

/** Optional test hooks for `sendTicketEmails()` (e.g. export_only sink). */
export interface MailDeliveryDeps {
  exportSink?: ExportSink;
}

interface PendingSend {
  deliveryId: string;
  attendeeId: string;
  to: string;
  frozenSubject: string;
  frozenHtml: string;
  links: AttendeeMailLinks;
  idempotencyKey: string;
  incrementAttempts?: boolean;
}

function deliveryUpdateFromBatchError(err: unknown): DeliveryStatusUpdate {
  const now = new Date();
  const message = err instanceof Error ? err.message : String(err);
  return {
    status: "failed",
    retryable: true,
    error: sanitizeDeliveryError(message),
    attempted_at: now,
    failed_at: now,
  };
}

async function resolvePlaintextToken(
  attendee: { id: string; token_enc: string | null },
  issueResult: Awaited<ReturnType<typeof issueTicket>>,
): Promise<string | undefined> {
  if (issueResult.mode === "agency") return undefined;
  if (issueResult.status === "issued") return issueResult.token;
  if (issueResult.status === "already_issued") {
    if (!attendee.token_enc) {
      throw new Error(`Attendee ${attendee.id} is issued but token_enc is missing`);
    }
    return decryptFromString(attendee.token_enc);
  }
  return undefined;
}

/** Resolves an attendee's ticket_type catalog key to its display label - fails open to the raw
 * key if the catalog lookup doesn't have it (deleted/renamed type), "General" when unset. Same
 * fallback precedent as buildWalletPassInput's ticketTypeLabel. */
function resolveTicketTypeLabel(
  ticketType: string | null,
  ticketTypeLabels: ReadonlyMap<string, string>,
): string {
  if (!ticketType) return "General";
  return ticketTypeLabels.get(ticketType) ?? ticketType;
}

function materializePendingMessage(item: PendingSend): MailMessage {
  const rendered = materializeStoredDeliveryMessage(
    { subject: item.frozenSubject, html: item.frozenHtml },
    item.links,
  );
  return {
    to: item.to,
    subject: rendered.subject,
    html: rendered.html,
    idempotencyKey: item.idempotencyKey,
  };
}

/** Attendee fields needed to process a single ticket-email send. */
interface AttendeeForSend extends AttendeeLinkInput {
  name: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  token_enc: string | null;
  ticket_type: string | null;
}

/** Event fields needed to process a single ticket-email send. */
interface EventForSend extends EventLinkInput {
  id: string;
  title: string;
  date: Date;
  event_hours_start: string | null;
  event_hours_end: string | null;
  location_details?: {
    venue_name: string | null;
    formatted_address: string | null;
    address_components?: unknown;
    latitude: number | null;
    longitude: number | null;
    map_zoom?: number | null;
    directions_text: string | null;
    accessibility_text: string | null;
    google_maps_url_override?: string | null;
    apple_maps_url_override?: string | null;
  } | null;
  organization_id: string;
}

type AttendeeSendOutcome =
  | { kind: "skip"; attendeeId: string; reason: string }
  | { kind: "pending"; pending: PendingSend };

interface ProcessAttendeeForSendInput {
  attendee: AttendeeForSend;
  event: EventForSend;
  resolvedTemplate: ResolvedTemplate;
  branding: BrandingUrls;
  customAssets: EventImageAssetPlaceholders;
  ticketTypeLabels: ReadonlyMap<string, string>;
  baseUrl: string;
  env: NodeJS.ProcessEnv;
  purpose: "initial" | "resend";
  options: SendTicketEmailsOptions;
  batchId: string;
  provider: string;
  prisma: PrismaClient;
}

/**
 * Process a single attendee: issue the ticket, build links/rendered content, and claim/create
 * the delivery row. Returns a skip outcome (batch continues without this attendee) or a pending
 * send to hand to `deliverPendingBatch`.
 */
async function processAttendeeForSend({
  attendee,
  event,
  resolvedTemplate,
  branding,
  customAssets,
  ticketTypeLabels,
  baseUrl,
  env,
  purpose,
  options,
  batchId,
  provider,
  prisma,
}: ProcessAttendeeForSendInput): Promise<AttendeeSendOutcome> {
  const issueResult = await issueTicket(attendee.id, prisma, baseUrl);

  if (issueResult.status === "not_issuable") {
    return { kind: "skip", attendeeId: attendee.id, reason: issueResult.reason };
  }

  let plaintextToken: string | undefined;
  try {
    plaintextToken = await resolvePlaintextToken(attendee, issueResult);
  } catch (err) {
    return {
      kind: "skip",
      attendeeId: attendee.id,
      reason: err instanceof Error ? err.message : "token_unavailable",
    };
  }

  let links: AttendeeMailLinks;
  try {
    links = buildAttendeeMailLinks(attendee, event, baseUrl, plaintextToken);
  } catch (err) {
    return {
      kind: "skip",
      attendeeId: attendee.id,
      reason: err instanceof Error ? err.message : "link_build_failed",
    };
  }

  // Real fields once the attendee has been through import/manual add/edit post-migration;
  // un-migrated attendees (both still null) fall back to splitting the combined name.
  const { first_name, last_name } =
    attendee.first_name !== null || attendee.last_name !== null
      ? { first_name: attendee.first_name ?? "", last_name: attendee.last_name ?? "" }
      : splitDisplayName(attendee.name);
  const locationVars = buildEventLocationTemplateVars(
    event.id,
    event.location_details,
    baseUrl,
    env,
  );

  const rendered = renderTemplateTrustedForStorage(
    {
      subject: resolvedTemplate.subjectTemplate,
      compiledHtml: resolvedTemplate.compiledHtmlTemplate,
    },
    {
      first_name,
      last_name,
      full_name: attendee.name,
      email: attendee.email,
      event_name: event.title,
      event_date: formatEventDate(event.date, "UTC"),
      event_hours: formatEventHours(event.event_hours_start, event.event_hours_end),
      ticket_type: resolveTicketTypeLabel(attendee.ticket_type, ticketTypeLabels),
      ...locationVars,
      logo_url: branding.logo_url,
      header_image_url: branding.header_image_url,
      // apple_wallet_url/google_wallet_url are deferred (STORAGE_DEFERRED_LINK_PLACEHOLDERS),
      // same as ticket_url/qr_image_url - materialized later from `links` at actual delivery.
      download_page_url: "",
      ...customAssets.vars,
    },
    { baseUrl, customAssetPlaceholders: customAssets.names },
  );

  const claimInput: ClaimInitialInput = {
    organizationId: event.organization_id,
    eventId: event.id,
    attendeeId: attendee.id,
    batchId,
    templateId: resolvedTemplate.templateId,
    templateLabel: resolvedTemplate.templateLabel,
    provider,
    recipientEmail:
      purpose === "resend" && options.recipientEmail ? options.recipientEmail : attendee.email,
    renderedSubject: rendered.subject,
    renderedHtml: rendered.html,
    timezone: options.timezone,
    actorUserId: options.actorUserId,
    sessionId: options.sessionId,
  };

  return claimOrResendPending(attendee.id, purpose, claimInput, links, prisma);
}

/**
 * purpose:"resend" always creates a new resend row. purpose:"initial" claims the atomic
 * (attendee, event) slot - except when that claim is skipped specifically because the
 * attendee already has a successful ticket: an explicit send action (checkbox selection)
 * against them is an implicit resend, not a silent no-op. A true in-flight duplicate is
 * still skipped.
 */
async function claimOrResendPending(
  attendeeId: string,
  purpose: "initial" | "resend",
  claimInput: ClaimInitialInput,
  links: AttendeeMailLinks,
  prisma: PrismaClient,
): Promise<AttendeeSendOutcome> {
  if (purpose !== "initial") {
    return { kind: "pending", pending: await createResendPending(attendeeId, claimInput, links, prisma) };
  }

  const claim = await claimInitialDelivery(claimInput, prisma);
  if (claim.action === "skip") {
    if (claim.reason !== "already_sent") {
      return { kind: "skip", attendeeId, reason: claim.reason };
    }
    return { kind: "pending", pending: await createResendPending(attendeeId, claimInput, links, prisma) };
  }
  return {
    kind: "pending",
    pending: {
      deliveryId: claim.deliveryId,
      attendeeId,
      to: claim.message.to,
      frozenSubject: claim.message.subject,
      frozenHtml: claim.message.html,
      links,
      idempotencyKey: `${attendeeId}:initial`,
      incrementAttempts: claim.action === "retry_existing",
    },
  };
}

async function createResendPending(
  attendeeId: string,
  claimInput: ClaimInitialInput,
  links: AttendeeMailLinks,
  prisma: PrismaClient,
): Promise<PendingSend> {
  const created = await createResendDelivery(claimInput, prisma);
  return {
    deliveryId: created.deliveryId,
    attendeeId,
    to: created.message.to,
    frozenSubject: created.message.subject,
    frozenHtml: created.message.html,
    links,
    idempotencyKey: `${attendeeId}:resend:${created.deliveryId}`,
  };
}

/**
 * True when `err` is a mail destination SSRF/DNS failure that API routes map to 422.
 * Duck-types on name/code so Vitest dual-package class identity does not drop the rethrow.
 */
function isMailDestinationFailure(err: unknown): boolean {
  if (!(err instanceof Error) || err.name !== "MailDestinationError" || !("code" in err)) {
    return false;
  }
  const code = err.code;
  return typeof code === "string" && code.startsWith("mail_destination_");
}

/**
 * Send the batched messages via the mailer and persist per-attendee delivery outcomes.
 * Returns the number of messages accepted by the provider (0 when the whole batch send throws).
 * Exported for unit tests of destination-error rethrow behaviour.
 */
export async function deliverPendingBatch(
  mailer: MailerAdapter,
  pending: PendingSend[],
  prisma: PrismaClient,
): Promise<number> {
  try {
    const batchResult = await sendBatch(
      mailer,
      pending.map((item) => materializePendingMessage(item)),
    );

    await Promise.all(
      batchResult.results.map((result, index) => {
        const item = pending.at(index);
        if (!item) return Promise.resolve();
        const update = mapSendResultToDelivery(result);
        return prisma.emailDelivery.update({
          where: { id: item.deliveryId },
          data: {
            ...update,
            provider: result.provider,
            ...(item.incrementAttempts ? { attempts: { increment: 1 } } : {}),
          },
        });
      }),
    );

    return batchResult.sent;
  } catch (err) {
    const failureUpdate = deliveryUpdateFromBatchError(err);
    await Promise.all(
      pending.map((item) =>
        prisma.emailDelivery.update({
          where: { id: item.deliveryId },
          data: {
            ...failureUpdate,
            ...(item.incrementAttempts ? { attempts: { increment: 1 } } : {}),
          },
        }),
      ),
    );
    // Destination SSRF/DNS failures must surface to API mappers (422), not look like a
    // soft batch failure with only failed EmailDelivery rows.
    // Duck-type on name/code (not instanceof): Vitest and some dual package graphs can
    // load two copies of MailDestinationError, so identity checks alone miss the rethrow.
    if (isMailDestinationFailure(err)) {
      throw err;
    }
    return 0;
  }
}

/**
 * Issue / claim ticket emails for an event (initial or resend).
 * By default only enqueues `EmailDelivery` rows (`queued`); the Admitto worker drains them.
 * Skips individual attendees on not_issuable, token/link build errors, or an in-flight duplicate
 * — does not abort the batch. purpose:"initial" against an attendee who already has a successful
 * ticket falls back to a resend rather than skipping, since that only happens on an explicit send
 * action (e.g. checkbox selection), not an automated sweep.
 */
export async function sendTicketEmails(
  eventId: string,
  options: SendTicketEmailsOptions,
  prisma: PrismaClient,
  env: NodeJS.ProcessEnv = process.env,
  deps: MailDeliveryDeps = {},
): Promise<SendTicketEmailsResult> {
  const purpose = options.purpose ?? "initial";
  const baseUrl = options.baseUrl ?? resolveBaseUrl(env);
  const batchId = randomUUID();
  const deliverImmediately = options.deliverImmediately === true;

  if (options.recipientEmail && options.attendeeIds?.length !== 1) {
    throw new Error("recipientEmail requires exactly one attendeeId");
  }

  const event = await prisma.event.findUniqueOrThrow({
    where: { id: eventId },
    include: { organization: true, location_details: true },
  });

  const mailConfig = await resolveMailConfig(eventId, prisma, env);
  let resolvedTemplate;
  if (options.templateId) {
    resolvedTemplate = await resolveTemplateById(options.templateId, eventId, prisma);
  } else {
    resolvedTemplate = await resolveTemplateForEvent(event, prisma);
  }
  const branding = resolveBrandingFromEvent(event);
  const customAssets = await resolveEventImageAssetVars(eventId, prisma);
  const ticketTypeLabels = new Map(
    (await loadEventTicketTypes(prisma, eventId)).map((t) => [t.key, t.label]),
  );

  const attendees = await prisma.attendee.findMany({
    where: {
      event_id: eventId,
      ...(options.attendeeIds ? { id: { in: options.attendeeIds } } : {}),
    },
  });

  // Provider is needed for claim `provider` snapshot even when we only enqueue.
  const mailer = await createMailer(mailConfig, { exportSink: deps.exportSink });
  const pending: PendingSend[] = [];
  const skipped: SendTicketEmailsResult["skipped"] = [];
  let sentCount = 0;

  try {
    for (const attendee of attendees) {
      const outcome = await processAttendeeForSend({
        attendee,
        event,
        resolvedTemplate,
        branding,
        customAssets,
        ticketTypeLabels,
        baseUrl,
        env,
        purpose,
        options,
        batchId,
        provider: mailer.provider,
        prisma,
      });
      if (outcome.kind === "skip") {
        skipped.push({ attendeeId: outcome.attendeeId, reason: outcome.reason });
      } else {
        pending.push(outcome.pending);
      }
    }

    if (deliverImmediately && pending.length > 0) {
      sentCount = await deliverPendingBatch(mailer, pending, prisma);
    }
  } finally {
    await mailer.close();
  }

  const queuedCount = deliverImmediately ? sentCount : pending.length;

  return {
    batchId,
    queued: queuedCount,
    sent: sentCount,
    skipped,
    deliveries: pending.map((item) => ({
      attendeeId: item.attendeeId,
      deliveryId: item.deliveryId,
    })),
    resolvedTemplateId: resolvedTemplate.templateId,
  };
}
