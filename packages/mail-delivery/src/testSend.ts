import type { PrismaClient } from "@prisma/client";
import { previewTemplate } from "@admitto/mail-templates";
import { closeMailer, createMailer, type SendResult } from "@admitto/mailer";
import { resolveMailConfig } from "@admitto/mailer-config";
import { resolveBaseUrl } from "./baseUrl.js";
import type { MailDeliveryDeps } from "./send.js";
import { sanitizeDeliveryError } from "./sanitizeError.js";

export interface SendTestEmailParams {
  eventId: string;
  toAddress: string;
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
  const mailer = createMailer(mailConfig, { exportSink: deps.exportSink });
  const baseUrl = options.baseUrl ?? resolveBaseUrl(env);

  try {
    const rendered = await previewTemplate(params.eventId, prisma, undefined, {
      baseUrl,
    });
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
