import { useEffect, useId, useRef, useState } from "react";
import { Button, Input, ModalBackdrop } from "@admitto/ui";
import { LOCATION_LIMITS } from "@admitto/location";
import { ApiError, createEvent } from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { EventDto, GeocodingResultDto } from "../api/types.js";
import { TimezoneSelect } from "../components/TimezoneSelect.js";
import { DatePicker } from "../components/DatePicker.js";
import { VenueAutocomplete } from "../components/VenueAutocomplete.js";
import { slugFromTitle } from "./slug.js";
import { useModalFocusTrap } from "../components/useModalFocusTrap.js";
import { NO_AUTOFILL_PROPS } from "../settings/mailTransportFormParts.js";
import "../attendees/add-attendee-modal.css";

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
  const [venueName, setVenueName] = useState("");
  // Only set right after picking a geocoding suggestion; free-typed text carries just
  // venue_name below, matching the Location tab's own venue_name vs. geocoded-fields split.
  const [venueGeocode, setVenueGeocode] = useState<GeocodingResultDto | null>(null);
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
    setVenueName("");
    setVenueGeocode(null);
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
    // Create is disabled while submitting or while the form is incomplete.
    setSubmitting(true);
    setError(null);
    try {
      const event = await createEvent({
        title: title.trim(),
        slug: slug.trim(),
        date,
        timezone,
        venue_name: venueName.trim() || undefined,
        formatted_address: venueGeocode?.formatted_address,
        latitude: venueGeocode?.latitude,
        longitude: venueGeocode?.longitude,
        geocoding_provider: venueGeocode?.provider,
      });
      onCreated(event);
      resetForm();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError("This link name is already in use. Choose another.");
      } else {
        setError(operatorApiErrorMessage(err, "Failed to create event. Try again."));
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <dialog className="add-attendee-modal" open aria-modal="true" aria-labelledby={titleId}>
      <ModalBackdrop onClose={handleClose} />
      <div ref={panelRef} className="add-attendee-modal__panel">
        <h2 className="add-attendee-modal__title" id={titleId}>
          <i className="ti ti-calendar-plus" aria-hidden="true" /> New event
        </h2>
        <p className="add-attendee-modal__subtitle">
          Add a title and date. Location is optional.
        </p>
        {error && (
          <p className="add-attendee-modal__error" role="alert">
            {error}
          </p>
        )}
        <div className="add-attendee-modal__fields">
          <Input
            id="ce-title"
            label="Event title *"
            icon={<i className="ti ti-ticket" aria-hidden="true" />}
            value={title}
            maxLength={200}
            required
            disabled={submitting}
            onChange={(e) => setTitle(e.target.value)}
            {...NO_AUTOFILL_PROPS}
          />
          <Input
            id="ce-slug"
            label="Link name *"
            hint="Appears in ticket web links (for example /t/summer-summit/…). Filled from the title — you can edit it now, but not after the event is created."
            icon={<i className="ti ti-link" aria-hidden="true" />}
            value={slug}
            maxLength={80}
            pattern="[a-z0-9_\-]+"
            required
            disabled={submitting}
            onChange={(e) => {
              setSlug(e.target.value);
              setSlugTouched(true);
            }}
            {...NO_AUTOFILL_PROPS}
          />
          <DatePicker
            id="ce-date"
            label="Event date"
            value={date}
            required
            disabled={submitting}
            onChange={setDate}
          />
          <div className="at-field">
            <label className="at-label" htmlFor={timezoneId}>
              Event timezone *
            </label>
            <TimezoneSelect
              id={timezoneId}
              value={timezone}
              onChange={setTimezone}
              disabled={submitting}
              required
            />
          </div>
          <VenueAutocomplete
            id="ce-location"
            label="Location"
            value={venueName}
            maxLength={LOCATION_LIMITS.VENUE_NAME_MAX_LENGTH}
            disabled={submitting}
            placeholder="e.g. Convention Center, Warsaw"
            onChange={(text) => {
              setVenueName(text);
              setVenueGeocode(null);
            }}
            onSelectResult={(result) => {
              setVenueName(result.name ?? result.formatted_address);
              setVenueGeocode(result);
            }}
          />
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
              disabled={submitting || !canSubmit}
              onClick={() => void handleSubmit()}
            >
              {submitting ? "Creating…" : "Create event"}
            </Button>
          </div>
        </div>
      </div>
    </dialog>
  );
}
