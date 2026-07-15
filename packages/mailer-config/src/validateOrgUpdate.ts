import type { MailSettings } from "@prisma/client";
import { mergeMailSettingsRow } from "./mailSettings.js";
import { tryParseOrgMailConfigFromRow, tryParseEventMailConfigFromRow } from "./resolver.js";
import type { MailSettingsInput } from "./types.js";

const SECRET_INPUT_KEYS = [
  "smtpPassword",
  "graphClientSecret",
  "powerAutomateKey",
  "powerAutomateUrl",
] as const satisfies ReadonlyArray<keyof MailSettingsInput>;

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
  const keys = Object.keys(input) as Array<keyof MailSettingsInput>;
  if (keys.length > 0 && keys.every((key) => (SECRET_INPUT_KEYS as readonly string[]).includes(key))) {
    return false;
  }
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
