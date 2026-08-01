import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Badge, Button, Card, Input, Switch, Tooltip, useToast } from "@admitto/ui";
import { fetchSecuritySettings, patchSecuritySettings } from "../api/client.js";
import { roleLabel } from "../auth/role-labels.js";
import { useDelayedLoading } from "../hooks/useDelayedLoading.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { SystemSettingsDto, SettingSource } from "../api/types.js";
import { SettingsFooter } from "./mailTransportFormParts.js";
import { buildSecurityPatchBody } from "./securitySettingsPatch.js";

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

function securityCardTitle() {
  return (
    <Tooltip content={SECURITY_CARD_HINT} className="audit-log-scope-header">
      Security <i className="ti ti-info-circle" aria-hidden="true" />
    </Tooltip>
  );
}

function SecurityFieldWarning({ message }: Readonly<{ message: string }>) {
  return (
    <Tooltip content={message} className="security-field-warning-trigger">
      <i className="ti ti-alert-circle" aria-label={message} />
    </Tooltip>
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

function securityDraftHasChanges(settings: SystemSettingsDto, draft: Draft): boolean {
  return buildSecurityPatchBody(settings, draft, fieldLocked).hasChanges;
}

interface SecurityNumericRowProps {
  label: string;
  description: string;
  value: number;
  min: number;
  max: number;
  source: SettingSource;
  warningMessage?: string;
  showDivider?: boolean;
  syncKey?: number;
  onChange: (value: number) => void;
}

function SecurityNumericRow({
  label,
  description,
  value,
  min,
  max,
  source,
  warningMessage,
  showDivider = true,
  syncKey = 0,
  onChange,
}: Readonly<SecurityNumericRowProps>) {
  const locked = fieldLocked(source);
  const warned = Boolean(warningMessage);
  const [text, setText] = useState(String(value));

  useEffect(() => {
    setText(String(value));
  }, [value, syncKey]);

  const commit = () => {
    const trimmed = text.trim();
    if (trimmed === "") {
      setText(String(value));
      return;
    }
    const parsed = Number.parseInt(trimmed, 10);
    if (Number.isNaN(parsed)) {
      setText(String(value));
      return;
    }
    const clamped = Math.min(max, Math.max(min, parsed));
    setText(String(clamped));
    if (clamped !== value) {
      flushSync(() => onChange(clamped));
    }
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
            value={text}
            disabled={locked}
            onChange={(e) => setText(e.target.value)}
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
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [numericSyncKey, setNumericSyncKey] = useState(0);
  const draftRef = useRef(draft);
  draftRef.current = draft;

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
    if (!settings) return;
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    const currentDraft = draftRef.current;
    if (!currentDraft) return;
    setSaving(true);

    const { body, hasChanges } = buildSecurityPatchBody(settings, currentDraft, fieldLocked);

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
    setNumericSyncKey((key) => key + 1);
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
      <Card title={securityCardTitle()}>
        <p className="sessions-status">Loading…</p>
      </Card>
    );
  }

  if (error || !settings || !draft) {
    return (
      <Card title={securityCardTitle()}>
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

  return (
    <>
      <Card title={securityCardTitle()}>
        <div className="mail-transport-section security-settings-rows">
          <SecurityNumericRow
            syncKey={numericSyncKey}
            label="Admin session maximum lifetime (hours)"
            description="Hard cap for admin and superadmin sessions, even if the user stays active. Allowed range: 1–720 hours."
            value={draft.sessionTtlH}
            min={1}
            max={720}
            source={settings.session_ttl_ms.source}
            warningMessage={
              draft.sessionTtlH > ABSOLUTE_LIFETIME_WARNING_HOURS ? ABSOLUTE_LIFETIME_WARNING : undefined
            }
            onChange={(sessionTtlH) => setDraft({ ...draft, sessionTtlH })}
          />

          <SecurityNumericRow
            syncKey={numericSyncKey}
            label="Admin session inactivity timeout (minutes)"
            description="Sign out admins and superadmins after this long without activity. Allowed range: 5–240 minutes."
            value={draft.sessionIdleM}
            min={5}
            max={240}
            source={settings.session_idle_timeout_ms.source}
            warningMessage={
              draft.sessionIdleM > ADMIN_IDLE_WARNING_MINUTES ? ADMIN_IDLE_WARNING : undefined
            }
            onChange={(sessionIdleM) => setDraft({ ...draft, sessionIdleM })}
          />

          <SecurityNumericRow
            syncKey={numericSyncKey}
            label="Operator session maximum lifetime (hours)"
            description="Hard cap for operator (check-in) sessions, even if the station stays active. Allowed range: 1–168 hours."
            value={draft.opTtlH}
            min={1}
            max={168}
            source={settings.operator_session_ttl_ms.source}
            warningMessage={
              draft.opTtlH > ABSOLUTE_LIFETIME_WARNING_HOURS ? ABSOLUTE_LIFETIME_WARNING : undefined
            }
            onChange={(opTtlH) => setDraft({ ...draft, opTtlH })}
          />

          <SecurityNumericRow
            syncKey={numericSyncKey}
            label="Operator session inactivity timeout (minutes)"
            description="Sign out operators after this long without activity at the check-in station. Allowed range: 5–480 minutes."
            value={draft.opIdleM}
            min={5}
            max={480}
            source={settings.operator_session_idle_timeout_ms.source}
            warningMessage={
              draft.opIdleM > OPERATOR_IDLE_WARNING_MINUTES ? OPERATOR_IDLE_WARNING : undefined
            }
            onChange={(opIdleM) => setDraft({ ...draft, opIdleM })}
          />

          <SecurityNumericRow
            syncKey={numericSyncKey}
            label="Remember device duration (days)"
            description='How long a trusted device can skip the authenticator app. Set 0 to turn off "remember this device". Allowed range: 0–90 days.'
            value={draft.trustedDays}
            min={0}
            max={90}
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
