import type { PrismaClient } from "@prisma/client";
import { decryptFromString } from "@admitto/crypto";
import { validateHttpUrl } from "@admitto/mail-templates";

/** Attendee fields required to build mail ticket/QR links. */
export interface AttendeeLinkInput {
  id: string;
  public_ref: string | null;
  qr_payload: string | null;
  external_uuid: string | null;
}

/** Event fields required to build mail ticket/QR links. */
export interface EventLinkInput {
  slug: string;
}

/** Resolved absolute ticket and QR image URLs for template materialization. */
export interface AttendeeMailLinks {
  ticket_url: string;
  qr_image_url: string;
}

function agencyPayload(attendee: AttendeeLinkInput): string | null {
  return attendee.qr_payload ?? attendee.external_uuid;
}

/** Returns validated http(s) agency ticket URL, or null when payload is not a URL. */
function validatedAgencyTicketUrl(payload: string): string | null {
  try {
    const validated = validateHttpUrl("ticket_url", payload);
    return validated === "" ? null : validated;
  } catch {
    return null;
  }
}

/**
 * Build ticket_url and qr_image_url for mail template vars.
 * @throws when agency attendee has no `public_ref` or internal attendee has no plaintext token
 */
export function buildAttendeeMailLinks(
  attendee: AttendeeLinkInput,
  event: EventLinkInput,
  baseUrl: string,
  plaintextToken?: string,
): AttendeeMailLinks {
  const root = baseUrl.replace(/\/$/, "");
  const agency = agencyPayload(attendee);

  if (agency !== null) {
    if (!attendee.public_ref) {
      throw new Error(`Agency attendee ${attendee.id} missing public_ref for mail links`);
    }
    const ref = attendee.public_ref;
    const qr_image_url = `${root}/q/${event.slug}/a/${ref}.png`;
    const agencyUrl = validatedAgencyTicketUrl(agency);
    const ticket_url = agencyUrl ?? `${root}/t/${event.slug}/a/${ref}`;
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
