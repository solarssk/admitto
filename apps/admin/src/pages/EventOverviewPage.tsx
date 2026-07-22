import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { Avatar, Badge, Button, Card, Input, PageHeader, Select, Stat, TICKET_TYPE_COLORS, useToast } from "@admitto/ui";
import {
  ApiError,
  fetchEventOverview,
  fetchTicketTypes,
  patchEventNote,
  createEventContact,
  updateEventContact,
  deleteEventContact,
  createEventResource,
  updateEventResource,
  deleteEventResource,
} from "../api/client.js";
import type {
  EventDto,
  EventOverviewDto,
  EventContactDto,
  EventRecentActivityEntry,
  EventResourceDto,
  TicketTypeDto,
} from "../api/types.js";
import {
  calendarDateInZone,
  formatEventCalendarDate,
  formatEventDate,
  formatEventDateTime,
  formatUtcDateTime,
} from "../utils/event-dates.js";
import { useConnectionState } from "../connection/ConnectionStateProvider.js";
import {
  isAdmitDedupHit,
  pruneAdmitDedupMap,
  registerAdmitDedup,
} from "../checkin/admitDedup.js";
import { useEventStream, type StreamCheckinEvent } from "../hooks/useEventStream.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { useModalFocusTrap } from "../components/useModalFocusTrap.js";
import { TicketTypeBadge } from "../attendees/ticketTypeBadge.js";
import { NO_AUTOFILL_PROPS } from "../settings/mailTransportFormParts.js";

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

/** Same http(s)-only rule the backend enforces (validateHttpUrl in @admitto/mail-templates) —
 * checked client-side first so an invalid URL surfaces a specific inline message (D3) instead of
 * the modal's generic save-failed toast. */
function isValidResourceUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/** Compact "N min/hours/days ago" for glance stats and the activity timeline — not a shared
 * export, mirrors the local helper StaffUserListItem.tsx already uses for the same purpose. */
function formatRelativeTime(iso: string | null): string {
  if (!iso) return "—";
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 60_000) return "Just now";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? "" : "s"} ago`;
}

/** "13:00" -> "13:00–14:00" for the check-in progress card's busiest-hour glance stat. */
function formatBusiestHourRange(hour: string): string {
  const [hh, mm = "00"] = hour.split(":");
  const h = Number(hh);
  if (!Number.isFinite(h)) return hour;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${mm}–${pad((h + 1) % 24)}:${mm}`;
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

interface ReadinessItem {
  label: string;
  status: "ok" | "warn" | "error" | "neutral";
  /** Explanatory sentence shown under the label for not-ok items — no reusable readiness widget
   * exists yet under Event settings (checked before building this), so this stays local. */
  detail: string;
}

/** Merges the former "Needs attention" + "Event readiness" cards into one compact checklist
 * (#348) — same readiness computation the old EventReadinessCard used, just surfaced as a short
 * "what still needs doing" list instead of two full-height cards. */
function SetupChecklistCard({
  overview,
  loading,
  eventId,
}: {
  overview: EventOverviewDto | null;
  loading: boolean;
  eventId: string;
}) {
  if (!overview) {
    return (
      <Card title="Setup checklist">
        <p className="overview-muted">{loading ? "Loading…" : "Unavailable"}</p>
      </Card>
    );
  }

  const failed = overview.email_failed + overview.email_bounced;

  const items: ReadinessItem[] = [
    {
      label: "Attendees imported",
      status: overview.attendee_count > 0 ? "ok" : "warn",
      detail:
        overview.attendee_count > 0
          ? `${overview.attendee_count} attendee${overview.attendee_count === 1 ? "" : "s"} imported.`
          : "No attendees have been imported yet.",
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
      detail:
        overview.attendee_count === 0
          ? "Import attendees before sending tickets."
          : overview.attendees_with_ticket > 0
            ? `${overview.attendees_with_ticket} of ${overview.attendee_count} attendees have received their ticket.`
            : "No attendees have received their ticket yet.",
    },
    {
      label: "Delivery healthy",
      status: failed === 0 ? "ok" : "error",
      detail:
        failed === 0
          ? "No delivery failures."
          : `${failed} ticket email${failed === 1 ? "" : "s"} failed or bounced.`,
    },
    {
      label: "Check-in staff",
      status: overview.checkin_staff_count > 0 ? "ok" : "warn",
      detail:
        overview.checkin_staff_count > 0
          ? `${overview.checkin_staff_count} user${overview.checkin_staff_count > 1 ? "s" : ""} can perform check-in.`
          : "No staff can perform check-in yet.",
    },
    {
      label: "Event items",
      status: "neutral",
      detail:
        overview.requirements_count > 0
          ? `${overview.requirements_count} configured.`
          : "None configured.",
    },
  ];

  const okCount = items.filter((i) => i.status === "ok").length;
  const total = items.filter((i) => i.status !== "neutral").length;
  // Errors before warnings so the most urgent item is never bumped off the top-3 by an earlier,
  // less pressing warning (mirrors the old Needs attention card's own priority order).
  const notOk = items
    .filter((i) => i.status === "warn" || i.status === "error")
    .sort((a, b) => (a.status === b.status ? 0 : a.status === "error" ? -1 : 1))
    .slice(0, 3);

  return (
    <Card
      title="Setup checklist"
      actions={
        <span className="overview-readiness-score">
          {okCount}/{total}
        </span>
      }
    >
      {notOk.length === 0 ? (
        <p className="overview-muted overview-all-clear">
          <i className="ti ti-circle-check" aria-hidden="true" />
          All checks look good
        </p>
      ) : (
        <div className="overview-checklist">
          {notOk.map((item) => (
            <div key={item.label} className="overview-readiness-item">
              <span className={`status-circle status-circle--${item.status}`} aria-hidden="true">
                {item.status === "error" ? (
                  <i className="ti ti-x" aria-hidden="true" />
                ) : (
                  <i className="ti ti-alert-triangle" aria-hidden="true" />
                )}
              </span>
              <div className="overview-readiness-item__body">
                <strong>{item.label}</strong>
                <span className="overview-readiness-item__detail">{item.detail}</span>
              </div>
            </div>
          ))}
        </div>
      )}
      <Link to={`/admin/events/${eventId}/settings?tab=general`} className="overview-checklist__link">
        View full checklist in Event settings <i className="ti ti-arrow-right" aria-hidden="true" />
      </Link>
    </Card>
  );
}

/** Check-in progress card (new, Part B): admission ring, ticket-type breakdown, and two glance
 * stats — the ring uses a real conic-gradient over --status-ok / --surface-sunken rather than an
 * SVG/canvas dependency. */
function CheckInProgressCard({
  overview,
  loading,
}: {
  overview: EventOverviewDto | null;
  loading: boolean;
}) {
  if (!overview) {
    return (
      <Card title="Check-in progress">
        <p className="overview-muted">{loading ? "Loading…" : "Unavailable"}</p>
      </Card>
    );
  }

  const total = overview.attendee_count;
  const admitted = Math.min(overview.admitted_count, total);
  const notYet = Math.max(total - admitted, 0);
  const pct = total > 0 ? Math.round((admitted / total) * 100) : 0;
  const breakdown = overview.ticket_type_breakdown.filter((t) => t.count > 0);
  const breakdownTotal = breakdown.reduce((sum, t) => sum + t.count, 0);

  return (
    <Card title="Check-in progress">
      <div className="overview-progress">
        <div
          className="overview-ring"
          style={{
            background: `conic-gradient(var(--status-ok) 0% ${pct}%, var(--surface-sunken) ${pct}% 100%)`,
          }}
          role="img"
          aria-label={`${pct}% of attendees checked in`}
        >
          <div className="overview-ring__hole">
            <span className="overview-ring__pct">{pct}%</span>
          </div>
        </div>
        <div className="overview-progress__legend">
          <div className="overview-progress__legend-item">
            <span className="overview-progress__legend-dot" style={{ background: "var(--status-ok)" }} />
            Checked in <strong>{admitted}</strong>
          </div>
          <div className="overview-progress__legend-item">
            <span className="overview-progress__legend-dot" style={{ background: "var(--surface-sunken)" }} />
            Not yet <strong>{notYet}</strong>
          </div>
        </div>
      </div>

      {breakdown.length > 1 && (
        <div className="overview-tt-breakdown">
          <span className="overline">By ticket type</span>
          <div className="overview-tt-bar">
            {breakdown.map((t) => (
              <span
                key={t.key}
                className="overview-tt-bar__seg"
                style={{
                  width: `${breakdownTotal > 0 ? (t.count / breakdownTotal) * 100 : 0}%`,
                  background: (TICKET_TYPE_COLORS[t.color] ?? TICKET_TYPE_COLORS.gray).solid,
                }}
              />
            ))}
          </div>
          <div className="overview-tt-legend">
            {breakdown.map((t) => (
              <span key={t.key} className="overview-tt-legend__item">
                <span
                  className="overview-tt-legend__dot"
                  style={{ background: (TICKET_TYPE_COLORS[t.color] ?? TICKET_TYPE_COLORS.gray).solid }}
                />
                {t.label} <span className="overview-tt-legend__count">{t.count}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="overview-glance">
        <div className="overview-glance__tile">
          <span className="overview-glance__label">
            <i className="ti ti-clock" aria-hidden="true" /> Last check-in
          </span>
          <span className="overview-glance__value">{formatRelativeTime(overview.last_check_in_at)}</span>
        </div>
        <div className="overview-glance__tile">
          <span className="overview-glance__label">
            <i className="ti ti-trending-up" aria-hidden="true" /> Busiest hour
          </span>
          <span className="overview-glance__value">
            {overview.busiest_hour ? formatBusiestHourRange(overview.busiest_hour.hour) : "—"}
          </span>
        </div>
      </div>
    </Card>
  );
}

/** A `recent_activity` row, plus the optional client-only ticket type key SSE carries — present
 * only on entries built locally from a live check-in (see mergeActivity) before the next overview
 * poll/reconcile replaces it with the server's own (badge-less) copy of the same event. */
interface DisplayActivityEntry extends EventRecentActivityEntry {
  ticketType?: string | null;
}

const ACTIVITY_ICONS: Record<EventRecentActivityEntry["type"], string> = {
  checkin: "ti-user-check",
  mail_bounced: "ti-mail-x",
  mail_failed: "ti-mail-x",
  mail_resent: "ti-mail-forward",
  import: "ti-upload",
};

function ActivityIcon({ entry }: { entry: DisplayActivityEntry }) {
  if (entry.type === "checkin") {
    return <Avatar name={entry.attendee_name ?? "?"} size="sm" />;
  }
  return (
    <span className={`status-circle status-circle--sm status-circle--${entry.tone}`} aria-hidden="true">
      <i className={`ti ${ACTIVITY_ICONS[entry.type]}`} />
    </span>
  );
}

/** Live SSE check-ins reshaped to look like a `recent_activity` row so they can render in the
 * same timeline immediately, ahead of the next overview poll (#373). */
function liveCheckinsAsActivity(checkins: StreamCheckinEvent[]): DisplayActivityEntry[] {
  return checkins.map((c) => ({
    id: `live-checkin:${c.attendeeId}-${c.admittedAt}`,
    type: "checkin",
    tone: "ok",
    attendee_name: c.attendeeName,
    attendee_id: c.attendeeId,
    message: "checked in",
    occurred_at: c.admittedAt,
    ticketType: c.ticketType,
  }));
}

/** Prepends not-yet-reconciled live check-ins ahead of the server's own feed, without duplicating
 * one once the next overview poll/reconcile brings the same check-in back as a server row —
 * matched on attendee name + timestamp since `recent_activity` doesn't carry an attendee id. */
function mergeActivity(
  server: EventRecentActivityEntry[],
  liveCheckins: StreamCheckinEvent[],
): DisplayActivityEntry[] {
  const seen = new Set(
    server
      .filter((e) => e.type === "checkin")
      .map((e) => `${e.attendee_name ?? ""}|${e.occurred_at}`),
  );
  const live = liveCheckinsAsActivity(liveCheckins).filter(
    (e) => !seen.has(`${e.attendee_name ?? ""}|${e.occurred_at}`),
  );
  return [...live, ...server];
}

function activityDayLabel(iso: string, timezone: string): string {
  const day = calendarDateInZone(iso, timezone);
  const today = calendarDateInZone(new Date().toISOString(), timezone);
  if (day === today) return "Today";
  const [y, m, d] = today.split("-").map(Number);
  const yesterday = new Date(Date.UTC(y!, m! - 1, d! - 1)).toISOString().slice(0, 10);
  if (day === yesterday) return "Yesterday";
  return formatEventDate(iso, timezone);
}

/** Groups an already newest-first list into contiguous same-day runs (Today/Yesterday/date). */
function groupActivityByDay(
  entries: DisplayActivityEntry[],
  timezone: string,
): Array<{ key: string; label: string; items: DisplayActivityEntry[] }> {
  const groups: Array<{ key: string; label: string; items: DisplayActivityEntry[] }> = [];
  for (const entry of entries) {
    const key = calendarDateInZone(entry.occurred_at, timezone);
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.items.push(entry);
    } else {
      groups.push({ key, label: activityDayLabel(entry.occurred_at, timezone), items: [entry] });
    }
  }
  return groups;
}

type ActivityFilter = "all" | "issues";

/** Recent activity card (replaces "Recent check-ins", #373 + Part B): a day-grouped timeline of
 * check-ins, mail failures/bounces, and imports, with an All/Issues filter. */
function RecentActivityCard({
  eventId,
  activity,
  liveCheckins,
  ticketTypes,
  timezone,
  connected,
}: {
  eventId: string;
  activity: EventRecentActivityEntry[];
  liveCheckins: StreamCheckinEvent[];
  ticketTypes: TicketTypeDto[];
  timezone: string;
  connected: boolean;
}) {
  const [filter, setFilter] = useState<ActivityFilter>("all");

  const merged = useMemo(() => mergeActivity(activity, liveCheckins), [activity, liveCheckins]);
  const filtered =
    filter === "issues" ? merged.filter((e) => e.tone === "warn" || e.tone === "error") : merged;
  const groups = useMemo(() => groupActivityByDay(filtered, timezone), [filtered, timezone]);

  return (
    <Card
      title="Recent activity"
      actions={
        <>
          <div className="overview-activity-filter" role="group" aria-label="Filter activity">
            <Button
              type="button"
              variant={filter === "all" ? "secondary" : "ghost"}
              size="sm"
              aria-pressed={filter === "all"}
              onClick={() => setFilter("all")}
            >
              All
            </Button>
            <Button
              type="button"
              variant={filter === "issues" ? "secondary" : "ghost"}
              size="sm"
              aria-pressed={filter === "issues"}
              onClick={() => setFilter("issues")}
            >
              Issues
            </Button>
          </div>
          {connected && (
            <span className="overview-live-badge">
              <span className="overview-live-dot" aria-hidden="true" />
              live
            </span>
          )}
        </>
      }
    >
      {filtered.length === 0 ? (
        <p className="overview-muted">
          {filter === "issues"
            ? "No issues — everything's running smoothly."
            : "No activity yet — check-ins, mail, and imports will appear here."}
        </p>
      ) : (
        <div className="overview-timeline">
          {groups.map((group) => (
            <div key={group.key} className="overview-timeline__group">
              <div className="overview-timeline__day">{group.label}</div>
              <ul className="overview-activity">
                {group.items.map((entry) => (
                  <li key={entry.id} className="overview-activity__item">
                    <ActivityIcon entry={entry} />
                    <div className="overview-activity__info">
                      {entry.attendee_name ? (
                        <>
                          {entry.attendee_id ? (
                            <Link
                              to={`/admin/events/${eventId}/attendees/${entry.attendee_id}`}
                              className="overview-activity__attendee-link"
                            >
                              <strong>{entry.attendee_name}</strong>
                            </Link>
                          ) : (
                            <strong>{entry.attendee_name}</strong>
                          )}
                          <span>
                            {entry.message}
                            {entry.ticketType !== undefined && (
                              <TicketTypeBadge ticketType={entry.ticketType} catalog={ticketTypes} />
                            )}
                          </span>
                        </>
                      ) : (
                        <strong>{entry.message}</strong>
                      )}
                    </div>
                    <time
                      className="overview-activity__time"
                      dateTime={entry.occurred_at}
                      title={formatEventDateTime(entry.occurred_at, timezone)}
                    >
                      {formatRelativeTime(entry.occurred_at)}
                    </time>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/** One labeled sub-section inside `NotesAndContactsCard` — an `.overline` heading plus optional
 * header action, replacing what used to be its own `<Card title=…>`. */
function NotesSection({
  label,
  action,
  children,
}: {
  label: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="overview-notes-section">
      <div className="overview-notes-section__header">
        <span className="overline">{label}</span>
        {action}
      </div>
      {children}
    </div>
  );
}

/** Shared modal shell for the three Notes & contacts add/edit forms (pinned note, contact,
 * resource) — same dialog/backdrop/panel structure and `useModalFocusTrap` other admin modals
 * use (e.g. `NoteModal`, `EventCustomFieldModal`), just scoped to this page instead of a new
 * shared component. Add and edit for a given entity render through the same instance, so the
 * two modes can never drift apart in width/layout — only the field values and submit label
 * differ (fixes the PO's add-vs-edit width mismatch). */
function OverviewModal({
  titleId,
  title,
  onClose,
  footer,
  children,
}: {
  titleId: string;
  title: string;
  onClose: () => void;
  footer: ReactNode;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(panelRef, true, onClose);

  return (
    <div className="overview-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="overview-modal__backdrop" role="presentation" onClick={onClose} />
      <div ref={panelRef} className="overview-modal__panel">
        <h2 id={titleId} className="overview-modal__title">
          {title}
        </h2>
        <div className="overview-modal__body">{children}</div>
        <div className="overview-modal__footer">{footer}</div>
      </div>
    </div>
  );
}

function PinnedNoteModal({
  note,
  onClose,
  onSave,
}: {
  note: string | null;
  onClose: () => void;
  onSave: (note: string | null) => Promise<void>;
}) {
  const titleId = useId();
  const [draft, setDraft] = useState(note ?? "");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(draft.trim() || null);
      onClose();
    } catch {
      // onSave already surfaced the error via toast; keep the modal open so staff can retry.
    } finally {
      setSaving(false);
    }
  };

  return (
    <OverviewModal
      titleId={titleId}
      title={note ? "Edit pinned note" : "Add pinned note"}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" variant="primary" onClick={() => void handleSave()} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <textarea
        className="overview-note-textarea"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Short operational note visible to all staff…"
        rows={4}
        autoFocus
      />
    </OverviewModal>
  );
}

function ContactModal({
  contact,
  onClose,
  onAdd,
  onUpdate,
}: {
  contact: EventContactDto | null;
  onClose: () => void;
  onAdd: (data: { name: string; role?: string | null; phone?: string | null; email?: string | null }) => Promise<void>;
  onUpdate: (id: string, data: { name: string; role?: string | null; phone?: string | null; email?: string | null }) => Promise<void>;
}) {
  const titleId = useId();
  const [form, setForm] = useState({
    name: contact?.name ?? "",
    role: contact?.role ?? "",
    phone: contact?.phone ?? "",
    email: contact?.email ?? "",
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!form.name.trim() || saving) return;
    setSaving(true);
    try {
      const data = {
        name: form.name.trim(),
        role: form.role.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
      };
      if (contact) {
        await onUpdate(contact.id, data);
      } else {
        await onAdd(data);
      }
      onClose();
    } catch {
      // onAdd/onUpdate already surfaced the error via toast; keep the modal open so staff can retry.
    } finally {
      setSaving(false);
    }
  };

  return (
    <OverviewModal
      titleId={titleId}
      title={contact ? "Edit contact" : "Add contact"}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={() => void handleSubmit()}
            disabled={saving || !form.name.trim()}
          >
            {saving ? "Saving…" : contact ? "Save" : "Add"}
          </Button>
        </>
      }
    >
      <Input
        label="Name *"
        icon={<i className="ti ti-user" aria-hidden="true" />}
        value={form.name}
        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        autoFocus
      />
      <Input
        label="Role"
        icon={<i className="ti ti-briefcase" aria-hidden="true" />}
        value={form.role}
        onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
      />
      <Input
        label="Phone"
        icon={<i className="ti ti-phone" aria-hidden="true" />}
        value={form.phone}
        onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
      />
      <Input
        label="Email"
        type="email"
        icon={<i className="ti ti-mail" aria-hidden="true" />}
        value={form.email}
        onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
        // Suppresses password-manager / iCloud "Hide My Email" autofill suggestions on this
        // non-auth contact field — same opt-out combination as mailTransportFormParts.tsx's other
        // non-auth email inputs; full suppression isn't guaranteed in every browser.
        {...NO_AUTOFILL_PROPS}
        name="event-contact-email"
      />
    </OverviewModal>
  );
}

function ResourceModal({
  resource,
  onClose,
  onAdd,
  onUpdate,
}: {
  resource: EventResourceDto | null;
  onClose: () => void;
  onAdd: (data: { title: string; type: "link" | "file"; url: string; description?: string | null }) => Promise<void>;
  onUpdate: (id: string, data: { title: string; type: "link" | "file"; url: string; description?: string | null }) => Promise<void>;
}) {
  const titleId = useId();
  const [form, setForm] = useState({
    title: resource?.title ?? "",
    type: resource?.type ?? ("link" as "link" | "file"),
    url: resource?.url ?? "",
    description: resource?.description ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!form.title.trim() || !form.url.trim() || saving) return;
    const trimmedUrl = form.url.trim();
    if (!isValidResourceUrl(trimmedUrl)) {
      setUrlError("Enter a valid URL starting with http:// or https://");
      return;
    }
    setSaving(true);
    try {
      const data = {
        title: form.title.trim(),
        type: form.type,
        url: trimmedUrl,
        description: form.description.trim() || null,
      };
      if (resource) {
        await onUpdate(resource.id, data);
      } else {
        await onAdd(data);
      }
      onClose();
    } catch {
      // onAdd/onUpdate already surfaced the error via toast; keep the modal open so staff can retry.
    } finally {
      setSaving(false);
    }
  };

  return (
    <OverviewModal
      titleId={titleId}
      title={resource ? "Edit link or file" : "Add link or file"}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={() => void handleSubmit()}
            disabled={saving || !form.title.trim() || !form.url.trim()}
          >
            {saving ? "Saving…" : resource ? "Save" : "Add"}
          </Button>
        </>
      }
    >
      <Input
        label="Title *"
        icon={<i className="ti ti-heading" aria-hidden="true" />}
        value={form.title}
        onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
        autoFocus
      />
      <Select
        label="Type"
        className="overview-resource-modal__type"
        value={form.type}
        onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as "link" | "file" }))}
      >
        <option value="link">Link</option>
        <option value="file">File</option>
      </Select>
      <Input
        label="URL *"
        icon={<i className="ti ti-link" aria-hidden="true" />}
        value={form.url}
        error={urlError ?? undefined}
        onChange={(e) => {
          setForm((f) => ({ ...f, url: e.target.value }));
          setUrlError(null);
        }}
      />
      <Input
        label="Description"
        icon={<i className="ti ti-file-text" aria-hidden="true" />}
        value={form.description}
        onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
      />
    </OverviewModal>
  );
}

function PinnedNoteSection({
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
  const [modalOpen, setModalOpen] = useState(false);

  // The pin icon renders in both the empty and filled states (previously filled-only), so the
  // header's icon+label never shifts when a note is added or cleared (PO: "headers move").
  const label = (
    <>
      <i className="ti ti-pin overview-notes-section__icon overview-pinned-note__pin" aria-hidden="true" /> Pinned note
    </>
  );

  let body: ReactNode;
  if (note) {
    body = <p className="overview-pinned-note__body">{note}</p>;
  } else if (loading) {
    body = <p className="overview-muted">Loading…</p>;
  } else if (archived) {
    body = <p className="overview-muted">No operational note.</p>;
  } else {
    body = (
      <button type="button" className="overview-note-empty" onClick={() => setModalOpen(true)}>
        <i className="ti ti-plus" aria-hidden="true" />
        Add a pinned note for staff
      </button>
    );
  }

  return (
    <>
      <NotesSection
        label={label}
        action={
          // Unchanged from before: the Edit button only ever appears once a note exists — adding
          // the first note is now triggered by the empty-state box above instead of a header action.
          note && !archived ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon={<i className="ti ti-pencil" aria-hidden="true" />}
              onClick={() => setModalOpen(true)}
              aria-label="Edit pinned note"
            >
              Edit
            </Button>
          ) : undefined
        }
      >
        {body}
      </NotesSection>
      {modalOpen && <PinnedNoteModal note={note} onClose={() => setModalOpen(false)} onSave={onSave} />}
    </>
  );
}

function KeyContactsSection({
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
  const [modalTarget, setModalTarget] = useState<"add" | EventContactDto | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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

  return (
    <NotesSection
      label={
        <>
          <i className="ti ti-address-book overview-notes-section__icon" aria-hidden="true" /> Key contacts
        </>
      }
      action={
        !archived ? (
          <Button type="button" variant="ghost" size="sm" icon={<i className="ti ti-plus" aria-hidden="true" />} onClick={() => setModalTarget("add")}>
            Add
          </Button>
        ) : undefined
      }
    >
      {contacts.length === 0 ? (
        <p className="overview-muted">{loading ? "Loading…" : "No contacts yet."}</p>
      ) : (
        <ul className="overview-contacts">
          {contacts.map((contact) => (
            <li key={contact.id} className="overview-contact">
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
                    <button className="overview-contact__action" onClick={() => setModalTarget(contact)} aria-label={`Edit ${contact.name}`}>
                      <i className="ti ti-pencil" aria-hidden="true" />
                    </button>
                    <button className="overview-contact__action overview-contact__action--delete" onClick={() => { setDeleteError(null); setConfirmDeleteId(contact.id); }} aria-label={`Delete ${contact.name}`}>
                      <i className="ti ti-trash" aria-hidden="true" />
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {modalTarget && (
        <ContactModal
          contact={modalTarget === "add" ? null : modalTarget}
          onClose={() => setModalTarget(null)}
          onAdd={onAdd}
          onUpdate={onUpdate}
        />
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
    </NotesSection>
  );
}

function LinksFilesSection({
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
  const [modalTarget, setModalTarget] = useState<"add" | EventResourceDto | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const visible = showAll ? resources : resources.slice(0, PREVIEW_MAX);
  const hiddenCount = resources.length - PREVIEW_MAX;

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

  return (
    <NotesSection
      label={
        <>
          <i className="ti ti-paperclip overview-notes-section__icon" aria-hidden="true" /> Links & files
        </>
      }
      action={
        !archived ? (
          <Button type="button" variant="ghost" size="sm" icon={<i className="ti ti-plus" aria-hidden="true" />} onClick={() => setModalTarget("add")}>
            Add
          </Button>
        ) : undefined
      }
    >
      {resources.length === 0 ? (
        <p className="overview-muted">{loading ? "Loading…" : "No links or files yet."}</p>
      ) : (
        <>
          <ul className="overview-resources">
            {visible.map((r) => (
              <li key={r.id} className="overview-resource">
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
                    <button className="overview-contact__action" onClick={() => setModalTarget(r)} aria-label={`Edit ${r.title}`}>
                      <i className="ti ti-pencil" aria-hidden="true" />
                    </button>
                    <button className="overview-contact__action overview-contact__action--delete" onClick={() => { setDeleteError(null); setConfirmDeleteId(r.id); }} aria-label={`Delete ${r.title}`}>
                      <i className="ti ti-trash" aria-hidden="true" />
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {!showAll && hiddenCount > 0 && (
            <button className="overview-resources__show-more" onClick={() => setShowAll(true)}>
              View all resources ({hiddenCount} more)
            </button>
          )}
        </>
      )}
      {modalTarget && (
        <ResourceModal
          resource={modalTarget === "add" ? null : modalTarget}
          onClose={() => setModalTarget(null)}
          onAdd={onAdd}
          onUpdate={onUpdate}
        />
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
    </NotesSection>
  );
}

/** Merges the former Pinned note / Key contacts / Important links & files cards (#344, #345,
 * #346) into one Card with three labeled sub-sections, matching the mockup's Overview layout —
 * only the outer wrapping changed, each section keeps its own state/handlers/rows untouched. */
function NotesAndContactsCard(props: {
  pinnedNote: string | null;
  loading: boolean;
  archived: boolean;
  onSaveNote: (note: string | null) => Promise<void>;
  contacts: EventContactDto[];
  onAddContact: (data: { name: string; role?: string | null; phone?: string | null; email?: string | null }) => Promise<void>;
  onUpdateContact: (id: string, data: { name: string; role?: string | null; phone?: string | null; email?: string | null }) => Promise<void>;
  onDeleteContact: (id: string) => Promise<void>;
  resources: EventResourceDto[];
  onAddResource: (data: { title: string; type: "link" | "file"; url: string; description?: string | null }) => Promise<void>;
  onUpdateResource: (id: string, data: { title: string; type: "link" | "file"; url: string; description?: string | null }) => Promise<void>;
  onDeleteResource: (id: string) => Promise<void>;
}) {
  return (
    <Card title="Notes & contacts">
      <PinnedNoteSection
        note={props.pinnedNote}
        loading={props.loading}
        archived={props.archived}
        onSave={props.onSaveNote}
      />
      <KeyContactsSection
        contacts={props.contacts}
        loading={props.loading}
        archived={props.archived}
        onAdd={props.onAddContact}
        onUpdate={props.onUpdateContact}
        onDelete={props.onDeleteContact}
      />
      <LinksFilesSection
        resources={props.resources}
        loading={props.loading}
        archived={props.archived}
        onAdd={props.onAddResource}
        onUpdate={props.onUpdateResource}
        onDelete={props.onDeleteResource}
      />
    </Card>
  );
}

/** Event-scoped dashboard — event command center with KPIs, a setup checklist, check-in progress,
 * and a live activity feed. */
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
  const [ticketTypes, setTicketTypes] = useState<TicketTypeDto[]>([]);

  // Independent of the overview polling below — the live SSE checkin payload only carries the
  // ticket_type catalog key (see checkin-sse-publish.ts), so the page needs its own catalog fetch
  // to resolve it to a label/color for the activity feed's not-yet-reconciled live rows, same
  // convention as CheckInPage/AttendeesPage.
  useEffect(() => {
    const ac = new AbortController();
    fetchTicketTypes(event.id, ac.signal)
      .then((types) => {
        if (ac.signal.aborted) return;
        setTicketTypes(types);
      })
      .catch(() => {
        if (!ac.signal.aborted) setTicketTypes([]);
      });
    return () => ac.abort();
  }, [event.id]);

  const currentOverview = overview?.event.id === event.id ? overview : null;
  const eventTimezone = currentOverview?.event.timezone ?? event.timezone;
  const eventDateIso = currentOverview?.event.date ?? event.date;

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
            icon={<i className="ti ti-users" aria-hidden="true" />}
            label="Attendees"
            // No raw event.attendee_count fallback here on purpose (#374) — that picker total
            // includes revoked attendees, so falling back to it flashed a higher number (e.g.
            // 5 -> 4) the instant the real active-only overview count arrived.
            value={currentOverview != null ? String(currentOverview.attendee_count) : loading ? "…" : "—"}
            sub={
              currentOverview?.event.capacity != null
                ? `of ${currentOverview.event.capacity} capacity`
                : "Active"
            }
          />
        </Card>
        <Card>
          <Stat
            icon={<i className="ti ti-mail-check" aria-hidden="true" />}
            label="Tickets sent"
            value={currentOverview != null ? String(currentOverview.email_sent) : loading ? "…" : "—"}
            sub={
              currentOverview == null
                ? loading
                  ? "Loading…"
                  : "Unavailable"
                : currentOverview.email_queued > 0
                  ? `${currentOverview.email_queued} queued`
                  : "Delivered"
            }
          />
        </Card>
        <Card>
          <Stat
            icon={<i className="ti ti-user-check" aria-hidden="true" />}
            label="Checked in"
            value={admittedCount != null ? String(admittedCount) : loading ? "…" : "—"}
            sub={admitPct != null ? `${admitPct}% admission rate` : "Check-in stats"}
          />
          {admittedCount != null && attendeeCount != null && attendeeCount > 0 && (
            <AdmissionBar admitted={admittedCount} total={attendeeCount} />
          )}
        </Card>
        <Card>
          <Stat
            icon={<i className="ti ti-alert-triangle" aria-hidden="true" />}
            label="Failed delivery"
            value={currentOverview != null ? String(emailFailedTotal) : loading ? "…" : "—"}
            sub={
              currentOverview == null
                ? loading
                  ? "Loading…"
                  : "Unavailable"
                : emailFailedTotal > 0
                  ? "Needs attention"
                  : "No failures"
            }
          />
        </Card>
      </div>

      <div className="overview-body">
        <div className="overview-row">
          <CheckInProgressCard overview={currentOverview} loading={loading} />
          <RecentActivityCard
            eventId={event.id}
            activity={currentOverview?.recent_activity ?? []}
            liveCheckins={recentCheckins}
            ticketTypes={ticketTypes}
            timezone={eventTimezone}
            connected={streamConnected}
          />
        </div>
        <div className="overview-row">
          <SetupChecklistCard overview={currentOverview} loading={loading} eventId={event.id} />
          <NotesAndContactsCard
            pinnedNote={pinnedNote}
            loading={loading}
            archived={!!event.archived_at}
            onSaveNote={handleSaveNote}
            contacts={contacts}
            onAddContact={handleAddContact}
            onUpdateContact={handleUpdateContact}
            onDeleteContact={handleDeleteContact}
            resources={resources}
            onAddResource={handleAddResource}
            onUpdateResource={handleUpdateResource}
            onDeleteResource={handleDeleteResource}
          />
        </div>
      </div>
    </div>
  );
}
