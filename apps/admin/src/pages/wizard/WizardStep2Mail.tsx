import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Button, Input, Select, Switch, useToast } from "@admitto/ui";
import {
  ApiError,
  fetchMailSettings,
  saveMailSettings,
  sendMailTransportTest,
} from "../../api/client.js";
import { useAuth } from "../../auth/AuthProvider.js";
import type {
  MailPlainFieldDto,
  MailProvider,
  MailSecretFieldDto,
  MailSettingsResponse,
} from "../../api/types.js";
import {
  buildSaveMailSettingsBody,
  emptyMailDraft,
  emptySecretEdits,
  smtpProviderDraftDefaults,
  validateMailDraft,
  type MailDraft,
  type SecretEdits,
} from "../../settings/mailSettingsValidation.js";
import { useWizard } from "./WizardContext.js";

export type WizardStep2MailHandle = {
  saveAndContinue: () => Promise<boolean>;
};

type WizardStep2MailProps = {
  onDirtyChange?: (dirty: boolean) => void;
};

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

const PROVIDER_LABELS: Record<MailProvider, string> = {
  smtp: "SMTP",
  graph: "Microsoft Graph",
  powerautomate: "Power Automate",
  export_only: "Export only",
};

export const WizardStep2Mail = forwardRef<WizardStep2MailHandle, WizardStep2MailProps>(
  function WizardStep2Mail({ onDirtyChange }, ref) {
    const { user } = useAuth();
    const { addToast } = useToast();
    const { setMailSkipped, setSummary } = useWizard();
    const [apiData, setApiData] = useState<MailSettingsResponse | null>(null);
    const [draft, setDraft] = useState<MailDraft>(emptyMailDraft());
    const [secrets, setSecrets] = useState<SecretEdits>(emptySecretEdits());
    const [loading, setLoading] = useState(true);
    const [validationErrors, setValidationErrors] = useState<string[]>([]);
    const [testSending, setTestSending] = useState(false);
    const [testError, setTestError] = useState<string | null>(null);
    const loadAbortRef = useRef<AbortController | null>(null);

    const fieldLocked = useCallback(
      (key: keyof MailSettingsResponse["fields"]): boolean => {
        if (!apiData) return false;
        const fd = apiData.fields[key];
        return Boolean(fd && "locked" in fd && fd.locked);
      },
      [apiData],
    );

    const applyResponse = useCallback((data: MailSettingsResponse) => {
      setApiData(data);
      setDraft(draftFromResponse(data));
      setSecrets(emptySecretEdits());
      setValidationErrors([]);
    }, []);

    useEffect(() => {
      loadAbortRef.current?.abort();
      const ac = new AbortController();
      loadAbortRef.current = ac;
      setLoading(true);
      void (async () => {
        try {
          const data = await fetchMailSettings(ac.signal);
          if (ac.signal.aborted) return;
          applyResponse(data);
        } catch (err) {
          if (ac.signal.aborted) return;
          addToast(
            err instanceof ApiError ? err.message : "Failed to load mail settings.",
            "error",
          );
        } finally {
          if (!ac.signal.aborted) setLoading(false);
        }
      })();
      return () => ac.abort();
    }, [addToast, applyResponse]);

    const updateDraft = (patch: Partial<MailDraft>) => {
      setDraft((prev) => ({ ...prev, ...patch }));
      setValidationErrors([]);
      setTestError(null);
      onDirtyChange?.(true);
    };

    const updateSecret = (
      key: keyof SecretEdits,
      patch: Partial<SecretEdits[keyof SecretEdits]>,
    ) => {
      setSecrets((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
      onDirtyChange?.(true);
    };

    const saveSettings = async (): Promise<boolean> => {
      if (!apiData) return false;
      const validation = validateMailDraft(draft);
      if (!validation.valid) {
        setValidationErrors(validation.errors);
        return false;
      }
      setValidationErrors([]);
      try {
        const lockedKeys = new Set(
          (Object.keys(apiData.fields) as Array<keyof typeof apiData.fields>).filter((key) =>
            fieldLocked(key),
          ),
        );
        const body = buildSaveMailSettingsBody(draft, secrets, lockedKeys);
        const data = await saveMailSettings(body);
        applyResponse(data);
        onDirtyChange?.(false);
        const provider = draft.provider;
        setMailSkipped(false);
        setSummary({
          mailLabel: provider
            ? `Configured (${PROVIDER_LABELS[provider as MailProvider] ?? provider})`
            : "Not configured",
        });
        return true;
      } catch (err) {
        addToast(err instanceof ApiError ? err.message : "Failed to save mail settings.", "error");
        return false;
      }
    };

    useImperativeHandle(ref, () => ({
      saveAndContinue: saveSettings,
    }));

    const handleTestSend = async () => {
      const validation = validateMailDraft(draft);
      if (!validation.valid) {
        setValidationErrors(validation.errors);
        return;
      }
      if (draft.provider === "export_only" || !draft.provider) {
        addToast("Configure a transport provider before sending a test email.", "warning");
        return;
      }
      setTestSending(true);
      setTestError(null);
      try {
        const saved = await saveSettings();
        if (!saved) return;
        const result = await sendMailTransportTest(user.email);
        if (result.status === "sent") {
          setTestError(null);
          addToast(`Test email sent to ${user.email}.`, "success");
        } else {
          const message = result.error ?? "Test email failed.";
          setTestError(message);
          addToast(message, "error");
        }
      } catch (err) {
        const message = err instanceof ApiError ? err.message : "Test email failed.";
        setTestError(message);
        addToast(message, "error");
      } finally {
        setTestSending(false);
      }
    };

    const providerOptions: { value: MailProvider; label: string }[] = [
      { value: "smtp", label: "SMTP" },
      { value: "graph", label: "Microsoft Graph" },
      { value: "powerautomate", label: "Power Automate" },
    ];
    if (apiData && (!apiData.isProduction || fieldLocked("provider"))) {
      providerOptions.push({ value: "export_only", label: "Export only (dev/test)" });
    }

    const provider = draft.provider;

    return (
      <>
        <h2 className="setup-wizard__card-title">Mail transport</h2>
        <p className="setup-wizard__card-desc">
          Configure outbound email for tickets and notifications. You can skip this step and
          configure mail later in Settings.
        </p>

        {loading && <p>Loading mail settings…</p>}

        {!loading && apiData && (
          <>
            {validationErrors.length > 0 && (
              <ul className="setup-wizard__errors" role="alert">
                {validationErrors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}

            <div className="setup-wizard__field">
              <Select
                label="Transport"
                value={provider}
                disabled={fieldLocked("provider")}
                onChange={(e) => {
                  const next = e.target.value as MailProvider | "";
                  if (next === "smtp" && draft.provider !== "smtp") {
                    updateDraft({ provider: next, ...smtpProviderDraftDefaults() });
                  } else {
                    updateDraft({ provider: next });
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
            </div>

            {provider === "smtp" && (
              <>
                <div className="setup-wizard__grid-2">
                  <Input
                    label="SMTP host"
                    value={draft.host}
                    disabled={fieldLocked("host")}
                    onChange={(e) => updateDraft({ host: e.target.value })}
                  />
                  <Input
                    label="Port"
                    value={draft.port}
                    disabled={fieldLocked("port")}
                    onChange={(e) => updateDraft({ port: e.target.value })}
                  />
                </div>
                <div className="setup-wizard__grid-2">
                  <Input
                    label="Username"
                    value={draft.user}
                    disabled={fieldLocked("user")}
                    onChange={(e) => updateDraft({ user: e.target.value })}
                  />
                  <SecretInput
                    label="Password"
                    field={apiData.fields.smtpPassword}
                    edit={secrets.smtpPassword}
                    onReplace={() => updateSecret("smtpPassword", { mode: "replace", value: "" })}
                    onValueChange={(value) => updateSecret("smtpPassword", { value })}
                    onCancel={() => updateSecret("smtpPassword", { mode: "idle", value: "" })}
                  />
                </div>
                <Input
                  label="From address"
                  type="email"
                  value={draft.fromAddress}
                  disabled={fieldLocked("fromAddress")}
                  onChange={(e) => updateDraft({ fromAddress: e.target.value })}
                />
                <Switch
                  label="Use TLS (STARTTLS)"
                  checked={draft.requireTls}
                  disabled={fieldLocked("requireTls")}
                  onChange={(e) => updateDraft({ requireTls: e.target.checked })}
                />
              </>
            )}

            {provider === "graph" && (
              <>
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
                <SecretInput
                  label="Client secret"
                  field={apiData.fields.graphClientSecret}
                  edit={secrets.graphClientSecret}
                  onReplace={() => updateSecret("graphClientSecret", { mode: "replace", value: "" })}
                  onValueChange={(value) => updateSecret("graphClientSecret", { value })}
                  onCancel={() => updateSecret("graphClientSecret", { mode: "idle", value: "" })}
                />
                <Input
                  label="Sender address"
                  type="email"
                  value={draft.fromAddress || draft.mailbox}
                  disabled={fieldLocked("fromAddress") && fieldLocked("mailbox")}
                  onChange={(e) => updateDraft({ fromAddress: e.target.value, mailbox: e.target.value })}
                />
                <Switch
                  label="Save to Sent Items"
                  checked={draft.saveToSentItems}
                  disabled={fieldLocked("saveToSentItems")}
                  onChange={(e) => updateDraft({ saveToSentItems: e.target.checked })}
                />
              </>
            )}

            {provider === "powerautomate" && (
              <>
                <SecretInput
                  label="Webhook URL"
                  field={apiData.fields.powerAutomateUrl}
                  edit={secrets.powerAutomateUrl}
                  onReplace={() => updateSecret("powerAutomateUrl", { mode: "replace", value: "" })}
                  onValueChange={(value) => updateSecret("powerAutomateUrl", { value })}
                  onCancel={() => updateSecret("powerAutomateUrl", { mode: "idle", value: "" })}
                />
                <Input
                  label="From address"
                  type="email"
                  value={draft.fromAddress}
                  disabled={fieldLocked("fromAddress")}
                  onChange={(e) => updateDraft({ fromAddress: e.target.value })}
                />
              </>
            )}

            {provider === "export_only" && (
              <p className="setup-wizard__hint">
                No email will be sent. Tickets can be exported as CSV/PDF.
              </p>
            )}

            {provider && provider !== "export_only" && (
              <div className="setup-wizard__actions-inline">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={testSending}
                  onClick={() => void handleTestSend()}
                >
                  {testSending ? "Sending…" : `Send test email to ${user.email}`}
                </Button>
                {testError && (
                  <p className="setup-wizard__test-error" role="alert">
                    {testError}
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </>
    );
  },
);

function SecretInput({
  label,
  field,
  edit,
  onReplace,
  onValueChange,
  onCancel,
}: {
  label: string;
  field: MailSecretFieldDto;
  edit: SecretEdits[keyof SecretEdits];
  onReplace: () => void;
  onValueChange: (value: string) => void;
  onCancel: () => void;
}) {
  if (field.locked) {
    return (
      <div className="setup-wizard__field">
        <span className="at-label">{label}</span>
        <p className="setup-wizard__hint">Managed by environment</p>
      </div>
    );
  }

  if (!field.locked && !field.set) {
    return (
      <Input
        label={label}
        type={label === "Webhook URL" ? "url" : "password"}
        autoComplete="new-password"
        value={edit.mode === "idle" ? "" : edit.value}
        onChange={(e) => {
          if (edit.mode === "idle") onReplace();
          onValueChange(e.target.value);
        }}
      />
    );
  }

  if (edit.mode === "idle") {
    return (
      <div className="setup-wizard__field">
        <span className="at-label">{label}</span>
        <p className="setup-wizard__hint">{field.set ? "Set ••••" : "Not set"}</p>
        <Button type="button" variant="secondary" onClick={onReplace}>
          {field.set ? "Replace" : "Set"}
        </Button>
      </div>
    );
  }

  return (
    <div className="setup-wizard__field">
      <Input
        label={label}
        type={label === "Webhook URL" ? "url" : "password"}
        autoComplete="new-password"
        value={edit.value}
        onChange={(e) => onValueChange(e.target.value)}
      />
      <Button type="button" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}
