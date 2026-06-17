import type { PrismaClient } from "@prisma/client";
import { sendTicketEmails, type MailDeliveryDeps } from "./send.js";

export interface ResendTicketEmailOptions {
  /** Alternate delivery address for this send only (does not update Attendee.email). */
  to?: string;
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
    },
    prisma,
    env,
    deps,
  );
}
