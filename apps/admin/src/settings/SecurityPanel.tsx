import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { Badge, Button, Card, Checkbox, Input, useToast } from "@admitto/ui";
import { fetchSecuritySettings, patchSecuritySettings } from "../api/client.js";
import { roleLabel } from "../auth/role-labels.js";
import { useDelayedLoading } from "../hooks/useDelayedLoading.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { PatchSystemSettingsBody, SystemSettingsDto, SettingSource } from "../api/types.js";

const MS_PER_HOUR = 3_600_000;
const MS_PER_MINUTE = 60_000;
/** Inline-warning thresholds (P0-4): flag values that weaken session security without blocking them. */
const ABSOLUTE_LIFETIME_WARNING_HOURS = 24;
const ADMIN_IDLE_WARNING_MINUTES = 120;
const OPERATOR_IDLE_WARNING_MINUTES = 240;
const MFA_ROLES = [
  { value: "superadmin", label: roleLabel("superadmin") },
  { value: "admin", label: roleLabel("admin") },
  { value: "operator", label: roleLabel("operator") },
] as const;

function fieldLocked(source: SettingSource): boolean {
  return source === "env";
}

function EnvBadge({ source }: Readonly<{ source: SettingSource }>) {
  if (!fieldLocked(source)) return null;
  return (
    <Badge variant="neutral" className="mail-field-env-badge">
      Managed by environment
    </Badge>
  );
}

interface Draft {
  sessionTtlH: number;
  opTtlH: number;
  sessionIdleM: number;
  opIdleM: number;
  trustedDays: number;
  mfaRoles: string[];
}

function draftFromSettings(s: SystemSettingsDto): Draft {
  return {
    sessionTtlH: Math.round(s.session_ttl_ms.value / MS_PER_HOUR),
    opTtlH: Math.round(s.operator_session_ttl_ms.value / MS_PER_HOUR),
    sessionIdleM: Math.round(s.session_idle_timeout_ms.value / MS_PER_MINUTE),
    opIdleM: Math.round(s.operator_session_idle_timeout_ms.value / MS_PER_MINUTE),
    trustedDays: s.trusted_device_days.value,
    mfaRoles: [...s.mfa_required_roles.value],
  };
}

/** Settings panel — security policies: session TTL, remember-device duration, and MFA role requirements. Env-locked fields are read-only. */
export function SecurityPanel() {
  const { addToast } = useToast();
  const [settings, setSettings] = useState<SystemSettingsDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchSecuritySettings();
      setSettings(data);
      setDraft(draftFromSettings(data));
    } catch (err) {
      const message = operatorApiErrorMessage(err, "Failed to load security settings.");
      setError(message);
      addToast(message, "error");
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async () => {
    if (!settings || !draft) return;
    setSaving(true);

    const body: PatchSystemSettingsBody = {};
    let hasChanges = false;

    if (!fieldLocked(settings.session_ttl_ms.source)) {
      if (draft.sessionTtlH !== Math.round(settings.session_ttl_ms.value / MS_PER_HOUR)) {
        body.session_ttl_ms = draft.sessionTtlH * MS_PER_HOUR;
        hasChanges = true;
      }
    }
    if (!fieldLocked(settings.operator_session_ttl_ms.source)) {
      if (draft.opTtlH !== Math.round(settings.operator_session_ttl_ms.value / MS_PER_HOUR)) {
        body.operator_session_ttl_ms = draft.opTtlH * MS_PER_HOUR;
        hasChanges = true;
      }
    }
    if (!fieldLocked(settings.session_idle_timeout_ms.source)) {
      if (
        draft.sessionIdleM !==
        Math.round(settings.session_idle_timeout_ms.value / MS_PER_MINUTE)
      ) {
        body.session_idle_timeout_ms = draft.sessionIdleM * MS_PER_MINUTE;
        hasChanges = true;
      }
    }
    if (!fieldLocked(settings.operator_session_idle_timeout_ms.source)) {
      if (
        draft.opIdleM !==
        Math.round(settings.operator_session_idle_timeout_ms.value / MS_PER_MINUTE)
      ) {
        body.operator_session_idle_timeout_ms = draft.opIdleM * MS_PER_MINUTE;
        hasChanges = true;
      }
    }
    if (!fieldLocked(settings.trusted_device_days.source)) {
      if (draft.trustedDays !== settings.trusted_device_days.value) {
        body.trusted_device_days = draft.trustedDays;
        hasChanges = true;
      }
    }
    if (!fieldLocked(settings.mfa_required_roles.source)) {
      const sorted = [...draft.mfaRoles].sort((a, b) => a.localeCompare(b)).join(",");
      const current = [...settings.mfa_required_roles.value].sort((a, b) => a.localeCompare(b)).join(",");
      if (sorted !== current) {
        body.mfa_required_roles = draft.mfaRoles;
        hasChanges = true;
      }
    }

    if (!hasChanges) {
      addToast("No changes to save.", "info");
      setSaving(false);
      return;
    }

    try {
      const updated = await patchSecuritySettings(body);
      setSettings(updated);
      setDraft(draftFromSettings(updated));
      addToast("Settings saved.", "success");
    } catch (err) {
      addToast(operatorApiErrorMessage(err, "Failed to save settings."), "error");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!settings) return;
    setSaving(true);

    const body: PatchSystemSettingsBody = {};
    if (!fieldLocked(settings.session_ttl_ms.source)) body.session_ttl_ms = null;
    if (!fieldLocked(settings.operator_session_ttl_ms.source)) body.operator_session_ttl_ms = null;
    if (!fieldLocked(settings.session_idle_timeout_ms.source)) body.session_idle_timeout_ms = null;
    if (!fieldLocked(settings.operator_session_idle_timeout_ms.source)) {
      body.operator_session_idle_timeout_ms = null;
    }
    if (!fieldLocked(settings.trusted_device_days.source)) body.trusted_device_days = null;
    if (!fieldLocked(settings.mfa_required_roles.source)) body.mfa_required_roles = null;

    try {
      const updated = await patchSecuritySettings(body);
      setSettings(updated);
      setDraft(draftFromSettings(updated));
      addToast("Reset to defaults.", "success");
    } catch (err) {
      addToast(operatorApiErrorMessage(err, "Failed to reset settings."), "error");
    } finally {
      setSaving(false);
    }
  };

  const toggleRole = (role: string) => {
    if (!draft) return;
    const current = draft.mfaRoles;
    const next = current.includes(role)
      ? current.filter((r) => r !== role)
      : [...current, role];
    setDraft({ ...draft, mfaRoles: next });
  };

  // A fetch that resolves near-instantly (localhost, a warm cache) would otherwise flash
  // the "Loading…" text on and off faster than it can register as loading — show it only
  // once the fetch has genuinely taken a moment.
  const showLoading = useDelayedLoading(loading);

  if (loading) {
    if (!showLoading) return null;
    return (
      <Card title="Security">
        <p className="sessions-status">Loading…</p>
      </Card>
    );
  }

  if (error || !settings || !draft) {
    return (
      <Card title="Security">
        <div className="sessions-status">
          <p>{error ?? "Unexpected error."}</p>
          <Button type="button" variant="secondary" onClick={load}>
            Retry
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card
      title="Security"
      footer={
        <div className="mail-transport-footer">
          <Button
            type="button"
            variant="secondary"
            disabled={saving}
            onClick={() => void handleReset()}
          >
            Reset to defaults
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={saving}
            onClick={() => void handleSave()}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      }
    >
      <div className="mail-transport-section">
        <div className="mail-field-row">
          <Input
            label="Admin session — maximum lifetime (hours)"
            type="number"
            min={1}
            max={720}
            value={String(draft.sessionTtlH)}
            disabled={fieldLocked(settings.session_ttl_ms.source)}
            onChange={(e) =>
              setDraft({
                ...draft,
                sessionTtlH: Math.max(1, Number.parseInt(e.target.value, 10) || 1),
              })
            }
          />
          <EnvBadge source={settings.session_ttl_ms.source} />
          <p className="mail-field-hint">
            Absolute limit for admin and superadmin sessions, regardless of activity (1–720 h).
          </p>
          {draft.sessionTtlH > ABSOLUTE_LIFETIME_WARNING_HOURS && (
            <p role="alert" className="text-warning">
              Sessions longer than {ABSOLUTE_LIFETIME_WARNING_HOURS} hours increase the impact of
              a stolen session.
            </p>
          )}
        </div>

        <div className="mail-field-row">
          <Input
            label="Admin session — inactivity timeout (minutes)"
            type="number"
            min={5}
            max={240}
            value={String(draft.sessionIdleM)}
            disabled={fieldLocked(settings.session_idle_timeout_ms.source)}
            onChange={(e) =>
              setDraft({
                ...draft,
                sessionIdleM: Math.max(5, Number.parseInt(e.target.value, 10) || 5),
              })
            }
          />
          <EnvBadge source={settings.session_idle_timeout_ms.source} />
          <p className="mail-field-hint">
            Signs an admin or superadmin out after this much inactivity (5–240 min).
          </p>
          {draft.sessionIdleM > ADMIN_IDLE_WARNING_MINUTES && (
            <p role="alert" className="text-warning">
              A long inactivity timeout leaves unattended admin sessions open longer.
            </p>
          )}
        </div>

        <div className="mail-field-row">
          <Input
            label="Operator session — maximum lifetime (hours)"
            type="number"
            min={1}
            max={168}
            value={String(draft.opTtlH)}
            disabled={fieldLocked(settings.operator_session_ttl_ms.source)}
            onChange={(e) =>
              setDraft({
                ...draft,
                opTtlH: Math.max(1, Number.parseInt(e.target.value, 10) || 1),
              })
            }
          />
          <EnvBadge source={settings.operator_session_ttl_ms.source} />
          <p className="mail-field-hint">
            Absolute limit for operator (check-in staff) sessions, regardless of activity (1–168 h).
          </p>
          {draft.opTtlH > ABSOLUTE_LIFETIME_WARNING_HOURS && (
            <p role="alert" className="text-warning">
              Sessions longer than {ABSOLUTE_LIFETIME_WARNING_HOURS} hours increase the impact of
              a stolen session.
            </p>
          )}
        </div>

        <div className="mail-field-row">
          <Input
            label="Operator session — inactivity timeout (minutes)"
            type="number"
            min={5}
            max={480}
            value={String(draft.opIdleM)}
            disabled={fieldLocked(settings.operator_session_idle_timeout_ms.source)}
            onChange={(e) =>
              setDraft({
                ...draft,
                opIdleM: Math.max(5, Number.parseInt(e.target.value, 10) || 5),
              })
            }
          />
          <EnvBadge source={settings.operator_session_idle_timeout_ms.source} />
          <p className="mail-field-hint">
            Signs an operator out after this much inactivity at the check-in station (5–480 min).
          </p>
          {draft.opIdleM > OPERATOR_IDLE_WARNING_MINUTES && (
            <p role="alert" className="text-warning">
              A long inactivity timeout leaves unattended check-in stations open longer.
            </p>
          )}
        </div>

        <div className="mail-field-row">
          <Input
            label='"Remember device" duration (days, 0 = off)'
            type="number"
            min={0}
            max={90}
            value={String(draft.trustedDays)}
            disabled={fieldLocked(settings.trusted_device_days.source)}
            onChange={(e) =>
              setDraft({
                ...draft,
                trustedDays: Math.max(0, Number.parseInt(e.target.value, 10) || 0),
              })
            }
          />
          <EnvBadge source={settings.trusted_device_days.source} />
          <p className="mail-field-hint">
            Days before a trusted device must re-verify 2FA. Set 0 to disable device trust entirely.
          </p>
        </div>

        <p className="mail-field-hint">
          Manage individual sessions in <Link to="/admin/users?tab=sessions">Users &amp; roles</Link>.
        </p>

        <div className="mail-field-row">
          <fieldset
            className="mfa-roles-fieldset"
            disabled={fieldLocked(settings.mfa_required_roles.source)}
          >
            <legend className="mail-field-label">Require 2FA for roles</legend>
            {MFA_ROLES.map((role) => (
              <Checkbox
                key={role.value}
                label={role.label}
                checked={draft.mfaRoles.includes(role.value)}
                onChange={() => toggleRole(role.value)}
              />
            ))}
          </fieldset>
          <EnvBadge source={settings.mfa_required_roles.source} />
          <p className="mail-field-hint">
            Roles that must complete TOTP 2FA on every login. Local accounts only; OIDC sessions
            are exempt.
          </p>
        </div>

        {draft.mfaRoles.length === 0 && (
          <p role="alert" className="text-warning">
            2FA is disabled for all roles. This is not recommended for production.
          </p>
        )}
      </div>
    </Card>
  );
}
