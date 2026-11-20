/**
 * Where the links a guest is sent point (D-C6): the one function that chooses the host, so a mail, a link to copy, the address a
 * company sign-in returns to and a ticket page cannot disagree about it.
 *
 * The event's own address is used only once it is VERIFIED (`custom_domain_verified_at`, set by the check of PR 120): an address
 * that is set but not working must not be where guests are sent, and a later failure does not take it back (the check warns, D-C6).
 * Without it, the address of the instance is used, as it was before events had their own.
 */
import { parseCustomDomain } from "./customDomain.js";

/** The columns of an event's registration settings that decide the host of its guests' links. */
export interface GuestDomain {
  custom_domain: string | null;
  custom_domain_verified_at: Date | null;
}

/** An event as far as the choice of host goes: the relation is part of the type, so a caller that did not load it does not compile. */
export interface GuestOriginEvent {
  registration_settings: GuestDomain | null;
}

/**
 * `https://<address>` of the event when it has a verified address of its own, else null. A stored value that is not an address of
 * the kind a superadmin may set (the table cannot hold one that is not lower case, but a value written by hand could be anything)
 * is not used: the guests are sent to the instance rather than to a host nobody checked.
 */
export function customGuestOrigin(settings: GuestDomain | null): string | null {
  if (!settings?.custom_domain || settings.custom_domain_verified_at === null) return null;
  const parsed = parseCustomDomain(settings.custom_domain);
  return parsed.ok && parsed.domain === settings.custom_domain ? `https://${parsed.domain}` : null;
}

/** The origin (no trailing slash) that the guest-facing links of `event` are built on: its verified own address, else `instanceBaseUrl`. */
export function resolveGuestOrigin(event: GuestOriginEvent, instanceBaseUrl: string): string {
  return customGuestOrigin(event.registration_settings) ?? instanceBaseUrl.replace(/\/$/, "");
}
