import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, Card, HintLabel, Input, Switch, Tooltip, useToast } from "@admitto/ui";
import { fetchSecuritySettings, patchSecuritySettings } from "../api/client.js";
import { roleLabel } from "../auth/role-labels.js";
import { useDelayedLoading } from "../hooks/useDelayedLoading.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { SystemSettingsDto, SettingSource } from "../api/types.js";
import { SettingsFooter } from "./mailTransportFormParts.js";
import {
  buildSecurityPatchBody,
  draftFromSettings,
  parseDraftInt,
  previewDraftInt,
  type SecuritySettingsDraft,
} from "./securitySettingsPatch.js";

const MS_PER_HOUR = 3_600_000;
const MS_PER_MINUTE = 60_000;
/** Inline-warning thresholds (P0-4): flag values that weaken session security without blocking them. */
const ABSOLUTE_LIFETIME_WARNING_HOURS = 24;
const ADMIN_IDLE_WARNING_MINUTES = 120;
const OPERATOR_IDLE_WARNING_MINUTES = 240;
const ABSOLUTE_LIFETIME_WARNING = `Sessions longer than ${ABSOLUTE_LIFETIME_WARNING_HOURS} hours increase the impact of a stolen session.`;
const ADMIN_IDLE_WARNING = "A long inactivity timeout leaves unattended admin sessions open longer.";
const OPERATOR_IDLE_WARNING = "A long inactivity timeout leaves unattended check-in stations open longer.";
const MFA_EMPTY_WARNING =
  "Two-factor authentication is off for every role. Not recommended for production.";
const MFA_ROLES = [
  { value: "superadmin", label: roleLabel("superadmin") },
  { value: "admin", label: roleLabel("admin") },
  { value: "operator", label: roleLabel("operator") },
] as const;
/** Shared control column width — mirrors Branding's FONT_SURFACE_SELECT_STYLE minWidth pattern
 * so every row's input lines up on the same right edge inside the parent grid. */
const SECURITY_NUMERIC_INPUT_STYLE = { width: "8rem", flexShrink: 0 } as const;
const SECURITY_CARD_HINT =
  "How long staff stay signed in, how long a device can skip the authenticator app, and which roles must use one.";

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

function SecurityFieldWarning({ message }: Readonly<{ message: string }>) {
  return (
    <Tooltip content={message} className="security-field-warning-trigger">
      <i className="ti ti-alert-circle" aria-label={message} />
    </Tooltip>
  );
}

function securityDraftHasChanges(settings: SystemSettingsDto, draft: SecuritySettingsDraft): boolean {
  return buildSecurityPatchBody(settings, draft, fieldLocked).hasChanges;
}

interface SecurityNumericRowProps {
  label: string;
  description: string;
  value: string;
  min: number;
  max: number;
  savedValue: number;
  source: SettingSource;
  warningMessage?: string;
  showDivider?: boolean;
  onChange: (value: string) => void;
}

function SecurityNumericRow({
  label,
  description,
  value,
  min,
  max,
  savedValue,
  source,
  warningMessage,
  showDivider = true,
  onChange,
}: Readonly<SecurityNumericRowProps>) {
  const locked = fieldLocked(source);
  const warned = Boolean(warningMessage);

  const commit = () => {
    onChange(String(parseDraftInt(value, min, max, savedValue)));
  };

  return (
    <div className="security-settings-item">
      <div className="settings-row__text">
        <strong>{label}</strong>
        <p>{description}</p>
      </div>
      <div className="security-settings-row__control">
        <div className="security-settings-field">
          <div className="security-settings-field__warning-slot">
            {warningMessage ? <SecurityFieldWarning message={warningMessage} /> : null}
          </div>
          <Input
            aria-label={label}
            type="number"
            min={min}
            max={max}
            style={SECURITY_NUMERIC_INPUT_STYLE}
            className={warned ? "at-input--warn" : undefined}
            value={value}
            disabled={locked}
            onChange={(e) => onChange(e.target.value)}
            onBlur={commit}
          />
        </div>
        <EnvBadge source={source} />
      </div>
      {showDivider && <div className="security-settings-row-divider" aria-hidden="true" />}
    </div>
  );
}

/** Settings panel — security policies: session TTL, remember-device duration, and MFA role requirements. Env-locked fields are read-only. */
export function SecurityPanel() {
  const { addToast } = useToast();
  const validationErrorsRef = useRef<HTMLUListElement>(null);
  const [settings, setSettings] = useState<SystemSettingsDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<SecuritySettingsDraft | null>(null);
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

    const { body, hasChanges } = buildSecurityPatchBody(settings, draft, fieldLocked);

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

  const handleReset = () => {
    if (!settings) return;
    setDraft(draftFromSettings(settings));
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
      <Card title={<HintLabel hint={SECURITY_CARD_HINT}>Security</HintLabel>}>
        <p className="sessions-status">Loading…</p>
      </Card>
    );
  }

  if (error || !settings || !draft) {
    return (
      <Card title={<HintLabel hint={SECURITY_CARD_HINT}>Security</HintLabel>}>
        <div className="sessions-status">
          <p>{error ?? "Unexpected error."}</p>
          <Button type="button" variant="secondary" onClick={load}>
            Retry
          </Button>
        </div>
      </Card>
    );
  }

  const mfaLocked = fieldLocked(settings.mfa_required_roles.source);
  const mfaEmpty = draft.mfaRoles.length === 0;
  const hasUnsavedChanges = securityDraftHasChanges(settings, draft);

  const savedSessionTtlH = Math.round(settings.session_ttl_ms.value / MS_PER_HOUR);
  const savedOpTtlH = Math.round(settings.operator_session_ttl_ms.value / MS_PER_HOUR);
  const savedSessionIdleM = Math.round(settings.session_idle_timeout_ms.value / MS_PER_MINUTE);
  const savedOpIdleM = Math.round(settings.operator_session_idle_timeout_ms.value / MS_PER_MINUTE);

  const sessionTtlH = previewDraftInt(draft.sessionTtlH);
  const sessionIdleM = previewDraftInt(draft.sessionIdleM);
  const opTtlH = previewDraftInt(draft.opTtlH);
  const opIdleM = previewDraftInt(draft.opIdleM);

  return (
    <>
      <Card title={<HintLabel hint={SECURITY_CARD_HINT}>Security</HintLabel>}>
        <div className="mail-transport-section security-settings-rows">
          <SecurityNumericRow
            label="Admin session maximum lifetime (hours)"
            description="Hard cap for admin and superadmin sessions, even if the user stays active. Allowed range: 1–720 hours."
            value={draft.sessionTtlH}
            min={1}
            max={720}
            savedValue={savedSessionTtlH}
            source={settings.session_ttl_ms.source}
            warningMessage={
              sessionTtlH !== null && sessionTtlH > ABSOLUTE_LIFETIME_WARNING_HOURS
                ? ABSOLUTE_LIFETIME_WARNING
                : undefined
            }
            onChange={(sessionTtlH) => setDraft({ ...draft, sessionTtlH })}
          />

          <SecurityNumericRow
            label="Admin session inactivity timeout (minutes)"
            description="Sign out admins and superadmins after this long without activity. Allowed range: 5–240 minutes."
            value={draft.sessionIdleM}
            min={5}
            max={240}
            savedValue={savedSessionIdleM}
            source={settings.session_idle_timeout_ms.source}
            warningMessage={
              sessionIdleM !== null && sessionIdleM > ADMIN_IDLE_WARNING_MINUTES
                ? ADMIN_IDLE_WARNING
                : undefined
            }
            onChange={(sessionIdleM) => setDraft({ ...draft, sessionIdleM })}
          />

          <SecurityNumericRow
            label="Operator session maximum lifetime (hours)"
            description="Hard cap for operator (check-in) sessions, even if the station stays active. Allowed range: 1–168 hours."
            value={draft.opTtlH}
            min={1}
            max={168}
            savedValue={savedOpTtlH}
            source={settings.operator_session_ttl_ms.source}
            warningMessage={
              opTtlH !== null && opTtlH > ABSOLUTE_LIFETIME_WARNING_HOURS
                ? ABSOLUTE_LIFETIME_WARNING
                : undefined
            }
            onChange={(opTtlH) => setDraft({ ...draft, opTtlH })}
          />

          <SecurityNumericRow
            label="Operator session inactivity timeout (minutes)"
            description="Sign out operators after this long without activity at the check-in station. Allowed range: 5–480 minutes."
            value={draft.opIdleM}
            min={5}
            max={480}
            savedValue={savedOpIdleM}
            source={settings.operator_session_idle_timeout_ms.source}
            warningMessage={
              opIdleM !== null && opIdleM > OPERATOR_IDLE_WARNING_MINUTES
                ? OPERATOR_IDLE_WARNING
                : undefined
            }
            onChange={(opIdleM) => setDraft({ ...draft, opIdleM })}
          />

          <SecurityNumericRow
            label="Remember device duration (days)"
            description='How long a trusted device can skip the authenticator app. Set 0 to turn off "remember this device". Allowed range: 0–90 days.'
            value={draft.trustedDays}
            min={0}
            max={90}
            savedValue={settings.trusted_device_days.value}
            source={settings.trusted_device_days.source}
            onChange={(trustedDays) => setDraft({ ...draft, trustedDays })}
          />

          <div className="security-settings-item">
            <div className="settings-row__text">
              <strong>Authenticator app required by role</strong>
              <p>
                Which roles must enter a code from an authenticator app at sign-in. Local accounts
                only; single sign-on is exempt.
              </p>
            </div>
            <div className="security-settings-row__control security-mfa-section__switches">
              <div className="security-settings-field__warning-slot">
                {mfaEmpty ? <SecurityFieldWarning message={MFA_EMPTY_WARNING} /> : null}
              </div>
              {MFA_ROLES.map((role) => (
                <Switch
                  key={role.value}
                  label={role.label}
                  checked={draft.mfaRoles.includes(role.value)}
                  disabled={mfaLocked}
                  onChange={() => toggleRole(role.value)}
                />
              ))}
              <EnvBadge source={settings.mfa_required_roles.source} />
            </div>
          </div>
        </div>
      </Card>

      <SettingsFooter
        validationErrors={[]}
        validationErrorsRef={validationErrorsRef}
        hasUnsavedChanges={hasUnsavedChanges}
        saving={saving}
        onReset={handleReset}
        onSave={() => void handleSave()}
      />
    </>
  );
}
