import { useId, useRef, useState } from "react";
import { Button, Input } from "@admitto/ui";
import { ApiError, createAttendee } from "../api/client.js";
import type { AttendeeDetailDto } from "../api/types.js";
import { useModalFocusTrap } from "../components/useModalFocusTrap.js";
import "./add-attendee-modal.css";

type AddAttendeeModalProps = {
  eventId: string;
  open: boolean;
  onClose: () => void;
  onCreated: (attendee: AttendeeDetailDto) => void;
};

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function AddAttendeeModal({ eventId, open, onClose, onCreated }: AddAttendeeModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [department, setDepartment] = useState("");
  const [ticketType, setTicketType] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetForm = () => {
    setEmail("");
    setName("");
    setCompany("");
    setDepartment("");
    setTicketType("");
    setError(null);
  };

  const handleClose = () => {
    if (submitting) return;
    resetForm();
    onClose();
  };

  useModalFocusTrap(panelRef, open, handleClose);

  const canSubmit = email.trim() && name.trim() && isValidEmail(email.trim()) && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const attendee = await createAttendee(eventId, {
        email: email.trim(),
        name: name.trim(),
        company: company.trim() || undefined,
        department: department.trim() || undefined,
        ticket_type: ticketType.trim() || undefined,
      });
      onCreated(attendee);
      resetForm();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError("This email is already registered for this event.");
      } else {
        setError(err instanceof ApiError ? err.message : "Failed to add attendee. Try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="add-attendee-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="add-attendee-modal__backdrop" role="presentation" onClick={handleClose} />
      <div ref={panelRef} className="add-attendee-modal__panel">
        <h2 className="add-attendee-modal__title" id={titleId}>
          Add attendee
        </h2>
        {error && (
          <p className="add-attendee-modal__error" role="alert">
            {error}
          </p>
        )}
        <div className="add-attendee-modal__fields">
          <Input
            label="Email"
            type="email"
            required
            value={email}
            disabled={submitting}
            onChange={(e) => {
              setEmail(e.target.value);
              setError(null);
            }}
          />
          <Input
            label="Name"
            required
            value={name}
            disabled={submitting}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
          />
          <Input
            label="Company"
            value={company}
            disabled={submitting}
            onChange={(e) => {
              setCompany(e.target.value);
              setError(null);
            }}
          />
          <Input
            label="Department"
            value={department}
            disabled={submitting}
            onChange={(e) => {
              setDepartment(e.target.value);
              setError(null);
            }}
          />
          <Input
            label="Ticket type"
            value={ticketType}
            disabled={submitting}
            onChange={(e) => {
              setTicketType(e.target.value);
              setError(null);
            }}
          />
        </div>
        <div className="add-attendee-modal__actions">
          <Button type="button" variant="secondary" disabled={submitting} onClick={handleClose}>
            Cancel
          </Button>
          <Button type="button" variant="primary" disabled={!canSubmit} onClick={() => void handleSubmit()}>
            {submitting ? "Adding…" : "Add attendee"}
          </Button>
        </div>
      </div>
    </div>
  );
}
