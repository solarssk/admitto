import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useNavigate, useOutletContext, useParams } from "react-router-dom";
import {
  Button,
  Card,
  EmptyState,
  Input,
  PageHeader,
  resolveStatusMeta,
  Select,
  Skeleton,
  Tabs,
  Tooltip,
  useToast,
} from "@admitto/ui";
import {
  ApiError,
  deleteAttendee,
  fetchAttendeeDetail,
  fetchTicketTypes,
  resendTicket,
  revokeAttendeeCheckIn,
  updateAttendee,
  type EventFullMeta,
} from "../api/client.js";
import { hasApiErrorCode, operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { AttendeeDetailDto, EventDto, RsvpStatus, TicketTypeDto, UpdateAttendeePatch } from "../api/types.js";
import {
  loadAttendeeDetailData,
  mergeFormAfterReload,
  toAttendeeForm,
  type AttendeeFormState,
} from "../attendees/attendeeDetailForm.js";
import { formatAdmissionDisplay, formatEventDateTime } from "../utils/event-dates.js";
import {
  deriveAttendeeSource,
  getTimelineActor,
  getTimelineDetail,
  getTimelineIcon,
  getTimelineLabel,
  getTimelineTone,
  formatActivityTimestamp,
  humanizeFieldKey,
} from "../attendees/attendeeTimeline.js";
import { MailStatusBadge } from "../attendees/mailStatusBadge.js";
import { PassStatusBadge } from "../attendees/passStatusBadge.js";
import { RsvpStatusBadge } from "../attendees/rsvpStatusBadge.js";
import { TicketTypeBadge } from "../attendees/ticketTypeBadge.js";
import { CustomDataFieldInput } from "../attendees/CustomDataFieldInput.js";
import {
  allCustomDataEntries,
  readCustomDataField,
  validateCustomFieldsForm,
} from "../attendees/customData.js";
import type { CustomDataFieldDef } from "../attendees/customData.js";
import { useMailConfigured } from "../attendees/useMailConfigured.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import {
  ArchivedGuard,
  ARCHIVED_ACTION_TOOLTIP,
  isEventArchived,
  type ArchivedGuardEvent,
} from "../components/ArchivedGuard.js";
import { useModalFocusTrap } from "../components/useModalFocusTrap.js";
import { useDropdownMenu } from "../components/useDropdownMenu.js";
import { canRevokeCheckIn } from "../checkin/revokeEligibility.js";
import { NO_AUTOFILL_PROPS } from "../settings/mailTransportFormParts.js";
import { useAuth } from "../auth/AuthProvider.js";
import { isSuperadmin } from "../auth/capabilities.js";
import "../attendees/attendees.css";

type TabId = "overview" | "activity";

/** Single red "Revoke" entry point — opens a small menu for pass vs. check-in, each still confirmed via its own dialog. */
function RevokeActionMenu({
  canRevokeCheckIn,
  onRevokePass,
  onRevokeCheckIn,
  disabled = false,
  "aria-describedby": ariaDescribedBy,
}: Readonly<{
  canRevokeCheckIn: boolean;
  onRevokePass: () => void;
  onRevokeCheckIn: () => void;
  disabled?: boolean;
  "aria-describedby"?: string;
}>) {
  const { open, setOpen, rootRef, triggerRef, panelRef } = useDropdownMenu<HTMLButtonElement>();

  return (
    <div className="revoke-menu" ref={rootRef}>
      <Button
        ref={triggerRef}
        type="button"
        variant="danger"
        icon={<i className="ti ti-ban" aria-hidden="true" />}
        hasMenu
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        aria-describedby={ariaDescribedBy}
        onClick={() => setOpen((o) => !o)}
      >
        Revoke
      </Button>
      {open && (
        <div className="revoke-menu__panel" role="menu" ref={panelRef}>
          <button
            type="button"
            role="menuitem"
            className="revoke-menu__item"
            onClick={() => {
              setOpen(false);
              onRevokePass();
            }}
          >
            <i className="ti ti-wallet" aria-hidden="true" /> Pass
          </button>
          {canRevokeCheckIn && (
            <button
              type="button"
              role="menuitem"
              className="revoke-menu__item"
              onClick={() => {
                setOpen(false);
                onRevokeCheckIn();
              }}
            >
              <i className="ti ti-qrcode" aria-hidden="true" /> Check-in
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Secondary actions that don't need their own header button - today just Resend ticket, matching
 * the design mockup's "More actions" menu (which also groups actions this page doesn't have yet,
 * e.g. attendee removal, tracked separately by #356). The trigger's own `disabled` is the archived
 * lock (blocks the whole menu); "Resend ticket" additionally gets its own disabled+tooltip when
 * the event has no working mail transport - same check and copy as the Attendees list's "Send
 * tickets" button, but scoped to just this one item since future menu entries (e.g. #356) may
 * have nothing to do with mail. */
function MoreActionsMenu({
  event,
  onResend,
  onDelete,
  mailConfigured,
}: Readonly<{
  event: ArchivedGuardEvent;
  onResend: () => void;
  onDelete: () => void;
  mailConfigured: boolean | undefined;
}>) {
  const { open, setOpen, rootRef, triggerRef, panelRef } = useDropdownMenu<HTMLButtonElement>();

  return (
    <div className="more-actions-menu" ref={rootRef}>
      <Button
        ref={triggerRef}
        type="button"
        variant="secondary"
        icon={<i className="ti ti-dots-vertical" aria-hidden="true" />}
        hasMenu
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        More actions
      </Button>
      {open && (
        <div className="more-actions-menu__panel" role="menu" ref={panelRef}>
          <ArchivedGuard
            event={event}
            reasonId="resend-ticket-mail-reason"
            disabled={mailConfigured === false}
            tooltip={
              mailConfigured === false
                ? "No mail transport configured for this event. Set one up in Event Settings → Mailing."
                : undefined
            }
          >
            {(guard) => (
              <button
                type="button"
                role="menuitem"
                className="more-actions-menu__item"
                {...guard}
                onClick={() => {
                  setOpen(false);
                  onResend();
                }}
              >
                <i className="ti ti-send" aria-hidden="true" /> Resend ticket
              </button>
            )}
          </ArchivedGuard>
          <hr className="more-actions-menu__divider" />
          {/* Not ArchivedGuard'd, unlike Resend ticket above — GDPR erasure requests can
           * legally arrive after an event ends, and the DELETE endpoint itself doesn't block
           * on archived_at (see docs/DSAR-PROCEDURE.md). */}
          <button
            type="button"
            role="menuitem"
            className="more-actions-menu__item more-actions-menu__item--danger"
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
          >
            <i className="ti ti-trash" aria-hidden="true" /> Delete attendee
          </button>
        </div>
      )}
    </div>
  );
}

type ChipTone = "ok" | "warn" | "error" | "neutral";

function passStatusTone(status: string): ChipTone {
  if (status === "registered" || status === "confirmed") return "ok";
  if (status === "revoked") return "error";
  return "neutral";
}

function rsvpTone(status: RsvpStatus): ChipTone {
  if (status === "confirmed") return "ok";
  if (status === "declined" || status === "cancelled") return "error";
  if (status === "tentative") return "warn";
  return "neutral";
}

/** Clamped to this page's four chip tones - resolveStatusMeta's other badge variants
 * (info/confirmed/vip/primary) don't apply to any mail delivery status. */
function mailTone(status: string | null): ChipTone {
  if (!status) return "neutral";
  const variant = resolveStatusMeta(status).variant;
  return variant === "ok" || variant === "warn" || variant === "error" ? variant : "neutral";
}

function itemStateLabel(state: string): string {
  if (state === "issued") return "Issued";
  if (state === "returned") return "Returned";
  return "Not yet";
}

/** Icon background/color has three looks (pending/issued/returned); the status text
 * only distinguishes "done" (issued) from everything else - matches the design mockup's
 * .att-item-row__icon vs .att-item-row__status rules exactly, not a simplification. */
function itemIconModifier(state: string): "issued" | "returned" | "" {
  if (state === "issued") return "issued";
  if (state === "returned") return "returned";
  return "";
}

function itemStateTone(state: string): "ok" | "muted" {
  return state === "issued" ? "ok" : "muted";
}

/** Whether the edit form differs from the last-loaded/saved attendee (field-by-field, including
 * custom data) — extracted out of the component (SonarCloud S3776: keeps the comparison chain out
 * of the component's own cognitive-complexity count, the same way EventOverviewPage.tsx extracts
 * buildReadinessItems). */
function isAttendeeFormDirty(form: AttendeeFormState | null, baseline: AttendeeFormState | null): boolean {
  if (form === null || baseline === null) return false;
  return (
    form.name !== baseline.name ||
    form.email !== baseline.email ||
    form.company !== baseline.company ||
    form.department !== baseline.department ||
    form.ticket_type !== baseline.ticket_type ||
    form.rsvp_status !== baseline.rsvp_status ||
    JSON.stringify(form.customFields) !== JSON.stringify(baseline.customFields)
  );
}

/** A stored ticket_type with no matching catalog entry (type deleted after assignment, or legacy
 * pre-catalog data) has no <option> to bind to — surfaced as its own option instead of silently
 * falling back to the blank "—" option (fail-open, same philosophy as ticketTypeBadge.tsx's
 * catalog resolver). Extracted out of the component (SonarCloud S3776). */
function resolveOrphanedTicketType(ticketType: string, ticketTypes: TicketTypeDto[]): string | null {
  if (!ticketType) return null;
  return ticketTypes.some((type) => type.key === ticketType) ? null : ticketType;
}

/** Overview tab: read-only profile, additional info, wallet placeholder, event-day items, and
 * mail delivery history — extracted out of the component (SonarCloud S3776: keeps this tab's own
 * conditional rendering out of the component's cognitive-complexity count). */
function AttendeeOverviewTab({
  detail,
  ticketTypes,
  attendeeSource,
  customDataEntries,
  eventItems,
  event,
}: Readonly<{
  detail: AttendeeDetailDto;
  ticketTypes: TicketTypeDto[];
  attendeeSource: string | null;
  customDataEntries: Array<[string, string, string]>;
  eventItems: AttendeeDetailDto["event_items"];
  event: EventDto;
}>) {
  return (
    <div className="attendee-detail-grid">
      <div className="attendee-detail-main">
        <Card title="Profile" className="attendee-detail-profile">
          <div className="attendee-detail-readonly">
            <div className="attendee-detail-row">
              <span>Email</span>
              <span className="mono">{detail.email}</span>
            </div>
            <div className="attendee-detail-row">
              <span>Ticket type</span>
              <TicketTypeBadge ticketType={detail.ticket_type} catalog={ticketTypes} />
            </div>
            <div className="attendee-detail-row">
              <span>Company</span>
              <span>{detail.company ?? "—"}</span>
            </div>
            <div className="attendee-detail-row">
              <span>Department</span>
              <span>{detail.department ?? "—"}</span>
            </div>
            {attendeeSource && (
              <div className="attendee-detail-row">
                <span>Added via</span>
                <span>{attendeeSource}</span>
              </div>
            )}
            <div className="attendee-detail-row">
              <span>Registered on</span>
              <span className="mono">
                {formatEventDateTime(detail.created_at, detail.client_timezone ?? event.timezone)}
              </span>
            </div>
          </div>
        </Card>

        <Card title="Additional information">
          {customDataEntries.length === 0 ? (
            <EmptyState
              icon={<i className="ti ti-list-details" aria-hidden="true" />}
              title="No additional information"
              description="Custom fields will appear here once this attendee has some."
            />
          ) : (
            <div className="attendee-detail-readonly">
              {customDataEntries.map(([key, label, value]) => (
                <div className="attendee-detail-row" key={key}>
                  <span>{label}</span>
                  <span>{value}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Wallet">
          <EmptyState
            icon={<i className="ti ti-wallet" aria-hidden="true" />}
            title="Not added to a wallet"
            description="Apple Wallet and Google Wallet support isn't available yet."
          />
        </Card>
      </div>

      <div className="attendee-detail-side">
        <Card title="Event-day items">
          {eventItems.length === 0 ? (
            <EmptyState
              icon={<i className="ti ti-package" aria-hidden="true" />}
              title="No event-day items"
              description="This event has no hand-out items configured yet."
            />
          ) : (
            <ul className="attendee-items-list">
              {eventItems.map((item) => (
                <li className="attendee-items-row" key={item.key}>
                  <span
                    className={[
                      "attendee-items-row__icon",
                      itemIconModifier(item.state) &&
                        `attendee-items-row__icon--${itemIconModifier(item.state)}`,
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <i
                      className={`ti ti-${item.state === "issued" || item.state === "returned" ? "circle-check" : (item.icon ?? "package")}`}
                      aria-hidden="true"
                    />
                  </span>
                  <span className="attendee-items-row__label">{item.label}</span>
                  <span
                    className={`attendee-items-row__state attendee-items-row__state--${itemStateTone(item.state)}`}
                  >
                    {itemStateLabel(item.state)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Mail delivery history">
          {detail.deliveries.length === 0 ? (
            <EmptyState
              icon={<i className="ti ti-mail-off" aria-hidden="true" />}
              title="No delivery attempts yet"
              description="Ticket emails and resends will appear here once one is sent."
            />
          ) : (
            <ul className="attendee-deliveries">
              {detail.deliveries.map((delivery) => (
                <li className="attendee-delivery" key={delivery.id}>
                  <div className="attendee-delivery__subject">
                    {delivery.rendered_subject ?? "Ticket email"}
                  </div>
                  <div className="attendee-delivery__meta">
                    <MailStatusBadge status={delivery.status} />
                    <span className="mono">
                      {formatEventDateTime(
                        delivery.sent_at ?? delivery.accepted_at ?? delivery.queued_at,
                        delivery.client_timezone ?? event.timezone,
                      )}
                    </span>
                    {delivery.recipient_email && delivery.recipient_email !== detail.email && (
                      <span>to {delivery.recipient_email}</span>
                    )}
                  </div>
                  {delivery.error_code && (
                    <p className="attendee-delivery__error">{delivery.error_code}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

/** Activity tab: chronological action log — extracted out of the component (SonarCloud S3776:
 * keeps this tab's own conditional rendering out of the component's cognitive-complexity count). */
function AttendeeActivityTab({
  actionLog,
  attributeFields,
  eventItems,
  event,
}: Readonly<{
  actionLog: AttendeeDetailDto["action_log"];
  attributeFields: CustomDataFieldDef[];
  eventItems: AttendeeDetailDto["event_items"];
  event: EventDto;
}>) {
  return (
    <Card padded>
      {actionLog.length === 0 ? (
        <EmptyState
          icon={<i className="ti ti-history" aria-hidden="true" />}
          title="No activity yet"
          description="Events will appear here as you work with this attendee."
        />
      ) : (
        <ul className="at-timeline">
          {actionLog.map((entry) => {
            const detailText = getTimelineDetail(entry, attributeFields, eventItems);
            return (
              <li key={entry.id} className="at-tl-item">
                <div className={`at-tl-dot at-tl-dot--${getTimelineTone(entry)}`}>
                  <i className={`ti ti-${getTimelineIcon(entry.action_type)}`} aria-hidden="true" />
                </div>
                <div className="at-tl-body">
                  <b>{getTimelineLabel(entry)}</b>
                  {detailText && <span>{detailText}</span>}
                </div>
                <div className="at-tl-meta">
                  <time className="at-tl-time" dateTime={entry.created_at}>
                    {formatActivityTimestamp(entry.created_at, entry.client_timezone, event.timezone)}
                  </time>
                  <span className="at-tl-actor">
                    <i className="ti ti-user" aria-hidden="true" />
                    {getTimelineActor(entry)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** Event attendee detail: profile edit, pass revoke/restore, resend, and activity log. */
/** Diffs the edit form against the loaded attendee to build the PATCH body — top-level fields
 * plus any changed custom-data attributes — extracted out of handleSave (SonarCloud S3776). */
function buildAttendeePatch(
  form: AttendeeFormState,
  detail: AttendeeDetailDto,
  attributeFields: CustomDataFieldDef[],
): UpdateAttendeePatch {
  const patch: UpdateAttendeePatch = {};
  if (form.name !== detail.name) patch.name = form.name;
  if (form.email !== detail.email) patch.email = form.email;
  if (form.company !== (detail.company ?? "")) patch.company = form.company || null;
  if (form.department !== (detail.department ?? "")) patch.department = form.department || null;
  if (form.ticket_type !== (detail.ticket_type ?? "")) patch.ticket_type = form.ticket_type || null;
  if (form.rsvp_status !== detail.rsvp_status) patch.rsvp_status = form.rsvp_status;

  const customDataPatch: Record<string, string | null> = {};
  for (const field of attributeFields) {
    const key = field.source_field;
    const next = form.customFields[key] ?? "";
    const current = readCustomDataField(detail.custom_data, key) ?? "";
    if (next !== current) customDataPatch[key] = next || null;
  }
  if (Object.keys(customDataPatch).length > 0) patch.custom_data_fields = customDataPatch;

  return patch;
}

type SaveErrorOutcome =
  | { kind: "email_conflict" }
  | { kind: "stale_write" }
  | { kind: "message"; message: string };

/** Classifies a failed profile save into the UI action it should trigger — extracted out of
 * handleSave (SonarCloud S3776). */
function classifySaveError(err: unknown): SaveErrorOutcome {
  if (err instanceof ApiError && err.status === 409) {
    if (hasApiErrorCode(err, "email_conflict")) return { kind: "email_conflict" };
    if (hasApiErrorCode(err, "stale_write")) return { kind: "stale_write" };
    return { kind: "message", message: "Could not save changes." };
  }
  if (
    err instanceof ApiError &&
    err.status === 400 &&
    (hasApiErrorCode(err, "unknown_custom_data_field") ||
      hasApiErrorCode(err, "required_custom_data_field_missing") ||
      hasApiErrorCode(err, "validation_failed"))
  ) {
    return {
      kind: "message",
      message: hasApiErrorCode(err, "unknown_custom_data_field")
        ? "Event configuration changed — reload this page to edit attributes."
        : "Could not save attribute fields — check required values and options.",
    };
  }
  return { kind: "message", message: operatorApiErrorMessage(err, "Failed to save changes.") };
}

type PassStatusErrorOutcome =
  | { kind: "capacity"; eventFull: EventFullMeta }
  | { kind: "stale_write" }
  | { kind: "message"; message: string };

/** Next form value after a pass-status change lands — merges onto any in-progress edit, or falls
 * back to a fresh form when there's none to merge onto — extracted out of handlePassStatusChange
 * (SonarCloud S3776: keeps this nested branch out of its cognitive-complexity count). */
function nextFormAfterPassStatusChange(
  currentForm: AttendeeFormState | null,
  previousDetail: AttendeeDetailDto,
  updated: AttendeeDetailDto,
  attributeFields: CustomDataFieldDef[],
): AttendeeFormState {
  if (!currentForm) return toAttendeeForm(updated, attributeFields);
  return mergeFormAfterReload(currentForm, previousDetail, updated, attributeFields);
}

/** Classifies a failed pass status change into the UI action it should trigger — extracted out
 * of handlePassStatusChange (SonarCloud S3776). */
function classifyPassStatusError(err: unknown): PassStatusErrorOutcome {
  if (err instanceof ApiError && err.status === 409) {
    if (err.code === "event_full" && err.eventFull) return { kind: "capacity", eventFull: err.eventFull };
    if (err.code === "stale_write") return { kind: "stale_write" };
    return { kind: "message", message: "Could not update pass status." };
  }
  return { kind: "message", message: operatorApiErrorMessage(err, "Could not update pass status.") };
}

export function AttendeeDetailPage() {
  const { eventId, attendeeId } = useParams();
  const { event } = useOutletContext<{ event: EventDto }>();
  const { assignments } = useAuth();
  const superadmin = isSuperadmin(assignments);
  const navigate = useNavigate();
  const { addToast } = useToast();
  const resendTitleId = useId();
  const resendPanelRef = useRef<HTMLFormElement>(null);
  const editTitleId = useId();
  const editPanelRef = useRef<HTMLFormElement>(null);

  const [tab, setTab] = useState<TabId>("overview");
  const [detail, setDetail] = useState<AttendeeDetailDto | null>(null);
  const [attributeFields, setAttributeFields] = useState<CustomDataFieldDef[]>([]);
  const [ticketTypes, setTicketTypes] = useState<TicketTypeDto[]>([]);
  const [ticketTypesError, setTicketTypesError] = useState<string | null>(null);
  const [form, setForm] = useState<AttendeeFormState | null>(null);
  const [initialEmail, setInitialEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [itemsWarning, setItemsWarning] = useState<string | null>(null);
  const [emailConflict, setEmailConflict] = useState(false);
  const [staleWrite, setStaleWrite] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [resendOpen, setResendOpen] = useState(false);
  const [resendMode, setResendMode] = useState<"same" | "other">("same");
  const [resendEmail, setResendEmail] = useState("");
  const [resending, setResending] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  // Which action the pending discard-confirm resolves to: navigating back away from the page,
  // or just closing edit mode in place (#361) - same dialog, different consequence on confirm.
  const [discardIntent, setDiscardIntent] = useState<"back" | "cancel-edit">("back");
  const [editMode, setEditMode] = useState(false);
  // Which of the two "revoke" confirm flows is active — mutually exclusive
  // by construction, replacing six independent booleans that could
  // technically both be true at once (review finding).
  const [activeRevoke, setActiveRevoke] = useState<"pass" | "checkin" | null>(null);
  const [revokeBusy, setRevokeBusy] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [restoreCapacityBlocked, setRestoreCapacityBlocked] = useState<EventFullMeta | null>(null);
  const [restoreForceCapacity, setRestoreForceCapacity] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  /** Guards async handlers when route params change before a request completes. */
  const selectionRef = useRef({ eventId, attendeeId });
  selectionRef.current = { eventId, attendeeId };

  function isStillSelected(target: { eventId: string; attendeeId: string }): boolean {
    const current = selectionRef.current;
    return current.eventId === target.eventId && current.attendeeId === target.attendeeId;
  }

  const loadDetail = useCallback(async () => {
    if (!eventId || !attendeeId) return;
    const target = { eventId, attendeeId };
    setLoading(true);
    setError(null);
    setNotFound(false);
    setRestoreCapacityBlocked(null);
    setRestoreForceCapacity(false);
    setRevokeError(null);
    try {
      const { detail: d, attributeFields: fields, itemsWarning: warn } =
        await loadAttendeeDetailData(eventId, attendeeId);
      if (!isStillSelected(target)) return;
      setDetail(d);
      setAttributeFields(fields);
      setForm(toAttendeeForm(d, fields));
      setInitialEmail(d.email);
      setItemsWarning(warn);
      setStaleWrite(false);
      setEmailConflict(false);
    } catch (err) {
      if (!isStillSelected(target)) return;
      if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
        setNotFound(true);
      } else {
        setError(operatorApiErrorMessage(err, "Failed to load attendee."));
      }
    } finally {
      if (isStillSelected(target)) setLoading(false);
    }
  }, [eventId, attendeeId]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  const loadTicketTypes = useCallback(() => {
    if (!eventId || !attendeeId) return;
    const target = { eventId, attendeeId };
    setTicketTypes([]);
    setTicketTypesError(null);
    fetchTicketTypes(eventId)
      .then((types) => {
        if (!isStillSelected(target)) return;
        setTicketTypes(types);
      })
      .catch((err: unknown) => {
        if (!isStillSelected(target)) return;
        setTicketTypesError(operatorApiErrorMessage(err, "Failed to load ticket types."));
      });
  }, [eventId, attendeeId]);

  useEffect(() => {
    loadTicketTypes();
  }, [loadTicketTypes]);

  // Whether "Resend ticket" should work at all — same check as the Attendees list's "Send
  // tickets" button, shared via useMailConfigured.
  const mailConfigured = useMailConfigured(eventId);

  const baseline = detail != null ? toAttendeeForm(detail, attributeFields) : null;
  const isDirty = isAttendeeFormDirty(form, baseline);

  const goBack = () => {
    if (eventId) navigate(`/admin/events/${eventId}/attendees`);
    else navigate(-1);
  };

  const handleBack = () => {
    if (isDirty) {
      setDiscardIntent("back");
      setDiscardOpen(true);
    } else {
      goBack();
    }
  };

  async function handleDeleteConfirm() {
    if (!eventId || !attendeeId) return;
    const target = { eventId, attendeeId };
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteAttendee(eventId, attendeeId);
      if (!isStillSelected(target)) return;
      addToast("Attendee permanently deleted", "success");
      navigate(`/admin/events/${eventId}/attendees`);
    } catch (err) {
      if (!isStillSelected(target)) return;
      setDeleteError(operatorApiErrorMessage(err, "Delete failed"));
    } finally {
      if (isStillSelected(target)) setDeleting(false);
    }
  }

  function handleCancelEdit() {
    if (isDirty) {
      setDiscardIntent("cancel-edit");
      setDiscardOpen(true);
    } else {
      setEditMode(false);
      setError(null);
      setEmailConflict(false);
    }
  }

  useModalFocusTrap(resendPanelRef, resendOpen, () => setResendOpen(false));
  useModalFocusTrap(editPanelRef, editMode, handleCancelEdit);

  async function handleReload() {
    if (!eventId || !attendeeId) return;
    const target = { eventId, attendeeId };
    const previousDetail = detail;
    setReloading(true);
    setError(null);
    try {
      const { detail: d, attributeFields: fields, itemsWarning: warn } =
        await loadAttendeeDetailData(eventId, attendeeId);
      if (!isStillSelected(target)) return;
      setAttributeFields(fields);
      setForm((currentForm) => {
        if (!currentForm || !previousDetail) return toAttendeeForm(d, fields);
        return mergeFormAfterReload(currentForm, previousDetail, d, fields);
      });
      setDetail(d);
      setInitialEmail(d.email);
      setStaleWrite(false);
      setItemsWarning(warn);
    } catch (err) {
      if (!isStillSelected(target)) return;
      setError(operatorApiErrorMessage(err, "Failed to reload — please try again."));
    } finally {
      if (isStillSelected(target)) setReloading(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!eventId || !attendeeId || !detail || !form) return;

    const patch = buildAttendeePatch(form, detail, attributeFields);
    if (Object.keys(patch).length === 0) {
      setEditMode(false);
      setError(null);
      setEmailConflict(false);
      return;
    }

    const customValidation = validateCustomFieldsForm(attributeFields, form.customFields);
    if (customValidation) {
      setError(customValidation);
      return;
    }

    patch.expected_updated_at = detail.updated_at;
    const target = { eventId, attendeeId };
    setSaving(true);
    setEmailConflict(false);
    setError(null);
    try {
      const updated = await updateAttendee(eventId, attendeeId, patch);
      if (!isStillSelected(target)) return;
      setDetail(updated);
      setForm(toAttendeeForm(updated, attributeFields));
      setInitialEmail(updated.email);
      setStaleWrite(false);
      setEditMode(false);
      addToast("Profile saved", "success");
    } catch (err) {
      if (!isStillSelected(target)) return;
      const outcome = classifySaveError(err);
      if (outcome.kind === "email_conflict") {
        setEmailConflict(true);
      } else if (outcome.kind === "stale_write") {
        // Inline modal warning + Reload button only, no toast - same error, actionable
        // retry control already visible in the still-open modal (bot review, matches the
        // ConfirmDialog convention of not duplicating an actionable inline error as a toast).
        setStaleWrite(true);
        void handleReload();
      } else {
        setError(outcome.message);
      }
    } finally {
      if (isStillSelected(target)) setSaving(false);
    }
  }

  async function handleResend(e: React.FormEvent) {
    e.preventDefault();
    if (!eventId || !attendeeId || !detail) return;
    const target = { eventId, attendeeId };
    if (resendMode === "other" && !resendEmail.trim()) {
      setResendError("Enter an email address for the alternate recipient.");
      return;
    }
    setResending(true);
    setResendError(null);
    try {
      const body = resendMode === "other" ? { to: resendEmail.trim() } : {};
      const delivery = await resendTicket(eventId, attendeeId, body);
      if (!isStillSelected(target)) return;
      const refreshed = await fetchAttendeeDetail(eventId, attendeeId);
      if (!isStillSelected(target)) return;
      setDetail(refreshed);
      setResendOpen(false);
      addToast(
        delivery.status === "failed"
          ? `Resend queued but delivery failed (${delivery.error_code ?? "unknown"}).`
          : "Ticket resent successfully.",
        delivery.status === "failed" ? "warning" : "success",
      );
    } catch (err) {
      if (!isStillSelected(target)) return;
      setResendError(operatorApiErrorMessage(err, "Resend failed."));
    } finally {
      if (isStillSelected(target)) setResending(false);
    }
  }

  /** Revoke or restore wallet pass; preserves unsaved profile edits in the form. */
  async function handlePassStatusChange(
    nextStatus: "registered" | "revoked",
    opts?: { force?: boolean },
  ) {
    if (!eventId || !attendeeId || !detail || !form) return;
    const target = { eventId, attendeeId };
    const previousDetail = detail;
    setRevokeBusy(true);
    setRevokeError(null);
    try {
      const updated = await updateAttendee(
        eventId,
        attendeeId,
        {
          status: nextStatus,
          expected_updated_at: detail.updated_at,
        },
        { force: opts?.force },
      );
      if (!isStillSelected(target)) return;
      setDetail(updated);
      setForm((currentForm) =>
        nextFormAfterPassStatusChange(currentForm, previousDetail, updated, attributeFields),
      );
      setActiveRevoke(null);
      setRestoreCapacityBlocked(null);
      setRestoreForceCapacity(false);
      addToast(nextStatus === "revoked" ? "Pass revoked" : "Pass restored", "success");
    } catch (err) {
      if (!isStillSelected(target)) return;
      const outcome = classifyPassStatusError(err);
      if (outcome.kind === "capacity") {
        setRestoreCapacityBlocked(outcome.eventFull);
        const { current, capacity } = outcome.eventFull;
        setRevokeError(
          `Event is at capacity (${current}/${capacity}). Free a slot or increase capacity before restoring this pass.`,
        );
      } else if (outcome.kind === "stale_write") {
        addToast("Someone else updated this attendee — page will reload", "warning");
        void handleReload();
      } else {
        setRevokeError(outcome.message);
      }
    } finally {
      if (isStillSelected(target)) setRevokeBusy(false);
    }
  }

  /** Un-admits this attendee regardless of who checked them in or when — distinct from the operator-facing device-scoped undo on the Check-in page. */
  async function handleRevokeCheckIn() {
    if (!eventId || !attendeeId || !detail) return;
    const target = { eventId, attendeeId };
    setRevokeBusy(true);
    setRevokeError(null);
    try {
      await revokeAttendeeCheckIn(eventId, attendeeId);
      if (!isStillSelected(target)) return;
      await loadDetail();
      setActiveRevoke(null);
    } catch (err) {
      if (!isStillSelected(target)) return;
      setRevokeError(operatorApiErrorMessage(err, "Could not revoke check-in."));
    } finally {
      if (isStillSelected(target)) setRevokeBusy(false);
    }
  }

  if (!eventId || !attendeeId) return <p>Missing event or attendee.</p>;

  if (loading && !detail) {
    return (
      <div className="attendee-detail-page">
        <Skeleton variant="text" lines={2} />
        <Skeleton variant="rect" height={240} className="attendee-detail-skeleton" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="attendee-detail-page">
        <PageHeader title="Attendee not found" actions={<Button variant="secondary" onClick={goBack}>Back</Button>} />
        <p>The attendee could not be found or you do not have access.</p>
      </div>
    );
  }

  if (!detail || !form) {
    return (
      <div className="attendee-detail-page">
        <PageHeader title="Attendee" actions={<Button variant="secondary" onClick={goBack}>Back</Button>} />
        {error && <p className="text-error">{error}</p>}
      </div>
    );
  }

  const lastMail = detail.deliveries[0]?.status ?? null;
  const emailChanged = form.email !== initialEmail;
  const isRevoked = detail.status === "revoked";
  // A stored ticket_type with no matching catalog entry (type deleted after assignment, or
  // legacy pre-catalog data) has no <option> to bind to — the native <select> would otherwise
  // silently fall back to the blank "—" option while form.ticket_type still holds the orphaned
  // value, hiding it from the admin. Surface it as its own option instead (fail-open, same
  // philosophy as ticketTypeBadge.tsx's catalog resolver).
  const orphanedTicketType = resolveOrphanedTicketType(form.ticket_type, ticketTypes);
  const attendeeSource = deriveAttendeeSource(detail.action_log);
  const customDataEntries = allCustomDataEntries(detail.custom_data, attributeFields, humanizeFieldKey);
  // Falls back to [] against a stale API response missing this field (e.g. an apps/web dev
  // server running from before event_items was added - it doesn't hot-reload) instead of
  // crashing the whole page on detail.event_items.length.
  const eventItems = detail.event_items ?? [];

  return (
    <div className="attendee-detail-page">
      <PageHeader
        title={detail.name}
        subtitle="Manage this attendee's profile, ticket, and check-in status."
        actions={
          <>
            <ArchivedGuard event={event} reasonId="edit-profile-reason">
              {(guard) => (
                <Button
                  type="button"
                  variant="secondary"
                  icon={<i className="ti ti-pencil" aria-hidden="true" />}
                  {...guard}
                  onClick={() => setEditMode(true)}
                >
                  Edit
                </Button>
              )}
            </ArchivedGuard>
            {isRevoked ? (
              <ArchivedGuard
                event={event}
                reasonId="restore-pass-reason"
                disabled={revokeBusy}
              >
                {(guard) => (
                  <Button
                    variant="primary"
                    onClick={() =>
                      void handlePassStatusChange("registered", {
                        force: restoreForceCapacity && superadmin,
                      })
                    }
                    {...guard}
                  >
                    {revokeBusy ? "Restoring…" : "Restore pass"}
                  </Button>
                )}
              </ArchivedGuard>
            ) : (
              <ArchivedGuard event={event} reasonId="revoke-menu-reason">
                {(guard) => (
                  <RevokeActionMenu
                    canRevokeCheckIn={canRevokeCheckIn({
                      checkInStatus: detail.check_in_status,
                      blocked: isRevoked,
                    })}
                    onRevokePass={() => {
                      setRevokeError(null);
                      setActiveRevoke("pass");
                    }}
                    onRevokeCheckIn={() => {
                      setRevokeError(null);
                      setActiveRevoke("checkin");
                    }}
                    {...guard}
                  />
                )}
              </ArchivedGuard>
            )}
            <MoreActionsMenu
              event={event}
              mailConfigured={mailConfigured}
              onResend={() => setResendOpen(true)}
              onDelete={() => {
                setDeleteError(null);
                setDeleteOpen(true);
              }}
            />
            <Button variant="secondary" onClick={handleBack}>
              Back
            </Button>
          </>
        }
      />

      {/* Not shown while the Edit modal is open - that error text renders inside the modal
          itself instead, otherwise it's stuck behind the modal's opaque backdrop, invisible
          (bot review), and duplicated in the DOM behind it if left unconditional here. */}
      {error && !editMode && <p className="text-error">{error}</p>}
      {revokeError && activeRevoke === null && (
        <div className="attendee-form__warn">
          <p className="text-error">{revokeError}</p>
          {isRevoked && restoreCapacityBlocked && superadmin && (
            <label className="attendee-restore-force">
              <input
                type="checkbox"
                checked={restoreForceCapacity}
                onChange={(e) => setRestoreForceCapacity(e.target.checked)}
                disabled={revokeBusy}
              />
              <span>Override capacity limit (superadmin)</span>
            </label>
          )}
        </div>
      )}
      {itemsWarning && <p className="attendee-form__warn">{itemsWarning}</p>}

      <div className="attendee-status-strip">
        <div className="attendee-status-chip">
          <span className={`attendee-status-chip__icon attendee-status-chip__icon--${passStatusTone(detail.status)}`}>
            <i className="ti ti-user-check" aria-hidden="true" />
          </span>
          <div className="attendee-status-chip__body">
            <strong>Registration</strong>
            <PassStatusBadge status={detail.status} />
          </div>
        </div>
        <div className="attendee-status-chip">
          <span className={`attendee-status-chip__icon attendee-status-chip__icon--${rsvpTone(detail.rsvp_status)}`}>
            <i className="ti ti-calendar-question" aria-hidden="true" />
          </span>
          <div className="attendee-status-chip__body">
            <strong>Attendance</strong>
            <RsvpStatusBadge status={detail.rsvp_status} />
          </div>
        </div>
        <div className="attendee-status-chip">
          <span className={`attendee-status-chip__icon attendee-status-chip__icon--${mailTone(lastMail)}`}>
            <i className="ti ti-mail" aria-hidden="true" />
          </span>
          <div className="attendee-status-chip__body">
            <strong>Ticket delivery</strong>
            <MailStatusBadge status={lastMail} />
          </div>
        </div>
        <div className="attendee-status-chip">
          <span className={`attendee-status-chip__icon attendee-status-chip__icon--${detail.admitted_at ? "ok" : "neutral"}`}>
            <i className="ti ti-qrcode" aria-hidden="true" />
          </span>
          <div className="attendee-status-chip__body">
            <strong>Check-in</strong>
            <span>
              {detail.admitted_at
                ? formatAdmissionDisplay(detail.admitted_at, event.date, event.timezone)
                : "Not yet"}
            </span>
          </div>
        </div>
        <div className="attendee-status-chip">
          <span className="attendee-status-chip__icon attendee-status-chip__icon--neutral">
            <i className="ti ti-wallet" aria-hidden="true" />
          </span>
          <div className="attendee-status-chip__body">
            <strong>Wallet</strong>
            <span>Not added</span>
          </div>
        </div>
      </div>

      <Tabs
        value={tab}
        onChange={(id) => setTab(id as TabId)}
        tabs={[
          { id: "overview", label: "Overview" },
          { id: "activity", label: "Activity log" },
        ]}
      />

      {tab === "overview" && (
        <AttendeeOverviewTab
          detail={detail}
          ticketTypes={ticketTypes}
          attendeeSource={attendeeSource}
          customDataEntries={customDataEntries}
          eventItems={eventItems}
          event={event}
        />
      )}

      {tab === "activity" && (
        <AttendeeActivityTab
          actionLog={detail.action_log}
          attributeFields={attributeFields}
          eventItems={eventItems}
          event={event}
        />
      )}

      {editMode && (
        <dialog className="attendee-edit-modal" open aria-modal="true" aria-labelledby={editTitleId}>
          <div className="attendee-edit-modal__backdrop" role="presentation" onClick={handleCancelEdit} />
          <form ref={editPanelRef} className="attendee-edit-modal__panel" onSubmit={handleSave}>
            <h2 id={editTitleId} className="attendee-edit-modal__title">
              <i className="ti ti-pencil" aria-hidden="true" /> Edit attendee
            </h2>
            <p className="attendee-edit-modal__subtitle">
              Update this attendee&apos;s profile and ticket details.
            </p>
            {error && (
              <p className="text-error" role="alert">
                {error}
              </p>
            )}
            {staleWrite && (
              <div className="attendee-form__warn">
                <p>Someone else updated this attendee — reload and reapply your edits.</p>
                <Button type="button" variant="secondary" size="sm" onClick={() => void handleReload()} disabled={reloading}>
                  {reloading ? "Reloading…" : "Reload"}
                </Button>
              </div>
            )}
            <Tooltip
              content={isEventArchived(event) ? ARCHIVED_ACTION_TOOLTIP : undefined}
              className="attendee-form__fieldset-wrapper"
            >
              <fieldset className="attendee-form__fieldset" disabled={isEventArchived(event)}>
                <Select
                  label="Attendance"
                  value={form.rsvp_status}
                  onChange={(e) => setForm({ ...form, rsvp_status: e.target.value as RsvpStatus })}
                >
                  <option value="none">Registered</option>
                  <option value="confirmed">Confirmed</option>
                  <option value="declined">Declined</option>
                  <option value="tentative">Tentative</option>
                  <option value="cancelled">Cancelled</option>
                </Select>
                <Input
                  label="Email"
                  type="text"
                  inputMode="email"
                  icon={<i className="ti ti-mail" aria-hidden="true" />}
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  required
                  {...NO_AUTOFILL_PROPS}
                />
                {emailChanged && (
                  <p className="attendee-form__warn">
                    This changes the attendee&apos;s primary address. To send a ticket elsewhere, use Resend ticket.
                  </p>
                )}
                {emailConflict && (
                  <p className="attendee-form__error">This email is already used by another attendee in this event.</p>
                )}
                <Input
                  label="Name"
                  icon={<i className="ti ti-user" aria-hidden="true" />}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                  {...NO_AUTOFILL_PROPS}
                />
                <Input
                  label="Company"
                  icon={<i className="ti ti-building" aria-hidden="true" />}
                  value={form.company}
                  onChange={(e) => setForm({ ...form, company: e.target.value })}
                />
                <Input
                  label="Department"
                  icon={<i className="ti ti-sitemap" aria-hidden="true" />}
                  value={form.department}
                  onChange={(e) => setForm({ ...form, department: e.target.value })}
                />
                <Select
                  label="Ticket type"
                  value={form.ticket_type}
                  onChange={(e) => setForm({ ...form, ticket_type: e.target.value })}
                >
                  <option value="">—</option>
                  {orphanedTicketType && (
                    <option
                      value={orphanedTicketType}
                      title="Not in this event's ticket-type catalog — it may have been deleted after being assigned. Picking another option here replaces it."
                    >
                      {orphanedTicketType} (not in catalog)
                    </option>
                  )}
                  {ticketTypes.map((type) => (
                    <option key={type.key} value={type.key}>
                      {type.label}
                    </option>
                  ))}
                </Select>
                {ticketTypesError && (
                  <p className="attendee-form__error">
                    {ticketTypesError}{" "}
                    <button type="button" className="link-btn" onClick={loadTicketTypes}>
                      Retry
                    </button>
                  </p>
                )}
                {attributeFields.map((field) => (
                  <CustomDataFieldInput
                    key={field.source_field}
                    field={field}
                    value={form.customFields[field.source_field] ?? ""}
                    disabled={saving || reloading || staleWrite}
                    onChange={(next) =>
                      setForm({
                        ...form,
                        customFields: { ...form.customFields, [field.source_field]: next },
                      })
                    }
                  />
                ))}
              </fieldset>
            </Tooltip>
            <div className="attendee-form__actions">
              <Button type="button" variant="secondary" onClick={handleCancelEdit} disabled={saving}>
                Cancel
              </Button>
              <ArchivedGuard
                event={event}
                reasonId="save-changes-reason"
                disabled={saving || reloading || staleWrite}
              >
                {(guard) => (
                  <Button type="submit" variant="primary" {...guard}>
                    {saving ? "Saving…" : "Save changes"}
                  </Button>
                )}
              </ArchivedGuard>
            </div>
          </form>
        </dialog>
      )}

      {resendOpen && (
        <dialog className="attendee-resend-modal" open aria-modal="true" aria-labelledby={resendTitleId}>
          <div className="attendee-resend-modal__backdrop" role="presentation" onClick={() => setResendOpen(false)} />
          <form ref={resendPanelRef} className="attendee-resend-modal__panel" onSubmit={handleResend}>
            <h3 id={resendTitleId} className="attendee-resend-modal__title">Resend ticket</h3>
            {resendError && (
              <div className="attendee-resend-modal__error" role="alert">
                <i className="ti ti-alert-triangle" aria-hidden="true" />
                <p>{resendError}</p>
              </div>
            )}
            <div className="attendee-resend-options">
              <label>
                <input type="radio" name="resendMode" checked={resendMode === "same"} onChange={() => setResendMode("same")} />
                Same address ({detail.email})
              </label>
              <label>
                <input type="radio" name="resendMode" checked={resendMode === "other"} onChange={() => setResendMode("other")} />{" "}
                Other address
              </label>
            </div>
            {resendMode === "other" && (
              <Input label="Recipient email" type="email" value={resendEmail} onChange={(e) => setResendEmail(e.target.value)} />
            )}
            <div className="attendee-form__actions">
              <Button type="button" variant="secondary" onClick={() => setResendOpen(false)}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={resending}>{resending ? "Sending…" : "Send"}</Button>
            </div>
          </form>
        </dialog>
      )}

      <ConfirmDialog
        open={discardOpen}
        title="Discard unsaved changes?"
        message={
          discardIntent === "back"
            ? "You have unsaved profile edits. Leave without saving?"
            : "You have unsaved profile edits. Discard them?"
        }
        confirmLabel={discardIntent === "back" ? "Leave" : "Discard"}
        onConfirm={() => {
          setDiscardOpen(false);
          if (discardIntent === "back") {
            goBack();
          } else {
            if (baseline) setForm(baseline);
            setEditMode(false);
            setError(null);
            setEmailConflict(false);
          }
        }}
        onCancel={() => setDiscardOpen(false)}
      />

      <ConfirmDialog
        open={activeRevoke === "pass"}
        title="Revoke pass?"
        message="This attendee will no longer be able to check in. You can restore the pass later if capacity allows."
        confirmLabel="Revoke pass"
        confirmVariant="danger"
        loading={revokeBusy}
        errorMessage={revokeError ?? undefined}
        onConfirm={() => void handlePassStatusChange("revoked")}
        onCancel={() => {
          if (!revokeBusy) {
            setActiveRevoke(null);
            setRevokeError(null);
          }
        }}
      />

      <ConfirmDialog
        open={activeRevoke === "checkin"}
        title="Revoke check-in?"
        message={`This un-admits ${detail.name} — they'll show as not checked in and will need to be scanned or admitted again to re-enter. This works regardless of when or how they were originally checked in.`}
        confirmLabel="Revoke check-in"
        confirmVariant="danger"
        loading={revokeBusy}
        errorMessage={revokeError ?? undefined}
        onConfirm={() => void handleRevokeCheckIn()}
        onCancel={() => {
          if (!revokeBusy) {
            setActiveRevoke(null);
            setRevokeError(null);
          }
        }}
      />

      <ConfirmDialog
        open={deleteOpen}
        title="Permanently delete this attendee?"
        message={`This cannot be undone. Deleting ${detail.name} permanently removes:`}
        errorMessage={deleteError}
        confirmLabel="Delete attendee"
        confirmVariant="danger"
        loading={deleting}
        confirmationValue={detail.name}
        confirmationLabel={`Type the attendee's name to confirm: "${detail.name}"`}
        onConfirm={() => void handleDeleteConfirm()}
        onCancel={() => {
          if (!deleting) {
            setDeleteOpen(false);
            setDeleteError(null);
          }
        }}
      >
        <ul className="confirm-dialog__list">
          <li>Profile and contact details</li>
          <li>Ticket deliveries</li>
          <li>Wallet pass</li>
          <li>Check-in history</li>
        </ul>
      </ConfirmDialog>
    </div>
  );
}
