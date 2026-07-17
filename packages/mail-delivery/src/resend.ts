import type { PrismaClient } from "@prisma/client";
import { sendTicketEmails, type MailDeliveryDeps } from "./send.js";

export interface ResendTicketEmailOptions {
  /** Override delivery recipient for a single-attendee resend (does not mutate Attendee.email). */
  to?: string;
  /** Resolved public instance URL (env BASE_URL or DB instance_url). */
  baseUrl?: string;
  /** Triggering admin's IANA timezone at send time, when known. */
  timezone?: string;
}

/** Explicit resend — new EmailDelivery row with purpose=resend and fresh render. */
export async function resendTicketEmail(
  attendeeId: string,
  prisma: PrismaClient,
  env: NodeJS.ProcessEnv = process.env,
  deps: MailDeliveryDeps = {},
  options: ResendTicketEmailOptions = {},
) {
  const attendee = await prisma.attendee.findUniqueOrThrow({ where: { id: attendeeId } });
  return sendTicketEmails(
    attendee.event_id,
    {
      attendeeIds: [attendeeId],
      purpose: "resend",
      ...(options.to ? { recipientEmail: options.to } : {}),
      ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
      ...(options.timezone ? { timezone: options.timezone } : {}),
    },
    prisma,
    env,
    deps,
  );
}
