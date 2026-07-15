import { useCallback, useEffect, useRef, useState } from "react";
import { Card, Input, Button, useToast } from "@admitto/ui";
import { fetchMailSettings, saveMailSettings, sendMailTransportTest } from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { MailSettingsResponse } from "../api/types.js";
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
import { buildMailProviderOptions } from "./mailProviderOptions.js";
import {
  buildTestResult,
  draftFromFields,
  GraphCard,
  MailTransportCard,
  NO_AUTOFILL_PROPS,
  PowerAutomateCard,
  SenderCard,
  SettingsFooter,
  SmtpConnectionCard,
  TestResultPreview,
  testSendErrorMessage,
  type FieldLocked,
  type TestResult,
} from "./mailTransportFormParts.js";

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
  // Bumped by every draft/secret edit so an in-flight test-send response can detect
  // it's now stale (config changed while the request was in the air) and skip
  // resurrecting a result the operator already moved past.
  const testGenerationRef = useRef(0);

  useEffect(() => {
    if (validationErrors.length > 0) {
      validationErrorsRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [validationErrors]);

  const applyResponse = useCallback((data: MailSettingsResponse) => {
    const nextDraft = draftFromFields(data.fields);
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

  // A test result describes a specific saved configuration — any further edit (to
  // the draft or to a secret) makes it stale, so both wrappers invalidate it.
  const updateDraft = (patch: Partial<MailDraft>) => {
    testGenerationRef.current += 1;
    setTestResult(null);
    setDraft((prev) => ({ ...prev, ...patch }));
  };

  const updateSecrets = (updater: (prev: SecretEdits) => SecretEdits) => {
    testGenerationRef.current += 1;
    setTestResult(null);
    setSecrets(updater);
  };

  const fieldLocked: FieldLocked = (key) => {
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

  let testSendReason: string | undefined;
  let testSendHint: string;
  if (!transportConfigured) {
    testSendReason = "Select and save a transport (SMTP, Graph, or Power Automate) first.";
    testSendHint = testSendReason;
  } else if (hasUnsavedChanges) {
    testSendReason = "Save your changes before sending a test email.";
    testSendHint =
      "Save your changes first — the test uses the saved configuration from the database, not unsaved form values.";
  } else {
    testSendReason = undefined;
    testSendHint = "Verifies transport credentials with a trivial message (not an event template).";
  }

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
    const requestGeneration = testGenerationRef.current;
    const snapshotInputs = {
      host: draft.host,
      port: draft.port,
      mailbox: draft.mailbox || draft.fromAddress,
    };
    setTestSending(true);
    setTestResult(null);
    try {
      const result = await sendMailTransportTest(to);
      if (testGenerationRef.current !== requestGeneration) return;
      const nextResult = buildTestResult(result, to, snapshotInputs);
      setTestResult(nextResult);
      addToast(nextResult.message, nextResult.kind === "ok" ? "success" : "error");
    } catch (err) {
      if (testGenerationRef.current !== requestGeneration) return;
      const message = testSendErrorMessage(err);
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

  const handleSelectProvider = (value: typeof provider) => {
    if (value === "smtp" && draft.provider !== "smtp") {
      updateDraft({ provider: "smtp", ...smtpProviderDraftDefaults() });
    } else {
      updateDraft({ provider: value });
    }
  };

  return (
    <>
      <MailTransportCard
        provider={provider}
        providerOptions={providerOptions}
        fieldLocked={fieldLocked}
        onSelectProvider={handleSelectProvider}
      />

      {provider !== "" && (
        <SenderCard draft={draft} fieldLocked={fieldLocked} updateDraft={updateDraft} />
      )}

      {provider === "smtp" && (
        <SmtpConnectionCard
          draft={draft}
          fieldLocked={fieldLocked}
          updateDraft={updateDraft}
          smtpPasswordField={apiData.fields.smtpPassword}
          smtpPasswordEdit={secrets.smtpPassword}
          updateSecrets={updateSecrets}
        />
      )}

      {provider === "graph" && (
        <GraphCard
          draft={draft}
          fieldLocked={fieldLocked}
          updateDraft={updateDraft}
          graphClientSecretField={apiData.fields.graphClientSecret}
          graphClientSecretEdit={secrets.graphClientSecret}
          updateSecrets={updateSecrets}
        />
      )}

      {provider === "powerautomate" && (
        <PowerAutomateCard
          powerAutomateUrlField={apiData.fields.powerAutomateUrl}
          powerAutomateUrlEdit={secrets.powerAutomateUrl}
          powerAutomateKeyField={apiData.fields.powerAutomateKey}
          powerAutomateKeyEdit={secrets.powerAutomateKey}
          updateSecrets={updateSecrets}
        />
      )}

      <Card title="Send test email">
        <p className="mail-test-send__hint">{testSendHint}</p>
        <div className="mail-test-send__row">
          <Input
            label="Recipient"
            type="text"
            inputMode="email"
            value={testEmail}
            onChange={(e) => setTestEmail(e.target.value)}
            placeholder="you@example.com"
            disabled={!!testSendReason}
            {...NO_AUTOFILL_PROPS}
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
        {testResult && <TestResultPreview testResult={testResult} />}
      </Card>

      <SettingsFooter
        validationErrors={validationErrors}
        validationErrorsRef={validationErrorsRef}
        hasUnsavedChanges={hasUnsavedChanges}
        saving={saving}
        onReset={handleReset}
        onSave={() => void handleSave()}
      />
    </>
  );
}
