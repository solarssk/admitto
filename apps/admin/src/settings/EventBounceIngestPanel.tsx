import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";
import {
  Button,
  Card,
  EmptyState,
  HintLabel,
  Input,
  Notice,
  Select,
  Switch,
  Tooltip,
  useToast,
} from "@admitto/ui";
import {
  fetchEventBounceIngestSettings,
  saveEventBounceIngestSettings,
  testEventBounceIngestConnection,
} from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type {
  EventBounceIngestSettingsResponse,
  MailSecretFieldDto,
  SaveEventBounceIngestSettingsBody,
} from "../api/types.js";
import { useDelayedLoading, whenShown } from "../hooks/useDelayedLoading.js";
import { emptySecretEdits, type SecretEdits } from "./mailSettingsValidation.js";
import { NO_AUTOFILL_PROPS, SecretFieldRow } from "./mailTransportFormParts.js";

const POLL_OPTIONS = [
  { value: 5, label: "5 minutes" },
  { value: 15, label: "15 minutes" },
  { value: 30, label: "30 minutes" },
  { value: 60, label: "60 minutes" },
] as const;

/** Card title (i) - complements the intro; does not restate what the card does. */
const BOUNCE_CARD_HINT =
  "Off keeps mailbox settings saved without polling for bounces.";

/** What the card does + that send vs receive can share an account or differ. */
const BOUNCE_CARD_INTRO =
  "Looks in a mailbox for delivery-failure emails and marks matching tickets for this event as bounced. That mailbox can be the same account you send from, or a different inbox if your send and receive setups differ.";

const BOUNCE_REUSE_HINT_AVAILABLE =
  "Same username and password as this event's SMTP. IMAP host and port stay separate (they often use different server names).";

const BOUNCE_REUSE_HINT_UNAVAILABLE =
  "Available when this event's mail transport is SMTP.";

type Draft = {
  enabled: boolean;
  imapHost: string;
  imapPort: string;
  imapUsername: string;
  reuseSmtp: boolean;
  folders: string;
  pollIntervalMinutes: number;
};

function draftFromApi(data: EventBounceIngestSettingsResponse): Draft {
  return {
    enabled: data.enabled,
    imapHost: data.imap_host ?? "",
    imapPort: String(data.imap_port ?? 993),
    imapUsername: data.imap_username ?? "",
    reuseSmtp: data.reuse_smtp_credentials,
    folders: data.folders.join(", "),
    pollIntervalMinutes: data.poll_interval_minutes || 5,
  };
}

function emptyDraft(): Draft {
  return {
    enabled: false,
    imapHost: "",
    imapPort: "993",
    imapUsername: "",
    reuseSmtp: false,
    folders: "INBOX, Junk Email",
    pollIntervalMinutes: 5,
  };
}

function secretFieldFromApi(data: EventBounceIngestSettingsResponse): MailSecretFieldDto {
  return {
    set: data.imap_password.set,
    masked: data.imap_password.masked,
    source: "db",
    locked: false,
  };
}

function bounceTestBlockedReason(
  isArchived: boolean,
  dirty: boolean,
  configured: boolean,
): string | undefined {
  if (isArchived) return "This event is archived.";
  if (dirty) return "Save your changes first.";
  if (!configured) return "Save your bounce detection settings first.";
  return undefined;
}

export type EventBounceIngestPanelHandle = {
  /** Persist settings. Resolves `true` on success, `false` on validation/API failure. */
  save: () => Promise<boolean>;
  reset: () => void;
  /** Re-fetch settings (e.g. after mail transport save changes smtp_reuse_available). */
  refresh: () => void;
};

/** Event-scoped IMAP bounce ingest. Save/Reset live on the Mail tab's shared footer. */
export const EventBounceIngestPanel = forwardRef<
  EventBounceIngestPanelHandle,
  Readonly<{
    eventId: string;
    isArchived: boolean;
    onDirtyChange?: (dirty: boolean) => void;
    onSavingChange?: (saving: boolean) => void;
    /** Called after a successful save so the parent can refresh Also verify bounce readiness. */
    onSaved?: () => void;
  }>
>(function EventBounceIngestPanel(
  { eventId, isArchived, onDirtyChange, onSavingChange, onSaved },
  ref,
) {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const showLoading = useDelayedLoading(loading);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [apiData, setApiData] = useState<EventBounceIngestSettingsResponse | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [baseline, setBaseline] = useState<Draft>(emptyDraft());
  const [secrets, setSecrets] = useState<SecretEdits>(emptySecretEdits());
  const [passwordField, setPasswordField] = useState<MailSecretFieldDto>({
    set: false,
    masked: null,
    source: "default",
    locked: false,
  });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setLoadError(null);
      try {
        const data = await fetchEventBounceIngestSettings(eventId, signal);
        if (signal?.aborted) return;
        setApiData(data);
        const d = draftFromApi(data);
        setDraft(d);
        setBaseline(d);
        setPasswordField(secretFieldFromApi(data));
        setSecrets(emptySecretEdits());
        setTestResult(null);
      } catch (err) {
        if (signal?.aborted) return;
        setLoadError(operatorApiErrorMessage(err, "Failed to load bounce detection settings."));
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [eventId],
  );

  useEffect(() => {
    const ac = new AbortController();
    void load(ac.signal);
    return () => ac.abort();
  }, [load]);

  const dirty = useMemo(() => {
    if (
      draft.enabled !== baseline.enabled ||
      draft.imapHost !== baseline.imapHost ||
      draft.imapPort !== baseline.imapPort ||
      draft.imapUsername !== baseline.imapUsername ||
      draft.reuseSmtp !== baseline.reuseSmtp ||
      draft.folders !== baseline.folders ||
      draft.pollIntervalMinutes !== baseline.pollIntervalMinutes
    ) {
      return true;
    }
    return secrets.smtpPassword.mode !== "idle";
  }, [draft, baseline, secrets]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    onSavingChange?.(saving);
  }, [saving, onSavingChange]);

  const updateSecrets = useCallback((updater: (s: SecretEdits) => SecretEdits) => {
    setSecrets(updater);
  }, []);

  const handleReset = useCallback(() => {
    setDraft(baseline);
    setSecrets(emptySecretEdits());
    setTestResult(null);
  }, [baseline]);

  const handleSave = useCallback(async (): Promise<boolean> => {
    const port = Number.parseInt(draft.imapPort, 10);
    if (!Number.isFinite(port) || port < 1 || port > 65535) {
      addToast("IMAP port must be a number between 1 and 65535.", "error");
      return false;
    }

    const body: SaveEventBounceIngestSettingsBody = {
      enabled: draft.enabled,
      imap_host: draft.imapHost.trim(),
      imap_port: port,
      reuse_smtp_credentials: draft.reuseSmtp && (apiData?.smtp_reuse_available ?? false),
      folders: draft.folders
        .split(",")
        .map((f) => f.trim())
        .filter(Boolean),
      poll_interval_minutes: draft.pollIntervalMinutes,
    };

    if (!body.reuse_smtp_credentials) {
      body.imap_username = draft.imapUsername.trim();
      if (secrets.smtpPassword.mode === "replace" && secrets.smtpPassword.value.trim()) {
        body.imap_password = secrets.smtpPassword.value.trim();
      } else if (secrets.smtpPassword.mode === "clear") {
        body.clear_imap_password = true;
      }
    }

    setSaving(true);
    try {
      const data = await saveEventBounceIngestSettings(eventId, body);
      setApiData(data);
      const d = draftFromApi(data);
      setDraft(d);
      setBaseline(d);
      setPasswordField(secretFieldFromApi(data));
      setSecrets(emptySecretEdits());
      setTestResult(null);
      addToast("Bounce detection settings saved.", "success");
      onSaved?.();
      return true;
    } catch (err) {
      addToast(operatorApiErrorMessage(err, "Failed to save bounce detection settings."), "error");
      return false;
    } finally {
      setSaving(false);
    }
  }, [addToast, apiData?.smtp_reuse_available, draft, eventId, onSaved, secrets.smtpPassword]);

  useImperativeHandle(ref, () => ({
    save: handleSave,
    reset: handleReset,
    refresh: () => {
      void load();
    },
  }));

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await testEventBounceIngestConnection(eventId);
      setTestResult({
        ok: res.ok,
        message: res.ok
          ? (res.message ?? "Connected.")
          : (res.error ?? "Could not connect."),
      });
    } catch (err) {
      setTestResult({
        ok: false,
        message: operatorApiErrorMessage(err, "Could not test the IMAP connection."),
      });
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return whenShown(
      showLoading,
      <Card title={<HintLabel hint={BOUNCE_CARD_HINT}>Bounce detection</HintLabel>}>
        <p className="settings-card-intro">Loading…</p>
      </Card>,
    );
  }

  if (loadError) {
    return (
      <Card title={<HintLabel hint={BOUNCE_CARD_HINT}>Bounce detection</HintLabel>}>
        <Notice variant="error" role="alert">
          {loadError}{" "}
          <button type="button" className="linkish" onClick={() => void load()}>
            Retry
          </button>
        </Notice>
      </Card>
    );
  }

  const smtpReuseAvailable = apiData?.smtp_reuse_available ?? false;
  const reuseOn = draft.reuseSmtp && smtpReuseAvailable;
  const testBlockedReason = bounceTestBlockedReason(
    isArchived,
    dirty,
    apiData?.configured ?? false,
  );
  const testBlocked = Boolean(testBlockedReason);
  const testReasonId = "event-bounce-ingest-test-reason";

  return (
    <div className="event-bounce-ingest">
      <Card
        title={<HintLabel hint={BOUNCE_CARD_HINT}>Bounce detection</HintLabel>}
        actions={
          <Switch
            label={draft.enabled ? "On" : "Off"}
            checked={draft.enabled}
            disabled={isArchived}
            onChange={(e) => setDraft((d) => ({ ...d, enabled: e.target.checked }))}
          />
        }
      >
        <div className="settings-card-stack">
          <p className="settings-card-intro">{BOUNCE_CARD_INTRO}</p>

          <div className="mail-transport-form">
            <div className="mail-transport-section">
              <Input
                label="IMAP host"
                placeholder="imap.yourprovider.com"
                value={draft.imapHost}
                disabled={isArchived}
                {...NO_AUTOFILL_PROPS}
                onChange={(e) => setDraft((d) => ({ ...d, imapHost: e.target.value }))}
              />
              <Input
                label="Port"
                inputMode="numeric"
                value={draft.imapPort}
                disabled={isArchived}
                {...NO_AUTOFILL_PROPS}
                onChange={(e) => setDraft((d) => ({ ...d, imapPort: e.target.value }))}
              />

              <div className="settings-row event-bounce-ingest__reuse-row">
                <div className="settings-row__text">
                  <strong>Use SMTP username &amp; password</strong>
                  <p>
                    {smtpReuseAvailable
                      ? BOUNCE_REUSE_HINT_AVAILABLE
                      : BOUNCE_REUSE_HINT_UNAVAILABLE}
                  </p>
                </div>
                <Switch
                  aria-label="Use SMTP username and password"
                  checked={reuseOn}
                  disabled={isArchived || !smtpReuseAvailable}
                  onChange={(e) => setDraft((d) => ({ ...d, reuseSmtp: e.target.checked }))}
                />
              </div>

              {!reuseOn && (
                <>
                  <Input
                    label="Username"
                    placeholder="you+admitto@example.com"
                    value={draft.imapUsername}
                    disabled={isArchived}
                    {...NO_AUTOFILL_PROPS}
                    onChange={(e) => setDraft((d) => ({ ...d, imapUsername: e.target.value }))}
                  />
                  <SecretFieldRow
                    label="Password"
                    field={passwordField}
                    edit={secrets.smtpPassword}
                    disabled={isArchived}
                    onReplace={() =>
                      updateSecrets((s) => ({
                        ...s,
                        smtpPassword: { mode: "replace", value: "" },
                      }))
                    }
                    onClear={() =>
                      updateSecrets((s) => ({
                        ...s,
                        smtpPassword: { mode: "clear", value: "" },
                      }))
                    }
                    onValueChange={(value) =>
                      updateSecrets((s) => ({
                        ...s,
                        smtpPassword: { ...s.smtpPassword, value },
                      }))
                    }
                    onCancel={() =>
                      updateSecrets((s) => ({
                        ...s,
                        smtpPassword: { mode: "idle", value: "" },
                      }))
                    }
                  />
                </>
              )}

              <Input
                label="Folders to check"
                value={draft.folders}
                disabled={isArchived}
                hint="Folder names vary by mail server. Separate multiple names with commas."
                {...NO_AUTOFILL_PROPS}
                onChange={(e) => setDraft((d) => ({ ...d, folders: e.target.value }))}
              />
              <div className="event-bounce-ingest__poll-and-test">
                <Select
                  label="Check every"
                  className="event-bounce-ingest__poll-select"
                  value={String(draft.pollIntervalMinutes)}
                  disabled={isArchived}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      pollIntervalMinutes: Number.parseInt(e.target.value, 10) || 5,
                    }))
                  }
                >
                  {POLL_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </Select>
                <div className="event-bounce-ingest__test-control">
                  <Tooltip content={testBlockedReason}>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={testing || testBlocked}
                      aria-describedby={testBlockedReason ? testReasonId : undefined}
                      onClick={() => void handleTest()}
                      icon={<i className="ti ti-plug" aria-hidden="true" />}
                    >
                      {testing ? "Testing…" : "Test connection"}
                    </Button>
                  </Tooltip>
                  {testBlockedReason && (
                    <span id={testReasonId} className="sr-only">
                      {testBlockedReason}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {testResult && (
              <Notice variant={testResult.ok ? "success" : "error"} role="status">
                {testResult.message}
              </Notice>
            )}

            <Notice variant="highlight" role="note">
              <strong>One-time setup in your mail app, not in Admitto:</strong> failure
              replies must arrive in the mailbox configured above. Set the return address on
              the sending mailbox to a sub-address such as{" "}
              <code>you+admitto@example.com</code>, then add a rule that forwards those
              failure messages into this mailbox.
            </Notice>
          </div>
        </div>
      </Card>

      <Card
        title={
          <HintLabel hint="Updated by the bounce-ingest sidecar, not by Test connection.">
            Last automatic check
          </HintLabel>
        }
      >
        <EmptyState
          icon={<i className="ti ti-clock" aria-hidden="true" />}
          title="Not tracked yet"
          description="Last-run status is not available in this version."
        />
      </Card>
    </div>
  );
});
