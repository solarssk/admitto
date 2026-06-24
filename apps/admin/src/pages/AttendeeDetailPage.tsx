import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
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
  updateAttendee,
} from "../api/client.js";
import type { AttendeeDetailDto, RsvpStatus, UpdateAttendeePatch } from "../api/types.js";
import {
  formatDateTime,
  loadAttendeeDetailData,
  mergeFormAfterReload,
  toAttendeeForm,
  type AttendeeFormState,
} from "../attendees/attendeeDetailForm.js";
import { getTimelineDetail, getTimelineIcon, getTimelineLabel } from "../attendees/attendeeTimeline.js";
import { MailStatusBadge } from "../attendees/mailStatusBadge.js";
import { readCustomDataField } from "../attendees/customData.js";
import type { CustomDataFieldDef } from "../attendees/customData.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { useModalFocusTrap } from "../components/useModalFocusTrap.js";
import "../attendees/attendees.css";

type TabId = "overview" | "activity";

export function AttendeeDetailPage() {
  const { eventId, attendeeId } = useParams();
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

  const loadDetail = useCallback(async () => {
    if (!eventId || !attendeeId) return;
    setLoading(true);
    setError(null);
    setNotFound(false);
    try {
      const { detail: d, attributeFields: fields, itemsWarning: warn } =
        await loadAttendeeDetailData(eventId, attendeeId);
      setDetail(d);
      setAttributeFields(fields);
      setForm(toAttendeeForm(d, fields));
      setInitialEmail(d.email);
      setItemsWarning(warn);
      setStaleWrite(false);
      setEmailConflict(false);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
        setNotFound(true);
      } else {
        setError(err instanceof ApiError ? err.message : "Failed to load attendee.");
      }
    } finally {
      setLoading(false);
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
    const previousDetail = detail;
    setReloading(true);
    setError(null);
    try {
      const { detail: d, attributeFields: fields, itemsWarning: warn } =
        await loadAttendeeDetailData(eventId, attendeeId);
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
      setError(err instanceof ApiError ? err.message : "Failed to reload — please try again.");
    } finally {
      setReloading(false);
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

    patch.expected_updated_at = detail.updated_at;
    setSaving(true);
    setEmailConflict(false);
    setError(null);
    try {
      const updated = await updateAttendee(eventId, attendeeId, patch);
      setDetail(updated);
      setForm(toAttendeeForm(updated, attributeFields));
      setInitialEmail(updated.email);
      setStaleWrite(false);
      addToast("Profile saved", "success");
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        if (err.message === "email_conflict") setEmailConflict(true);
        else if (err.message === "stale_write") {
          setStaleWrite(true);
          addToast("Someone else updated this attendee — page will reload", "warning");
          void handleReload();
        } else setError("Could not save changes.");
      } else if (err instanceof ApiError && err.status === 400 && err.message === "unknown_custom_data_field") {
        setError("Event configuration changed — reload this page to edit attributes.");
      } else {
        setError(err instanceof ApiError ? err.message : "Failed to save changes.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleRsvpChange(next: RsvpStatus) {
    if (!eventId || !attendeeId || !detail || next === detail.rsvp_status || rsvpSaving) return;
    const previous = detail;
    const expectedUpdatedAt = detail.updated_at;
    setDetail({ ...detail, rsvp_status: next });
    setRsvpSaving(true);
    try {
      const updated = await updateAttendee(eventId, attendeeId, {
        rsvp_status: next,
        expected_updated_at: expectedUpdatedAt,
      });
      setDetail(updated);
      setForm((f) => (f ? f : null));
      addToast("Status updated", "success");
    } catch (err) {
      setDetail(previous);
      if (err instanceof ApiError && err.message === "stale_write") {
        addToast("Someone else updated this attendee — page will reload", "warning");
        void handleReload();
      } else {
        addToast(err instanceof ApiError ? err.message : "Failed to update status", "error");
      }
    } finally {
      setRsvpSaving(false);
    }
  }

  async function handleResend(e: React.FormEvent) {
    e.preventDefault();
    if (!eventId || !attendeeId || !detail) return;
    if (resendMode === "other" && !resendEmail.trim()) {
      setResendError("Enter an email address for the alternate recipient.");
      return;
    }
    setResending(true);
    setResendError(null);
    try {
      const body = resendMode === "other" ? { to: resendEmail.trim() } : {};
      const delivery = await resendTicket(eventId, attendeeId, body);
      const refreshed = await fetchAttendeeDetail(eventId, attendeeId);
      setDetail(refreshed);
      setResendOpen(false);
      addToast(
        delivery.status === "failed"
          ? `Resend queued but delivery failed (${delivery.error_code ?? "unknown"}).`
          : "Ticket resent successfully.",
        delivery.status === "failed" ? "warning" : "success",
      );
    } catch (err) {
      setResendError(err instanceof ApiError ? err.message : "Resend failed.");
    } finally {
      setResending(false);
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

  return (
    <div className="attendee-detail-page">
      <PageHeader
        breadcrumb={["Attendees", detail.name]}
        title={detail.name}
        actions={
          <>
            <Button
              variant="ghost"
              icon={<i className="ti ti-refresh" aria-hidden="true" />}
              onClick={() => setResendOpen(true)}
            >
              Resend ticket
            </Button>
            <Button variant="danger" disabled title="Coming soon">
              Revoke pass
            </Button>
            <Button variant="secondary" onClick={handleBack}>
              Back
            </Button>
          </>
        }
      />

      {error && <p className="text-error">{error}</p>}
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
                <Input
                  key={field.source_field}
                  label={field.label}
                  value={form.customFields[field.source_field] ?? ""}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      customFields: { ...form.customFields, [field.source_field]: e.target.value },
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
                    <span className="attendee-detail-checkin">{formatDateTime(detail.admitted_at)}</span>
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
                    {formatDateTime(entry.created_at)}
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
    </div>
  );
}
