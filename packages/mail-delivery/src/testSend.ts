import type { PrismaClient } from "@prisma/client";
import { previewTemplate } from "@admitto/mail-templates";
import { closeMailer, createMailer, type SendResult } from "@admitto/mailer";
import { resolveMailConfig } from "@admitto/mailer-config";
import type { MailDeliveryDeps } from "./send.js";
import { sanitizeDeliveryError } from "./sanitizeError.js";

export interface SendTestEmailParams {
  eventId: string;
  toAddress: string;
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
): Promise<SendResult> {
  const mailConfig = await resolveMailConfig(params.eventId, prisma, env);
  const mailer = createMailer(mailConfig, { exportSink: deps.exportSink });

  try {
    const rendered = await previewTemplate(params.eventId, prisma);
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
