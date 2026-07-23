import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@admitto/ui";
import { ApiError, createEvent } from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { EventDto } from "../api/types.js";
import { TimezoneSelect } from "../components/TimezoneSelect.js";
import { DatePicker } from "../components/DatePicker.js";
import { slugFromTitle } from "./slug.js";
import { useModalFocusTrap } from "../components/useModalFocusTrap.js";
import "./create-event-modal.css";

type CreateEventModalProps = {
  open: boolean;
  onClose: () => void;
  onCreated: (event: EventDto) => void;
};

function defaultBrowserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function CreateEventModal({ open, onClose, onCreated }: Readonly<CreateEventModalProps>) {
  const titleId = useId();
  const timezoneId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [date, setDate] = useState("");
  const [timezone, setTimezone] = useState(defaultBrowserTimezone);
  const [location, setLocation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slugTouched) {
      setSlug(slugFromTitle(title, 80));
    }
  }, [title, slugTouched]);

  const resetForm = () => {
    setTitle("");
    setSlug("");
    setSlugTouched(false);
    setDate("");
    setTimezone(defaultBrowserTimezone());
    setLocation("");
    setError(null);
  };

  const handleClose = () => {
    if (submitting) return;
    resetForm();
    onClose();
  };

  useModalFocusTrap(panelRef, open, handleClose);

  const canSubmit = Boolean(title.trim() && slug.trim() && date && timezone);

  const handleSubmit = async () => {
    if (submitting || !canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const event = await createEvent({
        title: title.trim(),
        slug: slug.trim(),
        date,
        timezone,
        location: location.trim() || undefined,
      });
      onCreated(event);
      resetForm();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError("Slug is already in use. Choose another.");
      } else {
        setError(operatorApiErrorMessage(err, "Failed to create event. Try again."));
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="create-event-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div
        className="create-event-modal__backdrop"
        role="presentation"
        onClick={handleClose}
      />
      <div ref={panelRef} className="create-event-modal__panel">
        <h2 className="create-event-modal__title" id={titleId}>
          New event
        </h2>
        {error && (
          <p className="create-event-modal__error" role="alert">
            {error}
          </p>
        )}
        <div className="create-event-modal__form">
          <div className="create-event-modal__field">
            <label htmlFor="ce-title">
              Event title <span aria-hidden="true">*</span>
            </label>
            <input
              id="ce-title"
              className="create-event-modal__input"
              type="text"
              value={title}
              maxLength={200}
              required
              disabled={submitting}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="create-event-modal__field">
            <label htmlFor="ce-slug">
              URL slug <span aria-hidden="true">*</span>
              <span className="form-hint">
                Auto-generated · used in ticket URLs · cannot be changed later.
              </span>
            </label>
            <div className="create-event-modal__slug-wrap">
              <i className="ti ti-link" aria-hidden="true" />
              <input
                id="ce-slug"
                className="create-event-modal__input"
                type="text"
                value={slug}
                maxLength={80}
                pattern="[a-z0-9_-]+"
                required
                disabled={submitting}
                onChange={(e) => {
                  setSlug(e.target.value);
                  setSlugTouched(true);
                }}
              />
            </div>
          </div>
          <div className="create-event-modal__field">
            <DatePicker
              id="ce-date"
              label="Event date"
              value={date}
              required
              disabled={submitting}
              onChange={setDate}
            />
          </div>
          <div className="create-event-modal__field">
            <label htmlFor={timezoneId}>
              Event timezone <span aria-hidden="true">*</span>
            </label>
            <TimezoneSelect
              id={timezoneId}
              value={timezone}
              onChange={setTimezone}
              disabled={submitting}
              required
            />
          </div>
          <div className="create-event-modal__field">
            <label htmlFor="ce-location">
              Location <span className="form-optional">(optional)</span>
            </label>
            <input
              id="ce-location"
              className="create-event-modal__input"
              type="text"
              value={location}
              maxLength={300}
              disabled={submitting}
              onChange={(e) => setLocation(e.target.value)}
            />
          </div>
        </div>
        <div className="create-event-modal__actions">
          <Button type="button" variant="secondary" disabled={submitting} onClick={handleClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={submitting || !canSubmit}
            onClick={() => void handleSubmit()}
          >
            {submitting ? "Creating…" : "Create event"}
          </Button>
        </div>
      </div>
    </div>
  );
}
