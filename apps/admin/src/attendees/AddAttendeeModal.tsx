import { useEffect, useId, useRef, useState } from "react";
import { Button, Input } from "@admitto/ui";
import { ApiError, createAttendee, fetchEventItems } from "../api/client.js";
import { hasApiErrorCode, operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { AttendeeDetailDto } from "../api/types.js";
import { CustomDataFieldInput } from "./CustomDataFieldInput.js";
import {
  flattenCustomDataFieldsFromItems,
  initialCustomFieldValues,
  validateCustomFieldsForm,
  type CustomDataFieldDef,
} from "./customData.js";
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
  const [attributeFields, setAttributeFields] = useState<CustomDataFieldDef[]>([]);
  const [customFields, setCustomFields] = useState<Record<string, string>>({});
  const [attributeFieldsLoading, setAttributeFieldsLoading] = useState(false);
  const [attributeFieldsError, setAttributeFieldsError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setAttributeFields([]);
    setCustomFields({});
    setAttributeFieldsLoading(true);
    setAttributeFieldsError(null);
    let cancelled = false;
    fetchEventItems(eventId)
      .then((items) => {
        if (cancelled) return;
        const fields = flattenCustomDataFieldsFromItems(items);
        setAttributeFields(fields);
        setCustomFields(initialCustomFieldValues(fields));
      })
      .catch(() => {
        if (!cancelled) {
          setAttributeFields([]);
          setAttributeFieldsError("Failed to load attribute fields. Try reopening the dialog.");
        }
      })
      .finally(() => {
        if (!cancelled) setAttributeFieldsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [eventId, open]);

  const resetForm = () => {
    setEmail("");
    setName("");
    setCompany("");
    setDepartment("");
    setTicketType("");
    setCustomFields(initialCustomFieldValues(attributeFields));
    setError(null);
  };

  const handleClose = () => {
    if (submitting) return;
    resetForm();
    onClose();
  };

  useModalFocusTrap(panelRef, open, handleClose);

  const canSubmit =
    email.trim() &&
    name.trim() &&
    isValidEmail(email.trim()) &&
    !submitting &&
    !attributeFieldsLoading &&
    !attributeFieldsError;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    const customValidation = validateCustomFieldsForm(attributeFields, customFields);
    if (customValidation) {
      setError(customValidation);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const custom_data: Record<string, string> = {};
      for (const field of attributeFields) {
        const value = customFields[field.source_field]?.trim();
        if (value) custom_data[field.source_field] = value;
      }
      const attendee = await createAttendee(eventId, {
        email: email.trim(),
        name: name.trim(),
        company: company.trim() || undefined,
        department: department.trim() || undefined,
        ticket_type: ticketType.trim() || undefined,
        ...(Object.keys(custom_data).length > 0 ? { custom_data } : {}),
      });
      onCreated(attendee);
      resetForm();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError("This email is already registered for this event.");
      } else if (
        err instanceof ApiError &&
        err.status === 400 &&
        (hasApiErrorCode(err, "required_custom_data_field_missing") || hasApiErrorCode(err, "validation_failed"))
      ) {
        setError("Check required attribute fields and option values.");
      } else {
        setError(operatorApiErrorMessage(err, "Failed to add attendee. Try again."));
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
        {attributeFieldsError && (
          <p className="add-attendee-modal__error" role="alert">
            {attributeFieldsError}
          </p>
        )}
        {attributeFieldsLoading && (
          <p className="add-attendee-modal__hint">Loading attribute fields…</p>
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
          {attributeFields.map((field) => (
            <CustomDataFieldInput
              key={field.source_field}
              field={field}
              value={customFields[field.source_field] ?? ""}
              disabled={submitting}
              onChange={(next) => {
                setCustomFields((current) => ({ ...current, [field.source_field]: next }));
                setError(null);
              }}
            />
          ))}
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
