import type { PatchSystemSettingsBody, SettingSource, SystemSettingsDto } from "../api/types.js";

const MS_PER_HOUR = 3_600_000;
const MS_PER_MINUTE = 60_000;

export interface SecuritySettingsDraft {
  sessionTtlH: number;
  opTtlH: number;
  sessionIdleM: number;
  opIdleM: number;
  trustedDays: number;
  mfaRoles: string[];
}

function sortedRolesKey(roles: string[]): string {
  return [...roles].sort((a, b) => a.localeCompare(b)).join(",");
}

/** Build a PATCH body from the current draft, skipping env-locked fields. */
export function buildSecurityPatchBody(
  settings: SystemSettingsDto,
  draft: SecuritySettingsDraft,
  fieldLocked: (source: SettingSource) => boolean,
): { body: PatchSystemSettingsBody; hasChanges: boolean } {
  const body: PatchSystemSettingsBody = {};
  let hasChanges = false;

  const applyIfEditable = (locked: boolean, changed: boolean, apply: () => void) => {
    if (locked || !changed) return;
    apply();
    hasChanges = true;
  };

  applyIfEditable(
    fieldLocked(settings.session_ttl_ms.source),
    draft.sessionTtlH !== Math.round(settings.session_ttl_ms.value / MS_PER_HOUR),
    () => {
      body.session_ttl_ms = draft.sessionTtlH * MS_PER_HOUR;
    },
  );
  applyIfEditable(
    fieldLocked(settings.operator_session_ttl_ms.source),
    draft.opTtlH !== Math.round(settings.operator_session_ttl_ms.value / MS_PER_HOUR),
    () => {
      body.operator_session_ttl_ms = draft.opTtlH * MS_PER_HOUR;
    },
  );
  applyIfEditable(
    fieldLocked(settings.session_idle_timeout_ms.source),
    draft.sessionIdleM !== Math.round(settings.session_idle_timeout_ms.value / MS_PER_MINUTE),
    () => {
      body.session_idle_timeout_ms = draft.sessionIdleM * MS_PER_MINUTE;
    },
  );
  applyIfEditable(
    fieldLocked(settings.operator_session_idle_timeout_ms.source),
    draft.opIdleM !== Math.round(settings.operator_session_idle_timeout_ms.value / MS_PER_MINUTE),
    () => {
      body.operator_session_idle_timeout_ms = draft.opIdleM * MS_PER_MINUTE;
    },
  );
  applyIfEditable(
    fieldLocked(settings.trusted_device_days.source),
    draft.trustedDays !== settings.trusted_device_days.value,
    () => {
      body.trusted_device_days = draft.trustedDays;
    },
  );
  applyIfEditable(
    fieldLocked(settings.mfa_required_roles.source),
    sortedRolesKey(draft.mfaRoles) !== sortedRolesKey(settings.mfa_required_roles.value),
    () => {
      body.mfa_required_roles = draft.mfaRoles;
    },
  );

  return { body, hasChanges };
}
