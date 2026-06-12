import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { decryptFromString } from "@admitto/crypto";
import {
  formatEventDate,
  renderTemplateTrusted,
  resolveBrandingFromEvent,
  resolveTemplateForEvent,
} from "@admitto/mail-templates";
import { createMailer, sendBatch, type ExportSink, type MailMessage } from "@admitto/mailer";
import { resolveMailConfig } from "@admitto/mailer-config";
import { issueTicket } from "@admitto/tickets";
import { resolveBaseUrl } from "./baseUrl.js";
import { claimInitialDelivery, createResendDelivery } from "./claim.js";
import { buildAttendeeMailLinks } from "./links.js";
import { mapSendResultToDelivery } from "./mapSendResult.js";
import { splitDisplayName } from "./name.js";
import type { SendTicketEmailsResult } from "./types.js";

export interface SendTicketEmailsOptions {
  attendeeIds?: string[];
  purpose?: "initial" | "resend";
}

export interface MailDeliveryDeps {
  exportSink?: ExportSink;
}

interface PendingSend {
  deliveryId: string;
  attendeeId: string;
  message: MailMessage;
  incrementAttempts?: boolean;
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

  const event = await prisma.event.findUniqueOrThrow({
    where: { id: eventId },
    include: { organization: true },
  });

  const mailConfig = await resolveMailConfig(eventId, prisma, env);
  const mailer = createMailer(mailConfig, { exportSink: deps.exportSink });
  const resolvedTemplate = await resolveTemplateForEvent(event, prisma);
  const branding = resolveBrandingFromEvent(event);

  const attendees = await prisma.attendee.findMany({
    where: {
      event_id: eventId,
      ...(options.attendeeIds ? { id: { in: options.attendeeIds } } : {}),
    },
  });

  const pending: PendingSend[] = [];
  const skipped: SendTicketEmailsResult["skipped"] = [];

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

    const links = buildAttendeeMailLinks(attendee, event, baseUrl, plaintextToken);
    const { first_name, last_name } = splitDisplayName(attendee.name);

    const rendered = renderTemplateTrusted(
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
        event_date: formatEventDate(event.date),
        event_location: event.location ?? "",
        ticket_url: links.ticket_url,
        qr_image_url: links.qr_image_url,
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
      recipientEmail: attendee.email,
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
        message: {
          to: claim.message.to,
          subject: claim.message.subject,
          html: claim.message.html,
          idempotencyKey: `${attendee.id}:initial`,
        },
        incrementAttempts: claim.action === "retry_existing",
      });
    } else {
      const created = await createResendDelivery(claimInput, prisma);
      pending.push({
        deliveryId: created.deliveryId,
        attendeeId: attendee.id,
        message: {
          to: created.message.to,
          subject: created.message.subject,
          html: created.message.html,
          idempotencyKey: `${attendee.id}:resend:${created.deliveryId}`,
        },
      });
    }
  }

  if (pending.length > 0) {
    const batchResult = await sendBatch(
      mailer,
      pending.map((p) => p.message),
    );

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
  }

  await mailer.close();

  return {
    batchId,
    sent: pending.length,
    skipped,
  };
}
