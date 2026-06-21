import type { PrismaClient } from "@prisma/client";
import { closeMailer, createMailer, type SendResult } from "@admitto/mailer";
import { resolveMailConfigForOrg } from "@admitto/mailer-config";
import type { MailDeliveryDeps } from "./send.js";
import { sanitizeDeliveryError } from "./sanitizeError.js";

const TRANSPORT_TEST_SUBJECT = "Admitto mail transport test";
const TRANSPORT_TEST_HTML =
  "<p>This is a transport-level test message from Admitto instance settings.</p>";

export interface SendTransportTestEmailParams {
  organizationId: string;
  toAddress: string;
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
  const mailer = createMailer(mailConfig, { exportSink: deps.exportSink });

  try {
    const result = await mailer.send({
      to: params.toAddress,
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
