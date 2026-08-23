import { useEffect, useRef, useState } from "react";
import { Input } from "@admitto/ui";
import { fetchEventAttendees } from "../api/client.js";
import type { AttendeeRowDto } from "../api/types.js";
import "./attendee-picker.css";

const SEARCH_DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;

/** Minimal shape the picker itself ever reads - a narrower search endpoint (e.g. the wallet
 * message picker's own attendees search, which only returns id/name/email) can satisfy this
 * without matching AttendeeRowDto's full shape. */
export type AttendeePickerRow = { id: string; name: string; email: string };

export type AttendeePickerSearchFn<T extends AttendeePickerRow> = (
  eventId: string,
  params: { q: string; pageSize: number },
) => Promise<{ items: T[] }>;

export interface AttendeePickerProps<T extends AttendeePickerRow = AttendeeRowDto> {
  eventId: string;
  selected: T[];
  onChange: (selected: T[]) => void;
  disabled?: boolean;
  /** Defaults to the general attendee search (fetchEventAttendees) - pass a narrower search
   * function (e.g. one scoped to wallet-pass holders) to reuse this same picker UI for a
   * different recipient universe without duplicating the component. */
  searchFn?: AttendeePickerSearchFn<T>;
}

/** Type-to-search attendee picker for a "Specific attendees" recipient option: search by name or
 * email, click a result to add them as a removable chip. Debounce + stale-response guard mirror
 * VenueAutocomplete.tsx; the chip list mirrors UserEditModal's pendingAdds pattern. Results
 * already in `selected` are filtered out of the dropdown so nothing can be added twice. */
export function AttendeePicker<T extends AttendeePickerRow = AttendeeRowDto>({
  eventId,
  selected,
  onChange,
  disabled = false,
  searchFn = fetchEventAttendees as unknown as AttendeePickerSearchFn<T>,
}: Readonly<AttendeePickerProps<T>>) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<T[]>([]);
  const [visible, setVisible] = useState(false);
  const [searching, setSearching] = useState(false);
  const searchTimerRef = useRef<number | null>(null);
  const blurTimerRef = useRef<number | null>(null);
  // Guards against a slow, stale search response overwriting a newer one that resolved first -
  // same seq-counter pattern as VenueAutocomplete/CheckInPage's own typeaheads.
  const seqRef = useRef(0);

  useEffect(() => {
    return () => {
      if (searchTimerRef.current != null) window.clearTimeout(searchTimerRef.current);
      if (blurTimerRef.current != null) window.clearTimeout(blurTimerRef.current);
    };
  }, []);

  // Event switch: drop in-flight results and the typed query so a slow prior search cannot paint
  // another event's attendees under the new picker (or leave stale chips via parent selection).
  useEffect(() => {
    if (searchTimerRef.current != null) window.clearTimeout(searchTimerRef.current);
    seqRef.current += 1;
    setQuery("");
    setResults([]);
    setVisible(false);
    setSearching(false);
  }, [eventId]);

  const selectedIds = new Set(selected.map((a) => a.id));

  const runSearch = async (q: string) => {
    const seq = ++seqRef.current;
    setSearching(true);
    try {
      const res = await searchFn(eventId, { q, pageSize: 10 });
      if (seq !== seqRef.current) return;
      setResults(res.items);
      setVisible(res.items.length > 0);
    } catch {
      if (seq !== seqRef.current) return;
      setResults([]);
      setVisible(false);
    } finally {
      if (seq === seqRef.current) setSearching(false);
    }
  };

  const handleChange = (text: string) => {
    setQuery(text);
    if (searchTimerRef.current != null) window.clearTimeout(searchTimerRef.current);
    const trimmed = text.trim();
    // Invalidate any in-flight search immediately - including while the debounce timer is still
    // waiting - so a slow prior response cannot land under the newly typed query.
    seqRef.current += 1;
    setResults([]);
    setVisible(false);
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setSearching(false);
      return;
    }
    searchTimerRef.current = window.setTimeout(() => void runSearch(trimmed), SEARCH_DEBOUNCE_MS);
  };

  const handleSelect = (attendee: T) => {
    seqRef.current += 1;
    setResults([]);
    setVisible(false);
    setQuery("");
    onChange([...selected, attendee]);
  };

  const handleRemove = (id: string) => {
    onChange(selected.filter((a) => a.id !== id));
  };

  const handleBlur = () => {
    // A suggestion button's own onMouseDown already prevents default so a mouse click never
    // blurs the input in the first place; this short delay is a second line of defense for
    // pointer types where that doesn't hold, so a tap still lands (same as VenueAutocomplete).
    blurTimerRef.current = window.setTimeout(() => setVisible(false), 150);
  };

  const handleFocus = () => {
    if (blurTimerRef.current != null) {
      window.clearTimeout(blurTimerRef.current);
      blurTimerRef.current = null;
    }
    if (results.length > 0) setVisible(true);
  };

  const visibleResults = results.filter((a) => !selectedIds.has(a.id));

  return (
    <div className="attendee-picker">
      <div className="attendee-picker__field">
        <Input
          // No explicit id: Input auto-generates a unique one (useId()) since `label` is set.
          // A hardcoded literal here was safe while only one instance could ever exist on a
          // page, but CommunicationPage now keeps the mail Send tab and the Wallets tab mounted
          // simultaneously (hidden, not unmounted) - picking "Specific attendees" on both would
          // otherwise put two elements with the same id in the DOM at once.
          label="Search attendees"
          value={query}
          placeholder="Search by name or email…"
          icon={<i className="ti ti-search" aria-hidden="true" />}
          autoComplete="off"
          disabled={disabled}
          aria-expanded={visible}
          onChange={(e) => handleChange(e.target.value)}
          onBlur={handleBlur}
          onFocus={handleFocus}
        />
        {searching && <span className="attendee-picker__status">Searching…</span>}
        {visible && visibleResults.length > 0 && (
          <ul className="attendee-picker__suggest" aria-label="Attendee suggestions">
            {visibleResults.map((attendee) => (
              <li key={attendee.id}>
                <button
                  type="button"
                  className="attendee-picker__hit"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleSelect(attendee)}
                >
                  <strong className="attendee-picker__hit-name">{attendee.name}</strong>
                  <span className="attendee-picker__hit-email">{attendee.email}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {selected.length > 0 && (
        <div className="attendee-picker__chips">
          {selected.map((attendee) => (
            <span key={attendee.id} className="attendee-picker__chip">
              {attendee.name}
              <button
                type="button"
                className="attendee-picker__chip-remove"
                disabled={disabled}
                onClick={() => handleRemove(attendee.id)}
                aria-label={`Remove ${attendee.name}`}
              >
                <i className="ti ti-x" aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
