import { useCallback, useEffect, useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { Avatar, Badge, Card, PageHeader, Stat, useToast } from "@admitto/ui";
import {
  ApiError,
  fetchEventOverview,
  patchEventNote,
  createEventContact,
  updateEventContact,
  deleteEventContact,
  createEventResource,
  updateEventResource,
  deleteEventResource,
} from "../api/client.js";
import type { EventDto, EventOverviewDto, EventContactDto, EventResourceDto } from "../api/types.js";
import { formatEventCalendarDate, formatEventTime, formatUtcDateTime } from "../utils/event-dates.js";
import { useCountdown } from "../utils/event-countdown.js";
import { useConnectionState } from "../connection/ConnectionStateProvider.js";
import {
  isAdmitDedupHit,
  pruneAdmitDedupMap,
  registerAdmitDedup,
} from "../checkin/admitDedup.js";
import { useEventStream, type StreamCheckinEvent } from "../hooks/useEventStream.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";

const OVERVIEW_REFRESH_MS = 30_000;
const RECENT_CHECKINS_MAX = 8;

function safeHref(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? url : "#";
  } catch {
    return "#";
  }
}

function AdmissionBar({ admitted, total }: { admitted: number; total: number }) {
  const pct = total > 0 ? Math.round((admitted / total) * 100) : 0;
  return (
    <div
      className="overview-admission-bar"
      role="progressbar"
      aria-label="Admission progress"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="overview-admission-bar__fill" style={{ width: `${pct}%` }} />
    </div>
  );
}


interface NeedsAttentionProps {
  overview: EventOverviewDto;
}

function NeedsAttentionCard({ overview }: NeedsAttentionProps) {
  const failed = overview.email_failed + overview.email_bounced;
  const alerts: Array<{ icon: string; level: "error" | "warn"; title: string; desc: string }> = [];

  if (failed > 0) {
    alerts.push({
      icon: "ti-mail-x",
      level: "error",
      title: `${failed} email ${failed === 1 ? "delivery" : "deliveries"} failed`,
      desc: `${overview.email_bounced > 0 ? `${overview.email_bounced} bounced` : ""}${overview.email_bounced > 0 && overview.email_failed > 0 ? " · " : ""}${overview.email_failed > 0 ? `${overview.email_failed} rejected` : ""}`.trim(),
    });
  }

  if (overview.email_queued > 0) {
    alerts.push({
      icon: "ti-mail-forward",
      level: "warn",
      title: `${overview.email_queued} ${overview.email_queued === 1 ? "ticket" : "tickets"} still in send queue`,
      desc: "Mailer queue processing — check mailer status if delayed",
    });
  }

  if (overview.checkin_staff_count === 0 && !overview.event.archived_at) {
    alerts.push({
      icon: "ti-qrcode",
      level: "warn",
      title: "No operators assigned for check-in",
      desc: "Assign at least one operator so staff can scan tickets",
    });
  }

  if (alerts.length === 0) {
    return (
      <Card title="Needs attention">
        <p className="overview-muted overview-all-clear">
          <i className="ti ti-circle-check" aria-hidden="true" />
          All good — no issues to action
        </p>
      </Card>
    );
  }

  return (
    <Card
      title="Needs attention"
      actions={
        <Badge variant={alerts.some((a) => a.level === "error") ? "error" : "warn"}>
          {alerts.length}
        </Badge>
      }
    >
      <div className="overview-alerts">
        {alerts.map((alert) => (
          <div key={alert.title} className={`overview-alert overview-alert--${alert.level}`}>
            <i className={`ti ${alert.icon} overview-alert__icon`} aria-hidden="true" />
            <div className="overview-alert__body">
              <strong className="overview-alert__title">{alert.title}</strong>
              {alert.desc && <span className="overview-alert__desc">{alert.desc}</span>}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

interface ReadinessItem {
  label: string;
  status: "ok" | "warn" | "error" | "neutral";
  value: string;
}

function EventReadinessCard({
  overview,
  loading,
}: {
  overview: EventOverviewDto | null;
  loading: boolean;
}) {
  if (!overview) {
    return (
      <Card title="Event readiness">
        <p className="overview-muted">{loading ? "Loading…" : "Unavailable"}</p>
      </Card>
    );
  }

  const failed = overview.email_failed + overview.email_bounced;

  const items: ReadinessItem[] = [
    {
      label: "Attendees imported",
      status: overview.attendee_count > 0 ? "ok" : "warn",
      value: overview.attendee_count > 0 ? `${overview.attendee_count} guests` : "None yet",
    },
    {
      label: "Tickets sent",
      status:
        overview.attendee_count === 0
          ? "neutral"
          : overview.attendees_with_ticket >= overview.attendee_count
            ? "ok"
            : overview.attendees_with_ticket > 0
              ? "warn"
              : "error",
      value:
        overview.attendee_count === 0
          ? "—"
          : `${overview.attendees_with_ticket} / ${overview.attendee_count}`,
    },
    {
      label: "Delivery healthy",
      status: failed === 0 ? "ok" : "error",
      value: failed === 0 ? "No failures" : `${failed} failed`,
    },
    {
      label: "Check-in staff",
      status: overview.checkin_staff_count > 0 ? "ok" : "warn",
      value:
        overview.checkin_staff_count > 0
          ? `${overview.checkin_staff_count} user${overview.checkin_staff_count > 1 ? "s" : ""}`
          : "None active",
    },
    {
      label: "Event items",
      status: "neutral",
      value:
        overview.requirements_count > 0
          ? `${overview.requirements_count} configured`
          : "None",
    },
  ];

  const okCount = items.filter((i) => i.status === "ok").length;
  const actionableCount = items.filter((i) => i.status !== "neutral").length;

  return (
    <Card
      title="Event readiness"
      actions={
        <span className="overview-readiness-score">
          {okCount}/{actionableCount}
        </span>
      }
    >
      <div className="overview-readiness">
        {items.map((item) => (
          <div key={item.label} className="overview-readiness__row">
            <span className={`overview-readiness__dot overview-readiness__dot--${item.status}`}>
              {item.status === "ok" ? (
                <i className="ti ti-check" aria-hidden="true" />
              ) : item.status === "error" ? (
                <i className="ti ti-x" aria-hidden="true" />
              ) : item.status === "warn" ? (
                <i className="ti ti-alert-triangle" aria-hidden="true" />
              ) : (
                <i className="ti ti-minus" aria-hidden="true" />
              )}
            </span>
            <span className="overview-readiness__label">{item.label}</span>
            <span className={`overview-readiness__value overview-readiness__value--${item.status}`}>
              {item.value}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function RecentCheckinsCard({
  checkins,
  timezone,
  connected,
}: {
  checkins: StreamCheckinEvent[];
  timezone: string;
  connected: boolean;
}) {
  return (
    <Card
      title="Recent check-ins"
      actions={
        connected ? (
          <span className="overview-live-badge">
            <span className="overview-live-dot" aria-hidden="true" />
            live
          </span>
        ) : undefined
      }
    >
      {checkins.length === 0 ? (
        <p className="overview-muted">
          No check-ins yet — events will appear as attendees scan in.
        </p>
      ) : (
        <ul className="overview-activity">
          {checkins.map((c) => (
            <li key={`${c.attendeeId}-${c.admittedAt}`} className="overview-activity__item">
              <Avatar name={c.attendeeName} size="sm" />
              <div className="overview-activity__info">
                <strong>{c.attendeeName}</strong>
                <span>{c.ticketType ?? "—"}</span>
              </div>
              <time className="overview-activity__time">
                {formatEventTime(c.admittedAt, timezone)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function EventInfoCard({
  overview,
  event,
  countdown,
}: {
  overview: EventOverviewDto | null;
  event: EventDto;
  countdown: string;
}) {
  const location = overview?.event.location ?? event.location;
  const timezone = overview?.event.timezone ?? event.timezone;
  const dateIso = overview?.event.date ?? event.date;
  const capacity = overview?.event.capacity ?? null;

  const rows: Array<{ icon: string; label: string; value: string }> = [
    {
      icon: "ti-calendar",
      label: "Date",
      value: `${formatEventCalendarDate(dateIso)} · ${countdown}`,
    },
    ...(location ? [{ icon: "ti-map-pin", label: "Venue", value: location }] : []),
    { icon: "ti-world", label: "Timezone", value: timezone },
    ...(capacity != null
      ? [
          {
            icon: "ti-users",
            label: "Capacity",
            value: `${overview?.attendee_count ?? "—"} of ${capacity}`,
          },
        ]
      : []),
  ];

  return (
    <Card title="Event info">
      <div className="overview-info">
        {rows.map((row) => (
          <div key={row.label} className="overview-info__row">
            <i className={`ti ${row.icon} overview-info__icon`} aria-hidden="true" />
            <div className="overview-info__content">
              <span className="overview-info__label">{row.label}</span>
              <span className="overview-info__value">{row.value}</span>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function PinnedNoteCard({
  note,
  loading,
  archived,
  onSave,
}: {
  note: string | null;
  loading: boolean;
  archived: boolean;
  onSave: (note: string | null) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note ?? "");
  const [saving, setSaving] = useState(false);

  const handleEdit = () => {
    setDraft(note ?? "");
    setEditing(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(draft.trim() || null);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setDraft(note ?? "");
    setEditing(false);
  };

  if (editing) {
    return (
      <Card title="Pinned note">
        <div className="overview-note-edit">
          <textarea
            className="overview-note-textarea"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Short operational note visible to all staff…"
            rows={3}
            autoFocus
          />
          <div className="overview-note-actions">
            <button className="btn btn-ghost btn-sm" onClick={handleCancel} disabled={saving}>
              Cancel
            </button>
            <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </Card>
    );
  }

  if (!note) {
    return (
      <Card
        title="Pinned note"
        actions={
          !loading && !archived ? (
            <button className="btn btn-ghost btn-sm" onClick={handleEdit}>
              + Add note
            </button>
          ) : undefined
        }
      >
        <p className="overview-muted">
          {loading ? "Loading…" : "No operational note. Add one to share a quick reminder with all staff."}
        </p>
      </Card>
    );
  }

  return (
    <div className="overview-pinned-note">
      <div className="overview-pinned-note__header">
        <span className="overview-pinned-note__title">
          <i className="ti ti-pin" aria-hidden="true" /> Pinned note
        </span>
        {!archived && (
          <button className="btn btn-ghost btn-sm overview-pinned-note__edit" onClick={handleEdit} aria-label="Edit pinned note">
            <i className="ti ti-pencil" aria-hidden="true" /> Edit
          </button>
        )}
      </div>
      <p className="overview-pinned-note__body">{note}</p>
    </div>
  );
}

function KeyContactsCard({
  contacts,
  loading,
  archived,
  onAdd,
  onUpdate,
  onDelete,
}: {
  contacts: EventContactDto[];
  loading: boolean;
  archived: boolean;
  onAdd: (data: { name: string; role?: string | null; phone?: string | null; email?: string | null }) => Promise<void>;
  onUpdate: (id: string, data: { name: string; role?: string | null; phone?: string | null; email?: string | null }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", role: "", phone: "", email: "" });
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const openAdd = () => {
    setForm({ name: "", role: "", phone: "", email: "" });
    setEditingId(null);
    setAddOpen(true);
  };

  const openEdit = (c: EventContactDto) => {
    setForm({ name: c.name, role: c.role ?? "", phone: c.phone ?? "", email: c.email ?? "" });
    setEditingId(c.id);
    setAddOpen(false);
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const data = {
        name: form.name.trim(),
        role: form.role.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
      };
      if (editingId) {
        await onUpdate(editingId, data);
        setEditingId(null);
      } else {
        await onAdd(data);
        setAddOpen(false);
      }
      setForm({ name: "", role: "", phone: "", email: "" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setSaving(true);
    setDeleteError(null);
    try {
      await onDelete(id);
      setConfirmDeleteId(null);
    } catch {
      setDeleteError("Failed to delete contact.");
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => { setAddOpen(false); setEditingId(null); };

  const inlineForm = (
    <div className="overview-contact-form">
      <input className="input input-sm" placeholder="Name *" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
      <input className="input input-sm" placeholder="Role" value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))} />
      <input className="input input-sm" placeholder="Phone" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
      <input className="input input-sm" placeholder="Email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
      <div className="overview-contact-form__actions">
        <button className="btn btn-ghost btn-sm" onClick={cancel} disabled={saving}>Cancel</button>
        <button className="btn btn-primary btn-sm" onClick={handleSubmit} disabled={saving || !form.name.trim()}>
          {saving ? "Saving…" : editingId ? "Save" : "Add"}
        </button>
      </div>
    </div>
  );

  return (
    <Card
      title="Key contacts"
      actions={
        !archived ? (
          <button className="btn btn-ghost btn-sm" onClick={openAdd} aria-label="Add contact">
            + Add
          </button>
        ) : undefined
      }
    >
      {contacts.length === 0 && !addOpen ? (
        <p className="overview-muted">{loading ? "Loading…" : "No contacts yet."}</p>
      ) : (
        <ul className="overview-contacts">
          {contacts.map((contact) => (
            <li key={contact.id} className="overview-contact">
              {editingId === contact.id ? (
                inlineForm
              ) : (
                <>
                  <Avatar name={contact.name} size="sm" />
                  <div className="overview-contact__info">
                    <strong>{contact.name}</strong>
                    {contact.role && <span>{contact.role}</span>}
                    {contact.note && <span className="overview-contact__note">{contact.note}</span>}
                  </div>
                  <div className="overview-contact__actions">
                    {contact.phone && (
                      <a href={`tel:${contact.phone}`} className="overview-contact__action" aria-label={`Call ${contact.name}`}>
                        <i className="ti ti-phone" aria-hidden="true" />
                      </a>
                    )}
                    {contact.email && (
                      <a href={`mailto:${contact.email}`} className="overview-contact__action" aria-label={`Email ${contact.name}`}>
                        <i className="ti ti-mail" aria-hidden="true" />
                      </a>
                    )}
                    {!archived && (
                      <>
                        <button className="overview-contact__action" onClick={() => openEdit(contact)} aria-label={`Edit ${contact.name}`}>
                          <i className="ti ti-pencil" aria-hidden="true" />
                        </button>
                        <button className="overview-contact__action overview-contact__action--delete" onClick={() => { setDeleteError(null); setConfirmDeleteId(contact.id); }} aria-label={`Delete ${contact.name}`}>
                          <i className="ti ti-trash" aria-hidden="true" />
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}
            </li>
          ))}
          {addOpen && <li className="overview-contact overview-contact--form">{inlineForm}</li>}
        </ul>
      )}
      <ConfirmDialog
        open={confirmDeleteId !== null}
        title="Delete contact"
        message="Remove this contact? This cannot be undone."
        confirmLabel="Delete"
        confirmVariant="danger"
        loading={saving}
        errorMessage={deleteError}
        onConfirm={() => { if (confirmDeleteId) void handleDelete(confirmDeleteId); }}
        onCancel={() => { setConfirmDeleteId(null); setDeleteError(null); }}
      />
    </Card>
  );
}

function ImportantLinksCard({
  resources,
  loading,
  archived,
  onAdd,
  onUpdate,
  onDelete,
}: {
  resources: EventResourceDto[];
  loading: boolean;
  archived: boolean;
  onAdd: (data: { title: string; type: "link" | "file"; url: string; description?: string | null }) => Promise<void>;
  onUpdate: (id: string, data: { title: string; type: "link" | "file"; url: string; description?: string | null }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const PREVIEW_MAX = 4;
  const [showAll, setShowAll] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", type: "link" as "link" | "file", url: "", description: "" });
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const visible = showAll ? resources : resources.slice(0, PREVIEW_MAX);
  const hiddenCount = resources.length - PREVIEW_MAX;

  const openAdd = () => {
    setForm({ title: "", type: "link", url: "", description: "" });
    setEditingId(null);
    setAddOpen(true);
  };

  const openEdit = (r: EventResourceDto) => {
    setForm({ title: r.title, type: r.type, url: r.url, description: r.description ?? "" });
    setEditingId(r.id);
    setAddOpen(false);
  };

  const handleSubmit = async () => {
    if (!form.title.trim() || !form.url.trim()) return;
    setSaving(true);
    try {
      const data = { title: form.title.trim(), type: form.type, url: form.url.trim(), description: form.description.trim() || null };
      if (editingId) {
        await onUpdate(editingId, data);
        setEditingId(null);
      } else {
        await onAdd(data);
        setAddOpen(false);
      }
      setForm({ title: "", type: "link", url: "", description: "" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setSaving(true);
    setDeleteError(null);
    try {
      await onDelete(id);
      setConfirmDeleteId(null);
    } catch {
      setDeleteError("Failed to delete link.");
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => { setAddOpen(false); setEditingId(null); };

  const inlineForm = (
    <div className="overview-resource-form">
      <input className="input input-sm" placeholder="Title *" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
      <div className="overview-resource-form__row">
        <select className="select select-sm" value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as "link" | "file" }))}>
          <option value="link">Link</option>
          <option value="file">File</option>
        </select>
        <input className="input input-sm" placeholder="URL *" value={form.url} onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))} />
      </div>
      <input className="input input-sm" placeholder="Description (optional)" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
      <div className="overview-resource-form__actions">
        <button className="btn btn-ghost btn-sm" onClick={cancel} disabled={saving}>Cancel</button>
        <button className="btn btn-primary btn-sm" onClick={handleSubmit} disabled={saving || !form.title.trim() || !form.url.trim()}>
          {saving ? "Saving…" : editingId ? "Save" : "Add"}
        </button>
      </div>
    </div>
  );

  return (
    <Card
      title="Important links & files"
      actions={
        !archived ? (
          <button className="btn btn-ghost btn-sm" onClick={openAdd} aria-label="Add resource">
            + Add
          </button>
        ) : undefined
      }
    >
      {resources.length === 0 && !addOpen ? (
        <p className="overview-muted">{loading ? "Loading…" : "No links or files yet."}</p>
      ) : (
        <>
          <ul className="overview-resources">
            {visible.map((r) => (
              <li key={r.id} className="overview-resource">
                {editingId === r.id ? (
                  inlineForm
                ) : (
                  <>
                    <i
                      className={`ti ${r.type === "file" ? "ti-file" : "ti-link"} overview-resource__icon`}
                      aria-hidden="true"
                    />
                    <div className="overview-resource__info">
                      <a
                        href={safeHref(r.url)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="overview-resource__title"
                      >
                        {r.title}
                      </a>
                      {r.description && <span className="overview-resource__desc">{r.description}</span>}
                    </div>
                    {!archived && (
                      <div className="overview-resource__actions">
                        <button className="overview-contact__action" onClick={() => openEdit(r)} aria-label={`Edit ${r.title}`}>
                          <i className="ti ti-pencil" aria-hidden="true" />
                        </button>
                        <button className="overview-contact__action overview-contact__action--delete" onClick={() => { setDeleteError(null); setConfirmDeleteId(r.id); }} aria-label={`Delete ${r.title}`}>
                          <i className="ti ti-trash" aria-hidden="true" />
                        </button>
                      </div>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
          {!showAll && hiddenCount > 0 && (
            <button className="overview-resources__show-more" onClick={() => setShowAll(true)}>
              View all resources ({hiddenCount} more)
            </button>
          )}
          {addOpen && (
            <div className="overview-resource overview-resource--form">{inlineForm}</div>
          )}
        </>
      )}
      <ConfirmDialog
        open={confirmDeleteId !== null}
        title="Delete link"
        message="Remove this link? This cannot be undone."
        confirmLabel="Delete"
        confirmVariant="danger"
        loading={saving}
        errorMessage={deleteError}
        onConfirm={() => { if (confirmDeleteId) void handleDelete(confirmDeleteId); }}
        onCancel={() => { setConfirmDeleteId(null); setDeleteError(null); }}
      />
    </Card>
  );
}

/** Event-scoped dashboard — event command center with KPIs, alerts, readiness, and live check-in feed. */
export function EventOverviewPage() {
  const { event } = useOutletContext<{ event: EventDto }>();
  const { reportApiError } = useConnectionState();
  const { addToast } = useToast();
  const abortRef = useRef<AbortController | null>(null);
  const seenCheckinsRef = useRef(new Map<string, number>());
  const statsErrorToastedRef = useRef(false);
  const reconcileTimerRef = useRef<number | null>(null);
  const currentEventIdRef = useRef(event.id);

  useEffect(() => {
    currentEventIdRef.current = event.id;
  }, [event.id]);

  const [overview, setOverview] = useState<EventOverviewDto | null>(null);
  const [optimisticAdmittedDelta, setOptimisticAdmittedDelta] = useState(0);
  const [recentCheckins, setRecentCheckins] = useState<StreamCheckinEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [contacts, setContacts] = useState<EventContactDto[]>([]);
  const [resources, setResources] = useState<EventResourceDto[]>([]);
  const [pinnedNote, setPinnedNote] = useState<string | null>(null);

  const currentOverview = overview?.event.id === event.id ? overview : null;
  const eventTimezone = currentOverview?.event.timezone ?? event.timezone;
  const eventDateIso = currentOverview?.event.date ?? event.date;
  const countdown = useCountdown(eventDateIso, eventTimezone);

  const absorbServerOverview = useCallback((data: EventOverviewDto) => {
    if (data.event.id !== currentEventIdRef.current) return;
    pruneAdmitDedupMap(seenCheckinsRef.current);
    setOverview(data);
    setOptimisticAdmittedDelta(0);
    setContacts(data.contacts);
    setResources(data.resources);
    setPinnedNote(data.event.pinned_note);
  }, []);

  const scheduleReconcile = useCallback(() => {
    if (reconcileTimerRef.current != null) {
      window.clearTimeout(reconcileTimerRef.current);
    }
    reconcileTimerRef.current = window.setTimeout(() => {
      reconcileTimerRef.current = null;
      void fetchEventOverview(event.id)
        .then((data) => { absorbServerOverview(data); })
        .catch(() => { /* keep optimistic value until next poll */ });
    }, 3000);
  }, [absorbServerOverview, event.id]);

  const handleLiveCheckin = useCallback(
    (checkin: StreamCheckinEvent) => {
      if (isAdmitDedupHit(seenCheckinsRef.current, checkin.attendeeId, checkin.admittedAt)) return;
      registerAdmitDedup(seenCheckinsRef.current, checkin.attendeeId, checkin.admittedAt);
      setOptimisticAdmittedDelta((delta) => delta + 1);
      setRecentCheckins((prev) => [checkin, ...prev].slice(0, RECENT_CHECKINS_MAX));
      scheduleReconcile();
    },
    [scheduleReconcile],
  );

  const { connected: streamConnected } = useEventStream(event.id, handleLiveCheckin);

  const handleSaveNote = useCallback(async (note: string | null) => {
    const capturedEventId = event.id;
    try {
      await patchEventNote(capturedEventId, note);
      if (currentEventIdRef.current !== capturedEventId) return;
      setPinnedNote(note);
    } catch (err) {
      addToast("Failed to save note.", "error");
      throw err;
    }
  }, [event.id, addToast]);

  const handleAddContact = useCallback(async (data: Parameters<typeof createEventContact>[1]) => {
    const capturedEventId = event.id;
    try {
      const created = await createEventContact(capturedEventId, data);
      if (currentEventIdRef.current !== capturedEventId) return;
      setContacts((prev) => [...prev, created]);
    } catch (err) {
      addToast("Failed to add contact.", "error");
      throw err;
    }
  }, [event.id, addToast]);

  const handleUpdateContact = useCallback(async (id: string, data: Parameters<typeof updateEventContact>[2]) => {
    const capturedEventId = event.id;
    try {
      const updated = await updateEventContact(capturedEventId, id, data);
      if (currentEventIdRef.current !== capturedEventId) return;
      setContacts((prev) => prev.map((c) => (c.id === id ? updated : c)));
    } catch (err) {
      addToast("Failed to update contact.", "error");
      throw err;
    }
  }, [event.id, addToast]);

  const handleDeleteContact = useCallback(async (id: string) => {
    const capturedEventId = event.id;
    try {
      await deleteEventContact(capturedEventId, id);
      if (currentEventIdRef.current !== capturedEventId) return;
      setContacts((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      addToast("Failed to delete contact.", "error");
      throw err;
    }
  }, [event.id, addToast]);

  const handleAddResource = useCallback(async (data: Parameters<typeof createEventResource>[1]) => {
    const capturedEventId = event.id;
    try {
      const created = await createEventResource(capturedEventId, data);
      if (currentEventIdRef.current !== capturedEventId) return;
      setResources((prev) => [...prev, created]);
    } catch (err) {
      addToast("Failed to add link.", "error");
      throw err;
    }
  }, [event.id, addToast]);

  const handleUpdateResource = useCallback(async (id: string, data: Parameters<typeof updateEventResource>[2]) => {
    const capturedEventId = event.id;
    try {
      const updated = await updateEventResource(capturedEventId, id, data);
      if (currentEventIdRef.current !== capturedEventId) return;
      setResources((prev) => prev.map((r) => (r.id === id ? updated : r)));
    } catch (err) {
      addToast("Failed to update link.", "error");
      throw err;
    }
  }, [event.id, addToast]);

  const handleDeleteResource = useCallback(async (id: string) => {
    const capturedEventId = event.id;
    try {
      await deleteEventResource(capturedEventId, id);
      if (currentEventIdRef.current !== capturedEventId) return;
      setResources((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      addToast("Failed to delete link.", "error");
      throw err;
    }
  }, [event.id, addToast]);

  useEffect(() => {
    abortRef.current?.abort();
    seenCheckinsRef.current.clear();
    if (reconcileTimerRef.current != null) {
      window.clearTimeout(reconcileTimerRef.current);
      reconcileTimerRef.current = null;
    }
    setLoading(true);
    statsErrorToastedRef.current = false;
    setOverview(null);
    setOptimisticAdmittedDelta(0);
    setRecentCheckins([]);
    setContacts([]);
    setResources([]);
    setPinnedNote(null);

    const load = () => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      fetchEventOverview(event.id, ac.signal)
        .then((data) => {
          if (ac.signal.aborted) return;
          absorbServerOverview(data);
          statsErrorToastedRef.current = false;
        })
        .catch((err) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          if (err instanceof ApiError) reportApiError(err.status);
          if (!statsErrorToastedRef.current) {
            addToast("Failed to load event stats.", "error");
            statsErrorToastedRef.current = true;
          }
        })
        .finally(() => {
          if (!ac.signal.aborted) setLoading(false);
        });
    };

    load();
    const intervalId = setInterval(load, OVERVIEW_REFRESH_MS);

    return () => {
      clearInterval(intervalId);
      abortRef.current?.abort();
      if (reconcileTimerRef.current != null) {
        window.clearTimeout(reconcileTimerRef.current);
        reconcileTimerRef.current = null;
      }
    };
  }, [absorbServerOverview, event.id, reportApiError, addToast]);

  const attendeeCount = currentOverview?.attendee_count ?? event.attendee_count ?? null;
  const admittedCount =
    currentOverview?.admitted_count != null
      ? currentOverview.admitted_count + optimisticAdmittedDelta
      : null;
  const admitPct =
    attendeeCount != null && admittedCount != null && attendeeCount > 0
      ? Math.round((admittedCount / attendeeCount) * 100)
      : null;
  const emailFailedTotal =
    currentOverview != null
      ? currentOverview.email_failed + currentOverview.email_bounced
      : 0;

  return (
    <div className="screen">
      <PageHeader
        title={event.title}
        subtitle={
          [formatEventCalendarDate(eventDateIso), event.location].filter(Boolean).join(" · ")
        }
        actions={event.archived_at ? <Badge variant="neutral">Archived · read-only</Badge> : undefined}
      />

      {event.archived_at && (
        <p className="overview-archived-note">
          Archived on {formatUtcDateTime(event.archived_at)}. Restore from event settings if you
          need to edit again.
        </p>
      )}

      <div className="overview-stats">
        <Card>
          <Stat
            label="Attendees"
            value={attendeeCount != null ? String(attendeeCount) : "—"}
            sub={
              currentOverview?.event.capacity != null
                ? `of ${currentOverview.event.capacity} capacity`
                : "Registered"
            }
          />
        </Card>
        <Card>
          <Stat
            label="Admitted"
            value={admittedCount != null ? String(admittedCount) : loading ? "…" : "—"}
            sub={admitPct != null ? `${admitPct}% admission rate` : "Check-in stats"}
          />
          {admittedCount != null && attendeeCount != null && attendeeCount > 0 && (
            <AdmissionBar admitted={admittedCount} total={attendeeCount} />
          )}
        </Card>
        <Card>
          <Stat
            label="Emails sent"
            value={currentOverview != null ? String(currentOverview.email_sent) : loading ? "…" : "—"}
            sub={
              currentOverview == null
                ? loading
                  ? "Loading…"
                  : "Unavailable"
                : emailFailedTotal > 0
                  ? `${emailFailedTotal} failed`
                  : currentOverview.email_queued > 0
                    ? `${currentOverview.email_queued} queued`
                    : "Delivered"
            }
          />
        </Card>
        <Card>
          <Stat
            label="Event date"
            value={countdown}
            sub={formatEventCalendarDate(eventDateIso)}
          />
        </Card>
      </div>

      <div className="overview-body">
        <div className="overview-body__left">
          {currentOverview != null ? (
            <NeedsAttentionCard overview={currentOverview} />
          ) : null}
          <EventReadinessCard overview={currentOverview} loading={loading} />
          <ImportantLinksCard
            resources={resources}
            loading={loading}
            archived={!!event.archived_at}
            onAdd={handleAddResource}
            onUpdate={handleUpdateResource}
            onDelete={handleDeleteResource}
          />
        </div>
        <div className="overview-body__right">
          <PinnedNoteCard
            note={pinnedNote}
            loading={loading}
            archived={!!event.archived_at}
            onSave={handleSaveNote}
          />
          <RecentCheckinsCard checkins={recentCheckins} timezone={eventTimezone} connected={streamConnected} />
          <KeyContactsCard
            contacts={contacts}
            loading={loading}
            archived={!!event.archived_at}
            onAdd={handleAddContact}
            onUpdate={handleUpdateContact}
            onDelete={handleDeleteContact}
          />
          <EventInfoCard overview={currentOverview} event={event} countdown={countdown} />
        </div>
      </div>
    </div>
  );
}
