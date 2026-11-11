import type { PrismaClient } from "@admitto/db";
import { decryptFromString, signRegistrationConfirm } from "@admitto/crypto";
import { validateHttpUrl } from "@admitto/mail-templates";
import { resolveGuestOrigin, type GuestDomain } from "@admitto/shared";

/** Attendee fields required to build mail ticket/QR links. */
export interface AttendeeLinkInput {
  id: string;
  public_ref: string | null;
  qr_payload: string | null;
  external_uuid: string | null;
}

/** Event fields required to build mail ticket/QR/wallet links. `registration_settings` carries the event's own address for guests
 * (D-C6): it is part of the type so that a caller that did not load it does not compile, and the choice of host is made here. */
export interface EventLinkInput {
  slug: string;
  registration_settings: GuestDomain | null;
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

/** The columns of an event's registration settings that decide the host of its guests' links, and no others. */
export const GUEST_DOMAIN_SELECT = { custom_domain: true, custom_domain_verified_at: true } as const;

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
 * be an external override URL that these routes don't exist under. The path is on the address of the
 * INSTANCE, not the event's own: the wallet stays on the main address (D-C6). */
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
 * Build ticket_url, qr_image_url, and wallet URLs for mail template vars. `baseUrl` is the address of the instance: the ticket page
 * and the QR image are on the event's own address when it has a verified one (`resolveGuestOrigin`, D-C6), and the wallet links are
 * always on the instance's.
 * @throws when agency attendee has no `public_ref` or internal attendee has no plaintext token
 */
export function buildAttendeeMailLinks(
  attendee: AttendeeLinkInput,
  event: EventLinkInput,
  baseUrl: string,
  plaintextToken?: string,
): AttendeeMailLinks {
  const root = baseUrl.replace(/\/$/, "");
  const guestRoot = resolveGuestOrigin(event, root);
  const agency = agencyPayload(attendee);

  if (agency !== null) {
    if (!attendee.public_ref) {
      throw new Error(`Agency attendee ${attendee.id} missing public_ref for mail links`);
    }
    const ref = attendee.public_ref;
    const qr_image_url = `${guestRoot}/q/${event.slug}/a/${ref}.png`;
    const agencyUrl = validatedAgencyTicketUrl(agency);
    const ticket_url = agencyUrl ?? `${guestRoot}/t/${event.slug}/a/${ref}`;
    return { ticket_url, qr_image_url, ...walletUrls(event, `${root}/t/${event.slug}/a/${ref}`) };
  }

  if (!plaintextToken) {
    throw new Error("Internal attendee requires plaintext token for mail links");
  }

  return {
    ticket_url: `${guestRoot}/t/${plaintextToken}`,
    qr_image_url: `${guestRoot}/q/${plaintextToken}.png`,
    ...walletUrls(event, `${root}/t/${plaintextToken}`),
  };
}

/** Resolve mail links at send/retry - decrypts token_enc only in the point of use. `baseUrl` is the instance's address; the host of
 * the guest-facing links is chosen from the event (see `buildAttendeeMailLinks`), so no caller has to. */
export async function resolveAttendeeMailLinks(
  attendeeId: string,
  prisma: PrismaClient,
  baseUrl: string,
): Promise<AttendeeMailLinks> {
  const attendee = await prisma.attendee.findUniqueOrThrow({
    where: { id: attendeeId },
    include: { event: { include: { registration_settings: { select: GUEST_DOMAIN_SELECT } } } },
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

/**
 * Absolute e-mail confirmation link of a guest registration:
 * `{guestOrigin}/r/{slug}/confirm/{registrationId}.{mac}`. Stateless and deterministic - the same
 * registration id always gives the same link, so a re-sent mail repeats it. Verification and the
 * 24 h expiry belong to the confirm route (`verifyRegistrationConfirm` in `@admitto/crypto`).
 */
export function buildConfirmUrl(guestOrigin: string, slug: string, registrationId: string): string {
  const root = guestOrigin.replace(/\/$/, "");
  return `${root}/r/${slug}/confirm/${registrationId}.${signRegistrationConfirm(registrationId)}`;
}
