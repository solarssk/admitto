import type { PrismaClient } from "@prisma/client";
import { materializeStoredDeliveryMessage } from "@admitto/mail-templates";
import { createMailer, sendBatch } from "@admitto/mailer";
import { resolveMailConfig } from "@admitto/mailer-config";
import { resolveBaseUrl } from "./baseUrl.js";
import { resolveAttendeeMailLinks } from "./links.js";
import { mapSendResultToDelivery } from "./mapSendResult.js";
import type { MailDeliveryDeps } from "./send.js";

export interface RetryDeliveryOptions {
  /** Resolved public instance URL (env BASE_URL or DB instance_url). */
  baseUrl?: string;
}

/**
 * Retry a failed transient delivery — re-sends the frozen snapshot with fresh ticket links.
 *
 * Callers must pass `baseUrl` from `resolveInstanceBaseUrl(db, env)` in `@admitto/auth` when
 * only DB `instance_url` is configured (see `admitto mail retry-failed` in apps/cli).
 */
export async function retryDelivery(
  deliveryId: string,
  prisma: PrismaClient,
  env: NodeJS.ProcessEnv = process.env,
  deps: MailDeliveryDeps = {},
  options: RetryDeliveryOptions = {},
): Promise<{ ok: boolean; reason?: string }> {
  const delivery = await prisma.emailDelivery.findUniqueOrThrow({ where: { id: deliveryId } });

  if (delivery.status !== "failed" || !delivery.retryable) {
    return { ok: false, reason: "not_retryable" };
  }
  if (!delivery.recipient_email || !delivery.rendered_subject || !delivery.rendered_html) {
    return { ok: false, reason: "missing_snapshot" };
  }

  const baseUrl = options.baseUrl ?? resolveBaseUrl(env);
  let links;
  try {
    links = await resolveAttendeeMailLinks(delivery.attendee_id, prisma, baseUrl);
  } catch {
    return { ok: false, reason: "links_unavailable" };
  }

  const materialized = materializeStoredDeliveryMessage(
    { subject: delivery.rendered_subject, html: delivery.rendered_html },
    links,
  );

  const mailConfig = await resolveMailConfig(delivery.event_id, prisma, env);
  const mailer = createMailer(mailConfig, { exportSink: deps.exportSink });

  const message = {
    to: delivery.recipient_email,
    subject: materialized.subject,
    html: materialized.html,
    idempotencyKey: `${delivery.attendee_id}:${delivery.purpose}:retry:${delivery.id}`,
  };

  let result;
  try {
    const summary = await sendBatch(mailer, [message]);
    result = summary.results[0];
    if (!result) {
      await prisma.emailDelivery.update({
        where: { id: deliveryId },
        data: { attempts: { increment: 1 } },
      });
      return { ok: false, reason: "no_result" };
    }

    const update = mapSendResultToDelivery(result);
    await prisma.emailDelivery.update({
      where: { id: deliveryId },
      data: {
        ...update,
        provider: result.provider,
        attempts: { increment: 1 },
      },
    });

    return { ok: result.status === "accepted" || result.status === "sent" };
  } finally {
    await mailer.close();
  }
}
