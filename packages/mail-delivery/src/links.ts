import type { PrismaClient } from "@admitto/db";
import { decryptFromString } from "@admitto/crypto";
import { validateHttpUrl } from "@admitto/mail-templates";

/** Attendee fields required to build mail ticket/QR links. */
export interface AttendeeLinkInput {
  id: string;
  public_ref: string | null;
  qr_payload: string | null;
  external_uuid: string | null;
}

/** Event fields required to build mail ticket/QR/wallet links. */
export interface EventLinkInput {
  slug: string;
  wallet_enabled: boolean;
  wallet_template_id: string | null;
  wallet_api_key_enc: string | null;
  wallet_apple_enabled: boolean;
  wallet_google_enabled: boolean;
}

/** Resolved absolute ticket, QR image, and wallet URLs for template materialization. Wallet
 * URLs are the same on-demand redirect routes the ticket page's own buttons use (create-or-reuse
 * the pass, then 302 to the provider) - empty string when wallet isn't configured/enabled for
 * this event or platform, matching how the ticket page hides that button in the same case. */
export interface AttendeeMailLinks {
  ticket_url: string;
  qr_image_url: string;
  apple_wallet_url: string;
  google_wallet_url: string;
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

/** Wallet URLs off the same internal ticket path the on-demand routes are registered under
 * (apps/web/src/app.ts's /t/:token/wallet/:platform and /t/:eventSlug/a/:ref/wallet/:platform) -
 * built from `internalTicketPath`, never from `ticket_url` itself, since an agency ticket_url can
 * be an external override URL that these routes don't exist under. */
function walletUrls(
  event: EventLinkInput,
  internalTicketPath: string,
): Pick<AttendeeMailLinks, "apple_wallet_url" | "google_wallet_url"> {
  const configured = event.wallet_enabled && !!event.wallet_template_id && !!event.wallet_api_key_enc;
  return {
    apple_wallet_url: configured && event.wallet_apple_enabled ? `${internalTicketPath}/wallet/apple` : "",
    google_wallet_url: configured && event.wallet_google_enabled ? `${internalTicketPath}/wallet/google` : "",
  };
}

/**
 * Build ticket_url, qr_image_url, and wallet URLs for mail template vars.
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
    const internalTicketPath = `${root}/t/${event.slug}/a/${ref}`;
    const qr_image_url = `${root}/q/${event.slug}/a/${ref}.png`;
    const agencyUrl = validatedAgencyTicketUrl(agency);
    const ticket_url = agencyUrl ?? internalTicketPath;
    return { ticket_url, qr_image_url, ...walletUrls(event, internalTicketPath) };
  }

  if (!plaintextToken) {
    throw new Error("Internal attendee requires plaintext token for mail links");
  }

  const internalTicketPath = `${root}/t/${plaintextToken}`;
  return {
    ticket_url: internalTicketPath,
    qr_image_url: `${root}/q/${plaintextToken}.png`,
    ...walletUrls(event, internalTicketPath),
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
