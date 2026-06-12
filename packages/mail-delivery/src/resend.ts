import type { PrismaClient } from "@prisma/client";
import { sendTicketEmails, type MailDeliveryDeps } from "./send.js";

/** Explicit resend — new EmailDelivery row with purpose=resend and fresh render. */
export async function resendTicketEmail(
  attendeeId: string,
  prisma: PrismaClient,
  env: NodeJS.ProcessEnv = process.env,
  deps: MailDeliveryDeps = {},
) {
  const attendee = await prisma.attendee.findUniqueOrThrow({ where: { id: attendeeId } });
  return sendTicketEmails(
    attendee.event_id,
    { attendeeIds: [attendeeId], purpose: "resend" },
    prisma,
    env,
    deps,
  );
}
