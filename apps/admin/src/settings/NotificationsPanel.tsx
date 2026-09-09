import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  Button,
  Card,
  EmptyState,
  HintLabel,
  IconButton,
  Input,
  ModalBackdrop,
  Switch,
  Tooltip,
  useToast,
} from "@admitto/ui";
import {
  fetchNotificationSettings,
  saveNotificationSettings,
  testNotificationSettings,
} from "../api/client.js";
import type {
  NotificationChannelKind,
  NotificationSettingsResponse,
  NotificationSettingsTestChannelResult,
  NotificationSettingsTestResponse,
  NotificationWebhookKind,
  SaveNotificationSettingsBody,
} from "../api/types.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import { useDelayedLoading } from "../hooks/useDelayedLoading.js";
import { SearchableSelect } from "../components/SearchableSelect.js";
import { useModalFocusTrap } from "../components/useModalFocusTrap.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { ActorOrViewerLocalTimeLine } from "../components/ActorOrViewerLocalTimeLine.js";
import { PaginationFooter } from "../components/PaginationFooter.js";
import { formatUtcDateTime } from "../utils/event-dates.js";
import {
  mailPreviewModifierClass,
  NO_AUTOFILL_PROPS,
  SecretFieldRow,
  SettingsFooter,
} from "./mailTransportFormParts.js";
import "../requirements/requirements.css";
import "./notifications-panel.css";

const WEBHOOK_CARD_HINT = "Security alerts for admin staff - not attendee-facing email.";
const WEBHOOK_CARD_INTRO =
  "Configure the shared team webhook that receives every enabled security alert. One webhook URL per organisation, shared by every admin, not personal and not per event.";
const WEBHOOK_URL_HINT =
  "Team-wide destination for every notification type enabled for the webhook channel below.";
const WEBHOOK_KIND_HINT = "Shapes the payload: Discord embed, Slack text block, or a plain JSON body.";
const EMAIL_CARD_INTRO =
  "Extra people who get security alerts by email, on top of what each admin already receives. They get every notification type enabled for the email channel below, independent of any individual admin's own opt-out.";
const EMAIL_RECIPIENT_HINT = "Also emailed on every enabled email alert below.";
const TYPES_CARD_INTRO =
  "Choose which channels each alert type is allowed to use. Turning a type off for a channel only stops active delivery on that channel - the underlying security event is always recorded in the audit log either way. This is an organisation-wide setting, separate from each admin's own personal notification preferences.";

const WEBHOOK_KIND_OPTIONS = [
  { id: "discord", label: "Discord", icon: "brand-discord" },
  { id: "slack", label: "Slack", icon: "brand-slack" },
  { id: "generic", label: "Generic JSON", icon: "webhook" },
];

const WEBHOOK_KIND_DESCRIPTIONS: Record<NotificationWebhookKind, string> = {
  discord: "Sends a Discord embed with the alert title, body, and a severity-colored accent.",
  slack: "Sends a Slack-formatted text message.",
  generic: "Sends a plain JSON payload for any other webhook receiver.",
};

const CHANNEL_COLUMNS: ReadonlyArray<{ key: NotificationChannelKind; label: string }> = [
  { key: "webhook", label: "Webhook" },
  { key: "email", label: "Email" },
  { key: "in_app", label: "In-app" },
];

/** Matches the colored-circle severity badge the actual notification email now renders (see
 * packages/notifications/src/channels/emailContent.ts) - same three severities, same meaning,
 * just a live Tabler icon here instead of a baked PNG (no Outlook rendering constraints in a
 * browser admin UI). Uses the shared .status-circle-- variants already in packages/ui - no new
 * CSS needed. */
const SEVERITY_ICON: Record<string, string> = {
  info: "ti-info-circle",
  warn: "ti-alert-triangle",
  error: "ti-alert-circle",
};

const TYPE_DESCRIPTIONS: Record<string, string> = {
  "auth.login.repeated_failures":
    "Multiple failed sign-in attempts on an admin account - a possible brute-force or credential-stuffing attempt.",
  "auth.mfa.break_glass": "An admin signed in using the emergency two-factor bypass instead of a normal second factor.",
  "auth.settings.changed": "Organisation-wide login or security settings changed, such as MFA policy or SSO.",
  "auth.login.new_country": "An admin account signed in from a country not seen before on that account.",
};

const RECIPIENT_DESCRIPTION_MAX = 200;

/** Smaller than the shared Logs & Audit/Sessions defaults (25/50/100/200) - this list is capped
 * at 50 recipients server-side (putBodySchema's extraEmailRecipients .max(50)), so those larger
 * options would rarely, if ever, produce more than one page. */
const RECIPIENTS_PAGE_SIZE_OPTIONS = [10, 25, 50] as const;
const DEFAULT_RECIPIENTS_PAGE_SIZE = 10;

type WebhookEditMode = "idle" | "replace" | "clear";
type WebhookEdit = { mode: WebhookEditMode; value: string };
type DraftRecipient = { email: string; description: string };

type NotificationsDraft = {
  webhookEdit: WebhookEdit;
  webhookKind: NotificationWebhookKind;
  extraEmailRecipients: DraftRecipient[];
  disabledChannels: Record<string, NotificationChannelKind[]>;
};

const IDLE_WEBHOOK_EDIT: WebhookEdit = { mode: "idle", value: "" };

function draftFrom(data: NotificationSettingsResponse): NotificationsDraft {
  return {
    webhookEdit: IDLE_WEBHOOK_EDIT,
    webhookKind: data.webhook.kind,
    extraEmailRecipients: data.extra_email_recipients.map((r) => ({ email: r.email, description: r.description })),
    disabledChannels: Object.fromEntries(
      Object.entries(data.disabled_channels).map(([typeId, channels]) => [typeId, [...channels]]),
    ),
  };
}

function sameStringList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function sameRecipients(a: DraftRecipient[], b: DraftRecipient[]): boolean {
  return a.length === b.length && a.every((r, i) => r.email === b[i]?.email && r.description === b[i]?.description);
}

function sameDisabledChannels(
  a: Record<string, NotificationChannelKind[]>,
  b: Record<string, NotificationChannelKind[]>,
): boolean {
  const typeIds = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const typeId of typeIds) {
    const aSorted = [...(a[typeId] ?? [])].sort((x, y) => x.localeCompare(y));
    const bSorted = [...(b[typeId] ?? [])].sort((x, y) => x.localeCompare(y));
    if (!sameStringList(aSorted, bSorted)) return false;
  }
  return true;
}

function isDirty(draft: NotificationsDraft, saved: NotificationsDraft): boolean {
  return (
    draft.webhookEdit.mode !== "idle" ||
    draft.webhookKind !== saved.webhookKind ||
    !sameRecipients(draft.extraEmailRecipients, saved.extraEmailRecipients) ||
    !sameDisabledChannels(draft.disabledChannels, saved.disabledChannels)
  );
}

function buildSaveBody(draft: NotificationsDraft, saved: NotificationsDraft): SaveNotificationSettingsBody {
  const body: SaveNotificationSettingsBody = {};
  if (draft.webhookEdit.mode === "clear") body.webhookUrl = "";
  else if (draft.webhookEdit.mode === "replace") body.webhookUrl = draft.webhookEdit.value.trim();
  if (draft.webhookKind !== saved.webhookKind) body.webhookKind = draft.webhookKind;
  if (!sameRecipients(draft.extraEmailRecipients, saved.extraEmailRecipients)) {
    body.extraEmailRecipients = draft.extraEmailRecipients.map((r) => ({
      email: r.email,
      description: r.description,
    }));
  }
  if (!sameDisabledChannels(draft.disabledChannels, saved.disabledChannels)) {
    body.disabledChannels = draft.disabledChannels;
  }
  return body;
}

// Each domain label explicitly excludes "." from its own character class, so no quantified group
// overlaps with the literal that follows it - the split points are the string's actual dot
// positions, not a search space the engine has to backtrack through (Sonar S8786).
const EMAIL_RE = /^[^\s@]+@([^\s@.]+\.)+[^\s@.]+$/;

type TestTone = "ok" | "warn" | "error";

function resolveTestTone(results: NotificationSettingsTestChannelResult[]): TestTone {
  const okCount = results.filter((r) => r.ok).length;
  if (okCount === results.length) return "ok";
  if (okCount === 0) return "error";
  return "warn";
}

const TEST_TONE_ICON: Record<TestTone, string> = {
  ok: "ti-circle-check",
  warn: "ti-alert-triangle",
  error: "ti-circle-x",
};

/**
 * The exact same bordered report as the Mail transport "Send test email" card and Communication's
 * own test-send preview - head icon/title/subtitle, nothing else (both reuse the global
 * .mail-preview* classes for this reason: a test-send confirmation should look identical
 * everywhere in the app). No separate per-channel badge row - the icon/border color and title
 * already say whether it worked, so a redundant "Sent" pill under a green box repeats what the
 * reader can already see (PO report).
 */
function NotificationTestResultPreview({
  tone,
  title,
  subtitle,
}: Readonly<{ tone: TestTone; title: string; subtitle?: string }>) {
  return (
    <output className={`mail-preview mail-preview--${tone} notifications-test-preview`}>
      <div className="mail-preview__head">
        <div className="mail-preview__head-main">
          <i
            className={`ti ${TEST_TONE_ICON[tone]} ${mailPreviewModifierClass("mail-preview__head-icon", tone)}`}
            aria-hidden="true"
          />
          <div className="mail-preview__head-text">
            <b>{title}</b>
            {subtitle && <span>{subtitle}</span>}
          </div>
        </div>
      </div>
    </output>
  );
}

/**
 * Webhook card's test covers 2 channels (webhook + in-app) that can genuinely disagree, unlike
 * the Email card's single-address test - plain-English subtitle instead of the jargon label
 * "in-app" (already flagged once as unclear on its own), and instead of a second badge row.
 */
function webhookTestCopy(
  webhook: NotificationSettingsTestChannelResult,
  inApp: NotificationSettingsTestChannelResult,
): { tone: TestTone; title: string; subtitle: string } {
  const tone = resolveTestTone([webhook, inApp]);
  if (tone === "ok") {
    return {
      tone,
      title: "Test notification sent",
      subtitle: "The webhook received it, and it was also saved as a notification on your account.",
    };
  }
  if (!webhook.ok && !inApp.ok) {
    return { tone, title: "Test notification failed", subtitle: webhook.error ?? "Could not deliver it." };
  }
  if (!webhook.ok) {
    return {
      tone,
      title: "Webhook test failed",
      subtitle: `${webhook.error ?? "Could not reach the webhook."} It was still saved as a notification on your account.`,
    };
  }
  return {
    tone,
    title: "Saving it as a notification failed",
    subtitle: `${inApp.error ?? "Could not save it."} The webhook still received it.`,
  };
}

const EDIT_RECIPIENT_FORM_ID = "edit-recipient-form";

/** Edit an existing recipient's email/description - the same `.event-item-modal` shell as the
 * Requirements → Event items and Custom field dialogs (EventItemDrawer.tsx,
 * EventCustomFieldModal.tsx), not the unrelated add-attendee-modal shell - mixing the two left
 * fields with no gap from the header/footer (add-attendee-modal__scroll carries no gap of its
 * own; event-item-modal__scroll does) and a wider-than-standard gap between the two fields
 * themselves (PO report). Fields are direct .at-field children of a <form>, matching
 * EventCustomFieldModal exactly, so Enter in either field submits like a normal form instead of
 * needing a per-input onKeyDown handler. */
function EditRecipientModal({
  emailValue,
  descriptionValue,
  emailError,
  onEmailChange,
  onDescriptionChange,
  onCancel,
  onSave,
}: Readonly<{
  emailValue: string;
  descriptionValue: string;
  emailError: string | null;
  onEmailChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
}>) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(panelRef, true, onCancel);

  return (
    <dialog open className="event-item-modal" aria-modal="true" aria-labelledby={titleId}>
      <ModalBackdrop onClose={onCancel} />
      <div ref={panelRef} className="event-item-modal__panel">
        <div className="event-item-modal__scroll at-scroll">
          <div className="event-item-modal__header">
            <div>
              <h2 className="event-item-modal__title" id={titleId}>
                <i className="ti ti-mail" aria-hidden="true" />
                Edit recipient
              </h2>
              <p className="event-item-modal__subtitle">Update this recipient's email address or description.</p>
            </div>
            <IconButton label="Close" onClick={onCancel} icon={<i className="ti ti-x" aria-hidden="true" />} />
          </div>
          <form
            id={EDIT_RECIPIENT_FORM_ID}
            className="event-item-modal__body"
            onSubmit={(e) => {
              e.preventDefault();
              onSave();
            }}
          >
            <Input
              type="text"
              inputMode="email"
              label="Email address"
              value={emailValue}
              error={emailError ?? undefined}
              {...NO_AUTOFILL_PROPS}
              onChange={(e) => onEmailChange(e.target.value)}
            />
            <Input
              label="Description"
              placeholder="e.g. Finance team"
              maxLength={RECIPIENT_DESCRIPTION_MAX}
              value={descriptionValue}
              onChange={(e) => onDescriptionChange(e.target.value)}
            />
          </form>
          <div className="event-item-modal__footer">
            <div className="event-item-modal__footer-end">
              <Button type="button" variant="ghost" onClick={onCancel}>
                Cancel
              </Button>
              <Button type="submit" form={EDIT_RECIPIENT_FORM_ID} variant="primary">
                Save
              </Button>
            </div>
          </div>
        </div>
      </div>
    </dialog>
  );
}

/**
 * Organisation Settings → Notifications (notifications-module-foundation plan, PR2).
 * Three cards styled after EventWalletPanel: Webhook (SecretFieldRow + payload format + its own
 * test action), Email (extra recipients as a table, styled after Requirements → Event items -
 * each row can be tested, edited, or removed), and a type×channel matrix (which types deliver on
 * which channels). Every test action calls the same POST, which always exercises every channel -
 * each card just surfaces the channel(s) it owns from the one shared result, so the underlying
 * result state stays a single source of truth.
 */
export function NotificationsPanel() {
  const { addToast } = useToast();
  const [data, setData] = useState<NotificationSettingsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const showLoading = useDelayedLoading(loading);
  const [saving, setSaving] = useState(false);
  // "webhook" for the Webhook card's own button, or a recipient's email address for that row's
  // button - null when idle. Was a bare boolean; that made the webhook button's own "Sending…"
  // label flip on regardless of which button was actually clicked, since sending a single
  // recipient's test also set it true (PO report).
  const [testingTarget, setTestingTarget] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<NotificationSettingsTestResponse | null>(null);
  const [lastEmailTestAddress, setLastEmailTestAddress] = useState<string | null>(null);
  const [emailInput, setEmailInput] = useState("");
  const [emailInputError, setEmailInputError] = useState<string | null>(null);
  const [descriptionInput, setDescriptionInput] = useState("");
  const [editingRecipient, setEditingRecipient] = useState<string | null>(null);
  const [editEmailValue, setEditEmailValue] = useState("");
  const [editDescriptionValue, setEditDescriptionValue] = useState("");
  const [editEmailError, setEditEmailError] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);
  const [recipientsPage, setRecipientsPage] = useState(1);
  const [recipientsPageSize, setRecipientsPageSize] = useState<number>(DEFAULT_RECIPIENTS_PAGE_SIZE);

  const [draft, setDraft] = useState<NotificationsDraft | null>(null);
  const savedRef = useRef<NotificationsDraft | null>(null);
  const validationErrorsRef = useRef<HTMLUListElement | null>(null);
  // Test buttons deliberately stay independently clickable while another target's test is in
  // flight (see isTestDisabledFor) - but testResult/lastEmailTestAddress are still single, shared
  // state. Without this guard, an OLDER call that resolves after a NEWER one has already started
  // would overwrite the newer call's still-pending placeholder with its own stale result, which a
  // reader could easily misattribute to the button they most recently clicked (e.g. a webhook
  // test's own skipped:true email/in-app fields rendering as if the webhook itself had just
  // succeeded, reviewer report). A stale response is simply discarded instead.
  const testRequestSeqRef = useRef(0);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetchNotificationSettings(signal);
      if (signal?.aborted) return;
      setData(res);
      const d = draftFrom(res);
      setDraft(d);
      savedRef.current = d;
      setTestResult(null);
    } catch (err) {
      if (signal?.aborted) return;
      setLoadError(operatorApiErrorMessage(err, "Could not load notification settings."));
      setData(null);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    void load(ac.signal);
    return () => ac.abort();
  }, [load]);

  if (showLoading && !data) {
    return (
      <Card title="Notifications">
        <p className="settings-card-intro">Loading…</p>
      </Card>
    );
  }

  if (loadError && !data) {
    return (
      <EmptyState
        title="Could not load notification settings"
        description={loadError}
        action={
          <Button variant="secondary" onClick={() => void load()}>
            Retry
          </Button>
        }
      />
    );
  }

  if (!data || !draft) return null;

  const saved = savedRef.current!;
  const hasUnsavedChanges = isDirty(draft, saved);
  // Per-button, not "any test anywhere disables every test button" - the Webhook card's own
  // button and each recipient row's button are unrelated actions and must stay independently
  // clickable while a different one is in flight (PO report). Unsaved changes still disable all
  // of them, since every test exercises the already-saved settings, not the draft on screen.
  const isTestDisabledFor = (target: string) => testingTarget === target || hasUnsavedChanges;
  // Narrowed local for nested handlers below - TypeScript doesn't keep `draft`'s null-check
  // narrowing inside a nested function body (only within the enclosing scope it was checked in).
  const currentRecipients = draft.extraEmailRecipients;
  const recipientsTotalPages = Math.max(1, Math.ceil(currentRecipients.length / recipientsPageSize));
  // Clamp rather than reset on removal/edit - same reasoning as ActiveSessionsTab's own
  // effectivePage: the list can shrink out from under an already-open later page.
  const recipientsEffectivePage = Math.min(recipientsPage, recipientsTotalPages);
  const recipientsPageSlice = currentRecipients.slice(
    (recipientsEffectivePage - 1) * recipientsPageSize,
    recipientsEffectivePage * recipientsPageSize,
  );
  const webhookTestResult =
    testResult && lastEmailTestAddress === null ? webhookTestCopy(testResult.webhook, testResult.in_app) : null;

  function handleReset() {
    setDraft({ ...savedRef.current! });
    setEmailInput("");
    setDescriptionInput("");
    setEmailInputError(null);
    setTestResult(null);
  }

  function handleAddEmail() {
    const value = emailInput.trim().toLowerCase();
    if (!value) return;
    if (!EMAIL_RE.test(value)) {
      setEmailInputError("Enter a valid email address.");
      return;
    }
    // Same message/early-return shape as saveEditRecipient's own duplicate check below - adding
    // an already-listed address used to silently no-op (input cleared as if it worked, nothing
    // actually added - PO report), instead of telling the admin why nothing changed.
    if (currentRecipients.some((r) => r.email === value)) {
      setEmailInputError("This address is already in the list.");
      return;
    }
    // A stale test result naming a now-changed recipient list is worse than none - e.g. "sent to
    // test@test.pl" left showing after that address was replaced by a different one (PO report).
    setTestResult(null);
    setDraft((d) =>
      d
        ? {
            ...d,
            extraEmailRecipients: [
              ...d.extraEmailRecipients,
              { email: value, description: descriptionInput.trim() },
            ],
          }
        : d,
    );
    setEmailInput("");
    setDescriptionInput("");
    setEmailInputError(null);
  }

  function handleRemoveEmail(email: string) {
    setTestResult(null);
    setDraft((d) =>
      d ? { ...d, extraEmailRecipients: d.extraEmailRecipients.filter((r) => r.email !== email) } : d,
    );
  }

  function startEditRecipient(recipient: DraftRecipient) {
    setEditingRecipient(recipient.email);
    setEditEmailValue(recipient.email);
    setEditDescriptionValue(recipient.description);
    setEditEmailError(null);
  }

  function closeEditRecipient() {
    setEditingRecipient(null);
  }

  function saveEditRecipient() {
    if (!editingRecipient) return;
    const email = editEmailValue.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      setEditEmailError("Enter a valid email address.");
      return;
    }
    if (email !== editingRecipient && currentRecipients.some((r) => r.email === email)) {
      setEditEmailError("This address is already in the list.");
      return;
    }
    const description = editDescriptionValue.trim();
    setTestResult(null);
    setDraft((d) =>
      d
        ? {
            ...d,
            extraEmailRecipients: d.extraEmailRecipients.map((r) =>
              r.email === editingRecipient ? { email, description } : r,
            ),
          }
        : d,
    );
    setEditingRecipient(null);
  }

  function toggleTypeChannel(typeId: string, channel: NotificationChannelKind, enabled: boolean) {
    setDraft((d) => {
      if (!d) return d;
      const current = d.disabledChannels[typeId] ?? [];
      const next = enabled ? current.filter((c) => c !== channel) : [...current, channel];
      const disabledChannels = { ...d.disabledChannels };
      if (next.length > 0) disabledChannels[typeId] = next;
      else delete disabledChannels[typeId];
      return { ...d, disabledChannels };
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      const body = buildSaveBody(draft!, saved);
      const result = await saveNotificationSettings(body);
      setData(result);
      const d = draftFrom(result);
      setDraft(d);
      savedRef.current = d;
      addToast("Notification settings saved.", "success");
    } catch (err) {
      addToast(operatorApiErrorMessage(err, "Failed to save notification settings."), "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleTest(testEmail?: string) {
    const seq = ++testRequestSeqRef.current;
    setTestingTarget(testEmail ?? "webhook");
    setTestResult(null);
    setLastEmailTestAddress(testEmail ?? null);
    try {
      const result = await testNotificationSettings(testEmail);
      // A newer test started (and reset the shared state above) while this one was in flight -
      // applying this stale response now would misattribute it to whatever the newer click owns.
      if (testRequestSeqRef.current !== seq) return;
      setTestResult(result);
      // Only the channel(s) this button actually owns - the shared endpoint always exercises
      // every channel, but a recipient row's email-only test shouldn't report success/failure
      // based on webhook/in-app, which it never asked about.
      const ownedResults = testEmail ? [result.email] : [result.webhook, result.in_app];
      const tone = resolveTestTone(ownedResults);
      addToast(
        tone === "error" ? "Test failed - check the details below." : "Test sent - check the details below.",
        tone === "error" ? "error" : "success",
      );
    } catch (err) {
      if (testRequestSeqRef.current !== seq) return;
      addToast(operatorApiErrorMessage(err, "Could not send a test notification."), "error");
    } finally {
      if (testRequestSeqRef.current === seq) setTestingTarget(null);
    }
  }

  return (
    <>
      <Card title={<HintLabel hint={WEBHOOK_CARD_HINT}>Webhook</HintLabel>} className="event-settings-card">
        <div className="settings-card-stack">
          <p className="settings-card-intro">{WEBHOOK_CARD_INTRO}</p>
          <div className="notifications-webhook-row">
            <SecretFieldRow
              id="notifications-webhook-url"
              label="Webhook URL"
              hint={WEBHOOK_URL_HINT}
              field={{ set: data.webhook.set, masked: data.webhook.set ? "••••" : null, source: "db", locked: false }}
              edit={draft.webhookEdit}
              onReplace={() => setDraft((d) => (d ? { ...d, webhookEdit: { mode: "replace", value: "" } } : d))}
              onClear={() => setDraft((d) => (d ? { ...d, webhookEdit: { mode: "clear", value: "" } } : d))}
              onValueChange={(value) =>
                setDraft((d) => (d ? { ...d, webhookEdit: { mode: "replace", value } } : d))
              }
              onCancel={() => setDraft((d) => (d ? { ...d, webhookEdit: IDLE_WEBHOOK_EDIT } : d))}
            />
            <div className="at-field">
              <span className="at-label">
                <HintLabel hint={WEBHOOK_KIND_HINT}>Payload format</HintLabel>
              </span>
              <SearchableSelect
                id="notifications-webhook-kind"
                label="Payload format"
                placeholder="Select format…"
                searchPlaceholder="Search formats…"
                emptyLabel="No formats found"
                showLabel={false}
                value={draft.webhookKind}
                options={WEBHOOK_KIND_OPTIONS}
                hint={WEBHOOK_KIND_DESCRIPTIONS[draft.webhookKind]}
                onChange={(id) => setDraft((d) => (d ? { ...d, webhookKind: id as NotificationWebhookKind } : d))}
              />
            </div>
            <Button
              type="button"
              variant="secondary"
              disabled={isTestDisabledFor("webhook")}
              onClick={() => void handleTest()}
              icon={<i className="ti ti-send" aria-hidden="true" />}
              aria-label="Send test (webhook)"
            >
              {testingTarget === "webhook" ? "Sending…" : "Send test"}
            </Button>
          </div>
          {webhookTestResult && (
            <NotificationTestResultPreview
              tone={webhookTestResult.tone}
              title={webhookTestResult.title}
              subtitle={webhookTestResult.subtitle}
            />
          )}
        </div>
      </Card>

      <Card title="Email" className="event-settings-card">
        <div className="settings-card-stack">
          <p className="settings-card-intro">{EMAIL_CARD_INTRO}</p>
          <div className="notifications-input-row">
            <Input
              // type="email" is what actually triggers Safari's iCloud "Hide My Email" suggestion
              // chip (and similar password-manager prompts) regardless of the NO_AUTOFILL_PROPS
              // opt-outs below - same workaround already used by AddAttendeeModal.tsx,
              // AttendeeDetailPage.tsx, and EventOverviewPage.tsx for the same reason.
              type="text"
              inputMode="email"
              id="notifications-extra-recipient-input"
              label="Email address"
              hint={EMAIL_RECIPIENT_HINT}
              value={emailInput}
              placeholder="ops@example.com"
              invalid={Boolean(emailInputError)}
              error={emailInputError ?? undefined}
              {...NO_AUTOFILL_PROPS}
              onChange={(e) => {
                setEmailInput(e.target.value);
                setEmailInputError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddEmail();
                }
              }}
            />
            <Input
              id="notifications-extra-recipient-description"
              label="Description"
              placeholder="e.g. Finance team"
              maxLength={RECIPIENT_DESCRIPTION_MAX}
              value={descriptionInput}
              onChange={(e) => setDescriptionInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddEmail();
                }
              }}
            />
            <Button
              type="button"
              variant="secondary"
              icon={<i className="ti ti-plus" aria-hidden="true" />}
              onClick={handleAddEmail}
            >
              Add
            </Button>
          </div>
          {draft.extraEmailRecipients.length > 0 && (
            <>
              <div className="notifications-recipients-table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Email</th>
                      <th scope="col">Description</th>
                      <th scope="col">Added</th>
                      <th scope="col">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {recipientsPageSlice.map((recipient) => {
                      const meta = data.extra_email_recipients.find((r) => r.email === recipient.email);
                      const addedByLabel = meta?.added_by_display_name ?? meta?.added_by_email;
                      return (
                        <tr key={recipient.email}>
                          <td>
                            <div className="requirements-item-cell">
                              <i className="ti ti-mail" aria-hidden="true" />
                              <div className="requirements-item-info">
                                <div className="requirements-item-name">{recipient.email}</div>
                              </div>
                            </div>
                          </td>
                          <td>
                            {recipient.description || (
                              <span className="notifications-recipients-table__muted">No description</span>
                            )}
                          </td>
                          <td>
                            {meta?.added_at ? (
                              <>
                                <span className="notifications-recipients-table__muted">
                                  {formatUtcDateTime(meta.added_at)}
                                  {addedByLabel ? ` by ${addedByLabel}` : ""}
                                </span>
                                <ActorOrViewerLocalTimeLine
                                  iso={meta.added_at}
                                  actorTimezone={meta.added_by_timezone}
                                />
                              </>
                            ) : (
                              <span className="notifications-recipients-table__muted">Not saved yet</span>
                            )}
                          </td>
                          <td>
                            <div className="requirements-item-actions__wrap">
                              <Tooltip content="Send test">
                                <IconButton
                                  label={`Send test to ${recipient.email}`}
                                  size="sm"
                                  icon={<i className="ti ti-send" aria-hidden="true" />}
                                  disabled={isTestDisabledFor(recipient.email)}
                                  onClick={() => void handleTest(recipient.email)}
                                />
                              </Tooltip>
                              <Tooltip content="Edit">
                                <IconButton
                                  label={`Edit ${recipient.email}`}
                                  size="sm"
                                  icon={<i className="ti ti-pencil" aria-hidden="true" />}
                                  onClick={() => startEditRecipient(recipient)}
                                />
                              </Tooltip>
                              <Tooltip content="Remove">
                                <IconButton
                                  label={`Remove ${recipient.email}`}
                                  size="sm"
                                  icon={<i className="ti ti-trash" aria-hidden="true" />}
                                  onClick={() => setRemoveTarget(recipient.email)}
                                />
                              </Tooltip>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <PaginationFooter
                idPrefix="notifications-recipients"
                page={recipientsEffectivePage}
                pageSize={recipientsPageSize}
                totalPages={recipientsTotalPages}
                totalRows={currentRecipients.length}
                pageSizeOptions={RECIPIENTS_PAGE_SIZE_OPTIONS}
                onPageSizeChange={(size) => {
                  setRecipientsPageSize(size);
                  setRecipientsPage(1);
                }}
                onPrevious={() => setRecipientsPage(Math.max(1, recipientsEffectivePage - 1))}
                onNext={() => setRecipientsPage(Math.min(recipientsTotalPages, recipientsEffectivePage + 1))}
              />
            </>
          )}
          {testResult && lastEmailTestAddress !== null && (
            <NotificationTestResultPreview
              tone={testResult.email.ok ? "ok" : "error"}
              title={testResult.email.ok ? "Test email sent" : (testResult.email.error ?? "Test email failed")}
              subtitle={`to ${lastEmailTestAddress}`}
            />
          )}
        </div>
        {editingRecipient !== null && (
          <EditRecipientModal
            emailValue={editEmailValue}
            descriptionValue={editDescriptionValue}
            emailError={editEmailError}
            onEmailChange={(value) => {
              setEditEmailValue(value);
              setEditEmailError(null);
            }}
            onDescriptionChange={setEditDescriptionValue}
            onCancel={closeEditRecipient}
            onSave={saveEditRecipient}
          />
        )}
        <ConfirmDialog
          open={removeTarget !== null}
          title="Remove recipient"
          message={removeTarget ? `Remove ${removeTarget} from extra email recipients?` : ""}
          confirmLabel="Remove"
          onConfirm={() => {
            if (removeTarget) handleRemoveEmail(removeTarget);
            setRemoveTarget(null);
          }}
          onCancel={() => setRemoveTarget(null)}
        />
      </Card>

      <Card title="Notification types" className="event-settings-card">
        <div className="settings-card-stack">
          <p className="settings-card-intro">{TYPES_CARD_INTRO}</p>
          <div className="notifications-type-matrix-wrap">
            <table className="table notifications-type-matrix">
              <thead>
                <tr>
                  <th scope="col">Type</th>
                  {CHANNEL_COLUMNS.map((col) => (
                    <th scope="col" key={col.key}>
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.notification_types.map((type) => (
                  <tr key={type.id}>
                    <td>
                      <div className="notifications-type-matrix__label-row">
                        <span
                          className={`status-circle status-circle--sm status-circle--${type.default_severity}`}
                          aria-hidden="true"
                        >
                          <i className={`ti ${SEVERITY_ICON[type.default_severity] ?? "ti-info-circle"}`} aria-hidden="true" />
                        </span>
                        <strong>{type.label}</strong>
                      </div>
                      <p>{TYPE_DESCRIPTIONS[type.id] ?? "Alerts admin staff when this event occurs."}</p>
                    </td>
                    {CHANNEL_COLUMNS.map((col) =>
                      type.available_channels.includes(col.key) ? (
                        <td key={col.key}>
                          <Switch
                            id={`notifications-type-${type.id}-${col.key}`}
                            aria-label={`${type.label} - ${col.label}`}
                            checked={!draft.disabledChannels[type.id]?.includes(col.key)}
                            onChange={(e) => toggleTypeChannel(type.id, col.key, e.target.checked)}
                          />
                        </td>
                      ) : (
                        <td key={col.key} className="notifications-type-matrix__na">
                          <span aria-hidden="true">-</span>
                          <span className="sr-only">Not applicable</span>
                        </td>
                      ),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Card>

      <SettingsFooter
        validationErrorsRef={validationErrorsRef}
        hasUnsavedChanges={hasUnsavedChanges}
        saving={saving}
        onReset={handleReset}
        onSave={() => void handleSave()}
      />
    </>
  );
}
