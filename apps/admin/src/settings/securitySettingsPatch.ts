import { isValidCspTrustedOrigin, MAX_CSP_TRUSTED_ORIGINS } from "@admitto/auth/csp-trusted-origins";
import type { PatchSystemSettingsBody, SettingSource, SystemSettingsDto } from "../api/types.js";
import { parseListInput, joinListInput } from "../identity/cfAccessValidation.js";

const MS_PER_HOUR = 3_600_000;
const MS_PER_MINUTE = 60_000;

export interface SecuritySettingsDraft {
  sessionTtlH: string;
  opTtlH: string;
  sessionIdleM: string;
  opIdleM: string;
  trustedDays: string;
  mfaRoles: string[];
  cspTrustedOriginsRaw: string;
}

/** Parse a draft text field, clamp to bounds, and fall back when empty or non-numeric. */
export function parseDraftInt(text: string, min: number, max: number, fallback: number): number {
  const trimmed = text.trim();
  if (trimmed === "") return fallback;
  const parsed = Number.parseInt(trimmed, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/** Parse draft text for inline warnings without clamping partial input. */
export function previewDraftInt(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

export function draftFromSettings(s: SystemSettingsDto): SecuritySettingsDraft {
  return {
    sessionTtlH: String(Math.round(s.session_ttl_ms.value / MS_PER_HOUR)),
    opTtlH: String(Math.round(s.operator_session_ttl_ms.value / MS_PER_HOUR)),
    sessionIdleM: String(Math.round(s.session_idle_timeout_ms.value / MS_PER_MINUTE)),
    opIdleM: String(Math.round(s.operator_session_idle_timeout_ms.value / MS_PER_MINUTE)),
    trustedDays: String(s.trusted_device_days.value),
    mfaRoles: [...s.mfa_required_roles.value],
    cspTrustedOriginsRaw: joinListInput(s.csp_trusted_origins.value),
  };
}

function sortedRolesKey(roles: string[]): string {
  return [...roles].sort((a, b) => a.localeCompare(b)).join(",");
}

function sortedOriginsKey(origins: string[]): string {
  return [...origins].sort((a, b) => a.localeCompare(b)).join(",");
}

/** Validation errors for the trusted-origins draft text, for `SettingsFooter`'s
 *  `validationErrors` list. Empty array means the draft is ready to save. */
export function cspTrustedOriginsErrors(raw: string): string[] {
  const values = parseListInput(raw);
  const errors: string[] = [];
  if (values.length > MAX_CSP_TRUSTED_ORIGINS) {
    errors.push(`At most ${MAX_CSP_TRUSTED_ORIGINS} trusted origins are allowed.`);
  }
  for (const value of values) {
    if (!isValidCspTrustedOrigin(value)) {
      errors.push(`"${value}" is not a valid https:// origin.`);
    }
  }
  return errors;
}

/** Build a PATCH body from the current draft, skipping env-locked fields. */
export function buildSecurityPatchBody(
  settings: SystemSettingsDto,
  draft: SecuritySettingsDraft,
  fieldLocked: (source: SettingSource) => boolean,
): { body: PatchSystemSettingsBody; hasChanges: boolean } {
  const body: PatchSystemSettingsBody = {};
  let hasChanges = false;

  const savedSessionTtlH = Math.round(settings.session_ttl_ms.value / MS_PER_HOUR);
  const savedOpTtlH = Math.round(settings.operator_session_ttl_ms.value / MS_PER_HOUR);
  const savedSessionIdleM = Math.round(settings.session_idle_timeout_ms.value / MS_PER_MINUTE);
  const savedOpIdleM = Math.round(settings.operator_session_idle_timeout_ms.value / MS_PER_MINUTE);

  const sessionTtlH = parseDraftInt(draft.sessionTtlH, 1, 720, savedSessionTtlH);
  const opTtlH = parseDraftInt(draft.opTtlH, 1, 168, savedOpTtlH);
  const sessionIdleM = parseDraftInt(draft.sessionIdleM, 5, 240, savedSessionIdleM);
  const opIdleM = parseDraftInt(draft.opIdleM, 5, 480, savedOpIdleM);
  const trustedDays = parseDraftInt(draft.trustedDays, 0, 90, settings.trusted_device_days.value);

  const applyIfEditable = (locked: boolean, changed: boolean, apply: () => void) => {
    if (locked || !changed) return;
    apply();
    hasChanges = true;
  };

  applyIfEditable(
    fieldLocked(settings.session_ttl_ms.source),
    sessionTtlH !== savedSessionTtlH,
    () => {
      body.session_ttl_ms = sessionTtlH * MS_PER_HOUR;
    },
  );
  applyIfEditable(
    fieldLocked(settings.operator_session_ttl_ms.source),
    opTtlH !== savedOpTtlH,
    () => {
      body.operator_session_ttl_ms = opTtlH * MS_PER_HOUR;
    },
  );
  applyIfEditable(
    fieldLocked(settings.session_idle_timeout_ms.source),
    sessionIdleM !== savedSessionIdleM,
    () => {
      body.session_idle_timeout_ms = sessionIdleM * MS_PER_MINUTE;
    },
  );
  applyIfEditable(
    fieldLocked(settings.operator_session_idle_timeout_ms.source),
    opIdleM !== savedOpIdleM,
    () => {
      body.operator_session_idle_timeout_ms = opIdleM * MS_PER_MINUTE;
    },
  );
  applyIfEditable(
    fieldLocked(settings.trusted_device_days.source),
    trustedDays !== settings.trusted_device_days.value,
    () => {
      body.trusted_device_days = trustedDays;
    },
  );
  applyIfEditable(
    fieldLocked(settings.mfa_required_roles.source),
    sortedRolesKey(draft.mfaRoles) !== sortedRolesKey(settings.mfa_required_roles.value),
    () => {
      body.mfa_required_roles = draft.mfaRoles;
    },
  );
  const cspTrustedOrigins = parseListInput(draft.cspTrustedOriginsRaw);
  applyIfEditable(
    fieldLocked(settings.csp_trusted_origins.source),
    sortedOriginsKey(cspTrustedOrigins) !== sortedOriginsKey(settings.csp_trusted_origins.value),
    () => {
      body.csp_trusted_origins = cspTrustedOrigins;
    },
  );

  return { body, hasChanges };
}
