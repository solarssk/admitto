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
    provider: (f.provider.value as MailProvider | null) ?? "",
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
    pool: boolValue(f.pool, false),
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

function SecretFieldRow({
  label,
  field,
  edit,
  onReplace,
  onClear,
  onValueChange,
  onCancel,
}: {
  label: string;
  field: MailSecretFieldDto;
  edit: SecretEdits[keyof SecretEdits];
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
      const body = buildSaveMailSettingsBody(draft, secrets);
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

  const handleTestSend = async () => {
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
      setTestStatus({
        kind: "error",
        message: err instanceof ApiError ? err.message : "Send failed.",
      });
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
      title="Mail transport"
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
            <Button type="button" variant="primary" disabled={loading || saving || !!loadError} onClick={() => void handleSave()}>
              {saving ? "Saving…" : "Save"}
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
          <p className="mail-test-send__hint">
            Configure outbound mail for tickets and lifecycle messages.
          </p>
          <div className="mail-field-row">
            <Select
              label="Transport"
              value={provider}
              disabled={fieldLocked("provider")}
              onChange={(e) => updateDraft({ provider: e.target.value as MailProvider | "" })}
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
            </div>
          )}

          {provider === "smtp" && (
            <div className="mail-transport-section">
              <Input
                label="SMTP host"
                value={draft.host}
                disabled={fieldLocked("host")}
                onChange={(e) => updateDraft({ host: e.target.value })}
              />
              <Input
                label="Port"
                inputMode="numeric"
                value={draft.port}
                disabled={fieldLocked("port")}
                onChange={(e) => updateDraft({ port: e.target.value })}
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
              <Switch
                label="Use TLS (secure)"
                checked={draft.secure}
                disabled={fieldLocked("secure")}
                onChange={(e) => updateDraft({ secure: e.target.checked })}
              />
              <Switch
                label="Require STARTTLS"
                checked={draft.requireTls}
                disabled={fieldLocked("requireTls")}
                onChange={(e) => updateDraft({ requireTls: e.target.checked })}
              />
              <Switch
                label="Connection pool"
                checked={draft.pool}
                disabled={fieldLocked("pool")}
                onChange={(e) => updateDraft({ pool: e.target.checked })}
              />
              <Input
                label="Rate limit (per minute)"
                inputMode="numeric"
                value={draft.rateLimitPerMinute}
                disabled={fieldLocked("rateLimitPerMinute")}
                onChange={(e) => updateDraft({ rateLimitPerMinute: e.target.value })}
              />
            </div>
          )}

          {provider === "graph" && (
            <div className="mail-transport-section">
              <Input
                label="Mailbox"
                type="email"
                value={draft.mailbox}
                disabled={fieldLocked("mailbox")}
                onChange={(e) => updateDraft({ mailbox: e.target.value })}
              />
              <Input
                label="Tenant ID"
                value={draft.tenantId}
                disabled={fieldLocked("tenantId")}
                onChange={(e) => updateDraft({ tenantId: e.target.value })}
              />
              <Input
                label="Client ID"
                value={draft.clientId}
                disabled={fieldLocked("clientId")}
                onChange={(e) => updateDraft({ clientId: e.target.value })}
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
          )}

          <div className="mail-test-send">
            <h3 className="mail-test-send__title">Send test email</h3>
            <p className="mail-test-send__hint">
              Verifies transport credentials with a trivial message (not an event template).
            </p>
            <div className="mail-test-send__row">
              <Input
                label="Recipient"
                type="email"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                placeholder="you@example.com"
              />
              <Button
                type="button"
                variant="secondary"
                disabled={testSending}
                onClick={() => void handleTestSend()}
              >
                {testSending ? "Sending…" : "Send test email"}
              </Button>
            </div>
            {testStatus && (
              <p role="status" className={testStatus.kind === "ok" ? "text-success" : "text-error"}>
                {testStatus.message}
              </p>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
