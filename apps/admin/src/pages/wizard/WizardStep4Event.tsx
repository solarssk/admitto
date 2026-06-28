import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
} from "react";
import { Input, useToast } from "@admitto/ui";
import { ApiError, createEvent, fetchAdminEvents } from "../../api/client.js";
import { TimezoneSelect } from "../../components/TimezoneSelect.js";
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
    const [existingEvents, setExistingEvents] = useState<{ id: string; title: string }[]>([]);
    const [loadingEvents, setLoadingEvents] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

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
      setError(null);
      try {
        const event = await createEvent({
          title: title.trim(),
          slug: slug.trim(),
          date,
          timezone,
          location: location.trim() || undefined,
        });
        setSelectedEventId(event.id);
        setSummary({ eventTitle: event.title });
        onDirtyChange?.(false);
        return true;
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          setError("Slug is already in use. Change the event name and try again.");
        } else {
          const message = err instanceof ApiError ? err.message : "Failed to create event.";
          setError(message);
          addToast(message, "error");
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
        <h2 className="setup-wizard__card-title">First event</h2>
        <p className="setup-wizard__card-desc">
          Create your first event so you can start importing attendees and sending tickets.
        </p>

        {!loadingEvents && existingEvents.length > 0 && (
          <div className="setup-wizard__info" role="status">
            <i className="ti ti-info-circle" aria-hidden="true" />
            <span>
              You already have {existingEvents.length === 1 ? "an event" : `${existingEvents.length} events`}.
              You can skip this step or create another.
            </span>
          </div>
        )}

        {error && (
          <p className="setup-wizard__hint" style={{ color: "var(--status-error)" }} role="alert">
            {error}
          </p>
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
              setError(null);
              onDirtyChange?.(true);
            }}
          />
        </div>

        <div className="setup-wizard__field">
          <Input
            label="Date"
            type="date"
            value={date}
            required
            disabled={submitting}
            onChange={(e) => {
              setDate(e.target.value);
              setError(null);
              onDirtyChange?.(true);
            }}
          />
        </div>

        <div className="setup-wizard__field">
          <label className="input-label" htmlFor="wizard-event-timezone">
            Event timezone <span aria-hidden="true">*</span>
          </label>
          <TimezoneSelect
            id="wizard-event-timezone"
            value={timezone}
            onChange={(tz) => {
              setTimezone(tz);
              setError(null);
              onDirtyChange?.(true);
            }}
            disabled={submitting}
            required
          />
        </div>

        <div className="setup-wizard__field">
          <Input
            label="Location (optional)"
            value={location}
            placeholder="e.g. Warsaw, Poland"
            disabled={submitting}
            onChange={(e) => {
              setLocation(e.target.value);
              onDirtyChange?.(true);
            }}
          />
        </div>

        {slug && (
          <p className="setup-wizard__hint">Your event will be available at /t/{slug}</p>
        )}
      </>
    );
  },
);
