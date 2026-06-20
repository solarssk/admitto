import type { MailSettings } from "@prisma/client";
import { rawMailFieldsFromEnv } from "./envFields.js";
import { mergeOrgMailSettingsRow } from "./mailSettings.js";
import { tryParseOrgMailConfigFromRow } from "./resolver.js";
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
): string | null | undefined {
  return rawMailFieldsFromEnv(env).provider ?? merged.provider;
}

function shouldValidateMergedTransport(
  input: MailSettingsInput,
  merged: MailSettings,
  env: NodeJS.ProcessEnv,
): boolean {
  if ("provider" in input && input.provider === "") {
    return false;
  }
  if (!effectiveProvider(merged, env)) {
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
  const merged = mergeOrgMailSettingsRow(currentOrgRow, input);
  if (!shouldValidateMergedTransport(input, merged, env)) {
    return { ok: true };
  }
  return tryParseOrgMailConfigFromRow(merged, env);
}
