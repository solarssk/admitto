import { useCallback, useEffect, useState } from "react";
import { Link, useBlocker, useNavigate, useParams } from "react-router-dom";
import { Button, Card, EmptyState, Input, PageHeader, StatusBadge, useToast } from "@admitto/ui";
import {
  ApiError,
  archiveEvent,
  exportEventPii,
  fetchEventSettings,
  patchEvent,
  unarchiveEvent,
} from "../api/client.js";
import type { EventSettingsDto } from "../api/types.js";
import { useAuth } from "../auth/AuthProvider.js";
import { isSuperadmin } from "../auth/capabilities.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { TimezoneSelect } from "../components/TimezoneSelect.js";
import "./event-settings-page.css";

type SettingsForm = {
  title: string;
  date: string;
  timezone: string;
  location: string;
  capacity: string;
};

function toForm(data: EventSettingsDto): SettingsForm {
  return {
    title: data.title,
    date: data.date.split("T")[0] ?? "",
    timezone: data.timezone,
    location: data.location ?? "",
    capacity: data.capacity?.toString() ?? "",
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

function buildSettingsPatch(
  form: SettingsForm,
  original: SettingsForm,
): Partial<{ title: string; date: string; timezone: string; location: string | null; capacity: number | null }> {
  const patch: Partial<{ title: string; date: string; timezone: string; location: string | null; capacity: number | null }> =
    {};
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
  return patch;
}

/** Event-scoped settings: basic info, status, items summary, danger zone. */
export function EventSettingsPage() {
  const { eventId } = useParams();
  const navigate = useNavigate();
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
        addToast(err instanceof ApiError ? err.message : "Failed to load event settings", "error");
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
      } else if (err instanceof ApiError && err.message === "event_archived") {
        addToast("Cannot edit archived event", "error");
      } else {
        addToast(err instanceof ApiError ? err.message : "Failed to save settings", "error");
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
      addToast(err instanceof ApiError ? err.message : "Action failed", "error");
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
      addToast(err instanceof ApiError ? err.message : "Export failed", "error");
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

  const enabledItems = event.active_items.filter((i) => i.enabled);
  const itemsLabel =
    enabledItems.length > 0 ? enabledItems.map((i) => i.name).join(", ") : "None configured";

  return (
    <div className={`event-settings-page screen${isArchived ? " event-settings--archived" : ""}`}>
      <PageHeader
        title="Event settings"
        subtitle={event.title}
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

      <Card title="Basic information" className="event-settings-card">
        <Input
          label="Event title"
          required
          value={form.title}
          disabled={isArchived || saving}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
        />
        <p className="field-hint">Displayed everywhere — attendees, tickets, and mail.</p>

        <Input
          label="Date"
          type="date"
          required
          value={form.date}
          disabled={isArchived || saving}
          onChange={(e) => setForm({ ...form, date: e.target.value })}
        />

        <div className="event-settings-timezone">
          <label className="input-label" htmlFor="event-timezone">
            Event timezone
          </label>
          <TimezoneSelect
            id="event-timezone"
            value={form.timezone}
            onChange={(tz) => setForm({ ...form, timezone: tz })}
            disabled={isArchived || saving}
          />
          <p className="field-hint">
            All check-in timestamps and reports will use this timezone.
          </p>
        </div>

        <Input
          label="Location"
          value={form.location}
          disabled={isArchived || saving}
          placeholder="Convention Center, Warsaw"
          icon={<i className="ti ti-map-pin" aria-hidden="true" />}
          onChange={(e) => setForm({ ...form, location: e.target.value })}
        />
        <p className="field-hint">Optional. Shown on tickets and calendar invites.</p>

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

        <div className="slug-field">
          <Input
            label="URL slug"
            value={event.slug}
            readOnly
            disabled
            icon={<i className="ti ti-link" aria-hidden="true" />}
          />
        </div>
        <p className="field-hint">
          Slug is immutable after creation — it is embedded in all issued QR codes.
        </p>
      </Card>

      <Card title="Status" className="event-settings-card">
        <p>
          Current status:{" "}
          <StatusBadge
            status={isArchived ? "archived" : "active"}
            label={isArchived ? "Archived" : "Active"}
          />
        </p>
        <p className="field-hint">
          Active events accept check-ins and allow attendee edits.
        </p>
        <p>
          Organization: <strong>{event.organization_name}</strong>
        </p>
        <p className="field-hint">Events belong to an organization and inherit its branding.</p>
      </Card>

      <Card title="Event items" className="event-settings-card">
        <p>
          Active items: <strong>{itemsLabel}</strong>
        </p>
        <Link
          to={`/admin/events/${eventId}/requirements`}
          className="event-settings-items-link"
        >
          Manage in Requirements →
        </Link>
      </Card>

      <Card title="Danger zone" className="event-settings-card">
        <div className="danger-zone__item">
          <div className="danger-zone__info">
            <div className="danger-zone__title">Archive event</div>
            <p className="danger-zone__desc">
              Archived events become read-only. Check-in remains available. Unarchivable by superadmin
              only.
            </p>
          </div>
          {isSa ? (
            isArchived ? (
              <Button
                variant="secondary"
                disabled={archiving}
                onClick={() => {
                  setArchiveMode("unarchive");
                  setArchiveOpen(true);
                }}
              >
                <i className="ti ti-archive-off" aria-hidden="true" /> Unarchive event
              </Button>
            ) : (
              <Button
                variant="danger"
                disabled={archiving}
                onClick={() => {
                  setArchiveMode("archive");
                  setArchiveOpen(true);
                }}
              >
                <i className="ti ti-archive" aria-hidden="true" /> Archive event
              </Button>
            )
          ) : (
            <Button variant="danger" disabled title="Superadmin only">
              <i className="ti ti-archive" aria-hidden="true" /> Archive event
            </Button>
          )}
        </div>

        <div className="danger-zone__item">
          <div className="danger-zone__info">
            <div className="danger-zone__title">Export attendee PII</div>
            <p className="danger-zone__desc">
              Export all attendee data as CSV for retention or offboarding workflows.
            </p>
            <p className="field-hint">Superadmin only. Logged in audit trail.</p>
          </div>
          <Button
            variant="secondary"
            disabled={!isSa || exporting}
            title={isSa ? undefined : "Superadmin only"}
            onClick={() => void handleExportPii()}
          >
            <i className="ti ti-file-text" aria-hidden="true" />
            {exporting ? "Exporting…" : "Export PII"}
          </Button>
        </div>
      </Card>

      <ConfirmDialog
        open={archiveOpen}
        title={archiveMode === "archive" ? "Archive this event?" : "Unarchive this event?"}
        message={
          archiveMode === "archive"
            ? "Archived events become read-only. Attendee data is preserved. Check-in continues to work. Unarchivable by superadmin only."
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
