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
  Switch,
  Tooltip,
  useToast,
} from "@admitto/ui";
import {
  fetchEventBounceIngestSettings,
  runEventBounceIngestCheck,
  saveEventBounceIngestSettings,
  testEventBounceIngestConnection,
} from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type {
  EventBounceIngestLastRunDto,
  EventBounceIngestSettingsResponse,
  MailSecretFieldDto,
  SaveEventBounceIngestSettingsBody,
} from "../api/types.js";
import { SearchableSelect } from "../components/SearchableSelect.js";
import { useConnectionTest } from "../hooks/useConnectionTest.js";
import { useDelayedLoading, useLoadingGate } from "../hooks/useDelayedLoading.js";
import { useRetry } from "../hooks/useRetry.js";
import { emptySecretEdits, type SecretEdits } from "./mailSettingsValidation.js";
import { NO_AUTOFILL_PROPS, SecretFieldRow } from "./mailTransportFormParts.js";
import { PanelLoadError } from "./PanelLoadError.js";
import { SettingsPanelSkeleton, type SettingsSkeletonCard } from "./SettingsPanelSkeleton.js";
import { loadWithTimeout, rejectOnAbort } from "../utils/load-timeout.js";
import { LOAD_TIMEOUT_MESSAGE, SLOW_NOTICE_MS } from "../utils/loading-timing.js";
import { formatEventDateTime, getBrowserTimeZone } from "../utils/event-dates.js";

/** The cards of the panel's placeholder: the mailbox settings, and the last automatic check. */
export const BOUNCE_SKELETON_CARDS: ReadonlyArray<SettingsSkeletonCard> = [
  { id: "bounce", title: "Bounce detection", intro: 2, fields: 6, columns: 2, controlHeight: 44, rows: 2, rowHeight: 78 },
  { id: "last-run", title: "Last automatic check", rows: 1, rowHeight: 280 },
];

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

/** One-line field hint under Check every (keep short so the row stays single-line). */
const CHECK_EVERY_HINT = "How often bounce-ingest checks this event's mailbox.";

/** Longer deploy detail on the (i) next to the label. */
const CHECK_EVERY_INFO =
  "Deploy wakes on a short tick and skips events that are not yet due.";

const LAST_RUN_HINT =
  "Updated by automatic bounce-ingest checks or Run check now. Test connection does not update this card.";

function lastRunCountsLine(run: EventBounceIngestLastRunDto): string {
  const parts = [
    `${run.messagesSeen} seen`,
    `${run.bouncesApplied} bounced`,
    `${run.errors} errors`,
  ];
  if (run.connectFailed) parts.push("connect failed");
  return parts.join(" · ");
}

function LastRunSummary({ run }: Readonly<{ run: EventBounceIngestLastRunDto }>) {
  return (
    <output
      className={`org-mail-summary${
        run.ok ? " org-mail-summary--configured" : " org-mail-summary--failed"
      }`}
    >
      <span className="org-mail-summary__icon">
        <i
          className={`ti ${run.ok ? "ti-circle-check" : "ti-alert-circle"}`}
          aria-hidden="true"
        />
      </span>
      <div className="org-mail-summary__body">
        <strong>
          {run.ok ? "OK" : "Failed"}
          {" · "}
          {formatEventDateTime(run.at, getBrowserTimeZone())}
        </strong>
        <span>{lastRunCountsLine(run)}</span>
      </div>
    </output>
  );
}

function RecentChecksList({
  runs,
  excludeAt,
}: Readonly<{
  runs: EventBounceIngestLastRunDto[];
  /** Hide the same run already shown in the Last automatic check summary. */
  excludeAt?: string | null;
}>) {
  const history = excludeAt ? runs.filter((run) => run.at !== excludeAt) : runs;
  if (history.length === 0) return null;
  return (
    <div className="event-bounce-ingest__recent-runs">
      <h3 className="event-bounce-ingest__recent-runs-title">Recent checks</h3>
      <div className="event-bounce-ingest__recent-runs-scroll at-scroll">
        <ul className="event-bounce-ingest__recent-runs-list">
          {history.slice(0, 10).map((run) => (
            <li key={run.at}>
              <span
                className={`event-bounce-ingest__recent-run-icon${
                  run.ok
                    ? " event-bounce-ingest__recent-run-icon--ok"
                    : " event-bounce-ingest__recent-run-icon--failed"
                }`}
                aria-hidden="true"
              >
                <i className={`ti ${run.ok ? "ti-circle-check" : "ti-alert-circle"}`} />
              </span>
              <span
                className={`event-bounce-ingest__recent-run-status${
                  run.ok
                    ? " event-bounce-ingest__recent-run-status--ok"
                    : " event-bounce-ingest__recent-run-status--failed"
                }`}
              >
                {run.ok ? "OK" : "Failed"}
              </span>
              <span className="event-bounce-ingest__recent-run-meta">
                {formatEventDateTime(run.at, getBrowserTimeZone())} · {lastRunCountsLine(run)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function LastAutomaticCheckBody({
  lastRun,
  enabled,
  recentRuns,
}: Readonly<{
  lastRun: EventBounceIngestLastRunDto | null | undefined;
  enabled: boolean;
  recentRuns: EventBounceIngestLastRunDto[] | null | undefined;
}>) {
  if (!lastRun && !enabled) {
    return (
      <EmptyState
        icon={<i className="ti ti-player-pause" aria-hidden="true" />}
        title="Off"
        description="Turn bounce detection on and save. Automatic checks will appear here after bounce-ingest runs."
      />
    );
  }
  if (!lastRun) {
    return (
      <EmptyState
        icon={<i className="ti ti-clock" aria-hidden="true" />}
        title="Waiting for first automatic check"
        description="Status appears after bounce-ingest runs for this event, or when you use Run check now. Test connection does not update this card."
      />
    );
  }
  return (
    <>
      <LastRunSummary run={lastRun} />
      <RecentChecksList runs={recentRuns ?? []} excludeAt={lastRun.at} />
    </>
  );
}

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
    folders: (data.folders ?? []).join(", "),
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

function bounceRunBlockedReason(
  isArchived: boolean,
  dirty: boolean,
  configured: boolean,
  enabled: boolean,
): string | undefined {
  const testBlocked = bounceTestBlockedReason(isArchived, dirty, configured);
  if (testBlocked) return testBlocked;
  if (!enabled) return "Turn bounce detection on and save first.";
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadRetry = useRetry();
  const { token: loadToken, begin: beginLoad, end: endLoad } = loadRetry;
  const [apiData, setApiData] = useState<EventBounceIngestSettingsResponse | null>(null);
  // The first read, with nothing on screen yet, is what a placeholder covers: after 200ms ("Taking longer than usual" after 8
  // seconds), and a refresh keeps the form.
  const firstRead = loading && !loadError && apiData === null;
  const loadGate = useLoadingGate(firstRead);
  const loadSlow = useDelayedLoading(firstRead, SLOW_NOTICE_MS);
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
  const [runningCheck, setRunningCheck] = useState(false);
  const {
    testing,
    result: testResult,
    run: runConnectionTest,
    clearResult: clearTestResult,
  } = useConnectionTest("Could not test the IMAP connection.");

  const load = useCallback(
    async (signal?: AbortSignal, keepError = false) => {
      setLoading(true);
      // A Retry keeps its error, and the busy Retry button next to it, on screen until the answer is in.
      if (!keepError) setLoadError(null);
      const limit = loadWithTimeout(signal);
      try {
        const data = await rejectOnAbort(fetchEventBounceIngestSettings(eventId, limit.signal), limit.signal);
        if (signal?.aborted) return;
        setLoadError(null);
        setApiData(data);
        const d = draftFromApi(data);
        setDraft(d);
        setBaseline(d);
        setPasswordField(secretFieldFromApi(data));
        setSecrets(emptySecretEdits());
        clearTestResult();
      } catch (err) {
        if (signal?.aborted) return;
        setLoadError(limit.timedOut() ? LOAD_TIMEOUT_MESSAGE : operatorApiErrorMessage(err, "Could not load bounce detection settings."));
      } finally {
        limit.done();
        if (!signal?.aborted) {
          setLoading(false);
          endLoad();
        }
      }
    },
    [clearTestResult, eventId, endLoad],
  );

  useEffect(() => {
    const ac = new AbortController();
    void load(ac.signal, beginLoad());
    return () => ac.abort();
  }, [load, beginLoad, loadToken]);

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
    clearTestResult();
  }, [baseline, clearTestResult]);

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
      clearTestResult();
      addToast("Bounce detection settings saved.", "success");
      onSaved?.();
      return true;
    } catch (err) {
      addToast(operatorApiErrorMessage(err, "Failed to save bounce detection settings."), "error");
      return false;
    } finally {
      setSaving(false);
    }
  }, [
    addToast,
    apiData?.smtp_reuse_available,
    clearTestResult,
    draft,
    eventId,
    onSaved,
    secrets.smtpPassword,
  ]);

  useImperativeHandle(ref, () => ({
    save: handleSave,
    reset: handleReset,
    refresh: () => {
      void load();
    },
  }));

  const handleTest = async () => {
    await runConnectionTest(() => testEventBounceIngestConnection(eventId));
  };

  const handleRunCheck = async () => {
    setRunningCheck(true);
    try {
      const result = await runEventBounceIngestCheck(eventId);
      setApiData((prev) =>
        prev
          ? {
              ...prev,
              lastRun: result.lastRun,
              recentRuns: result.recentRuns ?? prev.recentRuns,
            }
          : prev,
      );
      addToast(result.message, result.ok ? "success" : "error");
    } catch (err) {
      addToast(operatorApiErrorMessage(err, "Could not run bounce check."), "error");
    } finally {
      setRunningCheck(false);
    }
  };

  // Only the first read (nothing on screen yet) is a placeholder: a refresh after the mail transport was saved keeps the
  // form where it is. While a Retry runs the error stays (with its busy button) instead of giving way to the placeholder.
  if (!loadGate.showContent) {
    return (
      <SettingsPanelSkeleton
        label="Loading bounce detection"
        held={!loadGate.showIndicator}
        slow={loadSlow}
        cards={BOUNCE_SKELETON_CARDS}
        footer={false}
      />
    );
  }

  if (loadError) {
    return (
      <PanelLoadError
        cardTitle={<HintLabel hint={BOUNCE_CARD_HINT}>Bounce detection</HintLabel>}
        title="Could not load bounce detection"
        message={loadError}
        retrying={loadRetry.busy}
        onRetry={() => {
          loadRetry.retry();
          return Promise.resolve();
        }}
      />
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
  const runBlockedReason = bounceRunBlockedReason(
    isArchived,
    dirty,
    apiData?.configured ?? false,
    apiData?.enabled ?? false,
  );
  const runBlocked = Boolean(runBlockedReason);
  const testReasonId = "event-bounce-ingest-test-reason";

  return (
    <div className="event-bounce-ingest">
      <Card
        title={<HintLabel hint={BOUNCE_CARD_HINT}>Bounce detection</HintLabel>}
        actions={
          <Switch
            id="event-bounce-detection-enabled"
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
                    id="bounce-ingest-password"
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
                <div className="at-field">
                  <label className="at-label" htmlFor="event-bounce-ingest-poll-interval">
                    <HintLabel hint={CHECK_EVERY_INFO}>Check every</HintLabel>
                  </label>
                  <SearchableSelect
                    id="event-bounce-ingest-poll-interval"
                    label="Check every"
                    placeholder="Select interval…"
                    searchPlaceholder="Search intervals…"
                    emptyLabel="No intervals found"
                    showLabel={false}
                    value={String(draft.pollIntervalMinutes)}
                    disabled={isArchived}
                    options={POLL_OPTIONS.map((opt) => ({ id: String(opt.value), label: opt.label }))}
                    onChange={(id) =>
                      setDraft((d) => ({
                        ...d,
                        pollIntervalMinutes: Number.parseInt(id, 10) || 5,
                      }))
                    }
                  />
                  <span className="at-hint">{CHECK_EVERY_HINT}</span>
                </div>
                <div className="event-bounce-ingest__test-control">
                  <Tooltip content={testBlockedReason}>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={testBlocked}
                      loading={testing}
                      loadingLabel="Testing…"
                      aria-describedby={testBlockedReason ? testReasonId : undefined}
                      onClick={() => void handleTest()}
                      icon={<i className="ti ti-plug" aria-hidden="true" />}
                    >
                      Test connection
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
        title={<HintLabel hint={LAST_RUN_HINT}>Last automatic check</HintLabel>}
        actions={
          runBlocked ? (
            <Tooltip content={runBlockedReason}>
              <span>
                <Button type="button" variant="secondary" size="sm" disabled>
                  Run check now
                </Button>
              </span>
            </Tooltip>
          ) : (
            <Tooltip content="Poll the bounce mailbox once and update this card">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                icon={<i className="ti ti-refresh" aria-hidden="true" />}
                onClick={() => void handleRunCheck()}
                loading={runningCheck}
              >
                Run check now
              </Button>
            </Tooltip>
          )
        }
      >
        <LastAutomaticCheckBody
          lastRun={apiData?.lastRun}
          enabled={apiData?.enabled ?? false}
          recentRuns={apiData?.recentRuns}
        />
      </Card>
    </div>
  );
});
