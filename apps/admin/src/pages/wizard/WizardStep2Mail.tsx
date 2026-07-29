import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Button, Input, Select, Switch, useToast } from "@admitto/ui";
import {
  fetchMailSettings,
  saveMailSettings,
  sendMailTransportTest,
} from "../../api/client.js";
import { operatorApiErrorMessage } from "../../api/operator-api-error.js";
import { useAuth } from "../../auth/AuthProvider.js";
import type { MailProvider, MailSecretFieldDto, MailSettingsResponse } from "../../api/types.js";
import {
  buildSaveMailSettingsBody,
  emptyMailDraft,
  emptySecretEdits,
  smtpProviderDraftDefaults,
  validateMailDraft,
  type MailDraft,
  type SecretEdits,
} from "../../settings/mailSettingsValidation.js";
import { buildMailProviderOptions, MAIL_PROVIDER_LABELS } from "../../settings/mailProviderOptions.js";
import { draftFromFields } from "../../settings/mailTransportFormParts.js";
import { useDelayedLoading } from "../../hooks/useDelayedLoading.js";
import { useWizard } from "./WizardContext.js";

export type WizardStep2MailHandle = {
  saveAndContinue: () => Promise<boolean>;
};

type WizardStep2MailProps = {
  onDirtyChange?: (dirty: boolean) => void;
};

const PROVIDER_LABELS = MAIL_PROVIDER_LABELS;

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
    const [testSent, setTestSent] = useState(false);
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
      setDraft(draftFromFields(data.fields));
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
            operatorApiErrorMessage(err, "Failed to load mail settings."),
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
      setTestSent(false);
      onDirtyChange?.(true);
    };

    const updateSecret = (
      key: keyof SecretEdits,
      patch: Partial<SecretEdits[keyof SecretEdits]>,
    ) => {
      setSecrets((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
      setTestSent(false);
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
        addToast(operatorApiErrorMessage(err, "Failed to save mail settings."), "error");
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
      try {
        const saved = await saveSettings();
        if (!saved) return;
        const result = await sendMailTransportTest(user.email);
        if (result.status === "sent") {
          setTestSent(true);
        } else {
          setTestSent(false);
          addToast(result.error ?? "Test email failed.", "error");
        }
      } catch (err) {
        setTestSent(false);
        addToast(operatorApiErrorMessage(err, "Test email failed."), "error");
      } finally {
        setTestSending(false);
      }
    };

    const providerOptions = buildMailProviderOptions(
      "wizard",
      Boolean(apiData && (!apiData.isProduction || fieldLocked("provider"))),
    );

    const provider = draft.provider;
    // A fetch that resolves near-instantly (localhost, a warm cache) would otherwise flash
    // the "Loading…" text on and off faster than it can register as loading — show it only
    // once the fetch has genuinely taken a moment.
    const showLoading = useDelayedLoading(loading);

    return (
      <>
        <p className="setup-wizard__step-sub">
          Choose how Admitto sends ticket and lifecycle emails.
        </p>

        {loading && showLoading && <p className="setup-wizard__hint">Loading mail settings…</p>}

        {!loading && apiData && (
          <>
            {validationErrors.length > 0 && (
              <ul className="setup-wizard__errors" role="alert">
                {validationErrors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}

            <div className="setup-wizard__mail-form">
              <Select
                className="setup-wizard__transport-select"
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

              {provider === "graph" && (
                <>
                  <Input
                    label="Tenant ID"
                    value={draft.tenantId}
                    disabled={fieldLocked("tenantId")}
                    onChange={(e) => updateDraft({ tenantId: e.target.value })}
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  />
                  <Input
                    label="Client ID"
                    value={draft.clientId}
                    disabled={fieldLocked("clientId")}
                    onChange={(e) => updateDraft({ clientId: e.target.value })}
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  />
                  <Input
                    label="Sender address"
                    type="email"
                    value={draft.fromAddress || draft.mailbox}
                    disabled={fieldLocked("fromAddress") && fieldLocked("mailbox")}
                    onChange={(e) =>
                      updateDraft({ fromAddress: e.target.value, mailbox: e.target.value })
                    }
                    placeholder="events@company.com"
                  />
                  <SecretInput
                    label="Client secret"
                    field={apiData.fields.graphClientSecret}
                    edit={secrets.graphClientSecret}
                    onReplace={() =>
                      updateSecret("graphClientSecret", { mode: "replace", value: "" })
                    }
                    onValueChange={(value) => updateSecret("graphClientSecret", { value })}
                    onCancel={() => updateSecret("graphClientSecret", { mode: "idle", value: "" })}
                  />
                  <Switch
                    label="Save to Sent Items"
                    checked={draft.saveToSentItems}
                    disabled={fieldLocked("saveToSentItems")}
                    onChange={(e) => updateDraft({ saveToSentItems: e.target.checked })}
                  />
                </>
              )}

              {provider === "smtp" && (
                <>
                  <Input
                    label="SMTP host"
                    value={draft.host}
                    disabled={fieldLocked("host")}
                    onChange={(e) => updateDraft({ host: e.target.value })}
                    placeholder="smtp.company.com"
                  />
                  <div className="setup-wizard__grid-user-port">
                    <Input
                      label="Username"
                      value={draft.user}
                      disabled={fieldLocked("user")}
                      onChange={(e) => updateDraft({ user: e.target.value })}
                      placeholder="events@company.com"
                    />
                    <Input
                      label="Port"
                      inputMode="numeric"
                      value={draft.port}
                      disabled={fieldLocked("port")}
                      onChange={(e) => updateDraft({ port: e.target.value })}
                      placeholder="587"
                    />
                  </div>
                  <SecretInput
                    label="Password"
                    field={apiData.fields.smtpPassword}
                    edit={secrets.smtpPassword}
                    onReplace={() => updateSecret("smtpPassword", { mode: "replace", value: "" })}
                    onValueChange={(value) => updateSecret("smtpPassword", { value })}
                    onCancel={() => updateSecret("smtpPassword", { mode: "idle", value: "" })}
                  />
                  <Input
                    label="From address"
                    type="email"
                    value={draft.fromAddress}
                    disabled={fieldLocked("fromAddress")}
                    onChange={(e) => updateDraft({ fromAddress: e.target.value })}
                    placeholder="events@company.com"
                  />
                  <div className="setup-wizard__mail-options-row">
                    <Switch
                      label="Use TLS (STARTTLS)"
                      checked={draft.requireTls}
                      disabled={fieldLocked("requireTls")}
                      onChange={(e) => updateDraft({ requireTls: e.target.checked })}
                    />
                    <MailTestControl
                      testSending={testSending}
                      testSent={testSent}
                      onSend={() => void handleTestSend()}
                    />
                  </div>
                </>
              )}

              {provider === "powerautomate" && (
                <>
                  <SecretInput
                    label="Webhook URL"
                    field={apiData.fields.powerAutomateUrl}
                    edit={secrets.powerAutomateUrl}
                    onReplace={() =>
                      updateSecret("powerAutomateUrl", { mode: "replace", value: "" })
                    }
                    onValueChange={(value) => updateSecret("powerAutomateUrl", { value })}
                    onCancel={() => updateSecret("powerAutomateUrl", { mode: "idle", value: "" })}
                  />
                  <Input
                    label="From address"
                    type="email"
                    value={draft.fromAddress}
                    disabled={fieldLocked("fromAddress")}
                    onChange={(e) => updateDraft({ fromAddress: e.target.value })}
                    placeholder="events@company.com"
                  />
                </>
              )}

              {provider === "export_only" && (
                <p className="setup-wizard__hint">
                  No email will be sent. Tickets can be exported as CSV/PDF.
                </p>
              )}

              {provider && provider !== "smtp" && provider !== "export_only" && (
                <MailTestControl
                  testSending={testSending}
                  testSent={testSent}
                  onSend={() => void handleTestSend()}
                />
              )}
            </div>
          </>
        )}
      </>
    );
  },
);

function MailTestControl({
  testSending,
  testSent,
  onSend,
}: Readonly<{
  testSending: boolean;
  testSent: boolean;
  onSend: () => void;
}>) {
  const pendingTestIcon = testSending ? (
    <i className="ti ti-loader-2 setup-wizard__spin" aria-hidden="true" />
  ) : (
    <i className="ti ti-send" aria-hidden="true" />
  );
  const pendingTestLabel = testSending ? "Sending…" : "Send test";
  return (
    <div className="setup-wizard__mail-test-cluster">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="setup-wizard__mail-test-action"
        disabled={testSending}
        onClick={onSend}
        icon={
          testSent ? (
            <i className="ti ti-circle-check setup-wizard__mail-test-icon--ok" aria-hidden="true" />
          ) : (
            pendingTestIcon
          )
        }
      >
        {testSent ? "Test sent" : pendingTestLabel}
      </Button>
      <span className="setup-wizard__mail-test-hint">
        {testSent ? "Check your inbox." : "Optional, sent to your login email."}
      </span>
    </div>
  );
}

function SecretInput({
  label,
  field,
  edit,
  onReplace,
  onValueChange,
  onCancel,
}: Readonly<{
  label: string;
  field: MailSecretFieldDto;
  edit: SecretEdits[keyof SecretEdits];
  onReplace: () => void;
  onValueChange: (value: string) => void;
  onCancel: () => void;
}>) {
  const inputId = useId();

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
      <div className="setup-wizard__secret-row">
        <span className="at-label">{label}</span>
        <div className="setup-wizard__secret-status">
          <span className="setup-wizard__hint">{field.set ? "Set ••••" : "Not set"}</span>
          <Button type="button" variant="ghost" size="sm" onClick={onReplace}>
            {field.set ? "Replace" : "Set"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="at-field setup-wizard__secret-field">
      <div className="setup-wizard__label-row">
        <label className="at-label" htmlFor={inputId}>
          {label}
        </label>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <input
        id={inputId}
        className="at-input"
        type={label === "Webhook URL" ? "url" : "password"}
        autoComplete="new-password"
        value={edit.value}
        onChange={(e) => onValueChange(e.target.value)}
      />
    </div>
  );
}
