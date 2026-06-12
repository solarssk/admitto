import type { PrismaClient } from "@prisma/client";
import { createMailer, sendBatch } from "@admitto/mailer";
import { resolveMailConfig } from "@admitto/mailer-config";
import { mapSendResultToDelivery } from "./mapSendResult.js";
import type { MailDeliveryDeps } from "./send.js";

/**
 * Retry a failed transient delivery — re-sends the frozen snapshot, no re-render.
 */
export async function retryDelivery(
  deliveryId: string,
  prisma: PrismaClient,
  env: NodeJS.ProcessEnv = process.env,
  deps: MailDeliveryDeps = {},
): Promise<{ ok: boolean; reason?: string }> {
  const delivery = await prisma.emailDelivery.findUniqueOrThrow({ where: { id: deliveryId } });

  if (delivery.status !== "failed" || !delivery.retryable) {
    return { ok: false, reason: "not_retryable" };
  }
  if (!delivery.recipient_email || !delivery.rendered_subject || !delivery.rendered_html) {
    return { ok: false, reason: "missing_snapshot" };
  }

  const mailConfig = await resolveMailConfig(delivery.event_id, prisma, env);
  const mailer = createMailer(mailConfig, { exportSink: deps.exportSink });

  const message = {
    to: delivery.recipient_email,
    subject: delivery.rendered_subject,
    html: delivery.rendered_html,
    idempotencyKey: `${delivery.attendee_id}:${delivery.purpose}:retry:${delivery.id}`,
  };

  let result;
  try {
    const summary = await sendBatch(mailer, [message]);
    result = summary.results[0];
    if (!result) {
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
