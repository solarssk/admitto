import type { PrismaClient } from "@admitto/db";
import {
  buildBaseTemplateVars,
  previewTemplate,
  renderTemplate,
  resolveBrandingFromEvent,
  resolveEventImageAssetVars,
  resolveTemplateById,
  sanitizeSampleLinksForTestSend,
} from "@admitto/mail-templates";
import { closeMailer, createMailer, type SendResult } from "@admitto/mailer";
import { resolveMailConfig } from "@admitto/mailer-config";
import { resolveBaseUrl } from "./baseUrl.js";
import type { MailDeliveryDeps } from "./send.js";
import { sanitizeDeliveryError } from "./sanitizeError.js";

export interface SendTestEmailParams {
  eventId: string;
  toAddress: string;
  /** When set, renders this template instead of the event default ticket template. */
  templateId?: string;
}

export interface SendTestEmailOptions {
  /** Resolved public instance URL — use when callers inject baseUrl (e.g. createApp) instead of env only. */
  baseUrl?: string;
}

/**
 * Sends one test email for an event using sample template data (no live ticket token).
 * Does not create EmailDelivery rows — operator preflight only.
 */
export async function sendTestEmail(
  params: SendTestEmailParams,
  prisma: PrismaClient,
  env: NodeJS.ProcessEnv = process.env,
  deps: MailDeliveryDeps = {},
  options: SendTestEmailOptions = {},
): Promise<SendResult> {
  const mailConfig = await resolveMailConfig(params.eventId, prisma, env);
  const mailer = await createMailer(mailConfig, { exportSink: deps.exportSink });
  const baseUrl = options.baseUrl ?? resolveBaseUrl(env);

  try {
    let rendered;
    if (params.templateId) {
      const event = await prisma.event.findUniqueOrThrow({
        where: { id: params.eventId },
        include: { organization: true, location_details: true },
      });
      const resolved = await resolveTemplateById(params.templateId, params.eventId, prisma);
      const branding = resolveBrandingFromEvent(event);
      const customAssets = await resolveEventImageAssetVars(params.eventId, prisma);
      const vars = {
        ...buildBaseTemplateVars(event, undefined, branding, baseUrl, env),
        ...customAssets.vars,
      };
      rendered = renderTemplate(
        {
          subject: resolved.subjectTemplate,
          compiledHtml: resolved.compiledHtmlTemplate,
        },
        vars,
        { baseUrl, customAssetPlaceholders: customAssets.names },
      );
    } else {
      rendered = await previewTemplate(params.eventId, prisma, undefined, {
        baseUrl,
        env,
      });
    }
    // Sample data only (see this function's own doc comment) - the sample ticket_url/qr_image_url
    // point at a domain nothing hosts, so swap them for safe placeholders before this reaches a
    // real inbox, same as the admin's own in-browser preview already does client-side.
    rendered = sanitizeSampleLinksForTestSend(rendered);
    const result = await mailer.send({
      to: params.toAddress,
      subject: rendered.subject,
      html: rendered.html,
    });

    if (result.error) {
      return { ...result, error: sanitizeDeliveryError(result.error) };
    }
    return result;
  } finally {
    await closeMailer(mailer);
  }
}
