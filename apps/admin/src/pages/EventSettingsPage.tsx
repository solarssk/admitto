import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  useBlocker,
  useNavigate,
  useOutletContext,
  useParams,
  useSearchParams,
  type NavigateFunction,
} from "react-router";
import { Badge, Button, Card, EmptyState, HintLabel, Input, Notice, PageHeader, useToast, type ToastVariant } from "@admitto/ui";
import {
  ApiError,
  archiveEvent,
  deleteEvent,
  exportEventPii,
  fetchEventSettings,
  fetchTicketTypes,
  patchEvent,
  revokeAllCheckIns,
  revokeAllItemsIssued,
  unarchiveEvent,
  uploadEventBrandingFile,
} from "../api/client.js";
import { hasApiErrorCode, operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { EventSettingsDto, LogoCropMeta, TicketTypeDto } from "../api/types.js";
import { TicketTypesCard } from "../settings/TicketTypesCard.js";
import { EventMailSettingsCard, type EventMailSettingsCardHandle } from "../settings/EventMailSettingsCard.js";
import {
  EventBounceIngestPanel,
  type EventBounceIngestPanelHandle,
} from "../settings/EventBounceIngestPanel.js";
import { LocationSettingsPanel } from "../settings/LocationSettingsPanel.js";
import { SettingsFooter, NO_AUTOFILL_PROPS } from "../settings/mailTransportFormParts.js";
import { useAuth } from "../auth/AuthProvider.js";
import { isSuperadmin } from "../auth/capabilities.js";
import { ArchivedGuard } from "../components/ArchivedGuard.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { EventImageAssetLibrary } from "../components/EventImageAssetLibrary.js";
import { LogoUploadZone } from "../components/LogoUploadZone.js";
import { ScrollFadeTabs } from "../components/ScrollFadeTabs.js";
import { TimezoneSelect } from "../components/TimezoneSelect.js";
import { DatePicker } from "../components/DatePicker.js";
import { useDelayedLoading } from "../hooks/useDelayedLoading.js";
import { formatEventDateTime, formatUtcDateTime } from "../utils/event-dates.js";
import {
  EVENT_SETTINGS_TABS,
  inPageTabFromSearch,
  isEventSettingsTab,
  SUPERADMIN_ONLY_TABS,
  type EventSettingsTab,
} from "../settings/eventSettingsTabs.js";
import "./event-settings-page.css";

/** Created/Archived stamp in the acting admin's timezone when known; UTC fallback for legacy rows. */
function formatActorStamp(iso: string, timezone: string | null | undefined): string {
  return timezone ? formatEventDateTime(iso, timezone) : formatUtcDateTime(iso);
}

type SettingsForm = {
  title: string;
  date: string;
  timezone: string;
  capacity: string;
  logoUrl: string;
  logoOriginalUrl: string;
  logoCrop: LogoCropMeta | null;
};

type SettingsPatch = Partial<{
  title: string;
  date: string;
  timezone: string;
  capacity: number | null;
  logo_url: string | null;
  logo_original_url: string | null;
  logo_crop: LogoCropMeta | null;
}>;

const EVENT_SETTINGS_SUBTITLE = "Manage this event's details, images, and access controls.";

const BASIC_INFORMATION_HINT =
  "Title and date appear on tickets and emails. Set the venue in the Location tab.";
const BASIC_INFORMATION_INTRO =
  "Title, date, capacity, and timezone for this event.";
const STATUS_HINT = "Read-only overview of this event's current state. Archive or delete it from the Danger zone tab.";
const EVENT_LOGO_HINT =
  "Replaces the organisation logo on tickets and emails for this event.";
const DANGER_ZONE_HINT = "Irreversible actions affecting this event's data or availability. Most require superadmin.";

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

/** English plural suffix for a count — used by the Danger Zone's toasts and row descriptions. */
function pluralSuffix(count: number): string {
  return count === 1 ? "" : "s";
}

function toForm(data: EventSettingsDto): SettingsForm {
  return {
    title: data.title,
    date: data.date.split("T")[0] ?? "",
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

function buildSettingsPatch(form: SettingsForm, original: SettingsForm): SettingsPatch {
  const patch: SettingsPatch = {};
  const title = form.title.trim();
  if (title !== original.title.trim()) patch.title = title;
  if (form.date !== original.date) patch.date = form.date;
  if (form.timezone !== original.timezone) patch.timezone = form.timezone;
  if (form.capacity.trim() !== original.capacity.trim()) {
    patch.capacity = parseCapacityInput(form.capacity);
  }
  if (form.logoUrl !== original.logoUrl) patch.logo_url = form.logoUrl.trim() || null;
  if (form.logoOriginalUrl !== original.logoOriginalUrl) {
    patch.logo_original_url = form.logoOriginalUrl.trim() || null;
  }
  const cropChanged = JSON.stringify(form.logoCrop) !== JSON.stringify(original.logoCrop);
  if (cropChanged) patch.logo_crop = form.logoCrop;
  // When display logo changes, always send original+crop together so the server stays consistent.
  if (patch.logo_url !== undefined) {
    patch.logo_original_url = form.logoOriginalUrl.trim() || null;
    patch.logo_crop = form.logoCrop;
  }
  return patch;
}

type AddToast = (message: string, variant?: ToastVariant, duration?: number) => void;

function eventOverviewPath(eventId: string | undefined): string {
  return eventId ? `/admin/events/${eventId}/overview` : "/admin";
}

/** Tooltip shared by the Danger Zone's superadmin-gated actions: superadmin restriction wins
 * over the action-specific reason. Extracted out of EventSettingsPage (SonarCloud S3776). */
function computeSuperadminTooltip(
  isSa: boolean,
  restrictedWhenTrue: boolean,
  restrictedMessage: string,
): string | undefined {
  if (!isSa) return "Superadmin only";
  if (restrictedWhenTrue) return restrictedMessage;
  return undefined;
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

function describeRevokeCheckins(admittedCount: number): string {
  return admittedCount > 0
    ? `Reverses check-in for all ${admittedCount} currently checked-in attendee${pluralSuffix(admittedCount)}. They can check in again afterwards.`
    : "No attendees are currently checked in.";
}

function describeRevokeItems(issuedItemsCount: number): string {
  return issuedItemsCount > 0
    ? `Resets all ${issuedItemsCount} issued item${pluralSuffix(issuedItemsCount)} back to pending, for every attendee. They can be handed out again afterwards.`
    : "No items have been issued yet.";
}

function describeDeleteEvent(isDeletable: boolean): string {
  return isDeletable
    ? "Permanently deletes this event and everything in it. This can't be undone. Saved in the history log."
    : "Only events with no attendees, custom items, custom ticket types, contacts, resources, pinned note, event-specific mail template, or recorded activity can be permanently deleted.";
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
      addToast(operatorApiErrorMessage(err, "Failed to load event settings"), "error");
    }
  } finally {
    setLoading(false);
  }
}

interface LoadTicketTypesDeps {
  eventId: string;
  loadedRef: RefObject<boolean>;
  abortRef: RefObject<AbortController | null>;
  setTicketTypesLoading: (value: boolean) => void;
  setTicketTypes: (types: TicketTypeDto[]) => void;
  setTicketTypesError: (error: string | null) => void;
}

/** Extracted out of the `loadTicketTypes` callback (SonarCloud S3776). */
async function loadTicketTypesForEvent(deps: LoadTicketTypesDeps): Promise<void> {
  const { eventId, loadedRef, abortRef, setTicketTypesLoading, setTicketTypes, setTicketTypesError } = deps;
  abortRef.current?.abort();
  const ac = new AbortController();
  abortRef.current = ac;
  if (!loadedRef.current) setTicketTypesLoading(true);
  try {
    const types = await fetchTicketTypes(eventId, ac.signal);
    if (ac.signal.aborted) return;
    setTicketTypes(types);
    setTicketTypesError(null);
    loadedRef.current = true;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return;
    loadedRef.current = false;
    setTicketTypes([]);
    setTicketTypesError(operatorApiErrorMessage(err, "Failed to load ticket types."));
  } finally {
    if (!ac.signal.aborted) setTicketTypesLoading(false);
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
    addToast,
    load,
    refreshLayoutEvent,
  } = deps;
  setArchiving(true);
  try {
    if (archiveMode === "archive") {
      await archiveEvent(eventId);
      addToast("Event archived", "success");
    } else {
      await unarchiveEvent(eventId);
      addToast("Event unarchived", "success");
    }
    setArchiveOpen(false);
    setMailCardResetKey((n) => n + 1);
    setLocationCardResetKey((n) => n + 1);
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
    await load();
    await refreshLayoutEvent?.();
  } catch (err) {
    addToast(operatorApiErrorMessage(err, "Failed to revoke items"), "error");
  } finally {
    setRevokingItems(false);
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
  const [ticketTypes, setTicketTypes] = useState<TicketTypeDto[]>([]);
  const [ticketTypesLoading, setTicketTypesLoading] = useState(true);
  const [ticketTypesError, setTicketTypesError] = useState<string | null>(null);
  const [mailDirty, setMailDirty] = useState(false);
  const [mailSaving, setMailSaving] = useState(false);
  const [bounceDirty, setBounceDirty] = useState(false);
  const [bounceSaving, setBounceSaving] = useState(false);
  const [mailValidationErrors, setMailValidationErrors] = useState<string[]>([]);
  const mailCardRef = useRef<EventMailSettingsCardHandle>(null);
  const bouncePanelRef = useRef<EventBounceIngestPanelHandle>(null);
  const mailTabValidationErrorsRef = useRef<HTMLUListElement>(null);
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

  const handleTabChange = useCallback(
    (id: string) => {
      if (!isEventSettingsTab(id)) return;
      if (SUPERADMIN_ONLY_TABS.has(id) && !isSa) return;
      setSearchParams({ tab: id });
    },
    [setSearchParams, isSa],
  );

  const dirty =
    form !== null && original !== null && JSON.stringify(form) !== JSON.stringify(original);
  // Combines the General form's own dirty state with the Mail and Location tabs' — navigating
  // away or running a page action that reloads state (archive, revoke) would otherwise silently
  // discard unsaved mail transport edits, pending secret replacements, or a pending pin move
  // (CodeRabbit review).
  const mailTabDirty = mailDirty || bounceDirty;
  const mailTabSaving = mailSaving || bounceSaving;
  const pageDirty = dirty || mailTabDirty || locationDirty;
  // Same combination for "a save request is in flight" - a Danger Zone action firing while the
  // Mail or Location tab's own save is still in flight would race against it on the same event record.
  const pageBusy = saving || mailTabSaving || locationSaving;
  // A fetch that resolves near-instantly (localhost, a warm cache) would otherwise flash
  // these "Loading…" placeholders on and off faster than they can register as loading —
  // show them only once the fetch has genuinely taken a moment.
  const showLoading = useDelayedLoading(loading);
  const showTicketTypesLoading = useDelayedLoading(ticketTypesLoading);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      (pageDirty || pageBusy) && currentLocation.pathname !== nextLocation.pathname,
  );
  const isArchived = event?.status === "archived";

  const load = useCallback(async () => {
    if (!eventId) return;
    await loadEventSettings({ eventId, setLoading, setNotFound, setEvent, setForm, setOriginal, addToast });
  }, [eventId, addToast]);

  useEffect(() => {
    void load();
  }, [load]);

  // Only the very first load shows the card's "Loading…" placeholder - a background refresh
  // after a color/label edit (TicketTypesCard's onChanged) must not swap the whole list out and
  // back in, which read as a full-card flicker (PO review).
  const ticketTypesLoadedRef = useRef(false);
  const ticketTypesAbortRef = useRef<AbortController | null>(null);
  const abortLatestTicketTypes = useCallback(() => ticketTypesAbortRef.current?.abort(), []);

  // A stale in-flight request from a previous eventId (e.g. navigating between two events'
  // settings before the first request lands) must not overwrite this event's state once it
  // resolves - reset and discard it the same way RequirementsPage's own load effect does
  // (CodeRabbit review).
  useEffect(() => {
    ticketTypesAbortRef.current?.abort();
    setTicketTypes([]);
    setTicketTypesError(null);
    ticketTypesLoadedRef.current = false;
  }, [eventId]);

  const loadTicketTypes = useCallback(async () => {
    if (!eventId) return;
    await loadTicketTypesForEvent({
      eventId,
      loadedRef: ticketTypesLoadedRef,
      abortRef: ticketTypesAbortRef,
      setTicketTypesLoading,
      setTicketTypes,
      setTicketTypesError,
    });
  }, [eventId]);

  useEffect(() => {
    loadTicketTypes().catch(() => {});
    return abortLatestTicketTypes;
  }, [abortLatestTicketTypes, loadTicketTypes]);

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

  async function handleSave() {
    if (!eventId || !form || !original || !dirty) return;
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

  async function handleArchiveConfirm() {
    if (!eventId) return;
    await confirmArchiveToggle({
      eventId,
      archiveMode,
      setArchiving,
      setArchiveOpen,
      setMailCardResetKey,
      setLocationCardResetKey,
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

  const revokeCheckinsTooltip = computeSuperadminTooltip(
    isSa,
    event.admitted_count === 0,
    "No check-ins to revoke",
  );
  const revokeItemsTooltip = computeSuperadminTooltip(
    isSa,
    event.issued_items_count === 0,
    "No items to revoke",
  );
  const deleteEventTooltip = computeSuperadminTooltip(
    isSa,
    !event.is_deletable,
    "This event has data and cannot be deleted",
  );
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
        <Card title={<HintLabel hint={STATUS_HINT}>Status</HintLabel>} className="event-settings-card">
          <div className="settings-status-grid">
            <div className="settings-field-group">
              <p>
                Current status:{" "}
                <Badge variant={isArchived ? "neutral" : "info"} dot={false}>
                  {isArchived ? "Archived" : "Active"}
                </Badge>
              </p>
              <p className="field-hint">
                {isArchived && event.archived_at
                  ? `Archived on ${formatActorStamp(event.archived_at, event.archived_by_timezone)}.`
                  : "Active events accept check-ins and allow attendee edits."}
              </p>
            </div>
            <div className="settings-field-group">
              <p>
                Organization: <strong>{event.organization_name}</strong>
              </p>
              <p className="field-hint">Events belong to an organization and use its branding by default.</p>
            </div>
            <div className="settings-field-group">
              <p>
                Created:{" "}
                <strong>
                  {event.created_at
                    ? formatActorStamp(event.created_at, event.created_by_timezone)
                    : "-"}
                </strong>
              </p>
              <p className="field-hint">When this event was first set up.</p>
            </div>
          </div>
        </Card>

        <Card
          title={<HintLabel hint={BASIC_INFORMATION_HINT}>Basic information</HintLabel>}
          className="event-settings-card"
        >
          <div className="settings-field-stack">
            <p className="settings-card-intro">{BASIC_INFORMATION_INTRO}</p>
            <div className="settings-field-group">
              <Input
                label="Event title"
                required
                value={form.title}
                disabled={isArchived || saving}
                hint="Shown everywhere - to attendees, on tickets, and in emails."
                {...NO_AUTOFILL_PROPS}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </div>

            <div className="settings-field-row">
              <div className="settings-field-group">
                <DatePicker
                  label="Date"
                  required
                  value={form.date}
                  disabled={isArchived || saving}
                  onChange={(next) => setForm({ ...form, date: next })}
                />
                <span className="at-hint">When the event takes place. Times and reports use the timezone below.</span>
              </div>

              <div className="settings-field-group">
                <Input
                  label="Capacity"
                  type="number"
                  min={1}
                  value={form.capacity}
                  disabled={isArchived || saving}
                  placeholder="500"
                  hint="Leave blank for unlimited."
                  onChange={(e) => setForm({ ...form, capacity: e.target.value })}
                />
              </div>
            </div>

            <div className="settings-field-group event-settings-timezone">
              <label className="at-label" htmlFor="event-timezone">
                Event timezone
              </label>
              <TimezoneSelect
                id="event-timezone"
                compact
                value={form.timezone}
                onChange={(tz) => setForm({ ...form, timezone: tz })}
                disabled={isArchived || saving}
              />
              <span className="at-hint">All check-in times and reports use this timezone.</span>
            </div>

            <div className="settings-field-group slug-field">
              <Input
                label="Event link ID"
                value={event.slug}
                readOnly
                disabled
                className="mono"
                icon={<i className="ti ti-link" aria-hidden="true" />}
                hint="This can't be changed after the event is created - it's already part of every QR code sent to attendees."
              />
            </div>
          </div>
        </Card>

        {!isArchived && (
          <SettingsFooter
            validationErrors={[]}
            validationErrorsRef={basicValidationErrorsRef}
            hasUnsavedChanges={dirty}
            saving={saving || logoUploading}
            busyLabel={logoUploading && !saving ? "Uploading…" : "Saving…"}
            onReset={handleBasicReset}
            onSave={() => void handleSave()}
          />
        )}
      </EventSettingsTabPanel>

      <EventSettingsTabPanel tab="location" activeTab={tab} visited={visitedTabs} label="Location">
        <LocationSettingsPanel
          key={locationCardResetKey}
          eventId={eventId}
          isArchived={isArchived}
          eventTimezone={form.timezone}
          onDirtyChange={setLocationDirty}
          onSavingChange={setLocationSaving}
          onLocationSaved={async () => {
            await refreshLayoutEvent?.();
          }}
          onApplyTimezone={async (timezone) => {
            // `form`/`original` are set whenever this panel mounts (gated by `!form` above).
            const { event: updated } = await patchEvent(eventId, { timezone });
            setEvent(updated);
            const next = { ...form, timezone: updated.timezone };
            const nextOriginal = { ...original!, timezone: updated.timezone };
            setForm(next);
            setOriginal(nextOriginal);
            await refreshLayoutEvent?.();
          }}
        />
      </EventSettingsTabPanel>

      <EventSettingsTabPanel tab="ticket-types" activeTab={tab} visited={visitedTabs} label="Ticket types">
        <TicketTypesCard
          eventId={eventId}
          event={event}
          types={ticketTypes}
          loading={ticketTypesLoading}
          showLoading={showTicketTypesLoading}
          error={ticketTypesError}
          onRetry={() => loadTicketTypes().catch(() => {})}
          onChanged={() => loadTicketTypes().catch(() => {})}
        />
      </EventSettingsTabPanel>

      <EventSettingsTabPanel tab="images" activeTab={tab} visited={visitedTabs} label="Images">
        <Card
          title={<HintLabel hint={EVENT_LOGO_HINT}>Event logo</HintLabel>}
          className="event-settings-card"
        >
          <LogoUploadZone
            label="Event logo"
            hideLabel
            hint="PNG, JPG, WebP · max 2 MB · leave blank to use the organization's logo"
            value={form.logoUrl}
            originalUrl={form.logoOriginalUrl || null}
            cropMeta={form.logoCrop}
            committedValue={original!.logoUrl}
            committedOriginalUrl={original!.logoOriginalUrl}
            disabled={isArchived || saving}
            onChange={(url) => setForm((prev) => prev && { ...prev, logoUrl: url })}
            onSourceChange={(source) =>
              setForm(
                (prev) =>
                  prev && {
                    ...prev,
                    logoOriginalUrl: source.originalUrl ?? "",
                    logoCrop: source.crop,
                  },
              )
            }
            uploadFn={(fd) => uploadEventBrandingFile(eventId, fd)}
            onUploadingChange={setLogoUploading}
          />
          {isArchived && (
            <p className="field-hint event-settings-archived-note">
              This event is archived - images cannot be changed.
            </p>
          )}
        </Card>

        {isSa ? (
          <EventImageAssetLibrary eventId={eventId} disabled={isArchived} />
        ) : (
          <Card title="Image assets" className="event-settings-card">
            <EmptyState
              icon={<i className="ti ti-photo" aria-hidden="true" />}
              title="Superadmin only"
              description="Uploading and managing named branding images for this event's email templates is restricted to superadmins."
            />
          </Card>
        )}

        {!isArchived && (
          <SettingsFooter
            validationErrors={[]}
            validationErrorsRef={basicValidationErrorsRef}
            hasUnsavedChanges={dirty}
            saving={saving || logoUploading}
            busyLabel={logoUploading && !saving ? "Uploading…" : "Saving…"}
            onReset={handleBasicReset}
            onSave={() => void handleSave()}
          />
        )}
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
            onValidationErrorsChange={setMailValidationErrors}
            validationErrorsListRef={mailTabValidationErrorsRef}
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
              validationErrors={mailValidationErrors}
              validationErrorsRef={mailTabValidationErrorsRef}
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
                  // If mail validation fails or opens a confirm dialog, stop before bounce
                  // so the operator does not see a bounce-save success toast alongside errors.
                  if (mailDirty) {
                    const mailOk = await mailCardRef.current?.save();
                    if (mailOk === false) return;
                  }
                  if (bounceDirty) await bouncePanelRef.current?.save();
                })();
              }}
            />
          )}
        </EventSettingsTabPanel>
      )}

      <EventSettingsTabPanel tab="wallet" activeTab={tab} visited={visitedTabs} label="Wallet">
        <EmptyState
          icon={<i className="ti ti-wallet" aria-hidden="true" />}
          title="Wallet passes are on the roadmap"
          description="Attendees will be able to add their ticket to Apple Wallet or Google Wallet. This isn't built yet."
        />
      </EventSettingsTabPanel>

      {isSa && (
        <EventSettingsTabPanel
          tab="integrations"
          activeTab={tab}
          visited={visitedTabs}
          label="Integrations"
        >
          <EmptyState
            icon={<i className="ti ti-plug-connected" aria-hidden="true" />}
            title="Automatic attendee import and attendance response tools are on the roadmap"
            description="Each event will get its own API token for automatic attendee imports and attendance responses, with the option to generate a new one anytime. Not built yet - superadmin-only, and kept separate from the everyday settings other admins use."
          />
        </EventSettingsTabPanel>
      )}

      <EventSettingsTabPanel tab="danger-zone" activeTab={tab} visited={visitedTabs} label="Danger zone">
        <div className="at-card danger-zone-panel">
          <div className="at-card__header danger-zone-panel__header">
            <div className="at-card__title">
              <HintLabel hint={DANGER_ZONE_HINT}>Danger zone</HintLabel>
            </div>
          </div>

          <div className="danger-zone__item">
            <div className="danger-zone__info">
              <div className="danger-zone__title">Export personal data</div>
              <p className="danger-zone__desc">
                Downloads every attendee&apos;s personal data as a CSV file (a simple
                spreadsheet). Saved in the history log.
              </p>
            </div>
            <ArchivedGuard
              event={null}
              reasonId="export-pii-reason"
              disabled={!isSa || exporting}
              tooltip={isSa ? undefined : "Superadmin only"}
            >
              {(guard) => (
                <Button
                  variant="secondary"
                  icon={<i className="ti ti-file-text" aria-hidden="true" />}
                  {...guard}
                  onClick={() => void handleExportPii()}
                >
                  {exporting ? "Exporting…" : "Export personal data"}
                </Button>
              )}
            </ArchivedGuard>
          </div>

          <div className="danger-zone__item">
            <div className="danger-zone__info">
              <div className="danger-zone__title">Revoke all check-ins</div>
              <p className="danger-zone__desc">{describeRevokeCheckins(event.admitted_count)}</p>
            </div>
            <ArchivedGuard
              event={event}
              reasonId="revoke-checkins-reason"
              disabled={!isSa || event.admitted_count === 0 || revokingCheckins}
              tooltip={revokeCheckinsTooltip}
            >
              {(guard) => (
                <Button
                  variant="danger"
                  icon={<i className="ti ti-arrow-back-up" aria-hidden="true" />}
                  {...guard}
                  onClick={() => setRevokeCheckinsOpen(true)}
                >
                  Revoke all check-ins
                </Button>
              )}
            </ArchivedGuard>
          </div>

          <div className="danger-zone__item">
            <div className="danger-zone__info">
              <div className="danger-zone__title">Revoke all items issued</div>
              <p className="danger-zone__desc">{describeRevokeItems(event.issued_items_count)}</p>
            </div>
            <ArchivedGuard
              event={event}
              reasonId="revoke-items-reason"
              disabled={!isSa || event.issued_items_count === 0 || revokingItems}
              tooltip={revokeItemsTooltip}
            >
              {(guard) => (
                <Button
                  variant="danger"
                  icon={<i className="ti ti-package-off" aria-hidden="true" />}
                  {...guard}
                  onClick={() => setRevokeItemsOpen(true)}
                >
                  Revoke all items issued
                </Button>
              )}
            </ArchivedGuard>
          </div>

          <div className="danger-zone__item">
            <div className="danger-zone__info">
              <div className="danger-zone__title">Revoke all Wallet passes</div>
              <p className="danger-zone__desc">
                Apple and Google Wallet passes aren&apos;t built yet - planned for a future
                release.
              </p>
            </div>
            <ArchivedGuard event={null} reasonId="wallet-revoke-reason" disabled tooltip="Not built yet">
              {(guard) => (
                <Button
                  variant="secondary"
                  icon={<i className="ti ti-wallet-off" aria-hidden="true" />}
                  {...guard}
                >
                  Revoke all Wallet passes
                </Button>
              )}
            </ArchivedGuard>
          </div>

          <div className="danger-zone__item">
            <div className="danger-zone__info">
              <div className="danger-zone__title">Archive event</div>
              <p className="danger-zone__desc">
                An archived event becomes fully read-only, including check-in. Only a superadmin
                can undo this.
              </p>
            </div>
            {isSa ? (
              archiveToggleButton
            ) : (
              <ArchivedGuard event={null} reasonId="archive-event-reason" disabled tooltip="Superadmin only">
                {(guard) => (
                  <Button
                    variant="danger"
                    icon={<i className="ti ti-archive" aria-hidden="true" />}
                    {...guard}
                  >
                    Archive event
                  </Button>
                )}
              </ArchivedGuard>
            )}
          </div>

          <div className="danger-zone__item">
            <div className="danger-zone__info">
              <div className="danger-zone__title">Delete event</div>
              <p className="danger-zone__desc">{describeDeleteEvent(event.is_deletable)}</p>
            </div>
            <ArchivedGuard
              event={null}
              reasonId="delete-event-reason"
              disabled={!isSa || !event.is_deletable || deleting}
              tooltip={deleteEventTooltip}
            >
              {(guard) => (
                <Button
                  variant="danger"
                  icon={<i className="ti ti-trash" aria-hidden="true" />}
                  {...guard}
                  onClick={() => {
                    setDeleteError(null);
                    setDeleteOpen(true);
                  }}
                >
                  Delete event
                </Button>
              )}
            </ArchivedGuard>
          </div>
        </div>

        <Notice variant="error" className="danger-zone-notice">
          These actions can affect this event&apos;s data or availability. Some are limited to
          superadmins and saved in the history log.
        </Notice>
      </EventSettingsTabPanel>

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
        confirmVariant="danger"
        cancelLabel="Keep editing"
        onConfirm={() => blocker.proceed?.()}
        onCancel={() => blocker.reset?.()}
      />
    </div>
  );
}
