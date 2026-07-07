/** @deprecated Use AttendeeDetailPage — kept for reference until cleanup PR. */
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, IconButton, Input, StatusBadge } from "@admitto/ui";
import {
  ApiError,
  fetchAttendeeDetail,
  fetchEventItems,
  resendTicket,
  updateAttendee,
} from "../api/client.js";
import { hasApiErrorCode, operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { AttendeeDetailDto, DeliveryDto, UpdateAttendeePatch } from "../api/types.js";
import { CustomDataFieldInput } from "./CustomDataFieldInput.js";
import {
  flattenCustomDataFieldsFromItems,
  readCustomDataField,
  validateCustomFieldsForm,
  type CustomDataFieldDef,
} from "./customData.js";
import { TicketTypeBadge } from "./ticketTypeBadge.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { formatEventDateTime, formatUtcDateTime } from "../utils/event-dates.js";

export interface AttendeeDetailDrawerProps {
  eventId: string;
  attendeeId: string;
  eventTimezone: string;
  onClose: () => void;
  onUpdated: () => void;
}

type FormState = {
  name: string;
  email: string;
  company: string;
  department: string;
  ticket_type: string;
  customFields: Record<string, string>;
};

function customFieldsFromDetail(
  detail: AttendeeDetailDto,
  attributeFields: CustomDataFieldDef[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of attributeFields) {
    out[field.source_field] = readCustomDataField(detail.custom_data, field.source_field) ?? "";
  }
  return out;
}

function toForm(detail: AttendeeDetailDto, attributeFields: CustomDataFieldDef[]): FormState {
  return {
    name: detail.name,
    email: detail.email,
    company: detail.company ?? "",
    department: detail.department ?? "",
    ticket_type: detail.ticket_type ?? "",
    customFields: customFieldsFromDetail(detail, attributeFields),
  };
}

/** After stale_write reload: keep user-edited fields, refresh untouched fields from server. */
function mergeFormAfterReload(
  currentForm: FormState,
  previousDetail: AttendeeDetailDto,
  reloaded: AttendeeDetailDto,
  attributeFields: CustomDataFieldDef[],
): FormState {
  const previousForm = toForm(previousDetail, attributeFields);
  const nextForm = toForm(reloaded, attributeFields);
  const customFields: Record<string, string> = { ...nextForm.customFields };
  for (const field of attributeFields) {
    const key = field.source_field;
    if (currentForm.customFields[key] !== previousForm.customFields[key]) {
      customFields[key] = currentForm.customFields[key] ?? "";
    }
  }
  return {
    name: currentForm.name !== previousForm.name ? currentForm.name : nextForm.name,
    email: currentForm.email !== previousForm.email ? currentForm.email : nextForm.email,
    company:
      currentForm.company !== previousForm.company ? currentForm.company : nextForm.company,
    department:
      currentForm.department !== previousForm.department
        ? currentForm.department
        : nextForm.department,
    ticket_type:
      currentForm.ticket_type !== previousForm.ticket_type
        ? currentForm.ticket_type
        : nextForm.ticket_type,
    customFields,
  };
}

function formatDateTime(iso: string | null, timezone: string): string {
  if (!iso) return "—";
  return formatEventDateTime(iso, timezone);
}

/** Load attendee detail; event items are best-effort so core fields stay editable on items API failure. */
const ITEMS_LOAD_WARNING =
  "Attribute fields could not be loaded — core fields are still editable.";

async function loadDrawerData(
  eventId: string,
  attendeeId: string,
): Promise<{
  detail: AttendeeDetailDto;
  attributeFields: CustomDataFieldDef[];
  itemsWarning: string | null;
}> {
  const [detail, itemsResult] = await Promise.all([
    fetchAttendeeDetail(eventId, attendeeId),
    fetchEventItems(eventId).then(
      (items) => ({ ok: true as const, items }),
      () => ({ ok: false as const }),
    ),
  ]);
  return {
    detail,
    attributeFields: itemsResult.ok
      ? flattenCustomDataFieldsFromItems(itemsResult.items)
      : [],
    itemsWarning: itemsResult.ok ? null : ITEMS_LOAD_WARNING,
  };
}

/** Slide-over panel for viewing/editing one attendee (admin list drill-down). */
export function AttendeeDetailDrawer({
  eventId,
  attendeeId,
  eventTimezone,
  onClose,
  onUpdated,
}: AttendeeDetailDrawerProps) {
  const [detail, setDetail] = useState<AttendeeDetailDto | null>(null);
  const [attributeFields, setAttributeFields] = useState<CustomDataFieldDef[]>([]);
  const [form, setForm] = useState<FormState | null>(null);
  const [initialEmail, setInitialEmail] = useState("");
  const [loading, setLoading] = useState(true);
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
  const [resendSuccess, setResendSuccess] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);

  /** Tracks the row currently selected in the parent list (guards async save/reload). */
  const selectionRef = useRef({ eventId, attendeeId });
  selectionRef.current = { eventId, attendeeId };

  function isStillSelected(target: { eventId: string; attendeeId: string }): boolean {
    const current = selectionRef.current;
    return current.eventId === target.eventId && current.attendeeId === target.attendeeId;
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setItemsWarning(null);
    setStaleWrite(false);
    setEmailConflict(false);
    (async () => {
      try {
        const { detail: d, attributeFields: fields, itemsWarning } = await loadDrawerData(
          eventId,
          attendeeId,
        );
        if (cancelled) return;
        setAttributeFields(fields);
        setDetail(d);
        setForm(toForm(d, fields));
        setInitialEmail(d.email);
        setItemsWarning(itemsWarning);
      } catch (err) {
        if (!cancelled) {
          setError(operatorApiErrorMessage(err, "Failed to load attendee."));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId, attendeeId]);

  const baseline = detail != null ? toForm(detail, attributeFields) : null;
  const isDirty =
    form !== null &&
    baseline !== null &&
    (form.name !== baseline.name ||
      form.email !== baseline.email ||
      form.company !== baseline.company ||
      form.department !== baseline.department ||
      form.ticket_type !== baseline.ticket_type ||
      JSON.stringify(form.customFields) !== JSON.stringify(baseline.customFields));

  const handleCloseGuard = useCallback(() => {
    if (isDirty) setDiscardOpen(true);
    else onClose();
  }, [isDirty, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !resendOpen && !discardOpen) handleCloseGuard();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleCloseGuard, resendOpen, discardOpen]);

  const emailChanged = form != null && form.email !== initialEmail;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!detail || !form) return;

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
      if (next !== current) {
        customDataPatch[key] = next || null;
      }
    }
    if (Object.keys(customDataPatch).length > 0) {
      patch.custom_data_fields = customDataPatch;
    }

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
      const updated = await updateAttendee(target.eventId, target.attendeeId, patch);
      if (!isStillSelected(target)) return;
      setDetail(updated);
      setForm(toForm(updated, attributeFields));
      setInitialEmail(updated.email);
      setStaleWrite(false);
      onUpdated();
    } catch (err) {
      if (!isStillSelected(target)) return;
      if (err instanceof ApiError && err.status === 409) {
        if (hasApiErrorCode(err, "email_conflict")) {
          setEmailConflict(true);
        } else if (hasApiErrorCode(err, "stale_write")) {
          setStaleWrite(true);
        } else {
          setError("Could not save changes. Reload and try again.");
        }
      } else if (
        err instanceof ApiError &&
        err.status === 400 &&
        (hasApiErrorCode(err, "unknown_custom_data_field") ||
          hasApiErrorCode(err, "required_custom_data_field_missing") ||
          hasApiErrorCode(err, "validation_failed"))
      ) {
        setError(
          hasApiErrorCode(err, "unknown_custom_data_field")
            ? "Event configuration changed — close and reopen this attendee to edit attributes."
            : "Could not save attribute fields — check required values and options.",
        );
      } else {
        setError(operatorApiErrorMessage(err, "Failed to save changes."));
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleReload() {
    const target = { eventId, attendeeId };
    const previousDetail = detail;
    setReloading(true);
    setError(null);
    try {
      const { detail: d, attributeFields: fields, itemsWarning } = await loadDrawerData(
        target.eventId,
        target.attendeeId,
      );
      if (!isStillSelected(target)) return;
      setAttributeFields(fields);
      setForm((currentForm) => {
        if (!currentForm || !previousDetail) return toForm(d, fields);
        return mergeFormAfterReload(currentForm, previousDetail, d, fields);
      });
      setDetail(d);
      setInitialEmail(d.email);
      setStaleWrite(false);
      setItemsWarning(itemsWarning);
    } catch (err) {
      if (!isStillSelected(target)) return;
      setError(operatorApiErrorMessage(err, "Failed to reload — please try again."));
    } finally {
      setReloading(false);
    }
  }

  function prependDelivery(delivery: DeliveryDto) {
    setDetail((prev) =>
      prev ? { ...prev, deliveries: [delivery, ...prev.deliveries] } : prev,
    );
  }

  async function handleResend(e: React.FormEvent) {
    e.preventDefault();
    if (!detail) return;

    if (resendMode === "other" && !resendEmail.trim()) {
      setResendError("Enter an email address for the alternate recipient.");
      return;
    }

    setResending(true);
    setResendError(null);
    setResendSuccess(null);
    try {
      const body =
        resendMode === "other" ? { to: resendEmail.trim() } : {};
      const delivery = await resendTicket(eventId, attendeeId, body);
      prependDelivery(delivery);
      setResendOpen(false);
      setResendSuccess(
        delivery.status === "failed"
          ? `Resend queued but delivery failed (${delivery.error_code ?? "unknown"}).`
          : "Ticket resent successfully.",
      );
      onUpdated();
    } catch (err) {
      setResendError(operatorApiErrorMessage(err, "Resend failed."));
    } finally {
      setResending(false);
    }
  }

  return (
    <>
      <div
        className="attendee-drawer-backdrop"
        role="presentation"
        onClick={handleCloseGuard}
        aria-hidden="true"
      />
      <aside className="attendee-drawer" aria-label="Attendee details">
        <header className="attendee-drawer__header">
          <div>
            <h2 className="attendee-drawer__title">{detail?.name ?? "Attendee"}</h2>
            {detail && <TicketTypeBadge ticketType={detail.ticket_type} />}
          </div>
          <IconButton icon={<i className="ti ti-x" aria-hidden="true" />} label="Close" onClick={handleCloseGuard} />
        </header>

        <div className="attendee-drawer__body">
          {loading && <p>Loading…</p>}
          {error && <p className="attendee-form__error">{error}</p>}
          {itemsWarning && <p className="attendee-form__warn">{itemsWarning}</p>}
          {resendSuccess && <p className="attendee-success">{resendSuccess}</p>}

          {detail && form && !loading && (
            <>
              <section>
                <h3 className="attendee-drawer__section-title">Edit details</h3>
                <form className="attendee-form" onSubmit={handleSave}>
                  <Input
                    label="Name"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    required
                  />
                  <Input
                    label="Email"
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    required
                  />
                  {emailChanged && (
                    <p className="attendee-form__warn">
                      This changes the attendee&apos;s primary address. To send a ticket to a
                      different address once, use Resend → other address.
                    </p>
                  )}
                  {emailConflict && (
                    <p className="attendee-form__error">
                      This email is already used by another attendee in this event.
                    </p>
                  )}
                  {staleWrite && (
                    <div className="attendee-form__warn">
                      <p>
                        This record was changed by someone else — reload and reapply.
                      </p>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={handleReload}
                        disabled={reloading}
                      >
                        {reloading ? "Reloading…" : "Reload"}
                      </Button>
                    </div>
                  )}
                  <Input
                    label="Company"
                    value={form.company}
                    onChange={(e) => setForm({ ...form, company: e.target.value })}
                  />
                  <Input
                    label="Department"
                    value={form.department}
                    onChange={(e) => setForm({ ...form, department: e.target.value })}
                  />
                  <Input
                    label="Type"
                    value={form.ticket_type}
                    onChange={(e) => setForm({ ...form, ticket_type: e.target.value })}
                  />
                  {attributeFields.map((field) => (
                    <CustomDataFieldInput
                      key={field.source_field}
                      field={field}
                      value={form.customFields[field.source_field] ?? ""}
                      disabled={saving || reloading || staleWrite}
                      onChange={(next) =>
                        setForm({
                          ...form,
                          customFields: {
                            ...form.customFields,
                            [field.source_field]: next,
                          },
                        })
                      }
                    />
                  ))}
                  <dl className="attendee-readonly">
                    <dt>Check-in</dt>
                    <dd>
                      <StatusBadge status={detail.check_in_status} />
                      {detail.admitted_at && (
                        <span> · {formatDateTime(detail.admitted_at, eventTimezone)}</span>
                      )}
                    </dd>
                  </dl>
                  <div className="attendee-form__actions">
                    <Button type="submit" variant="primary" disabled={saving || reloading || staleWrite}>
                      {saving ? "Saving…" : "Save changes"}
                    </Button>
                  </div>
                </form>
              </section>

              <section>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <h3 className="attendee-drawer__section-title" style={{ margin: 0 }}>
                    Communication log
                  </h3>
                  <Button variant="secondary" size="sm" onClick={() => setResendOpen(true)}>
                    Resend ticket
                  </Button>
                </div>
                {detail.deliveries.length === 0 ? (
                  <p className="attendee-readonly">No messages sent yet.</p>
                ) : (
                  <ul className="attendee-deliveries">
                    {detail.deliveries.map((d) => (
                      <li key={d.id} className="attendee-delivery">
                        <div className="attendee-delivery__subject">
                          {d.rendered_subject ?? "(no subject)"}
                        </div>
                        <div className="attendee-delivery__meta">
                          <StatusBadge status={d.status} />
                          <span>{d.recipient_email ?? "—"}</span>
                          <span>
                            {formatUtcDateTime(d.sent_at ?? d.accepted_at ?? d.queued_at)}
                          </span>
                        </div>
                        {d.status === "failed" && d.error_code && (
                          <div className="attendee-delivery__error">Error: {d.error_code}</div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>
      </aside>

      {resendOpen && detail && (
        <div className="attendee-resend-modal" role="dialog" aria-modal="true" aria-labelledby="resend-title">
          <div
            className="attendee-resend-modal__backdrop"
            role="presentation"
            onClick={() => setResendOpen(false)}
          />
          <form className="attendee-resend-modal__panel" onSubmit={handleResend}>
            <h3 id="resend-title" className="attendee-resend-modal__title">
              Resend ticket
            </h3>
            <div className="attendee-resend-options">
              <label>
                <input
                  type="radio"
                  name="resendMode"
                  checked={resendMode === "same"}
                  onChange={() => setResendMode("same")}
                />
                Same address ({detail.email})
              </label>
              <label>
                <input
                  type="radio"
                  name="resendMode"
                  checked={resendMode === "other"}
                  onChange={() => setResendMode("other")}
                />
                Other address
              </label>
            </div>
            {resendMode === "other" && (
              <Input
                label="Email"
                type="email"
                value={resendEmail}
                onChange={(e) => setResendEmail(e.target.value)}
                required
              />
            )}
            {resendError && <p className="attendee-form__error">{resendError}</p>}
            <div className="attendee-form__actions">
              <Button type="button" variant="secondary" onClick={() => setResendOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={resending}>
                {resending ? "Sending…" : "Send"}
              </Button>
            </div>
          </form>
        </div>
      )}
      <ConfirmDialog
        open={discardOpen}
        title="Discard changes?"
        message="You have unsaved changes. They will be lost if you close this panel."
        confirmLabel="Discard"
        confirmVariant="danger"
        cancelLabel="Keep editing"
        onConfirm={() => {
          setDiscardOpen(false);
          onClose();
        }}
        onCancel={() => setDiscardOpen(false)}
      />
    </>
  );
}
