import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type ReactNode, type RefObject } from "react";
import { useNavigate } from "react-router";
import { Card, HintLabel, Button, EmptyState, useToast } from "@admitto/ui";
import {
  clearEventMailSettings,
  fetchEventBounceIngestSettings,
  fetchEventMailSettings,
  probeEventMailSmtpConnection,
  saveEventMailSettings,
  sendEventMailTransportTest,
} from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { EventMailSettingsResponse } from "../api/types.js";
import { useAuth } from "../auth/AuthProvider.js";
import { isSuperadmin } from "../auth/capabilities.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { Segmented } from "../components/Segmented.js";
import { whenShown } from "../hooks/useDelayedLoading.js";
import {
  buildSaveMailSettingsBody,
  emptyMailDraft,
  emptySecretEdits,
  isMailSettingsDirty,
  smtpProviderDraftDefaults,
  validateMailDraft,
} from "./mailSettingsValidation.js";
import { buildMailProviderOptions, MAIL_PROVIDER_LABELS } from "./mailProviderOptions.js";
import {
  draftFromFields,
  GraphCard,
  PowerAutomateCard,
  runTestSend,
  SenderCard,
  SendTestEmailCard,
  SettingsFooter,
  SmtpConnectionCard,
  TransportTileGrid,
  useMailSettingsFormState,
  type FieldLocked,
} from "./mailTransportFormParts.js";

const EVENT_MAIL_TRANSPORT_HINT =
  "Organization uses the instance default. Dedicated lets this event send from its own mailbox.";
const EVENT_MAIL_TRANSPORT_INTRO =
  "Which mailbox and provider send this event's tickets and reminders.";

type Mode = "org" | "dedicated";

function modeFromResponse(data: EventMailSettingsResponse): Mode {
  return data.hasEventOverride ? "dedicated" : "org";
}

function smtpConnectionBlockedReason(isArchived: boolean, hasUnsavedChanges: boolean): string | undefined {
  if (isArchived) return "This event is archived.";
  if (hasUnsavedChanges) return "Save your changes first.";
  return undefined;
}

function resolveTestSendCopy(args: {
  isArchived: boolean;
  transportConfigured: boolean;
  hasUnsavedChanges: boolean;
}): { testSendReason: string | undefined; testSendHint: string } {
  if (args.isArchived) {
    const msg = "This event is archived. Mail settings cannot be tested.";
    return { testSendReason: msg, testSendHint: msg };
  }
  if (!args.transportConfigured) {
    const msg = "Select and save a transport (SMTP, Graph, or Power Automate) first.";
    return { testSendReason: msg, testSendHint: msg };
  }
  if (args.hasUnsavedChanges) {
    return {
      testSendReason: "Save your changes before sending a test email.",
      testSendHint:
        "Save your changes first. The test uses the saved configuration, not unsaved form values.",
    };
  }
  return {
    testSendReason: undefined,
    testSendHint:
      "Verifies whichever transport actually resolves for this event (dedicated or inherited).",
  };
}

function resolveBounceVerifyBlockedReason(args: {
  isArchived: boolean;
  bounceIngestReady: boolean;
  hasUnsavedChanges: boolean;
  transportConfigured: boolean;
}): string | undefined {
  if (args.isArchived) return "This event is archived.";
  if (!args.bounceIngestReady) {
    return "Enable and configure bounce detection for this event first.";
  }
  if (args.hasUnsavedChanges) return "Save your changes before verifying bounce.";
  if (!args.transportConfigured) return "Select and save a transport first.";
  return undefined;
}

/** One-line summary of a resolved, configured transport ("Microsoft Graph · sends as x@y.com"). */
function transportSummaryLine(data: EventMailSettingsResponse, provider: NonNullable<EventMailSettingsResponse["fields"]["provider"]["value"]>): string {
  const from = data.fields.fromAddress.value;
  return from ? `${MAIL_PROVIDER_LABELS[provider]} · sends as ${from}` : MAIL_PROVIDER_LABELS[provider];
}

/** Read-only summary of the organization's effective mail transport — only accurate to
 * show when the event currently has no override (apiData.fields ARE the org's resolved
 * values in that state; once an override exists, apiData.fields describe the event's own
 * config instead, so there is nothing trustworthy to preview here). */
function OrgMailSummary({
  data,
  canOpenInstanceSettings,
  onOpenInstanceSettings,
}: Readonly<{
  data: EventMailSettingsResponse;
  canOpenInstanceSettings: boolean;
  onOpenInstanceSettings: () => void;
}>) {
  const provider = data.fields.provider.value;
  const configured = provider !== null;

  return (
    <div className={`org-mail-summary${configured ? " org-mail-summary--configured" : ""}`}>
      <span className="org-mail-summary__icon">
        <i className={`ti ${configured ? "ti-circle-check" : "ti-building"}`} aria-hidden="true" />
      </span>
      <div className="org-mail-summary__body">
        <strong>
          {configured
            ? "Using the organization's mail transport"
            : "Organization mail transport not set up"}
        </strong>
        <span>
          {configured
            ? transportSummaryLine(data, provider)
            : "Configure it in instance settings, or switch this event to a dedicated transport."}
        </span>
      </div>
      {canOpenInstanceSettings && (
        <Button variant="secondary" size="sm" onClick={onOpenInstanceSettings}>
          Open instance settings
        </Button>
      )}
    </div>
  );
}

/** Imperative save()/reset(), kept for tests that drive the form directly. On the event
 * Mail tab the real Save/Reset pair lives in a shared tab footer (transport + bounce).
 * Standalone renders (unit tests) still embed SettingsFooter when `embeddedFooter` is true. */
export type EventMailSettingsCardHandle = {
  save: () => Promise<void>;
  reset: () => void;
};

/** Per-event dedicated transport override — inherits the organization's mail settings by
 * default; a superadmin or org admin can switch an event to send through its own transport
 * instead (see issue #511). Reuses the same tile-grid/secret-field building blocks as the
 * instance-level Mail transport panel. */
export const EventMailSettingsCard = forwardRef<
  EventMailSettingsCardHandle,
  Readonly<{
    eventId: string;
    isArchived: boolean;
    /** Notified on every change to hasUnsavedChanges, so a hosting page can fold this card's
     * dirty state into its own navigation/unload/destructive-action warnings (CodeRabbit review). */
    onDirtyChange?: (dirty: boolean) => void;
    /** Notified on every change to the in-flight save/revert state, so the page header's
     * hoisted Save button can disable itself and show "Saving…" the same way this card's
     * own button used to. */
    onSavingChange?: (saving: boolean) => void;
    /** When false, omit the card footer so the host can render one shared Save/Reset for the
     * whole Mail tab (bounce panel included). Defaults to true for standalone/unit use. */
    embeddedFooter?: boolean;
    /** Forwarded when the host owns the footer and needs to show this card's validation list. */
    onValidationErrorsChange?: (errors: string[]) => void;
    /** Host-owned list element for scroll-into-view when `embeddedFooter` is false. */
    validationErrorsListRef?: RefObject<HTMLUListElement | null>;
    /** Rendered above Send test email (e.g. Bounce detection on the Event Mailing tab). */
    children?: ReactNode;
  }>
>(function EventMailSettingsCard(
  {
    eventId,
    isArchived,
    onDirtyChange,
    onSavingChange,
    embeddedFooter = true,
    onValidationErrorsChange,
    validationErrorsListRef,
    children,
  },
  ref,
) {
  const { addToast } = useToast();
  const { assignments } = useAuth();
  const isSa = isSuperadmin(assignments);
  const navigate = useNavigate();

  const [apiData, setApiData] = useState<EventMailSettingsResponse | null>(null);
  const [mode, setMode] = useState<Mode>("org");
  const [savedMode, setSavedMode] = useState<Mode>("org");
  const [confirmRevertOpen, setConfirmRevertOpen] = useState(false);
  const [revertError, setRevertError] = useState<string | null>(null);
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
  const [probeTesting, setProbeTesting] = useState(false);
  const [probeResult, setProbeResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [bounceVerify, setBounceVerify] = useState(false);
  const [bounceIngestReady, setBounceIngestReady] = useState(false);
  // First switch into "dedicated" (no saved override yet) starts the draft blank rather
  // than prefilled with the organization's values — prefilled-but-unedited would silently
  // save as a full duplicate of the org's config the moment Save is clicked. Only the
  // *first* switch clears it, so toggling org <-> dedicated afterward doesn't wipe
  // whatever the admin has already typed. Reset whenever a fresh response is applied
  // (load, save, revert) so the next "first switch" after that behaves the same way.
  const dedicatedDraftSeededRef = useRef(false);

  useEffect(() => {
    if (validationErrors.length > 0) {
      (validationErrorsListRef ?? validationErrorsRef).current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }
  }, [validationErrors, validationErrorsListRef, validationErrorsRef]);

  const applyResponse = useCallback(
    (data: EventMailSettingsResponse) => {
      const nextDraft = draftFromFields(data.fields);
      const nextMode = modeFromResponse(data);
      setApiData(data);
      setMode(nextMode);
      setSavedMode(nextMode);
      setDraft(nextDraft);
      setSavedDraft(nextDraft);
      setSecrets(emptySecretEdits());
      setValidationErrors([]);
      setProbeResult(null);
      dedicatedDraftSeededRef.current = false;
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
      const data = await fetchEventMailSettings(eventId, ac.signal);
      if (ac.signal.aborted) return;
      applyResponse(data);
    } catch {
      if (ac.signal.aborted) return;
      setLoadError("Failed to load mail settings.");
      setApiData(null);
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, [eventId, applyResponse, loadAbortRef, setLoadError, setLoading]);

  useEffect(() => {
    loadSettings().catch(() => {});
    return () => loadAbortRef.current?.abort();
  }, [loadSettings, loadAbortRef]);

  useEffect(() => {
    const ac = new AbortController();
    void (async () => {
      try {
        const bounce = await fetchEventBounceIngestSettings(eventId, ac.signal);
        if (ac.signal.aborted) return;
        setBounceIngestReady(bounce.configured && bounce.enabled);
      } catch {
        if (ac.signal.aborted) return;
        setBounceIngestReady(false);
      }
    })();
    return () => ac.abort();
  }, [eventId]);

  useEffect(() => {
    if (!bounceIngestReady && bounceVerify) setBounceVerify(false);
  }, [bounceIngestReady, bounceVerify]);

  const handleModeChange = (next: Mode) => {
    testGenerationRef.current += 1;
    setTestResult(null);
    if (next === "dedicated" && !apiData?.hasEventOverride && !dedicatedDraftSeededRef.current) {
      dedicatedDraftSeededRef.current = true;
      setDraft(emptyMailDraft());
      setSecrets(emptySecretEdits());
    }
    setMode(next);
  };

  const fieldLocked: FieldLocked = (key) => {
    if (!apiData) return false;
    const fd = apiData.fields[key];
    return Boolean(fd && "locked" in fd && fd.locked);
  };

  const handleSave = async () => {
    if (!apiData) return;
    if (mode === "dedicated") {
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
        const data = await saveEventMailSettings(eventId, body);
        applyResponse(data);
        addToast("Event mail settings saved.", "success");
      } catch (err) {
        addToast(operatorApiErrorMessage(err, "Failed to save mail settings."), "error");
      } finally {
        setSaving(false);
      }
      return;
    }

    // Organization selected: only clear a dedicated override when one is actually pending /
    // saved. Already-inherited org with nothing dirty must be a no-op (shared Mail-tab Save
    // also persists bounce settings and must not open Revert for that).
    if (savedMode === "org" && !apiData.hasEventOverride) {
      return;
    }

    setValidationErrors([]);
    setRevertError(null);
    setConfirmRevertOpen(true);
  };

  const handleConfirmRevert = async () => {
    setSaving(true);
    setRevertError(null);
    try {
      const data = await clearEventMailSettings(eventId);
      applyResponse(data);
      setConfirmRevertOpen(false);
      addToast("Reverted to the organization's mail settings.", "success");
    } catch (err) {
      setRevertError(operatorApiErrorMessage(err, "Failed to revert mail settings."));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setMode(savedMode);
    setDraft(savedDraft);
    setSecrets(emptySecretEdits());
    setValidationErrors([]);
    dedicatedDraftSeededRef.current = false;
  };

  useImperativeHandle(ref, () => ({
    save: handleSave,
    reset: handleReset,
  }));

  const hasUnsavedChanges =
    mode !== savedMode || (mode === "dedicated" && isMailSettingsDirty(draft, savedDraft, secrets));

  useEffect(() => {
    onDirtyChange?.(hasUnsavedChanges);
  }, [hasUnsavedChanges, onDirtyChange]);

  useEffect(() => {
    onSavingChange?.(saving);
  }, [saving, onSavingChange]);

  useEffect(() => {
    onValidationErrorsChange?.(validationErrors);
  }, [validationErrors, onValidationErrorsChange]);

  // Org mode always tests the saved organization transport, never leftover edits from a
  // dedicated draft the admin switched away from (CodeRabbit review) — inherited -> dedicated
  // edits -> back to organization must not disable/mislabel the test using stale draft state.
  const testDraft = mode === "org" ? savedDraft : draft;

  const transportConfigured =
    testDraft.provider === "smtp" ||
    testDraft.provider === "graph" ||
    testDraft.provider === "powerautomate";

  const { testSendReason, testSendHint } = resolveTestSendCopy({
    isArchived,
    transportConfigured,
    hasUnsavedChanges,
  });
  const bounceVerifyBlockedReason = resolveBounceVerifyBlockedReason({
    isArchived,
    bounceIngestReady,
    hasUnsavedChanges,
    transportConfigured,
  });

  const handleTestSend = async () => {
    if (testSendReason) {
      addToast(testSendReason, "warning");
      return;
    }
    const verifyBounce = bounceVerify && !bounceVerifyBlockedReason;
    await runTestSend({
      testEmail,
      draft: testDraft,
      send: (to) => sendEventMailTransportTest(eventId, to, { verifyBounce }),
      testGenerationRef,
      setTestSending,
      setTestResult,
      addToast,
    });
  };

  const handleTestConnection = async () => {
    if (isArchived || hasUnsavedChanges || mode !== "dedicated" || draft.provider !== "smtp") {
      return;
    }
    setProbeTesting(true);
    setProbeResult(null);
    try {
      const res = await probeEventMailSmtpConnection(eventId);
      setProbeResult({
        ok: res.ok,
        message: res.ok
          ? (res.message ?? "Connected.")
          : (res.error ?? "Could not connect."),
      });
    } catch (err) {
      setProbeResult({
        ok: false,
        message: operatorApiErrorMessage(err, "Could not test the SMTP connection."),
      });
    } finally {
      setProbeTesting(false);
    }
  };

  if (loading) {
    return whenShown(
      showLoading,
      <Card title="Mail transport">
        <p>Loading mail settings…</p>
      </Card>,
    );
  }

  if (loadError) {
    return (
      <Card title="Mail transport">
        <EmptyState
          title="Could not load mail settings"
          description={loadError}
          action={
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                loadSettings().catch(() => {});
              }}
            >
              Retry
            </Button>
          }
        />
      </Card>
    );
  }

  // Successful load always populates apiData; failures always set loadError above.
  /* v8 ignore if */
  if (!apiData) return null;

  const showExportOnly =
    !apiData.isProduction || (fieldLocked("provider") && draft.provider === "export_only");
  const providerOptions = buildMailProviderOptions("settings", showExportOnly);

  const handleSelectProvider = (value: typeof draft.provider) => {
    if (value === "smtp" && draft.provider !== "smtp") {
      updateDraft({ provider: "smtp", ...smtpProviderDraftDefaults() });
    } else {
      updateDraft({ provider: value });
    }
  };

  // Only trustworthy when the event currently has no saved override — see OrgMailSummary's
  // own doc comment for why a toggled-but-unsaved "org" mode can't reuse it.
  const orgSummaryTrustworthy = !apiData.hasEventOverride;

  return (
    <div className="settings-sections">
      <Card
        title={<HintLabel hint={EVENT_MAIL_TRANSPORT_HINT}>Mail transport</HintLabel>}
        actions={
          <Segmented
            ariaLabel="Mail source"
            className="mail-source-toggle"
            value={mode}
            disabled={isArchived || saving}
            onChange={handleModeChange}
            options={[
              { value: "org", label: "Organization" },
              { value: "dedicated", label: "Dedicated" },
            ]}
          />
        }
      >
        <div className="settings-card-stack">
          <p className="settings-card-intro">{EVENT_MAIL_TRANSPORT_INTRO}</p>
          {mode === "org" &&
            (orgSummaryTrustworthy ? (
              <OrgMailSummary
                data={apiData}
                canOpenInstanceSettings={isSa}
                onOpenInstanceSettings={() => navigate("/admin/settings?tab=mail")}
              />
            ) : (
              <p className="mail-transport__env-note">
                Reverting will remove this event&apos;s dedicated transport and fall back to the
                organization&apos;s mail settings. Save to confirm.
              </p>
            ))}

          {mode === "org" && !isSa && (
            <p className="field-hint">
              Only a superadmin can view or change the organization&apos;s mail settings.
            </p>
          )}

          {mode === "dedicated" && (
            <div className="mail-transport-form">
              <p className="mail-transport__desc">
                Useful for a co-branded event or a separate mailbox.
              </p>
              {fieldLocked("provider") && (
                <p className="mail-transport__env-note">
                  Some transport settings are managed by your deployment configuration and cannot be
                  changed here. Contact your instance administrator if you need to update them.
                </p>
              )}
              <TransportTileGrid
                provider={draft.provider}
                providerOptions={providerOptions}
                locked={fieldLocked("provider") || isArchived}
                onSelect={handleSelectProvider}
                includeNotConfigured={false}
              />
            </div>
          )}
        </div>
      </Card>

      {mode === "dedicated" && (
        <>
          {draft.provider !== "" && (
            <SenderCard
              draft={draft}
              fieldLocked={fieldLocked}
              updateDraft={updateDraft}
              disabled={isArchived}
            />
          )}

          {draft.provider === "smtp" && (
            <SmtpConnectionCard
              draft={draft}
              fieldLocked={fieldLocked}
              updateDraft={updateDraft}
              smtpPasswordField={apiData.fields.smtpPassword}
              smtpPasswordEdit={secrets.smtpPassword}
              updateSecrets={updateSecrets}
              disabled={isArchived}
              onTestConnection={() => void handleTestConnection()}
              testing={probeTesting}
              testBlocked={hasUnsavedChanges || isArchived}
              testBlockedReason={smtpConnectionBlockedReason(isArchived, hasUnsavedChanges)}
              testResult={probeResult}
            />
          )}

          {draft.provider === "graph" && (
            <GraphCard
              draft={draft}
              fieldLocked={fieldLocked}
              updateDraft={updateDraft}
              graphClientSecretField={apiData.fields.graphClientSecret}
              graphClientSecretEdit={secrets.graphClientSecret}
              updateSecrets={updateSecrets}
              disabled={isArchived}
            />
          )}

          {draft.provider === "powerautomate" && (
            <PowerAutomateCard
              powerAutomateUrlField={apiData.fields.powerAutomateUrl}
              powerAutomateUrlEdit={secrets.powerAutomateUrl}
              powerAutomateKeyField={apiData.fields.powerAutomateKey}
              powerAutomateKeyEdit={secrets.powerAutomateKey}
              updateSecrets={updateSecrets}
              disabled={isArchived}
            />
          )}
        </>
      )}

      {children}

      <SendTestEmailCard
        idPrefix="event-mail-test-send"
        testEmail={testEmail}
        onTestEmailChange={setTestEmail}
        testSendHint={testSendHint}
        testSendReason={testSendReason}
        testSending={testSending}
        onTestSend={() => void handleTestSend()}
        testResult={testResult}
        bounceVerify={bounceVerify}
        onBounceVerifyChange={setBounceVerify}
        bounceVerifyBlockedReason={bounceVerifyBlockedReason}
      />

      {isArchived ? (
        <p className="field-hint event-settings-archived-note">
          This event is archived - mail settings cannot be changed.
        </p>
      ) : (
        embeddedFooter && (
          <SettingsFooter
            validationErrors={validationErrors}
            validationErrorsRef={validationErrorsRef}
            hasUnsavedChanges={hasUnsavedChanges}
            saving={saving}
            onReset={handleReset}
            onSave={() => void handleSave()}
          />
        )
      )}

      <ConfirmDialog
        open={confirmRevertOpen}
        title="Revert to organization mail"
        message="This removes this event's dedicated mail transport and any stored secrets, and reverts to the organization's mail settings."
        errorMessage={revertError}
        confirmLabel="Revert"
        confirmVariant="danger"
        loading={saving}
        onConfirm={() => void handleConfirmRevert()}
        onCancel={() => setConfirmRevertOpen(false)}
      />
    </div>
  );
});
