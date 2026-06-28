import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { decryptFromString } from "@admitto/crypto";
import {
  formatEventDate,
  materializeStoredDeliveryMessage,
  renderTemplateTrustedForStorage,
  resolveBrandingFromEvent,
  resolvePreviewEventTimeZone,
  resolveTemplateForEvent,
} from "@admitto/mail-templates";
import { createMailer, sendBatch, type ExportSink, type MailMessage } from "@admitto/mailer";
import { resolveMailConfig } from "@admitto/mailer-config";
import { issueTicket } from "@admitto/tickets";
import { resolveBaseUrl } from "./baseUrl.js";
import { claimInitialDelivery, createResendDelivery } from "./claim.js";
import { buildAttendeeMailLinks, type AttendeeMailLinks } from "./links.js";
import { mapSendResultToDelivery, type DeliveryStatusUpdate } from "./mapSendResult.js";
import { splitDisplayName } from "./name.js";
import { sanitizeDeliveryError } from "./sanitizeError.js";
import type { SendTicketEmailsResult } from "./types.js";

/** Options for `sendTicketEmails()` batch send. */
export interface SendTicketEmailsOptions {
  attendeeIds?: string[];
  purpose?: "initial" | "resend";
  /** Override delivery recipient for a single-attendee resend (does not mutate Attendee.email). */
  recipientEmail?: string;
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

/**
 * Issue ticket emails for an event (initial or resend).
 * Skips individual attendees on not_issuable, token/link build errors, or dedup — does not abort the batch.
 */
export async function sendTicketEmails(
  eventId: string,
  options: SendTicketEmailsOptions,
  prisma: PrismaClient,
  env: NodeJS.ProcessEnv = process.env,
  deps: MailDeliveryDeps = {},
): Promise<SendTicketEmailsResult> {
  const purpose = options.purpose ?? "initial";
  const baseUrl = resolveBaseUrl(env);
  const batchId = randomUUID();

  if (
    options.recipientEmail &&
    (!options.attendeeIds || options.attendeeIds.length !== 1)
  ) {
    throw new Error("recipientEmail requires exactly one attendeeId");
  }

  const event = await prisma.event.findUniqueOrThrow({
    where: { id: eventId },
    include: { organization: true },
  });

  const mailConfig = await resolveMailConfig(eventId, prisma, env);
  const resolvedTemplate = await resolveTemplateForEvent(event, prisma);
  const branding = resolveBrandingFromEvent(event);

  const attendees = await prisma.attendee.findMany({
    where: {
      event_id: eventId,
      ...(options.attendeeIds ? { id: { in: options.attendeeIds } } : {}),
    },
  });

  const mailer = createMailer(mailConfig, { exportSink: deps.exportSink });
  const pending: PendingSend[] = [];
  const skipped: SendTicketEmailsResult["skipped"] = [];
  let sentCount = 0;

  try {
    for (const attendee of attendees) {
      const issueResult = await issueTicket(attendee.id, prisma, baseUrl);

      if (issueResult.status === "not_issuable") {
        skipped.push({ attendeeId: attendee.id, reason: issueResult.reason });
        continue;
      }

      let plaintextToken: string | undefined;
      try {
        plaintextToken = await resolvePlaintextToken(attendee, issueResult);
      } catch (err) {
        skipped.push({
          attendeeId: attendee.id,
          reason: err instanceof Error ? err.message : "token_unavailable",
        });
        continue;
      }

      let links: AttendeeMailLinks;
      try {
        links = buildAttendeeMailLinks(attendee, event, baseUrl, plaintextToken);
      } catch (err) {
        skipped.push({
          attendeeId: attendee.id,
          reason: err instanceof Error ? err.message : "link_build_failed",
        });
        continue;
      }

      const { first_name, last_name } = splitDisplayName(attendee.name);

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
          event_date: formatEventDate(event.date, resolvePreviewEventTimeZone(event.timezone)),
          event_location: event.location ?? "",
          logo_url: branding.logo_url,
          header_image_url: branding.header_image_url,
          apple_wallet_url: "",
          google_wallet_url: "",
          download_page_url: "",
        },
      );

      const claimInput = {
        organizationId: event.organization_id,
        eventId: event.id,
        attendeeId: attendee.id,
        batchId,
        templateId: resolvedTemplate.source === "builtin" ? undefined : `${resolvedTemplate.source}`,
        provider: mailer.provider,
        recipientEmail:
          purpose === "resend" && options.recipientEmail ? options.recipientEmail : attendee.email,
        renderedSubject: rendered.subject,
        renderedHtml: rendered.html,
      };

      if (purpose === "initial") {
        const claim = await claimInitialDelivery(claimInput, prisma);
        if (claim.action === "skip") {
          skipped.push({ attendeeId: attendee.id, reason: claim.reason });
          continue;
        }
        pending.push({
          deliveryId: claim.deliveryId,
          attendeeId: attendee.id,
          to: claim.message.to,
          frozenSubject: claim.message.subject,
          frozenHtml: claim.message.html,
          links,
          idempotencyKey: `${attendee.id}:initial`,
          incrementAttempts: claim.action === "retry_existing",
        });
      } else {
        const created = await createResendDelivery(claimInput, prisma);
        pending.push({
          deliveryId: created.deliveryId,
          attendeeId: attendee.id,
          to: created.message.to,
          frozenSubject: created.message.subject,
          frozenHtml: created.message.html,
          links,
          idempotencyKey: `${attendee.id}:resend:${created.deliveryId}`,
        });
      }
    }

    if (pending.length > 0) {
      try {
        const batchResult = await sendBatch(
          mailer,
          pending.map((item) => materializePendingMessage(item)),
        );
        sentCount = batchResult.sent;

        await Promise.all(
          batchResult.results.map((result, index) => {
            const item = pending[index];
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
        sentCount = 0;
      }
    }
  } finally {
    await mailer.close();
  }

  return {
    batchId,
    sent: sentCount,
    skipped,
    deliveries: pending.map((item) => ({
      attendeeId: item.attendeeId,
      deliveryId: item.deliveryId,
    })),
  };
}
