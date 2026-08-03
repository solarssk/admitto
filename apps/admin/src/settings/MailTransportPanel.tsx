import { useCallback, useEffect, useState } from "react";
import { Card, useToast } from "@admitto/ui";
import { fetchMailSettings, saveMailSettings, sendMailTransportTest } from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { MailSettingsResponse } from "../api/types.js";
import {
  buildSaveMailSettingsBody,
  emptySecretEdits,
  isMailSettingsDirty,
  smtpProviderDraftDefaults,
  validateMailDraft,
} from "./mailSettingsValidation.js";
import { buildMailProviderOptions } from "./mailProviderOptions.js";
import {
  draftFromFields,
  GraphCard,
  MailTransportCard,
  PowerAutomateCard,
  runTestSend,
  SenderCard,
  SendTestEmailCard,
  SettingsFooter,
  SmtpConnectionCard,
  useMailSettingsFormState,
  type FieldLocked,
} from "./mailTransportFormParts.js";

/** Superadmin mail transport configuration panel. */
export function MailTransportPanel() {
  const { addToast } = useToast();
  const [apiData, setApiData] = useState<MailSettingsResponse | null>(null);
  const {
    draft,
    setDraft,
    secrets,
    setSecrets,
    savedDraft,
    setSavedDraft,
    loading,
    setLoading,
    showLoading,
    loadError,
    setLoadError,
    validationErrors,
    setValidationErrors,
    saving,
    setSaving,
    testEmail,
    setTestEmail,
    testSending,
    setTestSending,
    testResult,
    setTestResult,
    loadAbortRef,
    validationErrorsRef,
    testGenerationRef,
    updateDraft,
    updateSecrets,
  } = useMailSettingsFormState();

  useEffect(() => {
    if (validationErrors.length > 0) {
      validationErrorsRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [validationErrors, validationErrorsRef]);

  const applyResponse = useCallback(
    (data: MailSettingsResponse) => {
      const nextDraft = draftFromFields(data.fields);
      setApiData(data);
      setDraft(nextDraft);
      setSavedDraft(nextDraft);
      setSecrets(emptySecretEdits());
      setValidationErrors([]);
    },
    [setDraft, setSavedDraft, setSecrets, setValidationErrors],
  );

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
  }, [applyResponse, loadAbortRef, setLoadError, setLoading]);

  useEffect(() => {
    void loadSettings();
    return () => loadAbortRef.current?.abort();
  }, [loadSettings, loadAbortRef]);

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
      "Save your changes first. The test uses the saved configuration from the database, not unsaved form values.";
  } else {
    testSendReason = undefined;
    testSendHint = "Checks that the saved instance transport can deliver mail.";
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
    await runTestSend({
      testEmail,
      draft,
      send: (to) => sendMailTransportTest(to),
      testGenerationRef,
      setTestSending,
      setTestResult,
      addToast,
    });
  };

  const showExportOnly =
    apiData && (!apiData.isProduction || (fieldLocked("provider") && draft.provider === "export_only"));
  const providerOptions = buildMailProviderOptions("settings", Boolean(showExportOnly));

  const provider = draft.provider;

  if (loading) {
    if (!showLoading) return null;
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

      <SendTestEmailCard
        idPrefix="mail-test-send"
        testEmail={testEmail}
        onTestEmailChange={setTestEmail}
        testSendHint={testSendHint}
        testSendReason={testSendReason}
        testSending={testSending}
        onTestSend={() => void handleTestSend()}
        testResult={testResult}
      />

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
