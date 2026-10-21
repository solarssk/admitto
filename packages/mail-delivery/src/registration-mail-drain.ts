/**
 * Sends the mail a guest registration queued (`RegistrationMail`): the Admitto worker job `registration_mail`.
 *
 * What it does for each row, one row at a time:
 * 1. the last check, a short transaction under the registration queue (registration-mail-check.ts);
 * 2. the send, with no transaction and no lock held, so a send never makes an erasure or an admission wait;
 * 3. the result, one conditional update of the row (registration-mail-result.ts): a row that is gone, because its
 *    registration was erased or deleted meanwhile, matches nothing and is not put back.
 *
 * A `ticket` row is no mail of its own. It only triggers the usual ticket send (`sendTicketEmails`), which creates
 * the `EmailDelivery` that the delivery log shows and the ticket drain sends.
 *
 * Nothing here throws for one bad row: a failure is caught per row and recorded as a fixed category
 * (registration-mail-reasons.ts), and the rest of the queue carries on. The counts of the tick are all that is
 * logged; no address, name or error text leaves this module.
 */
import type { PrismaClient } from "@admitto/db";
import { resolveTemplateForEvent, type RenderedTemplate, type ResolvedTemplate } from "@admitto/mail-templates";
import { createMailer, isSendSuccess, type MailerAdapter, type MailMessage, type SendResult } from "@admitto/mailer";
import { resolveMailConfig } from "@admitto/mailer-config";
import { MAX_MAIL_DRAIN_ATTEMPTS, isMailDrainRetryDue } from "./drain-retry.js";
import { withDeliveryOwnership } from "./ownership.js";
import {
  checkRegistrationMailBeforeSend,
  type RegistrationForMail,
  type RegistrationMailCheck,
} from "./registration-mail-check.js";
import { MAIL_CANCELLATION, MAIL_FAILURE, RegistrationMailFailure } from "./registration-mail-reasons.js";
import { loadEventMailFacts, renderRegistrationMail, type EventMailFacts } from "./registration-mail-render.js";
import {
  QUEUED_MAIL_SELECT,
  cancelledResult,
  failedResult,
  sentResult,
  writeMailResult,
  type MailResult,
  type QueuedRegistrationMail,
} from "./registration-mail-result.js";
import { sendTicketEmails, type MailDeliveryDeps } from "./send.js";
import type { SendTicketEmailsResult } from "./types.js";

/** Rows taken per worker tick: less than the ticket drain's 50, so guest mail cannot take the provider's quota. */
export const DEFAULT_REGISTRATION_MAIL_DRAIN_LIMIT = 20;

export interface DrainRegistrationMailsOptions {
  /** The instance's public URL: the base of the confirmation link and of the ticket links. */
  baseUrl: string;
  /** Cap on the rows taken this tick (default 20). */
  limit?: number;
  /** Override "now" for backoff tests. */
  nowMs?: number;
}

export interface DrainRegistrationMailsResult {
  /** Rows taken this tick. */
  claimed: number;
  /** Mails the provider took, and ticket rows that handed the ticket to the usual send. */
  sent: number;
  /** Rows recorded as failed, to be tried again or not. */
  failed: number;
  /** Rows whose registration no longer fitted the mail: nothing was sent. */
  cancelled: number;
  /** Rows that were gone, or had moved on, or were held by another sender: nothing was done. */
  skipped: number;
  /** The events of the rows taken, for the worker to announce over SSE (ADR 0044). */
  eventIds: string[];
}

type RowOutcome = "sent" | "failed" | "cancelled" | "skipped";

/** The outcome of one row's send and what to write for it. */
interface Resolution {
  outcome: Exclude<RowOutcome, "skipped">;
  data: MailResult;
}

/** The rows to take: the queued ones first (oldest first), then failed ones whose backoff has run out. */
async function selectDrainCandidates(prisma: PrismaClient, limit: number, nowMs: number): Promise<QueuedRegistrationMail[]> {
  const notExhausted = { attempts: { lt: MAX_MAIL_DRAIN_ATTEMPTS } };
  const oldestFirst = [{ queued_at: "asc" as const }, { id: "asc" as const }];
  const queued = await prisma.registrationMail.findMany({
    where: { status: "queued", ...notExhausted },
    orderBy: oldestFirst,
    take: limit,
    select: QUEUED_MAIL_SELECT,
  });
  if (queued.length >= limit) return queued;

  const remaining = limit - queued.length;
  // More than needed are read, because the backoff is applied in memory.
  const retryable = await prisma.registrationMail.findMany({
    where: { status: "failed", retryable: true, ...notExhausted },
    orderBy: oldestFirst,
    take: Math.min(remaining * 4, Math.max(remaining, 200)),
    select: QUEUED_MAIL_SELECT,
  });
  return [...queued, ...retryable.filter((row) => isMailDrainRetryDue(row, nowMs)).slice(0, remaining)];
}

/** The same event's rows together, so that they share what is read once (the event, the templates, the mailer). */
function groupByEvent(rows: readonly QueuedRegistrationMail[]): Map<string, QueuedRegistrationMail[]> {
  const byEvent = new Map<string, QueuedRegistrationMail[]>();
  for (const row of rows) {
    const group = byEvent.get(row.event_id) ?? [];
    group.push(row);
    byEvent.set(row.event_id, group);
  }
  return byEvent;
}

/** What a mail needs besides the guest: read once per event and tick. */
interface PreparedMail {
  facts: EventMailFacts;
  template: ResolvedTemplate;
  mailer: MailerAdapter;
}

/**
 * What one event's rows share in a tick, read when the first row needs it and kept for the rest: the event, its
 * templates and the mailer. A group of ticket rows needs none of it, because the ticket send builds its own. The
 * mailer is closed when the group is done, as the ticket drain does (one mailer per event and tick).
 */
class EventMailContext {
  private facts?: Promise<EventMailFacts>;
  private mailer?: Promise<MailerAdapter>;
  private readonly templates = new Map<string, Promise<ResolvedTemplate>>();

  constructor(
    readonly prisma: PrismaClient,
    readonly env: NodeJS.ProcessEnv,
    readonly deps: MailDeliveryDeps,
    readonly eventId: string,
    readonly baseUrl: string,
  ) {}

  private loadFacts(): Promise<EventMailFacts> {
    this.facts ??= loadEventMailFacts(this.prisma, this.eventId, this.baseUrl, this.env);
    return this.facts;
  }

  private loadTemplate(name: string): Promise<ResolvedTemplate> {
    let template = this.templates.get(name);
    if (!template) {
      template = this.loadFacts().then((facts) =>
        resolveTemplateForEvent({ id: this.eventId, organization_id: facts.organizationId }, this.prisma, name),
      );
      this.templates.set(name, template);
    }
    return template;
  }

  private openMailer(): Promise<MailerAdapter> {
    this.mailer ??= resolveMailConfig(this.eventId, this.prisma, this.env).then((config) =>
      createMailer(config, { exportSink: this.deps.exportSink }),
    );
    return this.mailer;
  }

  /** Everything a mail of this template needs, read before the last check so that nothing slow separates it from the send. */
  async prepare(templateName: string): Promise<PreparedMail> {
    const [facts, template] = await Promise.all([this.loadFacts(), this.loadTemplate(templateName)]).catch(() => {
      throw new RegistrationMailFailure(MAIL_FAILURE.internal, true);
    });
    const mailer = await this.openMailer().catch(() => {
      throw new RegistrationMailFailure(MAIL_FAILURE.unavailable, true);
    });
    return { facts, template, mailer };
  }

  async close(): Promise<void> {
    const mailer = await this.mailer?.catch(() => undefined);
    await mailer?.close().catch(() => undefined);
  }
}

function resolutionOfSend(row: QueuedRegistrationMail, result: SendResult): Resolution {
  if (isSendSuccess(result.status)) {
    return { outcome: "sent", data: sentResult(row, result.providerMessageId, result.status === "sent" ? "sent" : "accepted") };
  }
  // The provider's own text is not kept: it can carry the address.
  if (result.status === "rejected") return { outcome: "failed", data: failedResult(row, MAIL_FAILURE.sendRejected, false) };
  return { outcome: "failed", data: failedResult(row, MAIL_FAILURE.sendFailed, result.retryable === true) };
}

/** Renders the mail for the guest as the last check read them and hands it to the provider. */
async function sendMail(
  prepared: PreparedMail,
  row: QueuedRegistrationMail,
  registration: RegistrationForMail,
  baseUrl: string,
  assertOwned: () => Promise<void>,
): Promise<Resolution> {
  let rendered: RenderedTemplate;
  try {
    rendered = renderRegistrationMail(prepared.facts, prepared.template, row.template_name, registration, baseUrl);
  } catch {
    // Only this row fails, and for good: a retry cannot change the text. The rest of the queue carries on.
    throw new RegistrationMailFailure(MAIL_FAILURE.unusable, false);
  }
  const message: MailMessage = {
    to: registration.email,
    subject: rendered.subject,
    html: rendered.html,
    idempotencyKey: `registration-mail:${row.id}${row.status === "failed" ? ":retry" : ""}`,
  };
  await assertOwned();
  let result: SendResult;
  try {
    result = await prepared.mailer.send(message);
  } catch {
    throw new RegistrationMailFailure(MAIL_FAILURE.sendFailed, true);
  }
  await assertOwned();
  return resolutionOfSend(row, result);
}

/** The ticket send reports why it made no delivery for an attendee: the ticket is out already, or cannot be issued. */
const TICKET_ON_ITS_WAY = new Set(["already_sent", "in_flight"]);
const TICKET_NOT_ISSUABLE = new Set(["cancelled", "revoked", "erased"]);

function resolutionOfTicketSend(row: QueuedRegistrationMail, result: SendTicketEmailsResult): Resolution {
  const skip = result.skipped.at(0)?.reason;
  if (result.deliveries.length > 0 || (skip !== undefined && TICKET_ON_ITS_WAY.has(skip))) {
    return { outcome: "sent", data: sentResult(row) };
  }
  // No attendee was found: the registration it was accepted from is gone too.
  if (skip === undefined) return { outcome: "cancelled", data: cancelledResult(MAIL_CANCELLATION.registrationChanged) };
  if (TICKET_NOT_ISSUABLE.has(skip)) return { outcome: "cancelled", data: cancelledResult(MAIL_CANCELLATION.ticketNotIssuable) };
  // Any other reason is the text of an error, which is not kept.
  throw new RegistrationMailFailure(MAIL_FAILURE.ticketFailed, true);
}

/**
 * Hands the ticket to the usual ticket send, which creates the `EmailDelivery`. It runs outside any transaction and
 * lock, and builds its own mailer. Its errors (no provider, no instance URL) are caught and recorded as a fixed
 * category, never rethrown with their text.
 */
async function handOverTicket(context: EventMailContext, row: QueuedRegistrationMail, attendeeId: string): Promise<Resolution> {
  let result: SendTicketEmailsResult;
  try {
    result = await sendTicketEmails(
      context.eventId,
      { attendeeIds: [attendeeId], purpose: "initial", baseUrl: context.baseUrl },
      context.prisma,
      context.env,
      context.deps,
    );
  } catch {
    throw new RegistrationMailFailure(MAIL_FAILURE.ticketFailed, true);
  }
  return resolutionOfTicketSend(row, result);
}

function outcomeOfCheck(check: Exclude<RegistrationMailCheck, { kind: "send" }>): RowOutcome {
  switch (check.kind) {
    case "cancelled":
      return "cancelled";
    case "ticket_already_out":
      return "sent";
    default:
      return "skipped";
  }
}

async function runRow(context: EventMailContext, row: QueuedRegistrationMail, assertOwned: () => Promise<void>): Promise<RowOutcome> {
  const isTicket = row.template_name === "ticket";
  const prepared = isTicket ? null : await context.prepare(row.template_name);
  const check = await checkRegistrationMailBeforeSend(context.prisma, row);
  if (check.kind !== "send") return outcomeOfCheck(check);

  // A ticket row passed the check, which refuses a registration without an attendee.
  const resolution = prepared
    ? await sendMail(prepared, row, check.registration, context.baseUrl, assertOwned)
    : await handOverTicket(context, row, check.attendeeId!);
  await assertOwned();
  const written = await writeMailResult(context.prisma, row, resolution.data);
  return written ? resolution.outcome : "skipped";
}

/** Records why a row failed: a category from the closed list, whatever was thrown. */
async function recordFailure(prisma: PrismaClient, row: QueuedRegistrationMail, thrown: unknown): Promise<RowOutcome> {
  const failure = thrown instanceof RegistrationMailFailure ? thrown : new RegistrationMailFailure(MAIL_FAILURE.internal, true);
  const written = await writeMailResult(prisma, row, failedResult(row, failure.reason, failure.retryable));
  return written ? "failed" : "skipped";
}

/** One row, start to end, under its own ownership lock. Never throws: no row may stop the others. */
async function processRow(context: EventMailContext, row: QueuedRegistrationMail): Promise<RowOutcome> {
  try {
    const outcome = await withDeliveryOwnership(row.id, async (assertOwned) => {
      try {
        return await runRow(context, row, assertOwned);
      } catch (error_) {
        await assertOwned();
        return await recordFailure(context.prisma, row, error_);
      }
    });
    // undefined: another sender holds the row.
    return outcome ?? "skipped";
  } catch {
    // The failure could not even be recorded (the database, the ownership connection): the row stays as it is and
    // the next tick takes it again.
    return "failed";
  }
}

/**
 * Takes up to `limit` rows of the registration mail queue and sends them, per event, one at a time. Safe under the
 * worker's advisory lock `registration_mail`, and under a second drain on the same database: each row is held by a
 * session lock while it is sent (withDeliveryOwnership), so no row goes out twice.
 */
export async function drainRegistrationMails(
  prisma: PrismaClient,
  env: NodeJS.ProcessEnv,
  deps: MailDeliveryDeps,
  options: DrainRegistrationMailsOptions,
): Promise<DrainRegistrationMailsResult> {
  const limit = options.limit !== undefined && options.limit > 0 ? Math.floor(options.limit) : DEFAULT_REGISTRATION_MAIL_DRAIN_LIMIT;
  const candidates = await selectDrainCandidates(prisma, limit, options.nowMs ?? Date.now());
  const byEvent = groupByEvent(candidates);
  const counts = new Map<RowOutcome, number>([
    ["sent", 0],
    ["failed", 0],
    ["cancelled", 0],
    ["skipped", 0],
  ]);

  for (const [eventId, rows] of byEvent) {
    const context = new EventMailContext(prisma, env, deps, eventId, options.baseUrl);
    try {
      for (const row of rows) {
        const outcome = await processRow(context, row); // NOSONAR - rows are sent one at a time on purpose, in order
        counts.set(outcome, counts.get(outcome)! + 1);
      }
    } finally {
      await context.close(); // NOSONAR - events are drained one at a time on purpose
    }
  }

  return {
    claimed: candidates.length,
    sent: counts.get("sent")!,
    failed: counts.get("failed")!,
    cancelled: counts.get("cancelled")!,
    skipped: counts.get("skipped")!,
    eventIds: [...byEvent.keys()],
  };
}
