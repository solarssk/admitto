import { useEffect, useId, useRef, useState } from "react";
import { Button, Input, ModalBackdrop } from "@admitto/ui";
import { LOCATION_LIMITS } from "@admitto/location";
import { ApiError, createEvent } from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { EventDto, GeocodingResultDto } from "../api/types.js";
import { TimezoneSelect } from "../components/TimezoneSelect.js";
import { DatePicker } from "../components/DatePicker.js";
import { TimeInput } from "../components/TimeInput.js";
import { VenueAutocomplete } from "../components/VenueAutocomplete.js";
import { slugFromTitle } from "./slug.js";
import { useModalFocusTrap } from "../components/useModalFocusTrap.js";
import { useOverscrollBounceGuard } from "../hooks/useOverscrollBounceGuard.js";
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
  const scrollRef = useRef<HTMLDivElement>(null);
  useOverscrollBounceGuard(scrollRef, open);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [date, setDate] = useState("");
  const [eventHoursStart, setEventHoursStart] = useState("");
  const [eventHoursEnd, setEventHoursEnd] = useState("");
  const [eventHoursStartValid, setEventHoursStartValid] = useState(true);
  const [eventHoursEndValid, setEventHoursEndValid] = useState(true);
  const eventHoursStartValidRef = useRef(true);
  const eventHoursEndValidRef = useRef(true);
  const [timezone, setTimezone] = useState(defaultBrowserTimezone);
  const [venueName, setVenueName] = useState("");
  // Only set right after picking a geocoding suggestion; free-typed text carries just
  // venue_name below, matching the Location tab's own venue_name vs. geocoded-fields split.
  const [venueGeocode, setVenueGeocode] = useState<GeocodingResultDto | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSlug(slugFromTitle(title, 80));
  }, [title]);

  const resetForm = () => {
    setTitle("");
    setSlug("");
    setDate("");
    setEventHoursStart("");
    setEventHoursEnd("");
    eventHoursStartValidRef.current = true;
    eventHoursEndValidRef.current = true;
    setEventHoursStartValid(true);
    setEventHoursEndValid(true);
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

  const canSubmit = Boolean(title.trim() && slug.trim() && date && timezone && eventHoursStartValid && eventHoursEndValid);

  const updateEventHoursStartValidity = (valid: boolean) => {
    eventHoursStartValidRef.current = valid;
    setEventHoursStartValid(valid);
  };

  const updateEventHoursEndValidity = (valid: boolean) => {
    eventHoursEndValidRef.current = valid;
    setEventHoursEndValid(valid);
  };

  const handleSubmit = async () => {
    // Create is disabled while submitting or while the form is incomplete.
    // The refs make the just-blurred TimeInput authoritative even before React re-renders its button.
    if (!canSubmit || !eventHoursStartValidRef.current || !eventHoursEndValidRef.current) return;
    setSubmitting(true);
    setError(null);
    try {
      const event = await createEvent({
        title: title.trim(),
        slug: slug.trim(),
        date,
        timezone,
        event_hours_start: eventHoursStart || undefined,
        event_hours_end: eventHoursEnd || undefined,
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
        setError("An event with a similar name already exists. Change the title slightly and try again.");
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
      <div ref={scrollRef} className="add-attendee-modal__scroll">
        <h2 className="add-attendee-modal__title" id={titleId}>
          <i className="ti ti-calendar-plus" aria-hidden="true" /> New event
        </h2>
        <p className="add-attendee-modal__subtitle">
          Add a title and date.
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
          <DatePicker
            id="ce-date"
            label="Event date"
            value={date}
            required
            disabled={submitting}
            onChange={setDate}
          />
          <div className="add-attendee-modal__time-range">
            <div className="add-attendee-modal__field-row">
              <TimeInput
                id="ce-hours-start"
                label="Event hours (start)"
                value={eventHoursStart}
                disabled={submitting}
                onChange={setEventHoursStart}
                onValidityChange={updateEventHoursStartValidity}
              />
              <TimeInput
                id="ce-hours-end"
                label="Event hours (end)"
                value={eventHoursEnd}
                disabled={submitting}
                onChange={setEventHoursEnd}
                pickerAlign="end"
                onValidityChange={updateEventHoursEndValidity}
              />
            </div>
            <span className="at-hint">Optional. Shown on tickets and wallet passes as a time range.</span>
          </div>
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
              hint="Search by city (for example Warsaw). Admitto saves the official region clock for that place (shown as Europe/Warsaw) so event times and reports stay correct."
            />
          </div>
          <VenueAutocomplete
            id="ce-location"
            label="Location (optional)"
            value={venueName}
            maxLength={LOCATION_LIMITS.VENUE_NAME_MAX_LENGTH}
            disabled={submitting}
            showFindButton={false}
            placeholder="e.g. Convention Center, Warsaw"
            hint="Search a venue or address. If nothing matches, create the event anyway and set the map pin later under Event settings, Location tab."
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
      </div>
    </dialog>
  );
}
