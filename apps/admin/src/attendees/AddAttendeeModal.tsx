import { useEffect, useId, useRef, useState } from "react";
import { Button, Input, ModalBackdrop, Notice, Skeleton } from "@admitto/ui";
import { ApiError, createAttendee, fetchTicketTypes } from "../api/client.js";
import { hasApiErrorCode, operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { AttendeeDetailDto, TicketTypeDto } from "../api/types.js";
import { CustomDataFieldInput } from "./CustomDataFieldInput.js";
import {
  customDataApiErrorMessage,
  fetchAttendeeCustomFields,
  initialCustomFieldValues,
  validateCustomFieldsForm,
  type CustomDataFieldDef,
} from "./customData.js";
import { SearchableSelect } from "../components/SearchableSelect.js";
import { useModalFocusTrap } from "../components/useModalFocusTrap.js";
import { useLoadingGate } from "../hooks/useDelayedLoading.js";
import { useOverscrollBounceGuard } from "../hooks/useOverscrollBounceGuard.js";
import { NO_AUTOFILL_PROPS } from "../settings/mailTransportFormParts.js";
import "./add-attendee-modal.css";

type AddAttendeeModalProps = {
  eventId: string;
  open: boolean;
  onClose: () => void;
  onCreated: (attendee: AttendeeDetailDto) => void;
};

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(value);
}

/** Message for a 409 add-attendee failure - event_full (capacity reached) and email_taken
 * (duplicate registration) both return the same HTTP status, so the caller must branch on the
 * error code rather than status alone (extracted out of handleSubmit, SonarCloud S3776; same
 * code/status distinction as AttendeeDetailPage's classifyPassStatusError). */
function add409ErrorMessage(err: ApiError): string {
  if (hasApiErrorCode(err, "event_full") && err.eventFull) {
    const { current, capacity } = err.eventFull;
    return `Event is at capacity (${current}/${capacity}). Free a slot or increase capacity before adding this attendee.`;
  }
  return "This email is already registered for this event.";
}

/** The dialog's fields while they load: the five text fields and the ticket type, drawn over the (still invisible) real ones. */
function FieldsSkeleton() {
  return (
    <div className="add-attendee-modal__fields-skeleton">
      <output className="sr-only">Loading attendee form</output>
      {Array.from({ length: 6 }, (_, i) => (
        <div className="add-attendee-modal__skeleton-field" key={i}>
          <Skeleton variant="rect" width="28%" height={14} />
          <Skeleton variant="rect" height={36} />
        </div>
      ))}
    </div>
  );
}

export function AddAttendeeModal({ eventId, open, onClose, onCreated }: Readonly<AddAttendeeModalProps>) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  useOverscrollBounceGuard(scrollRef, open);
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [company, setCompany] = useState("");
  const [department, setDepartment] = useState("");
  const [ticketType, setTicketType] = useState("");
  const [ticketTypes, setTicketTypes] = useState<TicketTypeDto[]>([]);
  const [ticketTypesLoading, setTicketTypesLoading] = useState(false);
  const [ticketTypesError, setTicketTypesError] = useState<string | null>(null);
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
    fetchAttendeeCustomFields(eventId)
      .then((fields) => {
        if (cancelled) return;
        setAttributeFields(fields);
        setCustomFields(initialCustomFieldValues(fields));
      })
      .catch(() => {
        if (!cancelled) {
          setAttributeFields([]);
          setAttributeFieldsError("Could not load attribute fields. Try reopening the dialog.");
        }
      })
      .finally(() => {
        if (!cancelled) setAttributeFieldsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [eventId, open]);

  useEffect(() => {
    if (!open) return;
    setTicketTypes([]);
    // Clears the *selected* value, not just the options list - leaving a previous event's key
    // selected would let it through, since submit is no longer blocked while this fetch is in
    // flight or has failed (review): the key could mean something else on the new event, or not
    // exist there at all, either way not what the admin intended when they picked it. Same fix
    // already applied to CommunicationSendDialog for the same stale-selection-on-switch pattern.
    setTicketType("");
    setTicketTypesError(null);
    setTicketTypesLoading(true);
    let cancelled = false;
    fetchTicketTypes(eventId)
      .then((types) => {
        if (!cancelled) setTicketTypes(types);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setTicketTypes([]);
          setTicketTypesError(operatorApiErrorMessage(err, "Could not load ticket types."));
        }
      })
      .finally(() => {
        if (!cancelled) setTicketTypesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [eventId, open]);

  const resetForm = () => {
    setEmail("");
    setFirstName("");
    setLastName("");
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

  // Unlike attribute fields (which can include required fields the form can't validate without
  // their defs), ticket_type is always optional - a loading/failed catalog only means the
  // dropdown can't offer a real choice yet (it shows just the blank option), not that submitting
  // with no type selected is invalid. Blocking the whole form here would stop an admin from
  // adding a typeless attendee during a brief load or a transient fetch failure.
  const canSubmit =
    email.trim() &&
    firstName.trim() &&
    lastName.trim() &&
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
        first_name: firstName.trim(),
        last_name: lastName.trim(),
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
        setError(add409ErrorMessage(err));
      } else if (
        err instanceof ApiError &&
        err.status === 400 &&
        (hasApiErrorCode(err, "required_custom_data_field_missing") ||
          hasApiErrorCode(err, "unknown_custom_data_field") ||
          hasApiErrorCode(err, "validation_failed"))
      ) {
        // Another admin may have changed this field's options/type between this modal's load and
        // this submit - the server just validated against its current config, so re-fetch before
        // describing the failure instead of quoting the (possibly now-wrong) options this form
        // loaded with. Falls back to what's already in state if the re-fetch itself fails.
        const freshFields = await fetchAttendeeCustomFields(eventId).catch(() => attributeFields);
        setAttributeFields(freshFields);
        setError(
          customDataApiErrorMessage(freshFields, err) ??
            "Check the attribute fields and try again.",
        );
      } else {
        setError(operatorApiErrorMessage(err, "Failed to add attendee. Try again."));
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Both catalogs (ticket types, custom fields) load as the dialog opens, and the form appears as one
  // piece once they are in: until then the fields are in the dialog but invisible (so the dialog
  // already has its size), and a skeleton of the same shape is drawn over them after 200ms and kept
  // for at least 400ms. A fetch that answers faster shows nothing at all.
  const fieldsGate = useLoadingGate(attributeFieldsLoading || ticketTypesLoading);
  const fieldsHeld = !fieldsGate.showContent;

  if (!open) return null;

  return (
    <dialog className="add-attendee-modal" open aria-modal="true" aria-labelledby={titleId}>
      <ModalBackdrop onClose={handleClose} />
      <div ref={panelRef} className="add-attendee-modal__panel">
      <div ref={scrollRef} className="add-attendee-modal__scroll at-scroll">
        <h2 className="add-attendee-modal__title" id={titleId}>
          <i className="ti ti-user-plus" aria-hidden="true" /> Add attendee
        </h2>
        <p className="add-attendee-modal__subtitle">
          Enter their email, first name, and last name. Everything else is optional.
        </p>
        {error && (
          <Notice variant="error" role="alert">
            {error}
          </Notice>
        )}
        {attributeFieldsError && (
          <Notice variant="error" role="alert">
            {attributeFieldsError}
          </Notice>
        )}
        {ticketTypesError && (
          <Notice variant="error" role="alert">
            {ticketTypesError}
          </Notice>
        )}
        <div
          className={`add-attendee-modal__fields ${fieldsHeld ? "at-loading-hold" : "at-fade-in"}`}
          aria-busy={fieldsHeld || undefined}
        >
          {fieldsHeld && fieldsGate.showIndicator && <FieldsSkeleton />}
          <Input
            label="Email *"
            type="text"
            inputMode="email"
            required
            icon={<i className="ti ti-mail" aria-hidden="true" />}
            value={email}
            disabled={submitting}
            onChange={(e) => {
              setEmail(e.target.value);
              setError(null);
            }}
            {...NO_AUTOFILL_PROPS}
          />
          <Input
            label="First name *"
            required
            icon={<i className="ti ti-user" aria-hidden="true" />}
            value={firstName}
            disabled={submitting}
            onChange={(e) => {
              setFirstName(e.target.value);
              setError(null);
            }}
            {...NO_AUTOFILL_PROPS}
          />
          <Input
            label="Last name *"
            required
            icon={<i className="ti ti-user" aria-hidden="true" />}
            value={lastName}
            disabled={submitting}
            onChange={(e) => {
              setLastName(e.target.value);
              setError(null);
            }}
            {...NO_AUTOFILL_PROPS}
          />
          <Input
            label="Company"
            icon={<i className="ti ti-building" aria-hidden="true" />}
            value={company}
            disabled={submitting}
            onChange={(e) => {
              setCompany(e.target.value);
              setError(null);
            }}
          />
          <Input
            label="Department"
            icon={<i className="ti ti-sitemap" aria-hidden="true" />}
            value={department}
            disabled={submitting}
            onChange={(e) => {
              setDepartment(e.target.value);
              setError(null);
            }}
          />
          <div className="at-field">
            <label className="at-label" htmlFor="add-attendee-ticket-type">
              Ticket type
            </label>
            <SearchableSelect
              id="add-attendee-ticket-type"
              label="Ticket type"
              placeholder="-"
              searchPlaceholder="Search ticket types…"
              emptyLabel="No ticket types found"
              showLabel={false}
              value={ticketType}
              options={[
                { id: "", label: "No ticket type" },
                ...ticketTypes.map((type) => ({ id: type.key, label: type.label })),
              ]}
              disabled={submitting}
              onChange={(id) => {
                setTicketType(id);
                setError(null);
              }}
            />
          </div>
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
          <p className="add-attendee-modal__required-hint">* Required</p>
          <div className="add-attendee-modal__actions-buttons">
            <Button type="button" variant="secondary" disabled={submitting} onClick={handleClose}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={!canSubmit}
              loading={submitting}
              loadingLabel="Adding…"
              onClick={() => void handleSubmit()}
            >
              Add attendee
            </Button>
          </div>
        </div>
      </div>
      </div>
    </dialog>
  );
}
