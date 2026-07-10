import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, useBlocker, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Badge, Button, Card, EmptyState, Input, PageHeader, Tabs, useToast } from "@admitto/ui";
import {
  ApiError,
  archiveEvent,
  exportEventPii,
  fetchEventSettings,
  patchEvent,
  unarchiveEvent,
  uploadEventBrandingFile,
} from "../api/client.js";
import { hasApiErrorCode, operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { EventSettingsDto } from "../api/types.js";
import { useAuth } from "../auth/AuthProvider.js";
import { isSuperadmin } from "../auth/capabilities.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { LogoUploadZone } from "../components/LogoUploadZone.js";
import { TimezoneSelect } from "../components/TimezoneSelect.js";
import { DatePicker } from "../components/DatePicker.js";
import { formatUtcDateTime } from "../utils/event-dates.js";
import {
  EVENT_SETTINGS_TABS,
  inPageTabFromSearch,
  isEventSettingsTab,
  SUPERADMIN_ONLY_TABS,
  type EventSettingsTab,
} from "../settings/eventSettingsTabs.js";
import "./event-settings-page.css";

type SettingsForm = {
  title: string;
  date: string;
  timezone: string;
  location: string;
  capacity: string;
  logoUrl: string;
  headerImageUrl: string;
};

type SettingsPatch = Partial<{
  title: string;
  date: string;
  timezone: string;
  location: string | null;
  capacity: number | null;
  logo_url: string | null;
  header_image_url: string | null;
}>;

function toForm(data: EventSettingsDto): SettingsForm {
  return {
    title: data.title,
    date: data.date.split("T")[0] ?? "",
    timezone: data.timezone,
    location: data.location ?? "",
    capacity: data.capacity?.toString() ?? "",
    logoUrl: data.logo_url ?? "",
    headerImageUrl: data.header_image_url ?? "",
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
  const location = form.location.trim() || null;
  const originalLocation = original.location.trim() || null;
  if (location !== originalLocation) patch.location = location;
  if (form.capacity.trim() !== original.capacity.trim()) {
    patch.capacity = parseCapacityInput(form.capacity);
  }
  if (form.logoUrl !== original.logoUrl) patch.logo_url = form.logoUrl.trim() || null;
  if (form.headerImageUrl !== original.headerImageUrl) {
    patch.header_image_url = form.headerImageUrl.trim() || null;
  }
  return patch;
}

interface EventSettingsTabPanelProps {
  tab: EventSettingsTab;
  activeTab: EventSettingsTab;
  visited: ReadonlySet<EventSettingsTab>;
  label: string;
  children: ReactNode;
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

/** Event-scoped settings: General / Branding / Wallet / Danger zone tabs. */
export function EventSettingsPage() {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { addToast } = useToast();
  const { assignments } = useAuth();
  const isSa = isSuperadmin(assignments);

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
      setVisitedTabs((prev) => (prev.has(target) ? prev : new Set(prev).add(target)));
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
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && currentLocation.pathname !== nextLocation.pathname,
  );
  const isArchived = event?.status === "archived";

  const load = useCallback(async () => {
    if (!eventId) return;
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
  }, [eventId, addToast]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const goBack = () => {
    if (eventId) navigate(`/admin/events/${eventId}/overview`);
    else navigate("/admin");
  };

  async function handleSave() {
    if (!eventId || !form || !original || !dirty) return;
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

  async function handleArchiveConfirm() {
    if (!eventId) return;
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
      await load();
    } catch (err) {
      addToast(operatorApiErrorMessage(err, "Action failed"), "error");
    } finally {
      setArchiving(false);
    }
  }

  async function handleExportPii() {
    if (!eventId || !isSa) return;
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

  if (!eventId) return <p>Missing event.</p>;

  if (loading && !event) {
    return <p role="status">Loading event settings…</p>;
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

  const enabledItemsCount = event.active_items.filter((i) => i.enabled).length;

  return (
    <div className={`event-settings-page screen${isArchived ? " event-settings--archived" : ""}`}>
      <PageHeader
        title="Event settings"
        subtitle="Manage this event's details, branding, and access controls."
        actions={
          !isArchived ? (
            <span className="save-actions">
              <Button
                variant="primary"
                disabled={!dirty || saving}
                onClick={() => void handleSave()}
              >
                {saving ? "Saving…" : "Save changes"}
              </Button>
            </span>
          ) : undefined
        }
      />

      <Tabs
        value={tab}
        onChange={handleTabChange}
        tabs={EVENT_SETTINGS_TABS.filter((t) => isSa || !SUPERADMIN_ONLY_TABS.has(t.id))}
      />

      <EventSettingsTabPanel tab="general" activeTab={tab} visited={visitedTabs} label="General">
        <Card title="Basic information" className="event-settings-card">
          <div className="settings-field-stack">
            <div className="settings-field-group">
              <Input
                label="Event title"
                required
                value={form.title}
                disabled={isArchived || saving}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
              <p className="field-hint">Shown everywhere - to attendees, on tickets, and in emails.</p>
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
              </div>

              <div className="settings-field-group">
                <Input
                  label="Capacity"
                  type="number"
                  min={1}
                  value={form.capacity}
                  disabled={isArchived || saving}
                  placeholder="500"
                  onChange={(e) => setForm({ ...form, capacity: e.target.value })}
                />
                <p className="field-hint">Leave blank for unlimited.</p>
              </div>
            </div>

            <div className="settings-field-group event-settings-timezone">
              <label className="input-label" htmlFor="event-timezone">
                Event timezone
              </label>
              <TimezoneSelect
                id="event-timezone"
                compact
                value={form.timezone}
                onChange={(tz) => setForm({ ...form, timezone: tz })}
                disabled={isArchived || saving}
              />
              <p className="field-hint">All check-in times and reports use this timezone.</p>
            </div>

            <div className="settings-field-group">
              <Input
                label="Location"
                value={form.location}
                disabled={isArchived || saving}
                placeholder="Convention Center, Warsaw"
                icon={<i className="ti ti-map-pin" aria-hidden="true" />}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
              />
              <p className="field-hint">Optional. Shown on tickets and calendar invites.</p>
            </div>

            <div className="settings-field-group slug-field">
              <Input
                label="Event link ID"
                value={event.slug}
                readOnly
                disabled
                icon={<i className="ti ti-link" aria-hidden="true" />}
              />
              <p className="field-hint">
                This can&apos;t be changed after the event is created - it&apos;s already part
                of every QR code sent to attendees.
              </p>
            </div>
          </div>
        </Card>

        <Card title="Status" className="event-settings-card">
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
                  ? `Archived on ${formatUtcDateTime(event.archived_at)}.`
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
                Created: <strong>{formatUtcDateTime(event.created_at)}</strong>
              </p>
              <p className="field-hint">When this event was first set up.</p>
            </div>
            <div className="settings-field-group">
              <p>
                Items:{" "}
                <strong>{enabledItemsCount > 0 ? `${enabledItemsCount} configured` : "None configured"}</strong>
              </p>
              <p className="field-hint">
                <Link to={`/admin/events/${eventId}/requirements`}>Manage in Requirements →</Link>
              </p>
            </div>
          </div>
        </Card>
      </EventSettingsTabPanel>

      <EventSettingsTabPanel tab="branding" activeTab={tab} visited={visitedTabs} label="Branding">
        <Card title="Event branding" className="event-settings-card">
          <p className="field-hint">
            Replace the organization&apos;s logo and header image just for this event. Leave a
            field blank to keep using the organization&apos;s branding.
          </p>
          <div className="settings-field-stack">
            <div className="settings-field-group">
              <LogoUploadZone
                label="Event logo"
                hint="PNG, JPG, WebP · max 2 MB · leave blank to inherit the organization logo"
                value={form.logoUrl}
                disabled={isArchived || saving}
                onChange={(url) => setForm({ ...form, logoUrl: url })}
                uploadFn={(fd) => uploadEventBrandingFile(eventId, fd)}
              />
            </div>
            <div className="settings-field-group">
              <LogoUploadZone
                label="Event header image"
                hint="PNG, JPG, WebP · max 2 MB · wide banner, recommended 1200×300 px"
                value={form.headerImageUrl}
                disabled={isArchived || saving}
                onChange={(url) => setForm({ ...form, headerImageUrl: url })}
                uploadFn={(fd) => uploadEventBrandingFile(eventId, fd)}
              />
            </div>
          </div>
          {isArchived && (
            <p className="field-hint event-settings-archived-note">
              This event is archived - branding cannot be changed.
            </p>
          )}
        </Card>
      </EventSettingsTabPanel>

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
            title="Ingest and RSVP API tokens are on the roadmap"
            description="Each event will get its own API token for automatic attendee imports and RSVP replies, with the option to generate a new one anytime. Not built yet - superadmin-only, and kept separate from the everyday settings other admins use."
          />
        </EventSettingsTabPanel>
      )}

      <EventSettingsTabPanel tab="danger-zone" activeTab={tab} visited={visitedTabs} label="Danger zone">
        <div className="at-card danger-zone-panel">
          <div className="at-card__header danger-zone-panel__header">
            <div className="at-card__title">Danger zone</div>
          </div>

          <div className="danger-zone__item">
            <div className="danger-zone__info">
              <div className="danger-zone__title">Archive event</div>
              <p className="danger-zone__desc">
                An archived event becomes read-only - editing is disabled, but check-in still
                works. Only a superadmin can undo this.
              </p>
            </div>
            {isSa ? (
              isArchived ? (
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
              )
            ) : (
              <Button
                variant="danger"
                disabled
                title="Superadmin only"
                icon={<i className="ti ti-archive" aria-hidden="true" />}
              >
                Archive event
              </Button>
            )}
          </div>

          <div className="danger-zone__item">
            <div className="danger-zone__info">
              <div className="danger-zone__title">Export personal data</div>
              <p className="danger-zone__desc">
                Downloads every attendee&apos;s personal data as a CSV file (a simple
                spreadsheet). Saved in the history log.
              </p>
            </div>
            <Button
              variant="secondary"
              disabled={!isSa || exporting}
              title={isSa ? undefined : "Superadmin only"}
              icon={<i className="ti ti-file-text" aria-hidden="true" />}
              onClick={() => void handleExportPii()}
            >
              {exporting ? "Exporting…" : "Export personal data"}
            </Button>
          </div>
        </div>

        <p className="danger-zone-notice">
          <i className="ti ti-alert-triangle" aria-hidden="true" /> These actions can affect this
          event&apos;s data or availability. Some are limited to superadmins and saved in the
          history log.
        </p>
      </EventSettingsTabPanel>

      <ConfirmDialog
        open={archiveOpen}
        title={archiveMode === "archive" ? "Archive this event?" : "Unarchive this event?"}
        message={
          archiveMode === "archive"
            ? "This event will become read-only. Editing will be disabled, but check-in will still work. Only a superadmin can undo this."
            : "This event will become active again and editable in admin."
        }
        confirmLabel={archiveMode === "archive" ? "Archive event" : "Unarchive event"}
        confirmVariant={archiveMode === "archive" ? "danger" : "primary"}
        loading={archiving}
        onConfirm={() => void handleArchiveConfirm()}
        onCancel={() => setArchiveOpen(false)}
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
