import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card, HintLabel, Input, Switch, Tooltip, useToast } from "@admitto/ui";
import { fetchSecuritySettings, patchSecuritySettings } from "../api/client.js";
import { roleLabel } from "../auth/role-labels.js";
import { useDelayedLoading } from "../hooks/useDelayedLoading.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { SystemSettingsDto, SettingSource } from "../api/types.js";
import { parseListInput, joinListInput } from "../identity/cfAccessValidation.js";
import { EnvBadge, SettingsFooter } from "./mailTransportFormParts.js";
import { CspTrustedOriginsModal } from "./CspTrustedOriginsModal.js";
import {
  buildSecurityPatchBody,
  cspTrustedOriginsErrors,
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
const CSP_TRUSTED_ORIGINS_WARNING =
  "Each trusted origin can run script code and receive data across the admin UI and sign-in pages. Only add origins you fully trust.";
const CSP_TRUSTED_ORIGINS_DESCRIPTION =
  "Extra https:// origins allowed to run script and send data on the admin UI and sign-in pages. Does not apply to the public ticket page.";
const MFA_ROLES = [
  { value: "superadmin", label: roleLabel("superadmin") },
  { value: "admin", label: roleLabel("admin") },
  { value: "operator", label: roleLabel("operator") },
] as const;
/** Shared control column width — mirrors Branding's FONT_SURFACE_SELECT_STYLE minWidth pattern
 * so every row's input lines up on the same right edge inside the parent grid. */
const SECURITY_NUMERIC_INPUT_STYLE = { width: "8rem", flexShrink: 0 } as const;
const SECURITY_CARD_HINT =
  "Already signed-in staff keep their current session until it expires or they sign out.";
const SECURITY_CARD_INTRO =
  "How long staff stay signed in, how long a device can skip the authenticator app, and which roles must use one.";

function fieldLocked(source: SettingSource): boolean {
  return source === "env";
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

function anySecurityEnvLocked(settings: SystemSettingsDto): boolean {
  return (
    fieldLocked(settings.session_ttl_ms.source) ||
    fieldLocked(settings.session_idle_timeout_ms.source) ||
    fieldLocked(settings.operator_session_ttl_ms.source) ||
    fieldLocked(settings.operator_session_idle_timeout_ms.source) ||
    fieldLocked(settings.trusted_device_days.source) ||
    fieldLocked(settings.mfa_required_roles.source) ||
    fieldLocked(settings.csp_trusted_origins.source)
  );
}

interface SecurityNumericRowProps {
  id: string;
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
  id,
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
            id={id}
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
  const [cspOriginsModalOpen, setCspOriginsModalOpen] = useState(false);

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
    if (cspTrustedOriginsErrors(draft.cspTrustedOriginsRaw).length > 0) {
      validationErrorsRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
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
  const cspTrustedOriginsLocked = fieldLocked(settings.csp_trusted_origins.source);
  const cspTrustedOrigins = parseListInput(draft.cspTrustedOriginsRaw);
  const cspOriginErrors = cspTrustedOriginsErrors(draft.cspTrustedOriginsRaw);
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
      <Card
        title={<HintLabel hint={SECURITY_CARD_HINT}>Security</HintLabel>}
        actions={<EnvBadge locked={anySecurityEnvLocked(settings)} />}
      >
        <div className="settings-card-stack">
          <p className="settings-card-intro">{SECURITY_CARD_INTRO}</p>
          <div className="mail-transport-section security-settings-rows">
          <SecurityNumericRow
            id="security-session-ttl-hours"
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
            id="security-session-idle-minutes"
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
            id="security-operator-ttl-hours"
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
            id="security-operator-idle-minutes"
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
            id="security-trusted-device-days"
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
            </div>
          </div>
          <div className="security-settings-row-divider" aria-hidden="true" />

          <div className="security-settings-item">
            <div className="settings-row__text">
              <strong>Trusted third-party script origins</strong>
              <p>{CSP_TRUSTED_ORIGINS_DESCRIPTION}</p>
            </div>
            <div className="security-settings-row__control">
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                {cspTrustedOrigins.length > 0 ? (
                  <SecurityFieldWarning message={CSP_TRUSTED_ORIGINS_WARNING} />
                ) : null}
                <Button
                  type="button"
                  variant="secondary"
                  disabled={cspTrustedOriginsLocked}
                  onClick={() => setCspOriginsModalOpen(true)}
                >
                  Manage origins
                </Button>
              </div>
            </div>
          </div>
        </div>
        </div>
      </Card>

      <CspTrustedOriginsModal
        open={cspOriginsModalOpen}
        initialOrigins={cspTrustedOrigins}
        onClose={() => setCspOriginsModalOpen(false)}
        onSave={(origins) => setDraft({ ...draft, cspTrustedOriginsRaw: joinListInput(origins) })}
      />

      <SettingsFooter
        validationErrors={cspOriginErrors}
        validationErrorsRef={validationErrorsRef}
        hasUnsavedChanges={hasUnsavedChanges}
        saving={saving}
        onReset={handleReset}
        onSave={() => void handleSave()}
      />
    </>
  );
}
