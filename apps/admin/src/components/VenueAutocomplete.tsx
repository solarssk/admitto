import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Input } from "@admitto/ui";
import { searchGeocoding } from "../api/client.js";
import type { GeocodingResultDto } from "../api/types.js";
import "./venue-autocomplete.css";

const SEARCH_DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;

export interface VenueAutocompleteProps {
  id: string;
  label: string;
  value: string;
  disabled?: boolean;
  placeholder?: string;
  maxLength?: number;
  hint?: string;
  /** Fired on every keystroke - this is a controlled input, the caller owns the value. */
  onChange: (value: string) => void;
  /** Fired when the admin picks a suggestion - the caller decides what to do with the name,
   * address, and coordinates together (this component only searches and lists candidates). */
  onSelectResult: (result: GeocodingResultDto) => void;
  /** Reports the last search response's `contact_configured` flag, so the caller can surface
   * Nominatim's usage-policy hint (Support contact not set) when it comes back false. */
  onContactConfigured?: (configured: boolean) => void;
}

/**
 * Single-field venue name/address search: type either one, matching places appear in an inline
 * dropdown as you type (styled after check-in's attendee typeahead, `.ck-suggest`) - pick one to
 * fill in coordinates too, or keep typing free text if nothing matches. Replaces the previous
 * two-field (address + search query) plus "Find on map" button design.
 */
export function VenueAutocomplete({
  id,
  label,
  value,
  disabled = false,
  placeholder,
  maxLength,
  hint,
  onChange,
  onSelectResult,
  onContactConfigured,
}: Readonly<VenueAutocompleteProps>) {
  const [results, setResults] = useState<GeocodingResultDto[]>([]);
  const [visible, setVisible] = useState(false);
  const searchTimerRef = useRef<number | null>(null);
  const blurTimerRef = useRef<number | null>(null);
  // Guards against a slow, stale search response overwriting the results of a newer one that
  // resolved first - same seq-counter pattern as CheckInPage's fetchSuggestions.
  const seqRef = useRef(0);

  useEffect(() => {
    return () => {
      if (searchTimerRef.current != null) window.clearTimeout(searchTimerRef.current);
      if (blurTimerRef.current != null) window.clearTimeout(blurTimerRef.current);
    };
  }, []);

  const runSearch = async (query: string) => {
    const seq = ++seqRef.current;
    try {
      const res = await searchGeocoding(query);
      if (seq !== seqRef.current) return;
      setResults(res.results);
      setVisible(res.results.length > 0);
      onContactConfigured?.(res.contact_configured);
    } catch {
      // Silent: suggestions are only an assist - typing free text always still works.
    }
  };

  const handleChange = (text: string) => {
    onChange(text);
    if (searchTimerRef.current != null) window.clearTimeout(searchTimerRef.current);
    const trimmed = text.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      seqRef.current += 1;
      setResults([]);
      setVisible(false);
      return;
    }
    searchTimerRef.current = window.setTimeout(() => {
      void runSearch(trimmed);
    }, SEARCH_DEBOUNCE_MS);
  };

  const handleSelect = (result: GeocodingResultDto) => {
    seqRef.current += 1;
    setResults([]);
    setVisible(false);
    onSelectResult(result);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape" && visible) {
      e.preventDefault();
      setVisible(false);
    }
  };

  const handleBlur = () => {
    // A suggestion button's own onMouseDown already prevents default so a mouse click never
    // blurs the input in the first place; this short delay is a second line of defense for
    // pointer types (touch, some assistive tech) where that doesn't hold, so a tap still lands.
    blurTimerRef.current = window.setTimeout(() => setVisible(false), 150);
  };

  const handleFocus = () => {
    if (results.length > 0) setVisible(true);
  };

  return (
    <div className="venue-autocomplete">
      <Input
        id={id}
        label={label}
        value={value}
        maxLength={maxLength}
        disabled={disabled}
        placeholder={placeholder}
        hint={hint}
        icon={<i className="ti ti-map-pin" aria-hidden="true" />}
        autoComplete="off"
        aria-expanded={visible}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        onFocus={handleFocus}
      />
      {visible && results.length > 0 && (
        <ul className="venue-suggest" aria-label="Venue suggestions">
          {results.map((result, index) => (
            <li key={`${result.latitude},${result.longitude},${index}`}>
              <button
                type="button"
                className="venue-suggest__hit"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleSelect(result)}
              >
                <span className="venue-suggest__info">
                  <strong className="venue-suggest__name">{result.name ?? result.formatted_address}</strong>
                  {result.name && <span className="venue-suggest__meta">{result.formatted_address}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
