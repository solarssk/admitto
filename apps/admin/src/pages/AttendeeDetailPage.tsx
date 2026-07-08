import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useNavigate, useOutletContext, useParams } from "react-router-dom";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  IconButton,
  Input,
  PageHeader,
  Select,
  Skeleton,
  Tabs,
  useToast,
} from "@admitto/ui";
import {
  ApiError,
  fetchAttendeeDetail,
  resendTicket,
  revokeAttendeeCheckIn,
  updateAttendee,
  type EventFullMeta,
} from "../api/client.js";
import { hasApiErrorCode, operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { AttendeeDetailDto, EventDto, RsvpStatus, UpdateAttendeePatch } from "../api/types.js";
import {
  formatDateTime,
  loadAttendeeDetailData,
  mergeFormAfterReload,
  toAttendeeForm,
  type AttendeeFormState,
} from "../attendees/attendeeDetailForm.js";
import { getTimelineDetail, getTimelineIcon, getTimelineLabel, formatActivityTimestamp } from "../attendees/attendeeTimeline.js";
import { MailStatusBadge } from "../attendees/mailStatusBadge.js";
import { CustomDataFieldInput } from "../attendees/CustomDataFieldInput.js";
import { readCustomDataField, validateCustomFieldsForm } from "../attendees/customData.js";
import type { CustomDataFieldDef } from "../attendees/customData.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { useModalFocusTrap } from "../components/useModalFocusTrap.js";
import { useAuth } from "../auth/AuthProvider.js";
import { isSuperadmin } from "../auth/capabilities.js";
import "../attendees/attendees.css";

type TabId = "overview" | "activity";

/** Event attendee detail: profile edit, pass revoke/restore, resend, and activity log. */
export function AttendeeDetailPage() {
  const { eventId, attendeeId } = useParams();
  const { event } = useOutletContext<{ event: EventDto }>();
  const { assignments } = useAuth();
  const superadmin = isSuperadmin(assignments);
  const navigate = useNavigate();
  const { addToast } = useToast();
  const resendTitleId = useId();
  const resendPanelRef = useRef<HTMLFormElement>(null);

  const [tab, setTab] = useState<TabId>("overview");
  const [detail, setDetail] = useState<AttendeeDetailDto | null>(null);
  const [attributeFields, setAttributeFields] = useState<CustomDataFieldDef[]>([]);
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
  const [rsvpSaving, setRsvpSaving] = useState(false);
  const [resendOpen, setResendOpen] = useState(false);
  const [resendMode, setResendMode] = useState<"same" | "other">("same");
  const [resendEmail, setResendEmail] = useState("");
  const [resending, setResending] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [revokeBusy, setRevokeBusy] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [restoreCapacityBlocked, setRestoreCapacityBlocked] = useState<EventFullMeta | null>(null);
  const [restoreForceCapacity, setRestoreForceCapacity] = useState(false);
  const [checkinRevokeOpen, setCheckinRevokeOpen] = useState(false);
  const [checkinRevokeBusy, setCheckinRevokeBusy] = useState(false);
  const [checkinRevokeError, setCheckinRevokeError] = useState<string | null>(null);

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

  const baseline = detail != null ? toAttendeeForm(detail, attributeFields) : null;
  const isDirty =
    form !== null &&
    baseline !== null &&
    (form.name !== baseline.name ||
      form.email !== baseline.email ||
      form.company !== baseline.company ||
      form.department !== baseline.department ||
      form.ticket_type !== baseline.ticket_type ||
      JSON.stringify(form.customFields) !== JSON.stringify(baseline.customFields));

  const goBack = () => {
    if (eventId) navigate(`/admin/events/${eventId}/attendees`);
    else navigate(-1);
  };

  const handleBack = () => {
    if (isDirty) setDiscardOpen(true);
    else goBack();
  };

  useModalFocusTrap(resendPanelRef, resendOpen, () => setResendOpen(false));

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

    const patch: UpdateAttendeePatch = {};
    if (form.name !== detail.name) patch.name = form.name;
    if (form.email !== detail.email) patch.email = form.email;
    if (form.company !== (detail.company ?? "")) patch.company = form.company || null;
    if (form.department !== (detail.department ?? "")) patch.department = form.department || null;
    if (form.ticket_type !== (detail.ticket_type ?? "")) patch.ticket_type = form.ticket_type || null;

    const customDataPatch: Record<string, string | null> = {};
    for (const field of attributeFields) {
      const key = field.source_field;
      const next = form.customFields[key] ?? "";
      const current = readCustomDataField(detail.custom_data, key) ?? "";
      if (next !== current) customDataPatch[key] = next || null;
    }
    if (Object.keys(customDataPatch).length > 0) patch.custom_data_fields = customDataPatch;
    if (Object.keys(patch).length === 0) return;

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
      addToast("Profile saved", "success");
    } catch (err) {
      if (!isStillSelected(target)) return;
      if (err instanceof ApiError && err.status === 409) {
        if (hasApiErrorCode(err, "email_conflict")) setEmailConflict(true);
        else if (hasApiErrorCode(err, "stale_write")) {
          setStaleWrite(true);
          addToast("Someone else updated this attendee — page will reload", "warning");
          void handleReload();
        } else setError("Could not save changes.");
      } else if (
        err instanceof ApiError &&
        err.status === 400 &&
        (hasApiErrorCode(err, "unknown_custom_data_field") ||
          hasApiErrorCode(err, "required_custom_data_field_missing") ||
          hasApiErrorCode(err, "validation_failed"))
      ) {
        setError(
          hasApiErrorCode(err, "unknown_custom_data_field")
            ? "Event configuration changed — reload this page to edit attributes."
            : "Could not save attribute fields — check required values and options.",
        );
      } else {
        setError(operatorApiErrorMessage(err, "Failed to save changes."));
      }
    } finally {
      if (isStillSelected(target)) setSaving(false);
    }
  }

  async function handleRsvpChange(next: RsvpStatus) {
    if (!eventId || !attendeeId || !detail || next === detail.rsvp_status || rsvpSaving) return;
    const target = { eventId, attendeeId };
    const previous = detail;
    const expectedUpdatedAt = detail.updated_at;
    setDetail({ ...detail, rsvp_status: next });
    setRsvpSaving(true);
    try {
      const updated = await updateAttendee(eventId, attendeeId, {
        rsvp_status: next,
        expected_updated_at: expectedUpdatedAt,
      });
      if (!isStillSelected(target)) return;
      setDetail(updated);
      setForm((f) => (f ? f : null));
      addToast("Status updated", "success");
    } catch (err) {
      if (!isStillSelected(target)) return;
      setDetail(previous);
      if (err instanceof ApiError && err.code === "stale_write") {
        addToast("Someone else updated this attendee — page will reload", "warning");
        void handleReload();
      } else {
        addToast(operatorApiErrorMessage(err, "Failed to update status"), "error");
      }
    } finally {
      if (isStillSelected(target)) setRsvpSaving(false);
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

  async function copyTicketRef() {
    if (!detail?.ticket_ref) return;
    try {
      await navigator.clipboard.writeText(detail.ticket_ref);
      addToast("Copied to clipboard", "success", 2000);
    } catch {
      addToast("Could not copy", "error");
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
      setForm((currentForm) => {
        if (!currentForm) return toAttendeeForm(updated, attributeFields);
        return mergeFormAfterReload(currentForm, previousDetail, updated, attributeFields);
      });
      setRevokeOpen(false);
      setRestoreCapacityBlocked(null);
      setRestoreForceCapacity(false);
      addToast(nextStatus === "revoked" ? "Pass revoked" : "Pass restored", "success");
    } catch (err) {
      if (!isStillSelected(target)) return;
      if (err instanceof ApiError && err.status === 409) {
        if (err.code === "event_full" && err.eventFull) {
          setRestoreCapacityBlocked(err.eventFull);
          const { current, capacity } = err.eventFull;
          setRevokeError(
            `Event is at capacity (${current}/${capacity}). Free a slot or increase capacity before restoring this pass.`,
          );
        } else if (err.code === "stale_write") {
          addToast("Someone else updated this attendee — page will reload", "warning");
          void handleReload();
        } else {
          setRevokeError("Could not update pass status.");
        }
      } else {
        setRevokeError(operatorApiErrorMessage(err, "Could not update pass status."));
      }
    } finally {
      if (isStillSelected(target)) setRevokeBusy(false);
    }
  }

  /** Un-admits this attendee regardless of who checked them in or when — distinct from the operator-facing device-scoped undo on the Check-in page. */
  async function handleRevokeCheckIn() {
    if (!eventId || !attendeeId || !detail) return;
    const target = { eventId, attendeeId };
    setCheckinRevokeBusy(true);
    setCheckinRevokeError(null);
    try {
      await revokeAttendeeCheckIn(eventId, attendeeId);
      if (!isStillSelected(target)) return;
      await loadDetail();
      setCheckinRevokeOpen(false);
      addToast("Check-in revoked", "success");
    } catch (err) {
      if (!isStillSelected(target)) return;
      setCheckinRevokeError(operatorApiErrorMessage(err, "Could not revoke check-in."));
    } finally {
      if (isStillSelected(target)) setCheckinRevokeBusy(false);
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

  return (
    <div className="attendee-detail-page">
      <PageHeader
        breadcrumb={["Attendees", detail.name]}
        title={detail.name}
        actions={
          <>
            {isRevoked && <Badge variant="error">Revoked</Badge>}
            <Button
              variant="ghost"
              icon={<i className="ti ti-refresh" aria-hidden="true" />}
              onClick={() => setResendOpen(true)}
            >
              Resend ticket
            </Button>
            {detail.check_in_status === "admitted" && (
              <Button
                variant="ghost"
                icon={<i className="ti ti-ban" aria-hidden="true" />}
                onClick={() => {
                  setCheckinRevokeError(null);
                  setCheckinRevokeOpen(true);
                }}
              >
                Revoke check-in
              </Button>
            )}
            {isRevoked ? (
              <Button
                variant="primary"
                onClick={() =>
                  void handlePassStatusChange("registered", {
                    force: restoreForceCapacity && superadmin,
                  })
                }
                disabled={revokeBusy}
              >
                {revokeBusy ? "Restoring…" : "Restore pass"}
              </Button>
            ) : (
              <Button variant="danger" onClick={() => { setRevokeError(null); setRevokeOpen(true); }}>
                Revoke pass
              </Button>
            )}
            <Button variant="secondary" onClick={handleBack}>
              Back
            </Button>
          </>
        }
      />

      {error && <p className="text-error">{error}</p>}
      {revokeError && !revokeOpen && (
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

      <Tabs
        value={tab}
        onChange={(id) => setTab(id as TabId)}
        tabs={[
          { id: "overview", label: "Overview" },
          { id: "activity", label: "Activity log" },
        ]}
      />

      {tab === "overview" && (
        <div className="attendee-detail-grid">
          <Card title="Profile" className="attendee-detail-profile">
            <form className="attendee-form" onSubmit={handleSave}>
              <Input label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
              {emailChanged && (
                <p className="attendee-form__warn">
                  This changes the attendee&apos;s primary address. To send a ticket elsewhere, use Resend ticket.
                </p>
              )}
              {emailConflict && (
                <p className="attendee-form__error">This email is already used by another attendee in this event.</p>
              )}
              {staleWrite && (
                <div className="attendee-form__warn">
                  <p>Someone else updated this attendee — reload and reapply your edits.</p>
                  <Button type="button" variant="secondary" size="sm" onClick={() => void handleReload()} disabled={reloading}>
                    {reloading ? "Reloading…" : "Reload"}
                  </Button>
                </div>
              )}
              <Input label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
<Input label="Company" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
              <Input label="Department" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
              <Input label="Ticket type" value={form.ticket_type} onChange={(e) => setForm({ ...form, ticket_type: e.target.value })} />
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
              <div className="attendee-detail-readonly-row">
                <span className="attendee-detail-readonly-row__label">Token</span>
                <span className="attendee-detail-mono">{detail.ticket_ref ?? "Not issued yet"}</span>
                {detail.ticket_ref && (
                  <IconButton label="Copy token preview" icon={<i className="ti ti-copy" aria-hidden="true" />} onClick={() => void copyTicketRef()} />
                )}
              </div>
              <div className="attendee-form__actions">
                <Button type="submit" variant="primary" disabled={saving || reloading || staleWrite || rsvpSaving}>
                  {saving ? "Saving…" : "Save changes"}
                </Button>
              </div>
            </form>
          </Card>

          <div className="attendee-detail-side">
            <Card className="status-stats-card">
              <div className="status-stats-grid">
                <div className="status-stats-grid__item">
                  <span className="status-stats-grid__label">Attendee status</span>
                  <Select
                    label="RSVP status"
                    value={detail.rsvp_status}
                    disabled={rsvpSaving}
                    onChange={(e) => void handleRsvpChange(e.target.value as RsvpStatus)}
                  >
                    <option value="none">Registered</option>
                    <option value="confirmed">Confirmed</option>
                    <option value="declined">Declined</option>
                    <option value="tentative">Tentative</option>
                    <option value="cancelled">Cancelled</option>
                  </Select>
                </div>
                <div className="status-stats-grid__item">
                  <span className="status-stats-grid__label">Email</span>
                  <MailStatusBadge status={lastMail} />
                </div>
                <div className="status-stats-grid__item">
                  <span className="status-stats-grid__label">Wallet pass</span>
                  <span className="attendee-readonly">—</span>
                </div>
                <div className="status-stats-grid__item">
                  <span className="status-stats-grid__label">Check-in</span>
                  {detail.admitted_at ? (
                    <span className="attendee-detail-checkin">{formatDateTime(detail.admitted_at, event.timezone)}</span>
                  ) : (
                    <span className="attendee-readonly">—</span>
                  )}
                </div>
              </div>
            </Card>

            <Card
              title="Wallet pass"
              actions={<Badge variant="neutral">coming soon</Badge>}
              className="attendee-wallet-placeholder"
            >
              <p>This event doesn&apos;t have wallet passes enabled yet.</p>
              <p className="attendee-readonly">Wallet passes will be available in v0.5.</p>
            </Card>
          </div>
        </div>
      )}

      {tab === "activity" && (
        <Card padded>
          {detail.action_log.length === 0 ? (
            <EmptyState
              icon={<i className="ti ti-history" aria-hidden="true" />}
              title="No activity yet"
              description="Events will appear here as you work with this attendee."
            />
          ) : (
            <ul className="at-timeline">
              {detail.action_log.map((entry) => (
                <li key={entry.id} className="at-tl-item">
                  <div className="at-tl-dot">
                    <i className={`ti ti-${getTimelineIcon(entry.action_type)}`} aria-hidden="true" />
                  </div>
                  <div className="at-tl-body">
                    <b>{getTimelineLabel(entry)}</b>
                    <span>{getTimelineDetail(entry)}</span>
                  </div>
                  <time className="at-tl-time" dateTime={entry.created_at}>
                    {formatActivityTimestamp(entry.created_at, entry.action_type, event.timezone)}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {resendOpen && (
        <div className="attendee-resend-modal" role="dialog" aria-modal="true" aria-labelledby={resendTitleId}>
          <div className="attendee-resend-modal__backdrop" role="presentation" onClick={() => setResendOpen(false)} />
          <form ref={resendPanelRef} className="attendee-resend-modal__panel" onSubmit={handleResend}>
            <h3 id={resendTitleId} className="attendee-resend-modal__title">Resend ticket</h3>
            {resendError && <p className="attendee-form__error">{resendError}</p>}
            <div className="attendee-resend-options">
              <label>
                <input type="radio" name="resendMode" checked={resendMode === "same"} onChange={() => setResendMode("same")} />
                Same address ({detail.email})
              </label>
              <label>
                <input type="radio" name="resendMode" checked={resendMode === "other"} onChange={() => setResendMode("other")} />
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
        </div>
      )}

      <ConfirmDialog
        open={discardOpen}
        title="Discard unsaved changes?"
        message="You have unsaved profile edits. Leave without saving?"
        confirmLabel="Leave"
        onConfirm={() => {
          setDiscardOpen(false);
          goBack();
        }}
        onCancel={() => setDiscardOpen(false)}
      />

      <ConfirmDialog
        open={revokeOpen}
        title="Revoke pass?"
        message="This attendee will no longer be able to check in. You can restore the pass later if capacity allows."
        confirmLabel="Revoke pass"
        confirmVariant="danger"
        loading={revokeBusy}
        errorMessage={revokeError ?? undefined}
        onConfirm={() => void handlePassStatusChange("revoked")}
        onCancel={() => {
          if (!revokeBusy) {
            setRevokeOpen(false);
            setRevokeError(null);
          }
        }}
      />

      <ConfirmDialog
        open={checkinRevokeOpen}
        title="Revoke check-in?"
        message={`This un-admits ${detail.name} — they'll show as not checked in and will need to be scanned or admitted again to re-enter. This works regardless of when or how they were originally checked in.`}
        confirmLabel="Revoke check-in"
        confirmVariant="danger"
        loading={checkinRevokeBusy}
        errorMessage={checkinRevokeError ?? undefined}
        onConfirm={() => void handleRevokeCheckIn()}
        onCancel={() => {
          if (!checkinRevokeBusy) {
            setCheckinRevokeOpen(false);
            setCheckinRevokeError(null);
          }
        }}
      />
    </div>
  );
}
