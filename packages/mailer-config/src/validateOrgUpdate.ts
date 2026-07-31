import type { MailSettings } from "@admitto/db";
import { mergeMailSettingsRow } from "./mailSettings.js";
import { tryParseOrgMailConfigFromRow, tryParseEventMailConfigFromRow } from "./resolver.js";
import type { MailSettingsInput } from "./types.js";

function effectiveProvider(
  merged: MailSettings,
  env: NodeJS.ProcessEnv,
  fallback?: MailSettings | null,
): string | null | undefined {
  const fromEnv = env.EMAIL_PROVIDER?.trim();
  if (fromEnv) return fromEnv.toLowerCase();
  return merged.provider ?? fallback?.provider;
}

function shouldValidateMergedTransport(
  input: MailSettingsInput,
  merged: MailSettings,
  env: NodeJS.ProcessEnv,
  fallback?: MailSettings | null,
): boolean {
  if ("provider" in input && input.provider === "") {
    return false;
  }
  // A provider-less event override still resolves through the org's provider at send
  // time (resolveMailConfig precedence) — skipping validation here let a conflicting
  // fromAddress/allowedFromDomain slip past until send (CodeRabbit review).
  if (!effectiveProvider(merged, env, fallback)) {
    return false;
  }
  // No blanket "secret-only updates skip validation" exemption: clearing the only
  // stored credential on an already-active transport is itself a secret-only update,
  // and must still be validated so it fails loudly instead of silently disabling mail
  // (CodeRabbit review — this previously let `{ smtpPassword: "" }` return 200 on a
  // fully configured SMTP transport).
  return true;
}

/**
 * Validates that the org mail settings row would resolve to a complete transport
 * after applying `input`, using the same merge + parse path as runtime send.
 */
export function validateOrgMailSettingsUpdate(
  currentOrgRow: MailSettings | null,
  input: MailSettingsInput,
  env: NodeJS.ProcessEnv = process.env,
): { ok: true } | { ok: false; error: string } {
  const merged = mergeMailSettingsRow(currentOrgRow, input);
  if (!shouldValidateMergedTransport(input, merged, env)) {
    return { ok: true };
  }
  return tryParseOrgMailConfigFromRow(merged, env);
}

/**
 * Validates that the event mail settings row would resolve to a complete transport
 * after applying `input`, resolving against the org row as fallback — same
 * precedence resolveMailConfig uses at send time. If the event's own merged row
 * ends up with no provider, the event is inheriting the (already-validated) org
 * transport, so there's nothing new to check.
 */
export function validateEventMailSettingsUpdate(
  currentEventRow: MailSettings | null,
  orgRow: MailSettings | null,
  input: MailSettingsInput,
  env: NodeJS.ProcessEnv = process.env,
): { ok: true } | { ok: false; error: string } {
  const merged = mergeMailSettingsRow(currentEventRow, input);
  if (!shouldValidateMergedTransport(input, merged, env, orgRow)) {
    return { ok: true };
  }
  return tryParseEventMailConfigFromRow(merged, orgRow, env);
}
