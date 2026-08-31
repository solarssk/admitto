import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type RefObject,
  type SetStateAction,
} from "react";
import {
  useBlocker,
  useNavigate,
  useOutletContext,
  useParams,
  useSearchParams,
  type NavigateFunction,
} from "react-router";
import { Button, EmptyState, PageHeader, useToast, type ToastVariant } from "@admitto/ui";
import {
  ApiError,
  archiveEvent,
  deleteEvent,
  exportEventPii,
  fetchEventLocation,
  fetchEventSettings,
  fetchWalletPushHistory,
  patchEvent,
  revokeAllCheckIns,
  revokeAllItemsIssued,
  testWalletConnection,
  unarchiveEvent,
  type WalletPushHistoryEntry,
} from "../api/client.js";
import { WALLET_RELEVANT_EVENT_FIELDS } from "@admitto/shared";
import { hasApiErrorCode, operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { EventLocationDto, EventSettingsDto, EventType, LogoCropMeta } from "../api/types.js";
import { TicketTypesCard } from "../settings/TicketTypesCard.js";
import { EventMailSettingsCard, type EventMailSettingsCardHandle } from "../settings/EventMailSettingsCard.js";
import {
  EventBounceIngestPanel,
  type EventBounceIngestPanelHandle,
} from "../settings/EventBounceIngestPanel.js";
import { CheckInBehaviourPanel } from "../settings/CheckInBehaviourPanel.js";
import { EventDangerZonePanel } from "../settings/EventDangerZonePanel.js";
import { EventGeneralInfoPanel } from "../settings/EventGeneralInfoPanel.js";
import { EventImagesPanel } from "../settings/EventImagesPanel.js";
import { EventWalletPanel, WALLET_PUSH_HISTORY_PAGE_SIZE_DEFAULT } from "../settings/EventWalletPanel.js";
import { LocationSettingsPanel } from "../settings/LocationSettingsPanel.js";
import { buildWalletFieldMappingPatch, type WalletFieldMappingRow } from "../settings/walletFieldMapping.js";
import { SettingsFooter } from "../settings/mailTransportFormParts.js";
import type { SecretEditMode } from "../settings/mailSettingsValidation.js";
import { useAuth } from "../auth/AuthProvider.js";
import { isSuperadmin } from "../auth/capabilities.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { ScrollFadeTabs } from "../components/ScrollFadeTabs.js";
import { useDelayedLoading } from "../hooks/useDelayedLoading.js";
import {
  EVENT_SETTINGS_TABS,
  inPageTabFromSearch,
  isEventSettingsTab,
  SUPERADMIN_ONLY_TABS,
  type EventSettingsTab,
} from "../settings/eventSettingsTabs.js";
import { pluralSuffix } from "../utils/pluralize.js";
import { describeWalletPushConfirm } from "../utils/walletPushConfirm.js";
import "./event-settings-page.css";

export type SettingsForm = {
  title: string;
  date: string;
  eventHoursStart: string;
  eventHoursEnd: string;
  eventType: EventType | "";
  walletEnabled: boolean;
  walletTemplateId: string;
  walletApiKeyEdit: { mode: SecretEditMode; value: string };
  walletAppleEnabled: boolean;
  walletGoogleEnabled: boolean;
  walletSamsungEnabled: boolean;
  walletFieldMapping: WalletFieldMappingRow[];
  timezone: string;
  capacity: string;
  logoUrl: string;
  logoOriginalUrl: string;
  logoCrop: LogoCropMeta | null;
};

/** Shared by every tab panel that edits `form` and renders its own SettingsFooter (General,
 * Images, Wallet) - factored out so this one shape only needs to change in one place instead of
 * being retyped identically in each panel. */
export type EventSettingsFormPanelProps = {
  form: SettingsForm;
  setForm: Dispatch<SetStateAction<SettingsForm | null>>;
  isArchived: boolean;
  saving: boolean;
  dirty: boolean;
  validationErrorsRef: RefObject<HTMLUListElement | null>;
  onReset: () => void;
  onSave: () => void;
};

type SettingsPatch = Partial<{
  title: string;
  date: string;
  event_hours_start: string | null;
  event_hours_end: string | null;
  event_type: EventType | null;
  wallet_enabled: boolean;
  wallet_template_id: string | null;
  wallet_api_key: string | null;
  wallet_apple_enabled: boolean;
  wallet_google_enabled: boolean;
  wallet_samsung_enabled: boolean;
  wallet_field_mapping: Record<string, string> | null;
  timezone: string;
  capacity: number | null;
  logo_url: string | null;
  logo_original_url: string | null;
  logo_crop: LogoCropMeta | null;
}>;

const EVENT_SETTINGS_SUBTITLE = "Manage event details, images, and access.";

// Extra "don't act on reflex" pause before the confirm button on the bulk revoke dialogs
// unlocks — these affect every attendee on the event at once, so they get a brief arming
// delay (visualised as a depleting bar under the button) on top of the confirmation dialog
// itself. Archive/Unarchive stay a plain Yes/No (already reversible); Delete already has its
// own stronger typed-confirmation gate.
const BULK_REVOKE_CONFIRM_DELAY_SECONDS = 10;

// Danger Zone actions reload this page's data on success (to refresh their own live counts),
// which silently discards any unsaved edits elsewhere on the page (e.g. a title/date change on
// the General tab not yet saved) - warn inline in the confirm dialog rather than let it vanish
// with no trace (bot review).
const UNSAVED_CHANGES_WARNING = " You also have unsaved changes elsewhere on this page. They'll be lost when this finishes.";

function toForm(data: EventSettingsDto): SettingsForm {
  return {
    title: data.title,
    date: data.date.split("T")[0] ?? "",
    eventHoursStart: data.event_hours_start ?? "",
    eventHoursEnd: data.event_hours_end ?? "",
    eventType: data.event_type ?? "",
    walletEnabled: data.wallet_enabled,
    walletTemplateId: data.wallet_template_id ?? "",
    walletApiKeyEdit: { mode: "idle", value: "" },
    walletAppleEnabled: data.wallet_apple_enabled,
    walletGoogleEnabled: data.wallet_google_enabled,
    walletSamsungEnabled: data.wallet_samsung_enabled,
    walletFieldMapping: Object.entries(data.wallet_field_mapping ?? {}).map(([key, value]) => ({
      id: crypto.randomUUID(),
      key,
      value,
    })),
    timezone: data.timezone,
    capacity: data.capacity?.toString() ?? "",
    logoUrl: data.logo_url ?? "",
    logoOriginalUrl: data.logo_original_url ?? "",
    logoCrop: data.logo_crop ?? null,
  };
}

/** Parse capacity input; null = unlimited. Throws on invalid non-empty input. */
function parseCapacityInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(n) || n < 1) {
    throw new Error("invalid_capacity");
  }
  return n;
}

/** Wallet-only slice of buildSettingsPatch, extracted to keep the main function's cognitive
 * complexity under the SonarCloud threshold (S3776). */
function buildWalletPatch(
  form: SettingsForm,
  original: SettingsForm,
): Pick<
  SettingsPatch,
  | "wallet_enabled"
  | "wallet_template_id"
  | "wallet_api_key"
  | "wallet_apple_enabled"
  | "wallet_google_enabled"
  | "wallet_samsung_enabled"
  | "wallet_field_mapping"
> {
  const patch: SettingsPatch = {};
  if (form.walletEnabled !== original.walletEnabled) {
    patch.wallet_enabled = form.walletEnabled;
  }
  if (form.walletTemplateId !== original.walletTemplateId) {
    patch.wallet_template_id = form.walletTemplateId.trim() || null;
  }
  if (form.walletApiKeyEdit.mode === "clear") {
    patch.wallet_api_key = null;
  } else if (form.walletApiKeyEdit.mode === "replace" && form.walletApiKeyEdit.value.trim()) {
    patch.wallet_api_key = form.walletApiKeyEdit.value.trim();
  }
  if (form.walletAppleEnabled !== original.walletAppleEnabled) {
    patch.wallet_apple_enabled = form.walletAppleEnabled;
  }
  if (form.walletGoogleEnabled !== original.walletGoogleEnabled) {
    patch.wallet_google_enabled = form.walletGoogleEnabled;
  }
  if (form.walletSamsungEnabled !== original.walletSamsungEnabled) {
    patch.wallet_samsung_enabled = form.walletSamsungEnabled;
  }
  if (JSON.stringify(form.walletFieldMapping) !== JSON.stringify(original.walletFieldMapping)) {
    patch.wallet_field_mapping = buildWalletFieldMappingPatch(form.walletFieldMapping);
  }
  return patch;
}

/** Logo-only slice of buildSettingsPatch, extracted for the same reason as buildWalletPatch. */
function buildLogoPatch(
  form: SettingsForm,
  original: SettingsForm,
): Pick<SettingsPatch, "logo_url" | "logo_original_url" | "logo_crop"> {
  const patch: SettingsPatch = {};
  if (form.logoUrl !== original.logoUrl) patch.logo_url = form.logoUrl.trim() || null;
  if (form.logoOriginalUrl !== original.logoOriginalUrl) {
    patch.logo_original_url = form.logoOriginalUrl.trim() || null;
  }
  if (JSON.stringify(form.logoCrop) !== JSON.stringify(original.logoCrop)) {
    patch.logo_crop = form.logoCrop;
  }
  // When display logo changes, always send original+crop together so the server stays consistent.
  if (patch.logo_url !== undefined) {
    patch.logo_original_url = form.logoOriginalUrl.trim() || null;
    patch.logo_crop = form.logoCrop;
  }
  return patch;
}

function buildSettingsPatch(form: SettingsForm, original: SettingsForm): SettingsPatch {
  const patch: SettingsPatch = { ...buildWalletPatch(form, original), ...buildLogoPatch(form, original) };
  const title = form.title.trim();
  if (title !== original.title.trim()) patch.title = title;
  if (form.date !== original.date) patch.date = form.date;
  if (form.eventHoursStart !== original.eventHoursStart) {
    patch.event_hours_start = form.eventHoursStart.trim() || null;
  }
  if (form.eventHoursEnd !== original.eventHoursEnd) {
    patch.event_hours_end = form.eventHoursEnd.trim() || null;
  }
  if (form.eventType !== original.eventType) {
    patch.event_type = form.eventType || null;
  }
  if (form.timezone !== original.timezone) patch.timezone = form.timezone;
  if (form.capacity.trim() !== original.capacity.trim()) {
    patch.capacity = parseCapacityInput(form.capacity);
  }
  return patch;
}

type AddToast = (message: string, variant?: ToastVariant, duration?: number) => void;

function eventOverviewPath(eventId: string | undefined): string {
  return eventId ? `/admin/events/${eventId}/overview` : "/admin";
}

function addVisitedTab(
  visited: ReadonlySet<EventSettingsTab>,
  tab: EventSettingsTab,
): ReadonlySet<EventSettingsTab> {
  return visited.has(tab) ? visited : new Set(visited).add(tab);
}

function appendUnsavedWarning(message: string, pageDirty: boolean): string {
  return pageDirty ? message + UNSAVED_CHANGES_WARNING : message;
}

/** True when `patch` touches a field that would trigger an automatic wallet-pass-refresh push to
 * every already-issued active pass (event-settings-routes.ts's pushWalletUpdatesBestEffort) - the
 * same WALLET_RELEVANT_EVENT_FIELDS list the server itself checks, shared so this can't drift out
 * of sync with what actually triggers the push. */
function patchTouchesWalletRelevantField(patch: SettingsPatch): boolean {
  return Object.keys(patch).some((key) =>
    (WALLET_RELEVANT_EVENT_FIELDS as readonly string[]).includes(key),
  );
}

/** True when the wallet feature will still be fully configured (master switch on, template ID
 * set, an API key present) once `form` is saved - the exact condition
 * event-settings-routes.ts's pushWalletUpdatesBestEffort itself gates the actual push on
 * (`!updated.wallet_enabled || !updated.wallet_template_id || !updated.wallet_api_key_enc`).
 * Confirming a push that this save's own wallet-tab edits (disabling Wallet, clearing the
 * template/key) would suppress server-side would be a false warning (CodeRabbit review) - checked
 * against `form`, not the currently-loaded `event`, since a save can change these fields in the
 * same request as the wallet-relevant field that triggered the confirm. */
function willWalletBeConfiguredForPush(form: SettingsForm, event: EventSettingsDto): boolean {
  if (!form.walletEnabled || !form.walletTemplateId.trim()) return false;
  if (form.walletApiKeyEdit.mode === "clear") return false;
  if (form.walletApiKeyEdit.mode === "replace") return form.walletApiKeyEdit.value.trim().length > 0;
  return event.wallet_api_key.configured;
}


interface ArchiveDialogCopy {
  title: string;
  message: string;
  confirmLabel: string;
  confirmVariant: "primary" | "danger";
}

function getArchiveDialogCopy(archiveMode: "archive" | "unarchive"): ArchiveDialogCopy {
  if (archiveMode === "archive") {
    return {
      title: "Archive this event?",
      message:
        "This event will become fully read-only, including check-in. Attendee data is kept. Only a superadmin can undo this.",
      confirmLabel: "Archive",
      confirmVariant: "danger",
    };
  }
  return {
    title: "Unarchive this event?",
    message: "This event will become active again and editable in admin.",
    confirmLabel: "Unarchive",
    confirmVariant: "primary",
  };
}

interface LoadEventSettingsDeps {
  eventId: string;
  setLoading: (value: boolean) => void;
  setNotFound: (value: boolean) => void;
  setEvent: (event: EventSettingsDto) => void;
  setForm: (form: SettingsForm) => void;
  setOriginal: (form: SettingsForm) => void;
  addToast: AddToast;
}

/** Extracted out of the `load` callback (SonarCloud S3776). */
async function loadEventSettings(deps: LoadEventSettingsDeps): Promise<void> {
  const { eventId, setLoading, setNotFound, setEvent, setForm, setOriginal, addToast } = deps;
  setLoading(true);
  setNotFound(false);
  try {
    const data = await fetchEventSettings(eventId);
    setEvent(data);
    const f = toForm(data);
    setForm(f);
    setOriginal(f);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
      setNotFound(true);
    } else {
      addToast(operatorApiErrorMessage(err, "Could not load event settings"), "error");
    }
  } finally {
    setLoading(false);
  }
}

/** Re-syncs `event` (is_deletable/deletion_blockers for the Danger Zone) after a ticket-type
 * create/update/delete, without touching `form`/`original` - those hold another tab's possibly
 * unsaved draft, and `loadEventSettings`'s full reload would silently discard it. Best-effort:
 * a failed background refresh here is a lesser problem than a toast unrelated to what the
 * operator just did in the Ticket types card.
 *
 * `deletionStatusSeqRef` guards against two different kinds of stale response: (1) this request
 * resolving after the operator has already navigated to a different event's settings (the page
 * component isn't remounted on an `:eventId` param change alone - bumped separately in an effect
 * keyed on `eventId`), and (2) two overlapping refreshes for the *same* event - e.g. two quick
 * ticket-type edits - resolving out of order, where the earlier request's response would
 * otherwise land after and overwrite the later, more current one (CodeRabbit review). Each call
 * claims the next sequence number and only applies its result while it's still the latest. */
async function refreshEventDeletionStatus(
  eventId: string,
  deletionStatusSeqRef: RefObject<number>,
  setEvent: (event: EventSettingsDto) => void,
): Promise<void> {
  const mySeq = deletionStatusSeqRef.current + 1;
  deletionStatusSeqRef.current = mySeq;
  try {
    const data = await fetchEventSettings(eventId);
    if (deletionStatusSeqRef.current !== mySeq) return;
    setEvent(data);
  } catch {
    // Best-effort - see comment above.
  }
}


interface SaveEventSettingsDeps {
  eventId: string;
  form: SettingsForm;
  original: SettingsForm;
  setSaving: (value: boolean) => void;
  setEvent: (event: EventSettingsDto) => void;
  setForm: (form: SettingsForm) => void;
  setOriginal: (form: SettingsForm) => void;
  addToast: AddToast;
  refreshLayoutEvent?: () => Promise<void>;
}

/** Extracted out of handleSave (SonarCloud S3776). */
async function saveEventSettings(deps: SaveEventSettingsDeps): Promise<void> {
  const { eventId, form, original, setSaving, setEvent, setForm, setOriginal, addToast, refreshLayoutEvent } =
    deps;
  setSaving(true);
  try {
    const patch = buildSettingsPatch(form, original);
    if (Object.keys(patch).length === 0) return;

    const { event: updated } = await patchEvent(eventId, patch);
    setEvent(updated);
    const f = toForm(updated);
    setForm(f);
    setOriginal(f);
    addToast("Event settings saved", "success");
    await refreshLayoutEvent?.();
  } catch (err) {
    if (err instanceof Error && err.message === "invalid_capacity") {
      addToast("Capacity must be a positive whole number", "error");
    } else if (err instanceof ApiError && hasApiErrorCode(err, "event_archived")) {
      addToast("Cannot edit archived event", "error");
    } else {
      addToast(operatorApiErrorMessage(err, "Failed to save settings"), "error");
    }
  } finally {
    setSaving(false);
  }
}

interface ArchiveToggleDeps {
  eventId: string;
  archiveMode: "archive" | "unarchive";
  setArchiving: (value: boolean) => void;
  setArchiveOpen: (value: boolean) => void;
  setMailCardResetKey: (updater: (n: number) => number) => void;
  setLocationCardResetKey: (updater: (n: number) => number) => void;
  setTicketTypesCardResetKey: (updater: (n: number) => number) => void;
  setCheckinBehaviourCardResetKey: (updater: (n: number) => number) => void;
  addToast: AddToast;
  load: () => Promise<void>;
  refreshLayoutEvent?: () => Promise<void>;
}

/** Extracted out of handleArchiveConfirm (SonarCloud S3776). */
async function confirmArchiveToggle(deps: ArchiveToggleDeps): Promise<void> {
  const {
    eventId,
    archiveMode,
    setArchiving,
    setArchiveOpen,
    setMailCardResetKey,
    setLocationCardResetKey,
    setTicketTypesCardResetKey,
    setCheckinBehaviourCardResetKey,
    addToast,
    load,
    refreshLayoutEvent,
  } = deps;
  setArchiving(true);
  try {
    if (archiveMode === "archive") {
      await archiveEvent(eventId);
      addToast("Event archived.", "success");
    } else {
      await unarchiveEvent(eventId);
      addToast("Event unarchived.", "success");
    }
    setArchiveOpen(false);
    setMailCardResetKey((n) => n + 1);
    setLocationCardResetKey((n) => n + 1);
    setTicketTypesCardResetKey((n) => n + 1);
    setCheckinBehaviourCardResetKey((n) => n + 1);
    await load();
    await refreshLayoutEvent?.();
  } catch (err) {
    addToast(operatorApiErrorMessage(err, "Action failed"), "error");
  } finally {
    setArchiving(false);
  }
}

interface DeleteEventDeps {
  eventId: string;
  setDeleting: (value: boolean) => void;
  setDeleteError: (value: string | null) => void;
  addToast: AddToast;
  navigate: NavigateFunction;
}

/** Extracted out of handleDeleteConfirm (SonarCloud S3776). */
async function confirmDeleteEvent(deps: DeleteEventDeps): Promise<void> {
  const { eventId, setDeleting, setDeleteError, addToast, navigate } = deps;
  setDeleting(true);
  setDeleteError(null);
  try {
    await deleteEvent(eventId);
    addToast("Event permanently deleted", "success");
    navigate("/admin");
  } catch (err) {
    setDeleteError(operatorApiErrorMessage(err, "Delete failed"));
  } finally {
    setDeleting(false);
  }
}

interface ExportPiiDeps {
  eventId: string;
  setExporting: (value: boolean) => void;
  addToast: AddToast;
}

/** Extracted out of handleExportPii (SonarCloud S3776). */
async function downloadEventPiiExport(deps: ExportPiiDeps): Promise<void> {
  const { eventId, setExporting, addToast } = deps;
  setExporting(true);
  try {
    const res = await exportEventPii(eventId);
    const blob = await res.blob();
    const disposition = res.headers.get("Content-Disposition") ?? "";
    const match = /filename="([^"]+)"/.exec(disposition);
    const filename = match?.[1] ?? "pii-export.csv";
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    const truncated = res.headers.get("X-Export-Truncated") === "true";
    const total = res.headers.get("X-Export-Total-Rows");
    addToast(
      truncated
        ? `PII export downloaded (first 10,000 of ${total ?? "many"} attendees)`
        : "PII export downloaded",
      truncated ? "warning" : "success",
    );
  } catch (err) {
    addToast(operatorApiErrorMessage(err, "Export failed"), "error");
  } finally {
    setExporting(false);
  }
}

interface RevokeCheckinsDeps {
  eventId: string;
  setRevokingCheckins: (value: boolean) => void;
  setRevokeCheckinsOpen: (value: boolean) => void;
  setMailCardResetKey: (updater: (n: number) => number) => void;
  setLocationCardResetKey: (updater: (n: number) => number) => void;
  setTicketTypesCardResetKey: (updater: (n: number) => number) => void;
  setCheckinBehaviourCardResetKey: (updater: (n: number) => number) => void;
  addToast: AddToast;
  load: () => Promise<void>;
  refreshLayoutEvent?: () => Promise<void>;
}

/** Extracted out of handleRevokeCheckinsConfirm (SonarCloud S3776). */
async function confirmRevokeCheckins(deps: RevokeCheckinsDeps): Promise<void> {
  const {
    eventId,
    setRevokingCheckins,
    setRevokeCheckinsOpen,
    setMailCardResetKey,
    setLocationCardResetKey,
    setTicketTypesCardResetKey,
    setCheckinBehaviourCardResetKey,
    addToast,
    load,
    refreshLayoutEvent,
  } = deps;
  setRevokingCheckins(true);
  try {
    const { revokedCount } = await revokeAllCheckIns(eventId);
    addToast(
      revokedCount > 0
        ? `Revoked check-in for ${revokedCount} attendee${pluralSuffix(revokedCount)}`
        : "No check-ins to revoke",
      "success",
    );
    setRevokeCheckinsOpen(false);
    setMailCardResetKey((n) => n + 1);
    setLocationCardResetKey((n) => n + 1);
    setTicketTypesCardResetKey((n) => n + 1);
    setCheckinBehaviourCardResetKey((n) => n + 1);
    await load();
    await refreshLayoutEvent?.();
  } catch (err) {
    addToast(operatorApiErrorMessage(err, "Failed to revoke check-ins"), "error");
  } finally {
    setRevokingCheckins(false);
  }
}

interface RevokeItemsDeps {
  eventId: string;
  setRevokingItems: (value: boolean) => void;
  setRevokeItemsOpen: (value: boolean) => void;
  setMailCardResetKey: (updater: (n: number) => number) => void;
  setLocationCardResetKey: (updater: (n: number) => number) => void;
  setTicketTypesCardResetKey: (updater: (n: number) => number) => void;
  setCheckinBehaviourCardResetKey: (updater: (n: number) => number) => void;
  addToast: AddToast;
  load: () => Promise<void>;
  refreshLayoutEvent?: () => Promise<void>;
}

/** Extracted out of handleRevokeItemsConfirm (SonarCloud S3776). */
async function confirmRevokeItems(deps: RevokeItemsDeps): Promise<void> {
  const {
    eventId,
    setRevokingItems,
    setRevokeItemsOpen,
    setMailCardResetKey,
    setLocationCardResetKey,
    setTicketTypesCardResetKey,
    setCheckinBehaviourCardResetKey,
    addToast,
    load,
    refreshLayoutEvent,
  } = deps;
  setRevokingItems(true);
  try {
    const { revokedCount } = await revokeAllItemsIssued(eventId);
    addToast(
      revokedCount > 0
        ? `Reset ${revokedCount} issued item${pluralSuffix(revokedCount)} back to pending`
        : "No items to revoke",
      "success",
    );
    setRevokeItemsOpen(false);
    setMailCardResetKey((n) => n + 1);
    setLocationCardResetKey((n) => n + 1);
    setTicketTypesCardResetKey((n) => n + 1);
    setCheckinBehaviourCardResetKey((n) => n + 1);
    await load();
    await refreshLayoutEvent?.();
  } catch (err) {
    addToast(operatorApiErrorMessage(err, "Failed to revoke items"), "error");
  } finally {
    setRevokingItems(false);
  }
}

interface TestWalletConnectionDeps {
  eventId: string;
  form: Pick<SettingsForm, "walletTemplateId" | "walletApiKeyEdit">;
  setWalletTesting: (value: boolean) => void;
  addToast: AddToast;
}

/** Extracted out of handleTestWallet (SonarCloud S3776). */
async function confirmTestWalletConnection(deps: TestWalletConnectionDeps): Promise<void> {
  const { eventId, form, setWalletTesting, addToast } = deps;
  const templateId = form.walletTemplateId.trim();
  if (!templateId) {
    addToast("Enter a Template ID before testing the connection.", "error");
    return;
  }
  if (form.walletApiKeyEdit.mode === "clear") {
    addToast("The API key will be cleared on save - set a new one to test the connection.", "error");
    return;
  }
  setWalletTesting(true);
  try {
    const result = await testWalletConnection(eventId, {
      templateId,
      ...(form.walletApiKeyEdit.mode === "replace" && form.walletApiKeyEdit.value.trim()
        ? { apiKey: form.walletApiKeyEdit.value.trim() }
        : {}),
    });
    addToast(
      result.ok ? (result.message ?? "Connected.") : (result.error ?? "Could not reach PassCreator."),
      result.ok ? "success" : "error",
    );
  } catch (err) {
    addToast(operatorApiErrorMessage(err, "Could not test the wallet connection."), "error");
  } finally {
    setWalletTesting(false);
  }
}

interface EventSettingsTabPanelProps {
  readonly tab: EventSettingsTab;
  readonly activeTab: EventSettingsTab;
  readonly visited: ReadonlySet<EventSettingsTab>;
  readonly label: string;
  readonly children: ReactNode;
}

/** Mount on first visit; stay mounted so draft state and scroll position survive tab switches. */
function EventSettingsTabPanel({ tab, activeTab, visited, label, children }: EventSettingsTabPanelProps) {
  if (!visited.has(tab)) return null;
  return (
    <div role="tabpanel" aria-label={label} hidden={activeTab !== tab} className="event-settings-tabpanel">
      {children}
    </div>
  );
}

/** Event-scoped settings: General / Images / Wallet / Danger zone tabs. */
export function EventSettingsPage() {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { addToast } = useToast();
  const { assignments } = useAuth();
  const isSa = isSuperadmin(assignments);
  // Optional: this page renders under the same event layout as Attendees/
  // Requirements/Communication/Import/Check-in and, like them, could in
  // principle be reached without that layout (e.g. in isolation in tests) —
  // fall back to a no-op so a missing Outlet context never crashes the page.
  const outletContext = useOutletContext<{ refreshEvent?: () => Promise<void> } | undefined>();
  const refreshLayoutEvent = outletContext?.refreshEvent;

  const [event, setEvent] = useState<EventSettingsDto | null>(null);
  const [form, setForm] = useState<SettingsForm | null>(null);
  const [original, setOriginal] = useState<SettingsForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);
  const [walletPushConfirmOpen, setWalletPushConfirmOpen] = useState(false);
  // Which save this confirm dialog is gating - the regular form save (handleSave), or the
  // Location tab's own "apply suggested timezone" shortcut (onApplyTimezone below), which
  // otherwise patches straight past this confirm entirely (CodeRabbit review).
  const pendingWalletPushActionRef = useRef<(() => Promise<void>) | null>(null);
  // Only set for onApplyTimezone's own pending Promise (handleSave has no outside caller awaiting
  // its result) - settles that Promise on Cancel so LocationSettingsPanel's own
  // handleApplyTimezone doesn't resolve (and show its "Event timezone set…" success toast) before
  // the operator has actually chosen anything (CodeRabbit review).
  const pendingWalletPushCancelRef = useRef<(() => void) | null>(null);
  const [walletTesting, setWalletTesting] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveMode, setArchiveMode] = useState<"archive" | "unarchive">("archive");
  const [logoUploading, setLogoUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [revokingCheckins, setRevokingCheckins] = useState(false);
  const [revokeCheckinsOpen, setRevokeCheckinsOpen] = useState(false);
  const [revokingItems, setRevokingItems] = useState(false);
  const [revokeItemsOpen, setRevokeItemsOpen] = useState(false);
  const [ticketTypesDirty, setTicketTypesDirty] = useState(false);
  const [ticketTypesSaving, setTicketTypesSaving] = useState(false);
  // Same reasoning as mailCardResetKey below, applied to TicketTypesCard's own draft state.
  const [ticketTypesCardResetKey, setTicketTypesCardResetKey] = useState(0);
  const [mailDirty, setMailDirty] = useState(false);
  const [mailSaving, setMailSaving] = useState(false);
  const [bounceDirty, setBounceDirty] = useState(false);
  const [bounceSaving, setBounceSaving] = useState(false);
  const mailCardRef = useRef<EventMailSettingsCardHandle>(null);
  const bouncePanelRef = useRef<EventBounceIngestPanelHandle>(null);
  // Archiving and the bulk Danger Zone actions below reload `event` but never touch
  // EventMailSettingsCard's own internal draft/secrets state, so a pending mail edit would
  // otherwise survive them despite the confirm dialogs promising unsaved changes are lost
  // (CodeRabbit review). Bumping this key remounts the card, discarding its draft and
  // re-fetching current server state.
  const [mailCardResetKey, setMailCardResetKey] = useState(0);
  const [locationDirty, setLocationDirty] = useState(false);
  const [locationSaving, setLocationSaving] = useState(false);
  // Same reasoning as mailCardResetKey above, applied to LocationSettingsPanel's own draft state.
  const [locationCardResetKey, setLocationCardResetKey] = useState(0);
  const [checkinBehaviourDirty, setCheckinBehaviourDirty] = useState(false);
  const [checkinBehaviourSaving, setCheckinBehaviourSaving] = useState(false);
  // Same reasoning as mailCardResetKey above, applied to CheckInBehaviourPanel's own draft state.
  const [checkinBehaviourCardResetKey, setCheckinBehaviourCardResetKey] = useState(0);
  const basicValidationErrorsRef = useRef<HTMLUListElement>(null);

  const initialTab = inPageTabFromSearch(searchParams, isSa);
  const [tab, setTab] = useState<EventSettingsTab>(initialTab);
  const [visitedTabs, setVisitedTabs] = useState<ReadonlySet<EventSettingsTab>>(
    () => new Set([initialTab]),
  );

  // URL is the source of truth for the active tab (deep links, Back navigation).
  useEffect(() => {
    const target = inPageTabFromSearch(searchParams, isSa);
    if (target !== tab) {
      setTab(target);
      setVisitedTabs((prev) => addVisitedTab(prev, target));
    }
  }, [searchParams, tab, isSa]);

  // Read-only preview data for the Wallet tab's field mapping hint icons (computeWalletPlaceholder
  // Preview) - the event's own Location tab data, fetched independently of LocationSettingsPanel
  // (which owns the editable copy) so opening Wallet alone doesn't require visiting Location
  // first. Fetched once, only once the Wallet tab is actually visited - undefined stays "loading"
  // rather than a misleading "not set" for the brief window before this resolves.
  const [walletLocationPreview, setWalletLocationPreview] = useState<EventLocationDto | null | undefined>(
    undefined,
  );
  useEffect(() => {
    if (!eventId || !visitedTabs.has("wallet") || walletLocationPreview !== undefined) return;
    const controller = new AbortController();
    fetchEventLocation(eventId, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setWalletLocationPreview(data);
      })
      .catch(() => {
        /* preview-only: a failed fetch just leaves hint icons showing "Loading…" */
      });
    return () => controller.abort();
  }, [eventId, visitedTabs, walletLocationPreview]);

  // Wallet push history: re-fetched every time the admin switches to the Wallet tab (not just
  // once) - unlike walletLocationPreview above (a static reference value), this list reflects
  // background jobs triggered from elsewhere (currently only the Attendees list's bulk
  // ticket-type change), so it can go stale while this tab stays mounted between visits.
  const [walletPushHistory, setWalletPushHistory] = useState<WalletPushHistoryEntry[] | null>(null);
  const [walletPushHistoryTotal, setWalletPushHistoryTotal] = useState(0);
  const [walletPushHistoryError, setWalletPushHistoryError] = useState<string | null>(null);
  const [walletPushHistoryToken, setWalletPushHistoryToken] = useState(0);
  const [walletPushHistoryLoading, setWalletPushHistoryLoading] = useState(false);
  const [walletPushHistoryPage, setWalletPushHistoryPage] = useState(1);
  const [walletPushHistoryPageSize, setWalletPushHistoryPageSize] = useState(WALLET_PUSH_HISTORY_PAGE_SIZE_DEFAULT);
  const showWalletPushHistoryLoading = useDelayedLoading(walletPushHistoryLoading);
  // Navigating from one event to another while the Wallet tab stays mounted must not keep the
  // outgoing event's rows/total/page - a separate reset effect keyed on eventId alone would still
  // let this effect run once more with the stale page for the new event first (both effects fire
  // on the same eventId-change render pass, before the reset effect's setState is applied) -
  // detecting the event change inline, in this same effect, is what actually avoids that request
  // (CodeRabbit).
  const walletPushHistoryEventIdRef = useRef(eventId);
  useEffect(() => {
    if (!eventId || tab !== "wallet") return;
    const isNewEvent = eventId !== walletPushHistoryEventIdRef.current;
    walletPushHistoryEventIdRef.current = eventId;
    const page = isNewEvent ? 1 : walletPushHistoryPage;
    if (isNewEvent) {
      setWalletPushHistory(null);
      setWalletPushHistoryTotal(0);
      if (walletPushHistoryPage !== 1) setWalletPushHistoryPage(1);
    }
    const controller = new AbortController();
    setWalletPushHistoryError(null);
    setWalletPushHistoryLoading(true);
    fetchWalletPushHistory(eventId, page, walletPushHistoryPageSize, controller.signal)
      .then(({ items, total }) => {
        setWalletPushHistory(items);
        setWalletPushHistoryTotal(total);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setWalletPushHistoryError("Could not load wallet push history.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setWalletPushHistoryLoading(false);
      });
    return () => controller.abort();
  }, [eventId, tab, walletPushHistoryToken, walletPushHistoryPage, walletPushHistoryPageSize]);

  const handleTabChange = useCallback(
    (id: string) => {
      if (!isEventSettingsTab(id)) return;
      if (SUPERADMIN_ONLY_TABS.has(id) && !isSa) return;
      setSearchParams({ tab: id });
    },
    [setSearchParams, isSa],
  );

  // Derived from buildSettingsPatch's own result, not a raw form/original diff - an in-progress
  // secret edit (e.g. clicking "Set" on the wallet API key without typing a value) changes
  // form.walletApiKeyEdit.mode without producing anything buildSettingsPatch would actually send.
  // A raw JSON diff flagged the page dirty in that state forever: Save's own "nothing to send"
  // early return (below) never resets form/original, so the unsaved-changes banner, the
  // beforeunload warning, and the navigation blocker never cleared.
  // buildSettingsPatch can throw mid-typing (e.g. an invalid capacity value) - this runs on every
  // render, not just on Save, so a thrown validation error must not crash the page. Fail safe:
  // treat "couldn't tell" as dirty, same as the raw diff this replaced would have.
  let dirty = false;
  if (form !== null && original !== null) {
    try {
      dirty = Object.keys(buildSettingsPatch(form, original)).length > 0;
    } catch {
      dirty = true;
    }
  }
  // Combines the General form's own dirty state with the Mail and Location tabs' — navigating
  // away or running a page action that reloads state (archive, revoke) would otherwise silently
  // discard unsaved mail transport edits, pending secret replacements, or a pending pin move
  // (CodeRabbit review).
  const mailTabDirty = mailDirty || bounceDirty;
  const mailTabSaving = mailSaving || bounceSaving;
  const pageDirty = dirty || mailTabDirty || locationDirty || ticketTypesDirty || checkinBehaviourDirty;
  // Same combination for "a save request is in flight" - a Danger Zone action firing while the
  // Mail or Location tab's own save is still in flight would race against it on the same event record.
  const pageBusy = saving || mailTabSaving || locationSaving || ticketTypesSaving || checkinBehaviourSaving;
  // A fetch that resolves near-instantly (localhost, a warm cache) would otherwise flash
  // these "Loading…" placeholders on and off faster than they can register as loading —
  // show them only once the fetch has genuinely taken a moment.
  const showLoading = useDelayedLoading(loading);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      (pageDirty || pageBusy) && currentLocation.pathname !== nextLocation.pathname,
  );
  const isArchived = event?.status === "archived";

  const load = useCallback(async () => {
    if (!eventId) return;
    await loadEventSettings({ eventId, setLoading, setNotFound, setEvent, setForm, setOriginal, addToast });
  }, [eventId, addToast]);

  // Sequence guard for refreshEventDeletionStatus - see that function's own comment. Bumped here
  // on every :eventId change (in addition to each refresh call bumping it) so an in-flight
  // request from a previous event can never be mistaken for still-current.
  const deletionStatusSeqRef = useRef(0);
  useEffect(() => {
    deletionStatusSeqRef.current += 1;
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!pageDirty && !pageBusy) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [pageDirty, pageBusy]);

  const goBack = () => navigate(eventOverviewPath(eventId));

  function handleBasicReset() {
    if (original) setForm({ ...original });
  }

  async function commitSave() {
    if (!eventId || !form || !original) return;
    await saveEventSettings({
      eventId,
      form,
      original,
      setSaving,
      setEvent,
      setForm,
      setOriginal,
      addToast,
      refreshLayoutEvent,
    });
  }

  async function handleSave() {
    if (!eventId || !form || !original || !dirty) return;
    // Only worth confirming when the save would actually push to a real, currently-installed
    // wallet pass - an event with none yet (or a save that doesn't touch a wallet-relevant field,
    // or one whose own edits leave Wallet unconfigured) goes straight through, matching the
    // "don't overuse confirmation dialogs" guidance this pattern is otherwise at risk of (NN/g).
    try {
      if (
        event &&
        event.installed_wallet_pass_count > 0 &&
        willWalletBeConfiguredForPush(form, event) &&
        patchTouchesWalletRelevantField(buildSettingsPatch(form, original))
      ) {
        pendingWalletPushActionRef.current = commitSave;
        setWalletPushConfirmOpen(true);
        return;
      }
    } catch {
      // buildSettingsPatch can throw (e.g. invalid capacity) - fall through to commitSave, which
      // rebuilds the same patch inside its own try/catch and shows the right validation toast,
      // rather than this check's own throw becoming an unhandled rejection (CodeRabbit review).
    }
    await commitSave();
  }

  async function handleWalletPushConfirm() {
    setWalletPushConfirmOpen(false);
    const action = pendingWalletPushActionRef.current;
    pendingWalletPushActionRef.current = null;
    pendingWalletPushCancelRef.current = null;
    await action?.();
  }

  function handleWalletPushCancel() {
    setWalletPushConfirmOpen(false);
    const cancel = pendingWalletPushCancelRef.current;
    pendingWalletPushActionRef.current = null;
    pendingWalletPushCancelRef.current = null;
    cancel?.();
  }

  async function handleTestWallet() {
    if (!eventId || !form) return;
    await confirmTestWalletConnection({ eventId, form, setWalletTesting, addToast });
  }

  async function handleArchiveConfirm() {
    if (!eventId) return;
    await confirmArchiveToggle({
      eventId,
      archiveMode,
      setArchiving,
      setArchiveOpen,
      setMailCardResetKey,
      setLocationCardResetKey,
      setTicketTypesCardResetKey,
      setCheckinBehaviourCardResetKey,
      addToast,
      load,
      refreshLayoutEvent,
    });
  }

  async function handleDeleteConfirm() {
    if (!eventId) return;
    await confirmDeleteEvent({ eventId, setDeleting, setDeleteError, addToast, navigate });
  }

  async function handleExportPii() {
    if (!eventId || !isSa) return;
    await downloadEventPiiExport({ eventId, setExporting, addToast });
  }

  async function handleRevokeCheckinsConfirm() {
    if (!eventId) return;
    await confirmRevokeCheckins({
      eventId,
      setRevokingCheckins,
      setRevokeCheckinsOpen,
      setMailCardResetKey,
      setLocationCardResetKey,
      setTicketTypesCardResetKey,
      setCheckinBehaviourCardResetKey,
      addToast,
      load,
      refreshLayoutEvent,
    });
  }

  async function handleRevokeItemsConfirm() {
    if (!eventId) return;
    await confirmRevokeItems({
      eventId,
      setRevokingItems,
      setRevokeItemsOpen,
      setMailCardResetKey,
      setLocationCardResetKey,
      setTicketTypesCardResetKey,
      setCheckinBehaviourCardResetKey,
      addToast,
      load,
      refreshLayoutEvent,
    });
  }

  if (!eventId) return <p>Missing event.</p>;

  if (loading && !event) {
    if (!showLoading) return null;
    return (
      <div className="event-settings-page screen">
        <PageHeader title="Event settings" subtitle={EVENT_SETTINGS_SUBTITLE} />
        <output>Loading event settings…</output>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="event-settings-page">
        <EmptyState
          title="Event not found"
          description="The event could not be found or you do not have access."
          action={
            <Button variant="secondary" onClick={goBack}>
              Back
            </Button>
          }
        />
      </div>
    );
  }

  if (!event || !form) return null;

  // The event's *persisted* wallet configuration, not the (possibly unsaved) Wallet-tab draft in
  // `form` - both the Location tab's own save and the suggested-timezone shortcut below only ever
  // patch fields unrelated to wallet_enabled/template/api_key, so an in-progress but unsaved edit
  // to those fields there has no bearing on whether *this* request's push will actually go out
  // server-side (CodeRabbit review: using `form` here misjudges a request that doesn't include
  // those unsaved changes). Event Settings' own General/Wallet-tab save uses
  // willWalletBeConfiguredForPush(form, event) instead, since that save *does* include them.
  const eventWalletConfiguredForPush =
    event.wallet_enabled && !!event.wallet_template_id && event.wallet_api_key.configured;

  const archiveDialogCopy = getArchiveDialogCopy(archiveMode);

  const archiveToggleButton = isArchived ? (
    <Button
      variant="secondary"
      disabled={archiving}
      icon={<i className="ti ti-archive-off" aria-hidden="true" />}
      onClick={() => {
        setArchiveMode("unarchive");
        setArchiveOpen(true);
      }}
    >
      Unarchive event
    </Button>
  ) : (
    <Button
      variant="danger"
      disabled={archiving}
      icon={<i className="ti ti-archive" aria-hidden="true" />}
      onClick={() => {
        setArchiveMode("archive");
        setArchiveOpen(true);
      }}
    >
      Archive event
    </Button>
  );

  return (
    <div className={`event-settings-page screen${isArchived ? " event-settings--archived" : ""}`}>
      <PageHeader
        title="Event settings"
        subtitle={EVENT_SETTINGS_SUBTITLE}
        className="event-settings-pageheader"
        actions={
          <a
            href="https://github.com/solarssk/admitto/wiki"
            target="_blank"
            rel="noopener noreferrer"
            className="at-btn at-btn--secondary"
          >
            <span className="at-btn__icon" aria-hidden="true">
              <i className="ti ti-book" aria-hidden="true" />
            </span>
            <span>Documentation</span>
          </a>
        }
      />

      <ScrollFadeTabs
        value={tab}
        onChange={handleTabChange}
        tabs={EVENT_SETTINGS_TABS.filter((t) => isSa || !SUPERADMIN_ONLY_TABS.has(t.id))}
      />

      <EventSettingsTabPanel tab="general" activeTab={tab} visited={visitedTabs} label="General">
        <EventGeneralInfoPanel
          event={event}
          form={form}
          setForm={setForm}
          isArchived={isArchived}
          saving={saving}
          logoUploading={logoUploading}
          dirty={dirty}
          validationErrorsRef={basicValidationErrorsRef}
          onReset={handleBasicReset}
          onSave={() => void handleSave()}
        />
      </EventSettingsTabPanel>

      <EventSettingsTabPanel tab="location" activeTab={tab} visited={visitedTabs} label="Location">
        <LocationSettingsPanel
          key={locationCardResetKey}
          eventId={eventId}
          isArchived={isArchived}
          eventTimezone={form.timezone}
          installedWalletPassCount={event.installed_wallet_pass_count}
          walletConfiguredForPush={eventWalletConfiguredForPush}
          onDirtyChange={setLocationDirty}
          onSavingChange={setLocationSaving}
          onLocationSaved={async () => {
            // Invalidate the Wallet tab's read-only location snapshot so a saved venue-access
            // field (room/entrance/opening hours/...) shows up in its field-mapping preview
            // right away, instead of the value from whenever Wallet was first visited.
            setWalletLocationPreview(undefined);
            await refreshLayoutEvent?.();
          }}
          onApplyTimezone={(timezone) => {
            // `form`/`original` are set whenever this panel mounts (gated by `!form` above).
            const applyTimezone = async () => {
              const { event: updated } = await patchEvent(eventId, { timezone });
              setEvent(updated);
              const next = { ...form, timezone: updated.timezone };
              const nextOriginal = { ...original!, timezone: updated.timezone };
              setForm(next);
              setOriginal(nextOriginal);
              await refreshLayoutEvent?.();
            };
            // timezone is unconditionally in WALLET_RELEVANT_EVENT_FIELDS - this shortcut patches
            // straight past handleSave's own confirm gate otherwise, silently pushing to every
            // installed pass the same way a regular General-tab save would (CodeRabbit review).
            if (event.installed_wallet_pass_count > 0 && eventWalletConfiguredForPush) {
              // Caller (LocationSettingsPanel.handleApplyTimezone) awaits this promise before
              // showing its own "Event timezone set…" success toast - it must stay pending until
              // the operator actually confirms or cancels, not resolve the instant the dialog
              // opens (CodeRabbit review). Cancel rejects with a sentinel the caller recognizes
              // and swallows silently, the same way saveEventSettings' own "invalid_capacity"
              // sentinel is matched by message rather than a custom Error subclass.
              return new Promise<void>((resolve, reject) => {
                pendingWalletPushActionRef.current = async () => {
                  try {
                    await applyTimezone();
                    resolve();
                  } catch (err) {
                    reject(err instanceof Error ? err : new Error(String(err)));
                  }
                };
                pendingWalletPushCancelRef.current = () => reject(new Error("wallet_push_cancelled"));
                setWalletPushConfirmOpen(true);
              });
            }
            return applyTimezone();
          }}
        />
      </EventSettingsTabPanel>

      <EventSettingsTabPanel tab="ticket-types" activeTab={tab} visited={visitedTabs} label="Ticket types">
        <TicketTypesCard
          key={ticketTypesCardResetKey}
          eventId={eventId}
          event={event}
          onDirtyChange={setTicketTypesDirty}
          onSavingChange={setTicketTypesSaving}
          onSaved={() => {
            // A create/update/delete here can flip is_deletable/deletion_blockers (e.g.
            // clearing the last non-standard type) - keep the Danger Zone's Delete button
            // accurate without reloading the whole page (see refreshEventDeletionStatus).
            void refreshEventDeletionStatus(eventId, deletionStatusSeqRef, setEvent);
          }}
        />
      </EventSettingsTabPanel>

      <EventSettingsTabPanel tab="images" activeTab={tab} visited={visitedTabs} label="Images">
        <EventImagesPanel
          eventId={eventId}
          form={form}
          setForm={setForm}
          original={original!}
          isArchived={isArchived}
          saving={saving}
          logoUploading={logoUploading}
          onUploadingChange={setLogoUploading}
          dirty={dirty}
          validationErrorsRef={basicValidationErrorsRef}
          onReset={handleBasicReset}
          onSave={() => void handleSave()}
        />
      </EventSettingsTabPanel>

      <EventSettingsTabPanel
        tab="checkin-behaviour"
        activeTab={tab}
        visited={visitedTabs}
        label="Check-in"
      >
        <CheckInBehaviourPanel
          key={checkinBehaviourCardResetKey}
          eventId={eventId}
          isArchived={isArchived}
          onDirtyChange={setCheckinBehaviourDirty}
          onSavingChange={setCheckinBehaviourSaving}
        />
      </EventSettingsTabPanel>

      {isSa && (
        <EventSettingsTabPanel tab="mail" activeTab={tab} visited={visitedTabs} label="Mail">
          <EventMailSettingsCard
            key={mailCardResetKey}
            ref={mailCardRef}
            eventId={eventId}
            isArchived={isArchived}
            embeddedFooter={false}
            onDirtyChange={setMailDirty}
            onSavingChange={setMailSaving}
            onSaved={() => bouncePanelRef.current?.refresh()}
          >
            <EventBounceIngestPanel
              key={`bounce-${mailCardResetKey}`}
              ref={bouncePanelRef}
              eventId={eventId}
              isArchived={isArchived}
              onDirtyChange={setBounceDirty}
              onSavingChange={setBounceSaving}
              onSaved={() => mailCardRef.current?.refreshBounceReady()}
            />
          </EventMailSettingsCard>
          {!isArchived && (
            <SettingsFooter
              hasUnsavedChanges={mailTabDirty}
              saving={mailTabSaving}
              onReset={() => {
                mailCardRef.current?.reset();
                bouncePanelRef.current?.reset();
              }}
              onSave={() => {
                void (async () => {
                  // Persist only what is dirty. Do not call mail save as a no-op fallback:
                  // org-mode save used to open "Revert to organization mail" even when the
                  // event already inherits org transport and the admin only edited bounce.
                  // Abort bounce only when mail validation/API fails (`blocked`). Opening
                  // the revert confirm (`confirm_pending`) still allows bounce to save.
                  if (mailDirty) {
                    const mailResult = await mailCardRef.current?.save();
                    if (mailResult === "blocked") return;
                    if (mailResult === "saved") {
                      bouncePanelRef.current?.refresh();
                    }
                  }
                  if (bounceDirty) await bouncePanelRef.current?.save();
                })();
              }}
            />
          )}
        </EventSettingsTabPanel>
      )}

      {isSa && (
        <EventSettingsTabPanel tab="wallet" activeTab={tab} visited={visitedTabs} label="Wallet">
          <EventWalletPanel
            event={event}
            form={form}
            setForm={setForm}
            isArchived={isArchived}
            saving={saving}
            dirty={dirty}
            validationErrorsRef={basicValidationErrorsRef}
            onReset={handleBasicReset}
            onSave={() => void handleSave()}
            walletTesting={walletTesting}
            onTestWallet={() => void handleTestWallet()}
            walletLocationPreview={walletLocationPreview}
            walletPushHistory={walletPushHistory}
            walletPushHistoryTotal={walletPushHistoryTotal}
            walletPushHistoryError={walletPushHistoryError}
            onRetryWalletPushHistory={() => setWalletPushHistoryToken((n) => n + 1)}
            showWalletPushHistoryLoading={showWalletPushHistoryLoading}
            walletPushHistoryPage={walletPushHistoryPage}
            walletPushHistoryPageSize={walletPushHistoryPageSize}
            onWalletPushHistoryPageChange={setWalletPushHistoryPage}
            onWalletPushHistoryPageSizeChange={setWalletPushHistoryPageSize}
          />
        </EventSettingsTabPanel>
      )}

      {isSa && (
        <EventSettingsTabPanel
          tab="integrations"
          activeTab={tab}
          visited={visitedTabs}
          label="Integrations"
        >
          <EmptyState
            icon={<i className="ti ti-plug-connected" aria-hidden="true" />}
            title="Event API connections are on the roadmap"
            description="Connect external systems to push attendee data into this event automatically."
          />
        </EventSettingsTabPanel>
      )}

      <EventSettingsTabPanel tab="danger-zone" activeTab={tab} visited={visitedTabs} label="Danger zone">
        <EventDangerZonePanel
          event={event}
          isSa={isSa}
          exporting={exporting}
          onExportPii={() => void handleExportPii()}
          revokingCheckins={revokingCheckins}
          onOpenRevokeCheckins={() => setRevokeCheckinsOpen(true)}
          revokingItems={revokingItems}
          onOpenRevokeItems={() => setRevokeItemsOpen(true)}
          archiveToggleButton={archiveToggleButton}
          deleting={deleting}
          onOpenDelete={() => {
            setDeleteError(null);
            setDeleteOpen(true);
          }}
        />
      </EventSettingsTabPanel>

      <ConfirmDialog
        open={walletPushConfirmOpen}
        title="Push this update to installed wallet passes?"
        message={describeWalletPushConfirm(event.installed_wallet_pass_count)}
        confirmLabel="Save and push"
        loading={saving}
        onConfirm={() => void handleWalletPushConfirm()}
        onCancel={handleWalletPushCancel}
      />
      <ConfirmDialog
        open={revokeCheckinsOpen}
        title="Revoke all check-ins?"
        message={appendUnsavedWarning(
          `This will revoke check-in for ${event.admitted_count} attendee${pluralSuffix(event.admitted_count)}. They can check in again afterwards.`,
          pageDirty,
        )}
        confirmLabel="Revoke"
        confirmVariant="danger"
        confirmDelaySeconds={BULK_REVOKE_CONFIRM_DELAY_SECONDS}
        loading={revokingCheckins}
        onConfirm={() => void handleRevokeCheckinsConfirm()}
        onCancel={() => setRevokeCheckinsOpen(false)}
      />
      <ConfirmDialog
        open={revokeItemsOpen}
        title="Revoke all items issued?"
        message={appendUnsavedWarning(
          `This will reset ${event.issued_items_count} issued item${pluralSuffix(event.issued_items_count)} back to pending. They can be handed out again afterwards.`,
          pageDirty,
        )}
        confirmLabel="Revoke"
        confirmVariant="danger"
        confirmDelaySeconds={BULK_REVOKE_CONFIRM_DELAY_SECONDS}
        loading={revokingItems}
        onConfirm={() => void handleRevokeItemsConfirm()}
        onCancel={() => setRevokeItemsOpen(false)}
      />
      <ConfirmDialog
        open={archiveOpen}
        title={archiveDialogCopy.title}
        message={appendUnsavedWarning(archiveDialogCopy.message, pageDirty)}
        confirmLabel={archiveDialogCopy.confirmLabel}
        confirmVariant={archiveDialogCopy.confirmVariant}
        loading={archiving}
        onConfirm={() => void handleArchiveConfirm()}
        onCancel={() => setArchiveOpen(false)}
      />
      <ConfirmDialog
        open={deleteOpen}
        title="Permanently delete this event?"
        message={`This permanently deletes "${event.title}" and all its configuration. This cannot be undone.`}
        errorMessage={deleteError}
        confirmLabel="Delete"
        confirmVariant="danger"
        loading={deleting}
        confirmationValue={event.title}
        confirmationLabel={`Type the event title to confirm: "${event.title}"`}
        onConfirm={() => void handleDeleteConfirm()}
        onCancel={() => {
          setDeleteError(null);
          setDeleteOpen(false);
        }}
      />
      <ConfirmDialog
        open={blocker.state === "blocked"}
        title="Discard unsaved changes?"
        message="You have unsaved event settings. They will be lost if you leave this page."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        onConfirm={() => blocker.proceed?.()}
        onCancel={() => blocker.reset?.()}
      />
    </div>
  );
}
