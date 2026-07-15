import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, Card, Input, Select, Switch, useToast } from "@admitto/ui";
import {
  ApiError,
  fetchMailSettings,
  saveMailSettings,
  sendMailTransportTest,
} from "../api/client.js";
import { hasApiErrorCode, operatorApiErrorMessage } from "../api/operator-api-error.js";
import type {
  MailPlainFieldDto,
  MailProvider,
  MailSecretFieldDto,
  MailSettingsResponse,
} from "../api/types.js";
import {
  buildSaveMailSettingsBody,
  emptyMailDraft,
  emptySecretEdits,
  isMailSettingsDirty,
  smtpProviderDraftDefaults,
  validateMailDraft,
  type MailDraft,
  type SecretEdits,
} from "./mailSettingsValidation.js";
import { buildMailProviderOptions, MAIL_PROVIDER_LABELS } from "./mailProviderOptions.js";
import { formatUtcDateTime } from "../utils/event-dates.js";

interface TestResult {
  kind: "ok" | "error";
  message: string;
  provider?: MailProvider;
  providerMessageId?: string;
  timestamp: string;
}

function strValue(fd: MailPlainFieldDto<string | null>): string {
  return fd.value ?? "";
}

function numValue(fd: MailPlainFieldDto<number | null>): string {
  return fd.value === null || fd.value === undefined ? "" : String(fd.value);
}

function boolValue(fd: MailPlainFieldDto<boolean | null>, fallback: boolean): boolean {
  return fd.value === null || fd.value === undefined ? fallback : fd.value;
}

function draftFromResponse(data: MailSettingsResponse): MailDraft {
  const f = data.fields;
  return {
    provider: f.provider.value ?? "",
    fromAddress: strValue(f.fromAddress),
    fromName: strValue(f.fromName),
    replyTo: strValue(f.replyTo),
    envelopeFrom: strValue(f.envelopeFrom),
    allowedFromDomain: strValue(f.allowedFromDomain),
    host: strValue(f.host),
    port: numValue(f.port),
    secure: boolValue(f.secure, false),
    user: strValue(f.user),
    requireTls: boolValue(f.requireTls, true),
    tlsRejectUnauthorized: boolValue(f.tlsRejectUnauthorized, true),
    heloName: strValue(f.heloName),
    pool: boolValue(f.pool, true),
    maxConnections: numValue(f.maxConnections),
    maxMessages: numValue(f.maxMessages),
    rateLimitPerMinute: numValue(f.rateLimitPerMinute),
    connectionTimeout: numValue(f.connectionTimeout),
    greetingTimeout: numValue(f.greetingTimeout),
    socketTimeout: numValue(f.socketTimeout),
    mailbox: strValue(f.mailbox),
    tenantId: strValue(f.tenantId),
    clientId: strValue(f.clientId),
    saveToSentItems: boolValue(f.saveToSentItems, true),
  };
}

function EnvBadge({ locked }: { locked: boolean }) {
  if (!locked) return null;
  return (
    <Badge variant="neutral" className="mail-field-env-badge">
      Managed by environment
    </Badge>
  );
}

function FieldHint({ children }: { children: string }) {
  return <p className="mail-field-hint">{children}</p>;
}

function SectionTitle({ children }: { children: string }) {
  return <h3 className="mail-transport-section__title">{children}</h3>;
}

const PROVIDER_GUIDE: Record<MailProvider | "", string | null> = {
  "": null,
  smtp: "External SMTP relay. Port 587 + STARTTLS, or 465 + implicit TLS.",
  graph: "Entra app-only Graph send (Mail.Send). Mailbox may differ from From.",
  powerautomate: "HTTP fallback when SMTP/Graph are unavailable.",
  export_only: "No network send — message export only (non-production).",
};

function SecretFieldRow({
  label,
  field,
  edit,
  hint,
  onReplace,
  onClear,
  onValueChange,
  onCancel,
}: {
  label: string;
  field: MailSecretFieldDto;
  edit: SecretEdits[keyof SecretEdits];
  hint?: string;
  onReplace: () => void;
  onClear: () => void;
  onValueChange: (value: string) => void;
  onCancel: () => void;
}) {
  return (
    <div className="mail-secret-field">
      <div className="mail-secret-field__header">
        <span className="at-label">{label}</span>
        {field.set && <Badge variant="neutral">Set ••••</Badge>}
        <EnvBadge locked={field.locked} />
      </div>
      {hint && <FieldHint>{hint}</FieldHint>}
      {edit.mode === "idle" ? (
        <div className="mail-secret-field__row">
          {!field.locked && (
            <div className="mail-secret-field__actions">
              <Button type="button" variant={field.set ? "secondary" : "primary"} onClick={onReplace}>
                {field.set ? "Change" : "Set"}
              </Button>
              {field.set && (
                <Button type="button" variant="secondary" onClick={onClear}>
                  Clear
                </Button>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="mail-secret-field__row">
          <Input
            type="password"
            autoComplete="new-password"
            placeholder={edit.mode === "clear" ? "Will be cleared on save" : "Enter new value"}
            value={edit.value}
            disabled={edit.mode === "clear" || field.locked}
            onChange={(e) => onValueChange(e.target.value)}
          />
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}

/** Superadmin mail transport configuration panel. */
export function MailTransportPanel() {
  const { addToast } = useToast();
  const [apiData, setApiData] = useState<MailSettingsResponse | null>(null);
  const [draft, setDraft] = useState<MailDraft>(emptyMailDraft());
  const [secrets, setSecrets] = useState<SecretEdits>(emptySecretEdits());
  const [savedDraft, setSavedDraft] = useState<MailDraft>(emptyMailDraft());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [testSending, setTestSending] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const loadAbortRef = useRef<AbortController | null>(null);

  const applyResponse = useCallback((data: MailSettingsResponse) => {
    const nextDraft = draftFromResponse(data);
    setApiData(data);
    setDraft(nextDraft);
    setSavedDraft(nextDraft);
    setSecrets(emptySecretEdits());
    setValidationErrors([]);
  }, []);

  const loadSettings = useCallback(async () => {
    loadAbortRef.current?.abort();
    const ac = new AbortController();
    loadAbortRef.current = ac;
    setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchMailSettings(ac.signal);
      if (ac.signal.aborted) return;
      applyResponse(data);
    } catch {
      if (ac.signal.aborted) return;
      const message = "Failed to load mail settings.";
      setLoadError(message);
      addToast(message, "error");
      setApiData(null);
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, [applyResponse, addToast]);

  useEffect(() => {
    void loadSettings();
    return () => loadAbortRef.current?.abort();
  }, [loadSettings]);

  const updateDraft = (patch: Partial<MailDraft>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  };

  const fieldLocked = (key: keyof MailSettingsResponse["fields"]): boolean => {
    if (!apiData) return false;
    const fd = apiData.fields[key];
    return Boolean(fd && "locked" in fd && fd.locked);
  };

  const handleSave = async () => {
    if (!apiData) return;
    const validation = validateMailDraft(draft);
    if (!validation.valid) {
      setValidationErrors(validation.errors);
      return;
    }
    setValidationErrors([]);
    setSaving(true);
    try {
      const lockedKeys = new Set(
        (Object.keys(apiData.fields) as Array<keyof typeof apiData.fields>).filter((key) =>
          fieldLocked(key),
        ),
      );
      const body = buildSaveMailSettingsBody(draft, secrets, lockedKeys);
      const data = await saveMailSettings(body);
      applyResponse(data);
      addToast("Mail settings saved.", "success");
    } catch (err) {
      addToast(operatorApiErrorMessage(err, "Failed to save mail settings."), "error");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setDraft(savedDraft);
    setSecrets(emptySecretEdits());
    setValidationErrors([]);
  };

  const hasUnsavedChanges = isMailSettingsDirty(draft, savedDraft, secrets);
  // export_only deliberately excluded — it never sends real mail, so a "test send" there
  // would misleadingly report success without anything actually leaving the instance.
  const transportConfigured =
    draft.provider === "smtp" || draft.provider === "graph" || draft.provider === "powerautomate";
  const testSendReason = !transportConfigured
    ? "Select and save a transport (SMTP, Graph, or Power Automate) first."
    : hasUnsavedChanges
      ? "Save your changes before sending a test email."
      : undefined;

  const handleTestSend = async () => {
    if (!transportConfigured) {
      addToast(testSendReason ?? "Configure a transport before sending a test email.", "warning");
      return;
    }
    if (hasUnsavedChanges) {
      addToast("Save your changes before sending a test email.", "warning");
      return;
    }
    const to = testEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      addToast("Enter a valid email address.", "error");
      return;
    }
    setTestSending(true);
    setTestResult(null);
    try {
      const result = await sendMailTransportTest(to);
      if (result.status === "sent") {
        addToast("Test email sent.", "success");
        setTestResult({
          kind: "ok",
          message: "Test email sent.",
          provider: result.provider,
          providerMessageId: result.providerMessageId,
          timestamp: new Date().toISOString(),
        });
      } else {
        const message = result.error ?? "Send failed.";
        addToast(message, "error");
        setTestResult({
          kind: "error",
          message,
          provider: result.provider,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (err) {
      const message =
        err instanceof ApiError && err.status === 400 && hasApiErrorCode(err, "validation_failed")
          ? "Enter a valid email address."
          : operatorApiErrorMessage(err, "Send failed.");
      addToast(message, "error");
      setTestResult({ kind: "error", message, timestamp: new Date().toISOString() });
    } finally {
      setTestSending(false);
    }
  };

  const showExportOnly =
    apiData && (!apiData.isProduction || (fieldLocked("provider") && draft.provider === "export_only"));
  const providerOptions = buildMailProviderOptions("settings", Boolean(showExportOnly));

  const provider = draft.provider;

  return (
    <Card
      title={hasUnsavedChanges ? "Mail transport *" : "Mail transport"}
      footer={
        <div className="foot-actions">
          <div className="foot-actions__status">
            {validationErrors.length > 0 && (
              <ul role="alert" className="text-error">
                {validationErrors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
          </div>
          <div className="foot-actions__buttons">
            <Button type="button" variant="secondary" disabled={loading || saving} onClick={handleReset}>
              Reset
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={loading || saving || !!loadError}
              onClick={() => void handleSave()}
              aria-describedby={hasUnsavedChanges ? "mail-transport-unsaved" : undefined}
            >
              {saving ? "Saving…" : hasUnsavedChanges ? "Save changes" : "Save"}
            </Button>
          </div>
        </div>
      }
    >
      {loading && <p>Loading mail settings…</p>}
      {loadError && (
        <p role="alert" className="text-error">
          {loadError}{" "}
          <button type="button" className="settings-retry-link" onClick={() => void loadSettings()}>
            Retry
          </button>
        </p>
      )}
      {!loading && !loadError && apiData && (
        <div className="mail-transport-form">
          {hasUnsavedChanges && (
            <p id="mail-transport-unsaved" className="mail-transport__unsaved-hint">
              Unsaved changes — save before leaving this page.
            </p>
          )}
          {fieldLocked("provider") && (
            <p className="mail-transport__env-note">
              Some transport settings are managed by your deployment configuration and cannot be changed
              here. Contact your instance administrator if you need to update them.
            </p>
          )}
          <p className="mail-transport__desc">
            Instance-wide outbound transport for tickets and lifecycle mail.
          </p>
          <div className="mail-field-row">
            <Select
              label="Transport"
              value={provider}
              disabled={fieldLocked("provider")}
              onChange={(e) => {
                const provider = e.target.value as MailProvider | "";
                if (provider === "smtp" && draft.provider !== "smtp") {
                  updateDraft({ provider, ...smtpProviderDraftDefaults() });
                } else {
                  updateDraft({ provider });
                }
              }}
            >
              <option value="">Not configured</option>
              {providerOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
            <EnvBadge locked={fieldLocked("provider")} />
          </div>
          {provider && PROVIDER_GUIDE[provider] && (
            <p className="mail-transport-provider-guide">{PROVIDER_GUIDE[provider]}</p>
          )}

          {provider === "export_only" && (
            <p className="mail-dev-warning" role="status">
              Dev/test only — cannot send real mail in production.
            </p>
          )}

          {(provider === "smtp" || provider === "graph" || provider === "powerautomate" || provider === "export_only") && (
            <>
              <SectionTitle>Sender</SectionTitle>
              <div className="mail-transport-section">
              <Input
                label="From address"
                type="email"
                value={draft.fromAddress}
                disabled={fieldLocked("fromAddress")}
                onChange={(e) => updateDraft({ fromAddress: e.target.value })}
              />
              <Input
                label="From name"
                value={draft.fromName}
                disabled={fieldLocked("fromName")}
                onChange={(e) => updateDraft({ fromName: e.target.value })}
              />
              <Input
                label="Reply-to"
                type="email"
                value={draft.replyTo}
                disabled={fieldLocked("replyTo")}
                onChange={(e) => updateDraft({ replyTo: e.target.value })}
              />
              <Input
                label="Envelope from (bounce address)"
                type="email"
                value={draft.envelopeFrom}
                disabled={fieldLocked("envelopeFrom")}
                onChange={(e) => updateDraft({ envelopeFrom: e.target.value })}
                hint="SMTP MAIL FROM / return-path."
              />
              <Input
                label="Allowed from domain"
                value={draft.allowedFromDomain}
                disabled={fieldLocked("allowedFromDomain")}
                onChange={(e) => updateDraft({ allowedFromDomain: e.target.value })}
                hint="Optional. Send fails when From (or Graph mailbox) is outside this domain."
              />
            </div>
            </>
          )}

          {provider === "smtp" && (
            <>
              <SectionTitle>SMTP connection</SectionTitle>
            <div className="mail-transport-section">
              <Input
                label="SMTP host"
                value={draft.host}
                disabled={fieldLocked("host")}
                onChange={(e) => updateDraft({ host: e.target.value })}
                placeholder="smtp.example.com"
              />
              <Input
                label="Port"
                inputMode="numeric"
                value={draft.port}
                disabled={fieldLocked("port")}
                onChange={(e) => updateDraft({ port: e.target.value })}
                placeholder="587"
              />
              <Input
                label="Username"
                value={draft.user}
                disabled={fieldLocked("user")}
                onChange={(e) => updateDraft({ user: e.target.value })}
              />
              <SecretFieldRow
                label="Password"
                field={apiData.fields.smtpPassword}
                edit={secrets.smtpPassword}
                onReplace={() =>
                  setSecrets((s) => ({ ...s, smtpPassword: { mode: "replace", value: "" } }))
                }
                onClear={() =>
                  setSecrets((s) => ({ ...s, smtpPassword: { mode: "clear", value: "" } }))
                }
                onValueChange={(value) =>
                  setSecrets((s) => ({ ...s, smtpPassword: { mode: "replace", value } }))
                }
                onCancel={() =>
                  setSecrets((s) => ({ ...s, smtpPassword: { mode: "idle", value: "" } }))
                }
              />
              <div className="mail-tls-row">
                <div className="mail-switch-field">
                  <Switch
                    label="Use TLS (secure)"
                    checked={draft.secure}
                    disabled={fieldLocked("secure")}
                    onChange={(e) => updateDraft({ secure: e.target.checked })}
                  />
                  <FieldHint>Implicit TLS on connect — typically port 465.</FieldHint>
                </div>
                <div className="mail-switch-field">
                  <Switch
                    label="Require STARTTLS"
                    checked={draft.requireTls}
                    disabled={fieldLocked("requireTls")}
                    onChange={(e) => updateDraft({ requireTls: e.target.checked })}
                  />
                  <FieldHint>Upgrade a plaintext connection — typically port 587.</FieldHint>
                </div>
              </div>
            </div>

            <SectionTitle>SMTP tuning</SectionTitle>
            <div className="mail-transport-section">
              <div className="mail-tuning__toggles">
                <Switch
                  label="Connection pool"
                  checked={draft.pool}
                  disabled={fieldLocked("pool")}
                  onChange={(e) => updateDraft({ pool: e.target.checked })}
                />
                <Switch
                  label="Verify TLS certificate"
                  checked={draft.tlsRejectUnauthorized}
                  disabled={fieldLocked("tlsRejectUnauthorized")}
                  onChange={(e) => updateDraft({ tlsRejectUnauthorized: e.target.checked })}
                />
              </div>
              <div className="mail-field-row">
                <Input
                  label="HELO/EHLO name"
                  value={draft.heloName}
                  disabled={fieldLocked("heloName")}
                  onChange={(e) => updateDraft({ heloName: e.target.value })}
                />
              </div>
              <div className="mail-tuning__limits">
                <Input
                  label="Rate limit (per minute)"
                  inputMode="numeric"
                  value={draft.rateLimitPerMinute}
                  disabled={fieldLocked("rateLimitPerMinute")}
                  onChange={(e) => updateDraft({ rateLimitPerMinute: e.target.value })}
                />
                <Input
                  label="Max connections"
                  inputMode="numeric"
                  value={draft.maxConnections}
                  disabled={fieldLocked("maxConnections")}
                  onChange={(e) => updateDraft({ maxConnections: e.target.value })}
                />
                <Input
                  label="Max messages per connection"
                  inputMode="numeric"
                  value={draft.maxMessages}
                  disabled={fieldLocked("maxMessages")}
                  onChange={(e) => updateDraft({ maxMessages: e.target.value })}
                />
              </div>
              <div className="mail-tuning__timeouts">
                <Input
                  label="Connection timeout (ms)"
                  inputMode="numeric"
                  value={draft.connectionTimeout}
                  disabled={fieldLocked("connectionTimeout")}
                  onChange={(e) => updateDraft({ connectionTimeout: e.target.value })}
                />
                <Input
                  label="Greeting timeout (ms)"
                  inputMode="numeric"
                  value={draft.greetingTimeout}
                  disabled={fieldLocked("greetingTimeout")}
                  onChange={(e) => updateDraft({ greetingTimeout: e.target.value })}
                />
                <Input
                  label="Socket timeout (ms)"
                  inputMode="numeric"
                  value={draft.socketTimeout}
                  disabled={fieldLocked("socketTimeout")}
                  onChange={(e) => updateDraft({ socketTimeout: e.target.value })}
                />
              </div>
            </div>
            </>
          )}

          {provider === "graph" && (
            <>
              <SectionTitle>Microsoft Graph</SectionTitle>
              <details className="mail-graph-setup-info">
                <summary>Entra app registration steps</summary>
                <ol>
                  <li>Register an app in Entra ID (App registrations → New registration).</li>
                  <li>
                    API permissions → Microsoft Graph → <strong>Application permissions</strong> (not
                    Delegated) → <code>Mail.Send</code>.
                  </li>
                  <li>Grant <strong>admin consent</strong> for the tenant.</li>
                  <li>Create a <strong>client secret</strong> and copy the value immediately — it's shown once.</li>
                  <li>
                    Enter the sending mailbox's address into <strong>Mailbox</strong> below — it can differ
                    from <strong>From address</strong> above.
                  </li>
                  <li>
                    Paste <strong>Tenant ID</strong>, <strong>Client ID</strong>, and the secret into the
                    fields below.
                  </li>
                </ol>
                <p>
                  This is app-only (client-credentials) authentication — Settings never opens an
                  interactive Microsoft sign-in, and there's no consent screen to click through here; a
                  tenant admin grants consent once, in Entra. After saving, use{" "}
                  <strong>Send test email</strong> below to confirm delivery.
                </p>
              </details>
            <div className="mail-transport-section">
              <Input
                label="Mailbox"
                type="email"
                value={draft.mailbox}
                disabled={fieldLocked("mailbox")}
                onChange={(e) => updateDraft({ mailbox: e.target.value })}
                placeholder="shared@contoso.com"
              />
              <Input
                label="Tenant ID"
                value={draft.tenantId}
                disabled={fieldLocked("tenantId")}
                onChange={(e) => updateDraft({ tenantId: e.target.value })}
                placeholder="00000000-0000-0000-0000-000000000000"
              />
              <Input
                label="Client ID"
                value={draft.clientId}
                disabled={fieldLocked("clientId")}
                onChange={(e) => updateDraft({ clientId: e.target.value })}
                placeholder="00000000-0000-0000-0000-000000000000"
              />
              <SecretFieldRow
                label="Client secret"
                field={apiData.fields.graphClientSecret}
                edit={secrets.graphClientSecret}
                onReplace={() =>
                  setSecrets((s) => ({ ...s, graphClientSecret: { mode: "replace", value: "" } }))
                }
                onClear={() =>
                  setSecrets((s) => ({ ...s, graphClientSecret: { mode: "clear", value: "" } }))
                }
                onValueChange={(value) =>
                  setSecrets((s) => ({ ...s, graphClientSecret: { mode: "replace", value } }))
                }
                onCancel={() =>
                  setSecrets((s) => ({ ...s, graphClientSecret: { mode: "idle", value: "" } }))
                }
              />
              <Switch
                label="Save to Sent Items"
                checked={draft.saveToSentItems}
                disabled={fieldLocked("saveToSentItems")}
                onChange={(e) => updateDraft({ saveToSentItems: e.target.checked })}
              />
            </div>
            </>
          )}

          {provider === "powerautomate" && (
            <>
              <SectionTitle>Power Automate</SectionTitle>
            <div className="mail-transport-section">
              <SecretFieldRow
                label="Flow URL"
                field={apiData.fields.powerAutomateUrl}
                edit={secrets.powerAutomateUrl}
                onReplace={() =>
                  setSecrets((s) => ({ ...s, powerAutomateUrl: { mode: "replace", value: "" } }))
                }
                onClear={() =>
                  setSecrets((s) => ({ ...s, powerAutomateUrl: { mode: "clear", value: "" } }))
                }
                onValueChange={(value) =>
                  setSecrets((s) => ({ ...s, powerAutomateUrl: { mode: "replace", value } }))
                }
                onCancel={() =>
                  setSecrets((s) => ({ ...s, powerAutomateUrl: { mode: "idle", value: "" } }))
                }
              />
              <SecretFieldRow
                label="Flow key"
                field={apiData.fields.powerAutomateKey}
                edit={secrets.powerAutomateKey}
                onReplace={() =>
                  setSecrets((s) => ({ ...s, powerAutomateKey: { mode: "replace", value: "" } }))
                }
                onClear={() =>
                  setSecrets((s) => ({ ...s, powerAutomateKey: { mode: "clear", value: "" } }))
                }
                onValueChange={(value) =>
                  setSecrets((s) => ({ ...s, powerAutomateKey: { mode: "replace", value } }))
                }
                onCancel={() =>
                  setSecrets((s) => ({ ...s, powerAutomateKey: { mode: "idle", value: "" } }))
                }
              />
            </div>
            </>
          )}

          <div className="mail-test-send">
            <h3 className="mail-test-send__title">Send test email</h3>
            <p className="mail-test-send__hint">
              {testSendReason === "Select and save a transport (SMTP, Graph, or Power Automate) first."
                ? testSendReason
                : hasUnsavedChanges
                  ? "Save your changes first — the test uses the saved configuration from the database, not unsaved form values."
                  : "Verifies transport credentials with a trivial message (not an event template)."}
            </p>
            <div className="mail-test-send__row">
              <Input
                label="Recipient"
                type="email"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                placeholder="you@example.com"
                disabled={!!testSendReason}
              />
              <span
                className={testSendReason ? "at-tooltip" : undefined}
                data-tooltip={testSendReason}
              >
                {testSendReason && (
                  <span id="mail-test-send-reason" className="sr-only">
                    {testSendReason}
                  </span>
                )}
                <Button
                  type="button"
                  variant="secondary"
                  disabled={testSending || !!testSendReason}
                  aria-describedby={testSendReason ? "mail-test-send-reason" : undefined}
                  onClick={() => void handleTestSend()}
                >
                  {testSending ? "Sending…" : "Send test email"}
                </Button>
              </span>
            </div>
            {testResult && (
              <div
                className={`mail-test-result mail-test-result--${testResult.kind}`}
                role="status"
              >
                <div className="mail-test-result__row">
                  <span className="mail-test-result__label">Status</span>
                  <span className="mail-test-result__value">
                    {testResult.kind === "ok" ? "Sent" : "Failed"} — {testResult.message}
                  </span>
                </div>
                <div className="mail-test-result__row">
                  <span className="mail-test-result__label">Time</span>
                  <span className="mail-test-result__value">
                    {formatUtcDateTime(testResult.timestamp)}
                  </span>
                </div>
                {testResult.provider && (
                  <div className="mail-test-result__row">
                    <span className="mail-test-result__label">Provider</span>
                    <span className="mail-test-result__value">
                      <Badge variant="neutral">{MAIL_PROVIDER_LABELS[testResult.provider]}</Badge>
                    </span>
                  </div>
                )}
                {testResult.providerMessageId && (
                  <div className="mail-test-result__row">
                    <span className="mail-test-result__label">Message ID</span>
                    <span className="mail-test-result__value mail-test-result__value--mono">
                      {testResult.providerMessageId}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
