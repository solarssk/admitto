import type { LookupAddress } from "node:dns";
import {
  isBlockedPrivateOrMetadataHost,
  isLoopbackHost,
  resolveSafeHostname,
  SafeHostnameError,
  unbracketHostname,
} from "@admitto/shared/ssrf-guard";

/**
 * SSRF guard for mail transport destinations (Power Automate webhook URL, SMTP host).
 * Both are settable via event-scoped admin config - see @admitto/mailer-config - and the
 * server itself makes the outbound connection, so an unvalidated destination lets whoever
 * can write that config make Admitto's server reach internal/loopback/metadata addresses.
 */

/** Stable API / operator-facing codes for mail destination SSRF failures at connect time. */
export type MailDestinationErrorCode =
  | "mail_destination_blocked"
  | "mail_destination_unresolved";

/** Thrown when SMTP/Power Automate destination fails DNS or SSRF checks before send. */
export class MailDestinationError extends Error {
  readonly code: MailDestinationErrorCode;

  constructor(code: MailDestinationErrorCode, message: string) {
    super(message);
    this.name = "MailDestinationError";
    this.code = code;
  }
}

/**
 * Opt-in lab escape hatch. Honored only when `ALLOW_PRIVATE_MAIL_DESTINATIONS=true` and
 * `NODE_ENV` is not `production`. Never enable in production: it bypasses loopback, RFC1918 /
 * IPv6-private, link-local, metadata, and unspecified-address checks at save and connect time.
 *
 * Self-hosted production with a LAN SMTP/IMAP host should use
 * `MAIL_PRIVATE_DESTINATION_ALLOWLIST` instead (exact hostnames / IP literals).
 */
function allowPrivateMailDestinations(): boolean {
  if (process.env["NODE_ENV"]?.trim().toLowerCase() === "production") {
    return false;
  }
  return process.env["ALLOW_PRIVATE_MAIL_DESTINATIONS"]?.trim().toLowerCase() === "true";
}

/**
 * Comma-separated exact hostnames or IP literals (case-insensitive) that may be private /
 * loopback at save and connect time. Honored in production. Ops-controlled only (env), not UI.
 */
function parseMailPrivateDestinationAllowlist(): Set<string> {
  const raw = process.env["MAIL_PRIVATE_DESTINATION_ALLOWLIST"]?.trim() ?? "";
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((entry) => unbracketHostname(entry.trim().toLowerCase()))
      .filter((entry) => entry.length > 0),
  );
}

function isAllowlistedMailHost(hostname: string): boolean {
  return parseMailPrivateDestinationAllowlist().has(unbracketHostname(hostname).toLowerCase());
}

/** Lab global bypass (non-production) or exact allowlist match (any NODE_ENV). */
function skipPrivateMailDestinationChecks(hostname: string): boolean {
  return allowPrivateMailDestinations() || isAllowlistedMailHost(hostname);
}

async function lookupMailDestinationUnrestricted(host: string): Promise<LookupAddress[]> {
  const { lookup } = await import("node:dns/promises");
  try {
    return await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new MailDestinationError(
      "mail_destination_unresolved",
      "hostname could not be resolved",
    );
  }
}

/**
 * Sync literal-string check, for zod schema refinements at config write-time.
 * Honors the same `ALLOW_PRIVATE_MAIL_DESTINATIONS` / allowlist overrides as
 * {@link resolveSafeMailDestination} so RFC1918 SMTP literals (e.g. `192.168.1.10`)
 * can be saved when explicitly permitted, not only hostnames that later resolve privately.
 */
export function isBlockedMailHost(hostname: string): boolean {
  if (skipPrivateMailDestinationChecks(hostname)) {
    return false;
  }
  const host = unbracketHostname(hostname);
  return isLoopbackHost(host) || isBlockedPrivateOrMetadataHost(host);
}

function mapSafeHostnameError(err: SafeHostnameError): MailDestinationError {
  if (err.code === "hostname_unresolved") {
    return new MailDestinationError("mail_destination_unresolved", err.message);
  }
  return new MailDestinationError("mail_destination_blocked", err.message);
}

/**
 * DNS-resolution-time recheck - call immediately before the real outbound connection
 * (Power Automate fetch / SMTP connect). Throws if the hostname is, or resolves to, a
 * private/loopback/link-local/metadata address. Written config can pass isBlockedMailHost
 * at save-time and still resolve to a blocked address later (DNS rebinding); this is the
 * layer that closes that gap. Returns the resolved records so the caller can pin the real
 * connection to them - resolving here and then letting fetch/nodemailer do their own,
 * separate DNS lookup for the actual connect would reopen the same DNS-rebinding gap.
 *
 * Escape hatches:
 * - `ALLOW_PRIVATE_MAIL_DESTINATIONS=true` (non-production only): skip checks for any host.
 * - `MAIL_PRIVATE_DESTINATION_ALLOWLIST` (any NODE_ENV): skip checks only for listed hosts.
 */
export async function resolveSafeMailDestination(hostname: string): Promise<LookupAddress[]> {
  const host = unbracketHostname(hostname);
  if (skipPrivateMailDestinationChecks(host)) {
    return lookupMailDestinationUnrestricted(host);
  }
  if (isLoopbackHost(host) || isBlockedPrivateOrMetadataHost(host)) {
    throw new MailDestinationError(
      "mail_destination_blocked",
      "destination is a private, loopback, or link-local address",
    );
  }
  try {
    return await resolveSafeHostname(host);
  } catch (err) {
    if (err instanceof SafeHostnameError) {
      throw mapSafeHostnameError(err);
    }
    throw err;
  }
}

/** Same check as {@link resolveSafeMailDestination}, for callers that don't need the records. */
export async function assertSafeMailDestination(hostname: string): Promise<void> {
  await resolveSafeMailDestination(hostname);
}
