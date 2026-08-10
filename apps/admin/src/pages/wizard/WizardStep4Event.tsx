import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
} from "react";
import { Input, Notice, useToast } from "@admitto/ui";
import { LOCATION_LIMITS } from "@admitto/location";
import { ApiError, createEvent, fetchAdminEvents } from "../../api/client.js";
import { operatorApiErrorMessage } from "../../api/operator-api-error.js";
import { DatePicker } from "../../components/DatePicker.js";
import { TimezoneSelect } from "../../components/TimezoneSelect.js";
import { VenueAutocomplete } from "../../components/VenueAutocomplete.js";
import type { GeocodingResultDto } from "../../api/types.js";
import { slugFromTitle } from "../../events/slug.js";
import { useWizard } from "./WizardContext.js";

export type WizardStep4EventHandle = {
  createAndContinue: () => Promise<boolean>;
};

type WizardStep4EventProps = {
  onCanContinueChange: (can: boolean) => void;
  onHasExistingEventsChange: (has: boolean) => void;
  onDirtyChange?: (dirty: boolean) => void;
};

export const WizardStep4Event = forwardRef<WizardStep4EventHandle, WizardStep4EventProps>(
  function WizardStep4Event(
    { onCanContinueChange, onHasExistingEventsChange, onDirtyChange },
    ref,
  ) {
    const { addToast } = useToast();
    const { setSelectedEventId, setSummary } = useWizard();
    const [title, setTitle] = useState("");
    const [date, setDate] = useState("");
    const [timezone, setTimezone] = useState(
      () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
    const [location, setLocation] = useState("");
    const [locationGeocode, setLocationGeocode] = useState<GeocodingResultDto | null>(null);
    const [existingEvents, setExistingEvents] = useState<{ id: string; title: string }[]>([]);
    const [loadingEvents, setLoadingEvents] = useState(true);
    const [submitting, setSubmitting] = useState(false);

    const slug = slugFromTitle(title, 80);
    const canSubmit = Boolean(title.trim() && date && slug.length > 0 && timezone);

    useEffect(() => {
      onCanContinueChange(canSubmit);
    }, [canSubmit, onCanContinueChange]);

    useEffect(() => {
      const ac = new AbortController();
      setLoadingEvents(true);
      void (async () => {
        try {
          const events = await fetchAdminEvents({ signal: ac.signal });
          if (ac.signal.aborted) return;
          const list = events.map((e) => ({ id: e.id, title: e.title }));
          setExistingEvents(list);
          onHasExistingEventsChange(list.length > 0);
          if (list.length === 1) {
            setSelectedEventId(list[0].id);
            setSummary({ eventTitle: list[0].title });
          }
        } catch {
          if (!ac.signal.aborted) onHasExistingEventsChange(false);
        } finally {
          if (!ac.signal.aborted) setLoadingEvents(false);
        }
      })();
      return () => ac.abort();
    }, [onHasExistingEventsChange, setSelectedEventId, setSummary]);

    const createAndContinue = async (): Promise<boolean> => {
      if (!canSubmit || submitting) return false;
      setSubmitting(true);
      try {
        const event = await createEvent({
          title: title.trim(),
          slug: slug.trim(),
          date,
          timezone,
          venue_name: location.trim() || undefined,
          formatted_address: locationGeocode?.formatted_address,
          latitude: locationGeocode?.latitude,
          longitude: locationGeocode?.longitude,
          geocoding_provider: locationGeocode?.provider,
        });
        setSelectedEventId(event.id);
        setSummary({ eventTitle: event.title });
        onDirtyChange?.(false);
        return true;
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          addToast("An event with a similar name already exists. Change the title slightly and try again.", "error");
        } else {
          addToast(operatorApiErrorMessage(err, "Failed to create event."), "error");
        }
        return false;
      } finally {
        setSubmitting(false);
      }
    };

    useImperativeHandle(ref, () => ({
      createAndContinue,
    }));

    return (
      <>
        <p className="setup-wizard__step-sub">
          Create your first event so you can start importing attendees and sending tickets.
        </p>

        {!loadingEvents && existingEvents.length > 0 && (
          <Notice variant="info" as="output">
            You already have {existingEvents.length === 1 ? "an event" : `${existingEvents.length} events`}.
            You can skip this step or create another.
          </Notice>
        )}

        <div className="setup-wizard__field">
          <Input
            label="Event name"
            value={title}
            placeholder="e.g. Summer Conference 2026"
            required
            disabled={submitting}
            onChange={(e) => {
              setTitle(e.target.value);
              onDirtyChange?.(true);
            }}
          />
        </div>

        <div className="setup-wizard__field setup-wizard__field--popover">
          <DatePicker
            label="Date"
            value={date}
            required
            disabled={submitting}
            onChange={(next) => {
              setDate(next);
              onDirtyChange?.(true);
            }}
          />
        </div>

        <div className="setup-wizard__field setup-wizard__field--popover">
          <label className="input-label" htmlFor="wizard-event-timezone">
            Event timezone <span aria-hidden="true">*</span>
          </label>
          <TimezoneSelect
            id="wizard-event-timezone"
            value={timezone}
            compact
            onChange={(tz) => {
              setTimezone(tz);
              onDirtyChange?.(true);
            }}
            disabled={submitting}
            required
            hint="Search by city (for example Warsaw). Admitto saves the official region clock for that place (shown as Europe/Warsaw)."
          />
        </div>

        <div className="setup-wizard__field">
          <VenueAutocomplete
            id="wizard-event-location"
            label="Location (optional)"
            value={location}
            maxLength={LOCATION_LIMITS.VENUE_NAME_MAX_LENGTH}
            disabled={submitting}
            showFindButton={false}
            placeholder="e.g. Warsaw, Poland"
            onChange={(text) => {
              setLocation(text);
              setLocationGeocode(null);
              onDirtyChange?.(true);
            }}
            onSelectResult={(result) => {
              setLocation(result.name ?? result.formatted_address);
              setLocationGeocode(result);
              onDirtyChange?.(true);
            }}
          />
        </div>
      </>
    );
  },
);
