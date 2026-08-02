import type { LookupAddress } from "node:dns";
import {
  isBlockedPrivateOrMetadataHost,
  isLoopbackHost,
  resolveSafeHostname,
  unbracketHostname,
} from "@admitto/shared/ssrf-guard";

/**
 * SSRF guard for mail transport destinations (Power Automate webhook URL, SMTP host).
 * Both are settable via event-scoped admin config — see @admitto/mailer-config — and the
 * server itself makes the outbound connection, so an unvalidated destination lets whoever
 * can write that config make Admitto's server reach internal/loopback/metadata addresses.
 */

/** Sync literal-string check, for zod schema refinements at config write-time. */
export function isBlockedMailHost(hostname: string): boolean {
  const host = unbracketHostname(hostname);
  return isLoopbackHost(host) || isBlockedPrivateOrMetadataHost(host);
}

/**
 * DNS-resolution-time recheck — call immediately before the real outbound connection
 * (Power Automate fetch / SMTP connect). Throws if the hostname is, or resolves to, a
 * private/loopback/link-local/metadata address. Written config can pass isBlockedMailHost
 * at save-time and still resolve to a blocked address later (DNS rebinding); this is the
 * layer that closes that gap. Returns the resolved records so the caller can pin the real
 * connection to them — resolving here and then letting fetch/nodemailer do their own,
 * separate DNS lookup for the actual connect would reopen the same DNS-rebinding gap.
 *
 * Opt-in escape hatch: `ALLOW_PRIVATE_MAIL_DESTINATIONS=true` skips the private/link-local
 * check (local lab SMTP on RFC1918 only — never enable in production).
 */
export async function resolveSafeMailDestination(hostname: string): Promise<LookupAddress[]> {
  const host = unbracketHostname(hostname);
  if (process.env["ALLOW_PRIVATE_MAIL_DESTINATIONS"]?.trim().toLowerCase() === "true") {
    const { lookup } = await import("node:dns/promises");
    return lookup(host, { all: true, verbatim: true });
  }
  if (isLoopbackHost(host) || isBlockedPrivateOrMetadataHost(host)) {
    throw new Error("destination is a private, loopback, or link-local address");
  }
  return resolveSafeHostname(host);
}

/** Same check as {@link resolveSafeMailDestination}, for callers that don't need the records. */
export async function assertSafeMailDestination(hostname: string): Promise<void> {
  await resolveSafeMailDestination(hostname);
}
