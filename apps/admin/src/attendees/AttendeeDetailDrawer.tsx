import { useEffect, useState } from "react";
import { Button, IconButton, Input, StatusBadge } from "@admitto/ui";
import {
  ApiError,
  fetchAttendeeDetail,
  resendTicket,
  updateAttendee,
} from "../api/client.js";
import type { AttendeeDetailDto, DeliveryDto } from "../api/types.js";
import { TicketTypeBadge } from "./ticketTypeBadge.js";

export interface AttendeeDetailDrawerProps {
  eventId: string;
  attendeeId: string;
  onClose: () => void;
  onUpdated: () => void;
}

type FormState = {
  name: string;
  email: string;
  company: string;
  department: string;
  ticket_type: string;
  shirt_size: string;
};

function toForm(detail: AttendeeDetailDto): FormState {
  return {
    name: detail.name,
    email: detail.email,
    company: detail.company ?? "",
    department: detail.department ?? "",
    ticket_type: detail.ticket_type ?? "",
    shirt_size: detail.shirt_size ?? "",
  };
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function AttendeeDetailDrawer({
  eventId,
  attendeeId,
  onClose,
  onUpdated,
}: AttendeeDetailDrawerProps) {
  const [detail, setDetail] = useState<AttendeeDetailDto | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [initialEmail, setInitialEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailConflict, setEmailConflict] = useState(false);
  const [resendOpen, setResendOpen] = useState(false);
  const [resendMode, setResendMode] = useState<"same" | "other">("same");
  const [resendEmail, setResendEmail] = useState("");
  const [resending, setResending] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);
  const [resendSuccess, setResendSuccess] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const d = await fetchAttendeeDetail(eventId, attendeeId);
        if (cancelled) return;
        setDetail(d);
        setForm(toForm(d));
        setInitialEmail(d.email);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Failed to load attendee.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId, attendeeId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !resendOpen) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, resendOpen]);

  const emailChanged = form != null && form.email !== initialEmail;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!detail || !form) return;

    const patch: Record<string, string | null> = {};
    if (form.name !== detail.name) patch.name = form.name;
    if (form.email !== detail.email) patch.email = form.email;
    if (form.company !== (detail.company ?? "")) patch.company = form.company || null;
    if (form.department !== (detail.department ?? "")) patch.department = form.department || null;
    if (form.ticket_type !== (detail.ticket_type ?? "")) patch.ticket_type = form.ticket_type || null;
    if (form.shirt_size !== (detail.shirt_size ?? "")) patch.shirt_size = form.shirt_size || null;

    if (Object.keys(patch).length === 0) return;

    setSaving(true);
    setEmailConflict(false);
    setError(null);
    try {
      const updated = await updateAttendee(eventId, attendeeId, patch);
      setDetail(updated);
      setForm(toForm(updated));
      setInitialEmail(updated.email);
      onUpdated();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setEmailConflict(true);
      } else {
        setError(err instanceof ApiError ? err.message : "Failed to save changes.");
      }
    } finally {
      setSaving(false);
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
    setResending(true);
    setResendError(null);
    setResendSuccess(null);
    try {
      const body =
        resendMode === "other" && resendEmail.trim()
          ? { to: resendEmail.trim() }
          : {};
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
      setResendError(err instanceof ApiError ? err.message : "Resend failed.");
    } finally {
      setResending(false);
    }
  }

  return (
    <>
      <div
        className="attendee-drawer-backdrop"
        role="presentation"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside className="attendee-drawer" aria-label="Attendee details">
        <header className="attendee-drawer__header">
          <div>
            <h2 className="attendee-drawer__title">{detail?.name ?? "Attendee"}</h2>
            {detail && <TicketTypeBadge ticketType={detail.ticket_type} />}
          </div>
          <IconButton icon={<i className="ti ti-x" aria-hidden="true" />} label="Close" onClick={onClose} />
        </header>

        <div className="attendee-drawer__body">
          {loading && <p>Loading…</p>}
          {error && <p className="attendee-form__error">{error}</p>}
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
                  <Input
                    label="Shirt size"
                    value={form.shirt_size}
                    onChange={(e) => setForm({ ...form, shirt_size: e.target.value })}
                  />
                  <dl className="attendee-readonly">
                    <dt>Check-in</dt>
                    <dd>
                      <StatusBadge status={detail.check_in_status} />
                      {detail.admitted_at && (
                        <span> · {formatDateTime(detail.admitted_at)}</span>
                      )}
                    </dd>
                  </dl>
                  <div className="attendee-form__actions">
                    <Button type="submit" variant="primary" disabled={saving}>
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
                          <span>{formatDateTime(d.sent_at ?? d.queued_at)}</span>
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
    </>
  );
}
