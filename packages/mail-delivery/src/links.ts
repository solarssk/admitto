import type { PrismaClient } from "@prisma/client";
import { decryptFromString } from "@admitto/crypto";
import { validateHttpUrl } from "@admitto/mail-templates";

export interface AttendeeLinkInput {
  id: string;
  qr_payload: string | null;
  external_uuid: string | null;
}

export interface EventLinkInput {
  slug: string;
}

export interface AttendeeMailLinks {
  ticket_url: string;
  qr_image_url: string;
}

function agencyPayload(attendee: AttendeeLinkInput): string | null {
  return attendee.qr_payload ?? attendee.external_uuid;
}

function isAgencyPayloadUrl(payload: string): boolean {
  try {
    const validated = validateHttpUrl("ticket_url", payload);
    return validated !== "";
  } catch {
    return false;
  }
}

/** Build ticket_url and qr_image_url for mail template vars. */
export function buildAttendeeMailLinks(
  attendee: AttendeeLinkInput,
  event: EventLinkInput,
  baseUrl: string,
  plaintextToken?: string,
): AttendeeMailLinks {
  const root = baseUrl.replace(/\/$/, "");
  const agency = agencyPayload(attendee);

  if (agency !== null) {
    const qr_image_url = `${root}/q/${event.slug}/a/${attendee.id}.png`;
    const ticket_url = isAgencyPayloadUrl(agency)
      ? validateHttpUrl("ticket_url", agency)
      : `${root}/t/${event.slug}/a/${attendee.id}`;
    return { ticket_url, qr_image_url };
  }

  if (!plaintextToken) {
    throw new Error("Internal attendee requires plaintext token for mail links");
  }

  return {
    ticket_url: `${root}/t/${plaintextToken}`,
    qr_image_url: `${root}/q/${plaintextToken}.png`,
  };
}

/** Resolve mail links at send/retry — decrypts token_enc only in the point of use. */
export async function resolveAttendeeMailLinks(
  attendeeId: string,
  prisma: PrismaClient,
  baseUrl: string,
): Promise<AttendeeMailLinks> {
  const attendee = await prisma.attendee.findUniqueOrThrow({
    where: { id: attendeeId },
    include: { event: true },
  });

  const agency = agencyPayload(attendee);
  let plaintextToken: string | undefined;
  if (agency === null) {
    if (!attendee.token_enc) {
      throw new Error(`Attendee ${attendee.id} missing token_enc for mail links`);
    }
    plaintextToken = decryptFromString(attendee.token_enc);
  }

  return buildAttendeeMailLinks(attendee, attendee.event, baseUrl, plaintextToken);
}
