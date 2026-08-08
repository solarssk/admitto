import { useEffect, useRef, useState } from "react";
import { Input } from "@admitto/ui";
import { fetchEventAttendees } from "../api/client.js";
import type { AttendeeRowDto } from "../api/types.js";
import "./attendee-picker.css";

const SEARCH_DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;

export interface AttendeePickerProps {
  eventId: string;
  selected: AttendeeRowDto[];
  onChange: (selected: AttendeeRowDto[]) => void;
  disabled?: boolean;
}

/** Type-to-search attendee picker for the "Specific attendees" Send recipient option: search by
 * name or email, click a result to add them as a removable chip. Debounce + stale-response guard
 * mirror VenueAutocomplete.tsx; the chip list mirrors UserEditModal's pendingAdds pattern.
 * Results already in `selected` are filtered out of the dropdown so nothing can be added twice. */
export function AttendeePicker({
  eventId,
  selected,
  onChange,
  disabled = false,
}: Readonly<AttendeePickerProps>) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AttendeeRowDto[]>([]);
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

  const selectedIds = new Set(selected.map((a) => a.id));

  const runSearch = async (q: string) => {
    const seq = ++seqRef.current;
    setSearching(true);
    try {
      const res = await fetchEventAttendees(eventId, { q, pageSize: 10 });
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
    if (trimmed.length < MIN_QUERY_LENGTH) {
      seqRef.current += 1;
      setResults([]);
      setVisible(false);
      return;
    }
    searchTimerRef.current = window.setTimeout(() => void runSearch(trimmed), SEARCH_DEBOUNCE_MS);
  };

  const handleSelect = (attendee: AttendeeRowDto) => {
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
          id="communication-attendee-picker"
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
