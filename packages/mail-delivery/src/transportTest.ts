import type { PrismaClient } from "@admitto/db";
import { closeMailer, createMailer, type MailerConfig, type SendResult } from "@admitto/mailer";
import { resolveMailConfig, resolveMailConfigForOrg } from "@admitto/mailer-config";
import type { MailDeliveryDeps } from "./send.js";
import { sanitizeDeliveryError } from "./sanitizeError.js";

const TRANSPORT_TEST_SUBJECT = "Admitto mail transport test";
const TRANSPORT_TEST_HTML =
  "<p>This is a transport-level test message from Admitto instance settings.</p>";

export interface SendTransportTestEmailParams {
  organizationId: string;
  toAddress: string;
}

export interface SendEventTransportTestEmailParams {
  eventId: string;
  toAddress: string;
}

async function sendTransportTestEmailWithConfig(
  mailConfig: MailerConfig,
  toAddress: string,
  deps: MailDeliveryDeps,
): Promise<SendResult> {
  const mailer = await createMailer(mailConfig, { exportSink: deps.exportSink });

  try {
    const result = await mailer.send({
      to: toAddress,
      subject: TRANSPORT_TEST_SUBJECT,
      html: TRANSPORT_TEST_HTML,
    });

    if (result.error) {
      return { ...result, error: sanitizeDeliveryError(result.error) };
    }
    return result;
  } finally {
    await closeMailer(mailer);
  }
}

/**
 * Sends one transport-level test email using org-scoped mail config.
 * Does not create EmailDelivery rows — operator preflight only.
 */
export async function sendTransportTestEmail(
  params: SendTransportTestEmailParams,
  prisma: PrismaClient,
  env: NodeJS.ProcessEnv = process.env,
  deps: MailDeliveryDeps = {},
): Promise<SendResult> {
  const mailConfig = await resolveMailConfigForOrg(params.organizationId, prisma, env);
  return sendTransportTestEmailWithConfig(mailConfig, params.toAddress, deps);
}

/**
 * Sends one transport-level test email using event-scoped mail config, falling
 * back to the organization's config per resolveMailConfig's normal precedence.
 * Does not create EmailDelivery rows — operator preflight only.
 */
export async function sendEventTransportTestEmail(
  params: SendEventTransportTestEmailParams,
  prisma: PrismaClient,
  env: NodeJS.ProcessEnv = process.env,
  deps: MailDeliveryDeps = {},
): Promise<SendResult> {
  const mailConfig = await resolveMailConfig(params.eventId, prisma, env);
  return sendTransportTestEmailWithConfig(mailConfig, params.toAddress, deps);
}
