import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, Card, Input, Select, Switch } from "@admitto/ui";
import {
  ApiError,
  fetchMailSettings,
  saveMailSettings,
  sendMailTransportTest,
} from "../api/client.js";
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
  const status = field.set ? "Set ••••" : "Not set";

  return (
    <div className="mail-secret-field">
      <div className="mail-secret-field__header">
        <span className="at-label">{label}</span>
        <EnvBadge locked={field.locked} />
      </div>
      {hint && <FieldHint>{hint}</FieldHint>}
      {edit.mode === "idle" ? (
        <div className="mail-secret-field__row">
          <span className="mail-secret-field__status">{status}</span>
          {!field.locked && (
            <div className="mail-secret-field__actions">
              <Button type="button" variant="secondary" onClick={onReplace}>
                Replace
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
  const [apiData, setApiData] = useState<MailSettingsResponse | null>(null);
  const [draft, setDraft] = useState<MailDraft>(emptyMailDraft());
  const [secrets, setSecrets] = useState<SecretEdits>(emptySecretEdits());
  const [savedDraft, setSavedDraft] = useState<MailDraft>(emptyMailDraft());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [testEmail, setTestEmail] = useState("");
  const [testStatus, setTestStatus] = useState<{ kind: "ok" | "error"; message: string } | null>(
    null,
  );
  const [testSending, setTestSending] = useState(false);
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
      setLoadError("Failed to load mail settings.");
      setApiData(null);
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, [applyResponse]);

  useEffect(() => {
    void loadSettings();
    return () => loadAbortRef.current?.abort();
  }, [loadSettings]);

  const updateDraft = (patch: Partial<MailDraft>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
    setSaveMessage(null);
    setSaveError(null);
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
    setSaveError(null);
    try {
      const lockedKeys = new Set(
        (Object.keys(apiData.fields) as Array<keyof typeof apiData.fields>).filter((key) =>
          fieldLocked(key),
        ),
      );
      const body = buildSaveMailSettingsBody(draft, secrets, lockedKeys);
      const data = await saveMailSettings(body);
      applyResponse(data);
      setSaveMessage("Mail settings saved.");
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Failed to save mail settings.");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setDraft(savedDraft);
    setSecrets(emptySecretEdits());
    setValidationErrors([]);
    setSaveMessage(null);
    setSaveError(null);
  };

  const hasUnsavedChanges = isMailSettingsDirty(draft, savedDraft, secrets);

  const handleTestSend = async () => {
    if (hasUnsavedChanges) {
      setTestStatus({
        kind: "error",
        message: "Save your changes before sending a test email.",
      });
      return;
    }
    const to = testEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      setTestStatus({ kind: "error", message: "Enter a valid email address." });
      return;
    }
    setTestSending(true);
    setTestStatus(null);
    try {
      const result = await sendMailTransportTest(to);
      if (result.status === "sent") {
        setTestStatus({ kind: "ok", message: "Test email sent." });
      } else {
        setTestStatus({ kind: "error", message: result.error ?? "Send failed." });
      }
    } catch (err) {
      let message = "Send failed.";
      if (err instanceof ApiError) {
        if (err.status === 400) {
          message = "Enter a valid email address.";
        } else {
          message = err.message;
        }
      }
      setTestStatus({ kind: "error", message });
    } finally {
      setTestSending(false);
    }
  };

  const providerOptions: { value: MailProvider; label: string }[] = [
    { value: "smtp", label: "SMTP (DuoCircle)" },
    { value: "graph", label: "Microsoft Graph" },
    { value: "powerautomate", label: "Power Automate" },
  ];
  if (apiData && !apiData.isProduction) {
    providerOptions.push({
      value: "export_only",
      label: "Export only (dev/test)",
    });
  }

  const provider = draft.provider;

  return (
    <Card
      title={hasUnsavedChanges ? "Mail transport *" : "Mail transport"}
      footer={
        <div className="foot-actions">
          <div className="foot-actions__status">
            {saveMessage && (
              <p role="status" className="text-success">
                {saveMessage}
              </p>
            )}
            {saveError && (
              <p role="alert" className="text-error">
                {saveError}
              </p>
            )}
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
          <p className="mail-transport__desc">
            Configure outbound mail for tickets and lifecycle messages.
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

          {provider === "export_only" && (
            <p className="mail-dev-warning" role="status">
              Dev/test only — cannot send real mail in production.
            </p>
          )}

          {(provider === "smtp" || provider === "graph" || provider === "powerautomate" || provider === "export_only") && (
            <div className="mail-transport-section">
              <Input
                label="From address"
                type="email"
                value={draft.fromAddress}
                disabled={fieldLocked("fromAddress")}
                onChange={(e) => updateDraft({ fromAddress: e.target.value })}
                hint="Visible sender address in outbound mail (From header)."
              />
              <Input
                label="From name"
                value={draft.fromName}
                disabled={fieldLocked("fromName")}
                onChange={(e) => updateDraft({ fromName: e.target.value })}
                hint="Display name shown next to the from address."
              />
              <Input
                label="Reply-to"
                type="email"
                value={draft.replyTo}
                disabled={fieldLocked("replyTo")}
                onChange={(e) => updateDraft({ replyTo: e.target.value })}
                hint="Where replies should go. Leave empty to use the from address."
              />
              <Input
                label="Envelope from (bounce address)"
                type="email"
                value={draft.envelopeFrom}
                disabled={fieldLocked("envelopeFrom")}
                onChange={(e) => updateDraft({ envelopeFrom: e.target.value })}
                hint="SMTP MAIL FROM / return-path for bounces. Often a dedicated address on your sending domain (SPF/DKIM alignment)."
              />
              {(provider === "smtp" || provider === "graph" || provider === "powerautomate") && (
                <Input
                  label="Allowed from domain"
                  value={draft.allowedFromDomain}
                  disabled={fieldLocked("allowedFromDomain")}
                  onChange={(e) => updateDraft({ allowedFromDomain: e.target.value })}
                  hint="When set, outbound mail is rejected unless the from address (or Graph mailbox) uses this domain."
                />
              )}
            </div>
          )}

          {provider === "smtp" && (
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
                hint="587 with STARTTLS (Require STARTTLS on, Use TLS off) or 465 with implicit TLS (Use TLS on)."
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
              <div className="mail-switch-field">
                <Switch
                  label="Use TLS (secure)"
                  checked={draft.secure}
                  disabled={fieldLocked("secure")}
                  onChange={(e) => updateDraft({ secure: e.target.checked })}
                />
                <FieldHint>
                  Implicit TLS from the first byte — typical for port 465. Turn off when using port 587 with STARTTLS.
                </FieldHint>
              </div>
              <div className="mail-switch-field">
                <Switch
                  label="Require STARTTLS"
                  checked={draft.requireTls}
                  disabled={fieldLocked("requireTls")}
                  onChange={(e) => updateDraft({ requireTls: e.target.checked })}
                />
                <FieldHint>
                  Upgrade plain connection with STARTTLS — typical for port 587. Usually off when Use TLS (secure) is on.
                </FieldHint>
              </div>
              <Input
                label="Rate limit (per minute)"
                inputMode="numeric"
                value={draft.rateLimitPerMinute}
                disabled={fieldLocked("rateLimitPerMinute")}
                onChange={(e) => updateDraft({ rateLimitPerMinute: e.target.value })}
                hint="Optional cap on messages per minute for this transport."
              />
              <details className="mail-transport-advanced">
                <summary>Advanced SMTP options</summary>
                <div className="mail-transport-advanced__body">
                  <div className="mail-switch-field">
                    <Switch
                      label="Verify TLS certificate"
                      checked={draft.tlsRejectUnauthorized}
                      disabled={fieldLocked("tlsRejectUnauthorized")}
                      onChange={(e) => updateDraft({ tlsRejectUnauthorized: e.target.checked })}
                    />
                    <FieldHint>Turn off only for lab/testing with self-signed certificates.</FieldHint>
                  </div>
                  <div className="mail-switch-field">
                    <Switch
                      label="Connection pool"
                      checked={draft.pool}
                      disabled={fieldLocked("pool")}
                      onChange={(e) => updateDraft({ pool: e.target.checked })}
                    />
                    <FieldHint>Reuse SMTP connections for bulk sending.</FieldHint>
                  </div>
                  <Input
                    label="HELO/EHLO name"
                    value={draft.heloName}
                    disabled={fieldLocked("heloName")}
                    onChange={(e) => updateDraft({ heloName: e.target.value })}
                    hint="Hostname presented to the SMTP server. Leave empty for the system default."
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
              </details>
            </div>
          )}

          {provider === "graph" && (
            <div className="mail-transport-section">
              <FieldHint>
                Register an app in Azure Entra ID (Microsoft Entra). Use application permissions for
                send mail; copy Tenant ID and Client ID from the app registration.
              </FieldHint>
              <Input
                label="Mailbox"
                type="email"
                value={draft.mailbox}
                disabled={fieldLocked("mailbox")}
                onChange={(e) => updateDraft({ mailbox: e.target.value })}
                hint="Shared mailbox or user mailbox used for /users/{mailbox}/sendMail. Defaults to from address when empty."
              />
              <Input
                label="Tenant ID"
                value={draft.tenantId}
                disabled={fieldLocked("tenantId")}
                onChange={(e) => updateDraft({ tenantId: e.target.value })}
                placeholder="00000000-0000-0000-0000-000000000000"
                hint="Directory (tenant) GUID from Azure portal → Microsoft Entra ID → Overview."
              />
              <Input
                label="Client ID"
                value={draft.clientId}
                disabled={fieldLocked("clientId")}
                onChange={(e) => updateDraft({ clientId: e.target.value })}
                placeholder="00000000-0000-0000-0000-000000000000"
                hint="Application (client) ID from the app registration."
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
          )}

          {provider === "powerautomate" && (
            <div className="mail-transport-section">
              <FieldHint>
                Create a Power Automate cloud flow with the “When an HTTP request is received” trigger.
                Paste the trigger URL below; optional key is sent as the x-admitto-key header if your flow
                checks it.
              </FieldHint>
              <SecretFieldRow
                label="Flow URL"
                hint="HTTPS URL from the flow trigger (contains a signature token — treat as a secret)."
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
                hint="Optional shared secret for endpoint protection. Leave unset if the flow does not require it."
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
          )}

          <div className="mail-test-send">
            <h3 className="mail-test-send__title">Send test email</h3>
            <p className="mail-test-send__hint">
              {hasUnsavedChanges
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
                disabled={hasUnsavedChanges}
              />
              <Button
                type="button"
                variant="secondary"
                disabled={testSending || hasUnsavedChanges}
                onClick={() => void handleTestSend()}
              >
                {testSending ? "Sending…" : "Send test email"}
              </Button>
            </div>
            {testStatus && (
              <p
                role={testStatus.kind === "ok" ? "status" : "alert"}
                className={testStatus.kind === "ok" ? "text-success" : "text-error"}
              >
                {testStatus.message}
              </p>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
