import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, Card, Input, Switch, useToast } from "@admitto/ui";
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
  recipient: string;
  provider?: MailProvider;
  providerMessageId?: string;
  retryable?: boolean;
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

const PROVIDER_GUIDE: Record<MailProvider | "", string> = {
  "": "No mail will be sent yet.",
  smtp: "External SMTP relay. Port 587 + STARTTLS, or 465 + implicit TLS.",
  graph: "Entra app-only Graph send (Mail.Send). Mailbox may differ from From.",
  powerautomate: "HTTP fallback when SMTP/Graph are unavailable.",
  export_only: "No network send — message export only (non-production).",
};

const TRANSPORT_ICON: Record<MailProvider | "", string> = {
  "": "plug-off",
  smtp: "server-2",
  graph: "brand-office",
  powerautomate: "bolt",
  export_only: "file-export",
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
        {field.set && (
          <span className="password-pill">
            <i className="ti ti-lock" aria-hidden="true" />
            Set ••••
          </span>
        )}
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
        <div className="mail-secret-field__edit">
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
          <FieldHint>
            Saves with the page&rsquo;s Save changes button below — Cancel discards this edit only.
          </FieldHint>
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
  const validationErrorsRef = useRef<HTMLUListElement | null>(null);

  useEffect(() => {
    if (validationErrors.length > 0) {
      validationErrorsRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [validationErrors]);

  // A test result reflects a send made under the *previous* transport — stale once
  // the operator switches to a different provider, so drop it rather than leave a
  // misleading pass/fail badge attached to the newly selected transport.
  useEffect(() => {
    setTestResult(null);
  }, [draft.provider]);

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
      // Inline + Retry only (no toast) — this is an initial-load failure with a
      // persistent retry control, not a transient action outcome. See AGENTS.md's
      // toast-vs-inline table.
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
          recipient: to,
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
          recipient: to,
          provider: result.provider,
          retryable: result.retryable,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (err) {
      const message =
        err instanceof ApiError && err.status === 400 && hasApiErrorCode(err, "validation_failed")
          ? "Enter a valid email address."
          : operatorApiErrorMessage(err, "Send failed.");
      addToast(message, "error");
      setTestResult({ kind: "error", message, recipient: to, timestamp: new Date().toISOString() });
    } finally {
      setTestSending(false);
    }
  };

  const showExportOnly =
    apiData && (!apiData.isProduction || (fieldLocked("provider") && draft.provider === "export_only"));
  const providerOptions = buildMailProviderOptions("settings", Boolean(showExportOnly));

  const provider = draft.provider;

  if (loading) {
    return (
      <Card title="Mail transport">
        <p>Loading mail settings…</p>
      </Card>
    );
  }

  if (loadError || !apiData) {
    return (
      <Card title="Mail transport">
        <p role="alert" className="text-error">
          {loadError ?? "Failed to load mail settings."}{" "}
          <button type="button" className="settings-retry-link" onClick={() => void loadSettings()}>
            Retry
          </button>
        </p>
      </Card>
    );
  }

  return (
    <>
      <Card
        title="Mail transport"
        actions={
          <Badge variant={provider ? "ok" : "neutral"}>{provider ? "Configured" : "Not configured"}</Badge>
        }
      >
        <div className="mail-transport-form">
          {fieldLocked("provider") && (
            <p className="mail-transport__env-note">
              Some transport settings are managed by your deployment configuration and cannot be changed
              here. Contact your instance administrator if you need to update them.
            </p>
          )}
          <p className="mail-transport__desc">
            Instance-wide outbound transport for tickets and lifecycle mail.
          </p>
          <div className="transport-grid" role="radiogroup" aria-label="Transport">
            {([{ value: "" as const, label: "Not configured" }, ...providerOptions] as const).map((opt) => {
              const active = provider === opt.value;
              return (
                <button
                  key={opt.value || "none"}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={opt.label}
                  className={`transport-tile${active ? " transport-tile--active" : ""}`}
                  disabled={fieldLocked("provider")}
                  onClick={() => {
                    if (opt.value === "smtp" && draft.provider !== "smtp") {
                      updateDraft({ provider: "smtp", ...smtpProviderDraftDefaults() });
                    } else {
                      updateDraft({ provider: opt.value });
                    }
                  }}
                >
                  <span className="transport-tile__icon">
                    <i className={`ti ti-${TRANSPORT_ICON[opt.value]}`} aria-hidden="true" />
                  </span>
                  <strong>{opt.label}</strong>
                  <span>{PROVIDER_GUIDE[opt.value]}</span>
                  {active && (
                    <i className="ti ti-circle-check-filled transport-tile__check" aria-hidden="true" />
                  )}
                </button>
              );
            })}
          </div>
          {provider === "export_only" && (
            <p className="mail-dev-warning" role="status">
              Dev/test only — cannot send real mail in production.
            </p>
          )}
        </div>
      </Card>

      {(provider === "smtp" || provider === "graph" || provider === "powerautomate" || provider === "export_only") && (
        <Card title="Sender">
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
        </Card>
      )}

      {provider === "smtp" && (
        <Card title="SMTP connection">
          <div className="mail-transport-form">
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
              <div className="settings-row">
                <div className="settings-row__text">
                  <strong>Use TLS (secure)</strong>
                  <p>Implicit TLS on connect — typically port 465.</p>
                </div>
                <Switch
                  aria-label="Use TLS (secure)"
                  checked={draft.secure}
                  disabled={fieldLocked("secure")}
                  onChange={(e) => updateDraft({ secure: e.target.checked })}
                />
              </div>
              <div className="settings-row">
                <div className="settings-row__text">
                  <strong>Require STARTTLS</strong>
                  <p>Upgrade a plaintext connection — typically port 587.</p>
                </div>
                <Switch
                  aria-label="Require STARTTLS"
                  checked={draft.requireTls}
                  disabled={fieldLocked("requireTls")}
                  onChange={(e) => updateDraft({ requireTls: e.target.checked })}
                />
              </div>
            </div>

            <details className="disclosure">
              <summary className="disclosure__summary">
                <i className="ti ti-chevron-right" aria-hidden="true" />
                Advanced tuning
              </summary>
              <div className="disclosure__body">
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
              </div>
            </details>
          </div>
        </Card>
      )}

      {provider === "graph" && (
        <Card title="Microsoft Graph">
          <div className="mail-transport-form">
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
          </div>
        </Card>
      )}

      {provider === "powerautomate" && (
        <Card title="Power Automate">
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
        </Card>
      )}

      <Card title="Send test email">
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
          <span className={testSendReason ? "at-tooltip" : undefined} data-tooltip={testSendReason}>
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
          <div className={`mail-preview mail-preview--${testResult.kind}`} role="status">
            {testResult.kind === "ok" && (
              <div className="mail-preview__head">
                <b>✅ Your Admitto mail configuration is working</b>
                <span>to {testResult.recipient}</span>
              </div>
            )}
            <div className="test-mail-hero">
              <span className="test-mail-hero__icon">
                <i
                  className={`ti ${testResult.kind === "ok" ? "ti-circle-check" : "ti-circle-x"}`}
                  aria-hidden="true"
                />
              </span>
              <p>
                {testResult.kind === "ok"
                  ? `Sent successfully via ${testResult.provider ? MAIL_PROVIDER_LABELS[testResult.provider] : "the configured transport"}.`
                  : testResult.message}
              </p>
            </div>
            <div className="test-mail-summary">
              <div>
                <span>Recipient</span>
                <b>{testResult.recipient}</b>
              </div>
              {testResult.provider && (
                <div>
                  <span>Transport</span>
                  <b>{MAIL_PROVIDER_LABELS[testResult.provider]}</b>
                </div>
              )}
              {testResult.provider === "smtp" && draft.host && (
                <div>
                  <span>Host</span>
                  <b>
                    {draft.host}:{draft.port}
                  </b>
                </div>
              )}
              {testResult.provider === "graph" && (draft.mailbox || draft.fromAddress) && (
                <div>
                  <span>Mailbox</span>
                  <b>{draft.mailbox || draft.fromAddress}</b>
                </div>
              )}
              <div>
                <span>Sent at</span>
                <b>{formatUtcDateTime(testResult.timestamp)}</b>
              </div>
              {testResult.providerMessageId && (
                <div>
                  <span>Message ID</span>
                  <b className="test-mail-summary__mono">{testResult.providerMessageId}</b>
                </div>
              )}
              {testResult.kind === "error" && testResult.retryable !== undefined && (
                <div>
                  <span>Retryable</span>
                  <b>{testResult.retryable ? "Yes" : "No"}</b>
                </div>
              )}
            </div>
            {testResult.kind === "ok" && (
              <p className="test-mail-footnote">Automated message from Admitto — no reply needed.</p>
            )}
          </div>
        )}
      </Card>

      <div className="settings-footer">
        <div className="settings-footer__status">
          {validationErrors.length > 0 ? (
            <ul ref={validationErrorsRef} role="alert" className="text-error">
              {validationErrors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          ) : (
            <span className="settings-footer__save-state">
              <i
                className={`ti ${hasUnsavedChanges ? "ti-alert-triangle" : "ti-circle-check"}`}
                aria-hidden="true"
              />
              {hasUnsavedChanges ? "Unsaved changes" : "All changes saved"}
            </span>
          )}
        </div>
        <div className="settings-footer__buttons">
          <Button type="button" variant="secondary" disabled={saving} onClick={handleReset}>
            Reset
          </Button>
          <Button type="button" variant="primary" disabled={saving} onClick={() => void handleSave()}>
            {saving ? "Saving…" : hasUnsavedChanges ? "Save changes" : "Save"}
          </Button>
        </div>
      </div>
    </>
  );
}
