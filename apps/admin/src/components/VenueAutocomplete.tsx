import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Button, Input, Notice } from "@admitto/ui";
import { searchGeocoding } from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { GeocodingResultDto } from "../api/types.js";
import { useFloatingPlacement } from "./useFloatingPlacement.js";
import "./venue-autocomplete.css";

const SEARCH_DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;
const SUGGEST_MAX_HEIGHT_PX = 320;
const SUGGEST_GAP_PX = 4;
const SUGGEST_MIN_HEIGHT_PX = 120;
// Above add-attendee-modal (z-index 1000) when this list escapes overflow:auto.
const SUGGEST_Z_INDEX = 1100;

export interface VenueAutocompleteProps {
  id: string;
  label: string;
  value: string;
  disabled?: boolean;
  placeholder?: string;
  maxLength?: number;
  hint?: string;
  /** When true (default), shows a "Find on map" button that runs search immediately. */
  showFindButton?: boolean;
  /** When this value changes, cancel any in-flight lookup and clear suggestions/feedback. */
  lookupResetKey?: number;
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
 * Single-field venue name/address search: type either one, matching places appear in a fixed
 * dropdown as you type (styled after check-in's attendee typeahead, `.ck-suggest`) - pick one to
 * fill in coordinates too, or keep typing free text if nothing matches. An optional "Find on map"
 * button forces the same search immediately and shows a no-match notice when OSM returns nothing.
 *
 * Suggestions use `position: fixed` (same idea as DeliveryRowMenu) so an ancestor with
 * `overflow: auto` (e.g. New event modal) neither clips the list nor grows scroll height.
 */
export function VenueAutocomplete({
  id,
  label,
  value,
  disabled = false,
  placeholder,
  maxLength,
  hint,
  showFindButton = true,
  lookupResetKey = 0,
  onChange,
  onSelectResult,
  onContactConfigured,
}: Readonly<VenueAutocompleteProps>) {
  const [results, setResults] = useState<GeocodingResultDto[]>([]);
  const [visible, setVisible] = useState(false);
  const [searching, setSearching] = useState(false);
  const [noMatch, setNoMatch] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchTimerRef = useRef<number | null>(null);
  const blurTimerRef = useRef<number | null>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const suggestRef = useRef<HTMLUListElement>(null);
  // Guards against a slow, stale search response overwriting the results of a newer one that
  // resolved first - same seq-counter pattern as CheckInPage's fetchSuggestions.
  const seqRef = useRef(0);

  const hideSuggestions = () => {
    setVisible(false);
  };

  /** Cancel in-flight lookup and clear Find/"Searching…" so a cancelled request cannot stick. */
  const invalidateSearch = () => {
    seqRef.current += 1;
    setSearching(false);
  };

  useEffect(() => {
    if (lookupResetKey === 0) return;
    if (searchTimerRef.current != null) {
      window.clearTimeout(searchTimerRef.current);
      searchTimerRef.current = null;
    }
    seqRef.current += 1;
    setSearching(false);
    setResults([]);
    setVisible(false);
    setNoMatch(false);
    setSearchError(null);
  }, [lookupResetKey]);

  useEffect(() => {
    return () => {
      if (searchTimerRef.current != null) window.clearTimeout(searchTimerRef.current);
      if (blurTimerRef.current != null) window.clearTimeout(blurTimerRef.current);
    };
  }, []);

  // The list is as wide as the field and starts at its left edge, but hangs from the input itself
  // (the field also holds the Find button and the hint under it).
  const suggestOpen = visible && results.length > 0;
  const { panelStyle: suggestStyle } = useFloatingPlacement({
    open: suggestOpen,
    anchorRef: fieldRef,
    panelRef: suggestRef,
    onScrollClose: () => setVisible(false),
    gap: SUGGEST_GAP_PX,
    align: "start",
    matchWidth: true,
    maxHeight: SUGGEST_MAX_HEIGHT_PX,
    minMaxHeight: SUGGEST_MIN_HEIGHT_PX,
    zIndex: SUGGEST_Z_INDEX,
    remeasureKey: results.length,
    getReferenceRect: () => {
      const field = fieldRef.current!;
      const fieldBox = field.getBoundingClientRect();
      const input = (field.querySelector<HTMLElement>("input") ?? field).getBoundingClientRect();
      return { left: fieldBox.left, top: input.top, width: fieldBox.width, height: input.height };
    },
  });

  const runSearch = async (query: string, opts?: { fromFindButton?: boolean }) => {
    const seq = ++seqRef.current;
    const surfaceLookupFeedback = opts?.fromFindButton === true || !showFindButton;
    if (surfaceLookupFeedback) {
      setSearching(true);
      // A search that ends as the one before it did must still be announced again: the notice of the last outcome goes first.
      setNoMatch(false);
      setSearchError(null);
    }
    try {
      const res = await searchGeocoding(query);
      if (seq !== seqRef.current) return;
      setResults(res.results);
      setVisible(res.results.length > 0);
      setNoMatch(surfaceLookupFeedback && res.results.length === 0);
      setSearchError(null);
      onContactConfigured?.(res.contact_configured);
    } catch (err) {
      if (seq !== seqRef.current) return;
      setResults([]);
      setVisible(false);
      if (surfaceLookupFeedback) {
        setNoMatch(false);
        setSearchError(operatorApiErrorMessage(err, "Address lookup failed. Try again shortly."));
      }
    } finally {
      // Whichever kind of search is the newest ends the wait: a Find that a later, typed search took over from must not
      // leave the button busy for good.
      if (seq === seqRef.current) setSearching(false);
    }
  };

  const handleChange = (text: string) => {
    onChange(text);
    setNoMatch(false);
    setSearchError(null);
    if (searchTimerRef.current != null) window.clearTimeout(searchTimerRef.current);
    const trimmed = text.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      invalidateSearch();
      setResults([]);
      hideSuggestions();
      return;
    }
    searchTimerRef.current = window.setTimeout(() => {
      void runSearch(trimmed);
    }, SEARCH_DEBOUNCE_MS);
  };

  const handleFind = () => {
    // Enter in the field does not go through the busy button, which swallows a second click: a Find that is running is not started again.
    if (searching) return;
    if (searchTimerRef.current != null) window.clearTimeout(searchTimerRef.current);
    const trimmed = value.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setNoMatch(false);
      setSearchError(null);
      invalidateSearch();
      setResults([]);
      hideSuggestions();
      return;
    }
    void runSearch(trimmed, { fromFindButton: true });
  };

  const handleSelect = (result: GeocodingResultDto) => {
    invalidateSearch();
    setResults([]);
    hideSuggestions();
    setNoMatch(false);
    setSearchError(null);
    onSelectResult(result);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape" && visible) {
      e.preventDefault();
      hideSuggestions();
    }
    if (e.key === "Enter" && showFindButton) {
      e.preventDefault();
      handleFind();
    }
  };

  const handleBlur = () => {
    // A suggestion button's own onMouseDown already prevents default so a mouse click never
    // blurs the input in the first place; this short delay is a second line of defense for
    // pointer types (touch, some assistive tech) where that doesn't hold, so a tap still lands.
    blurTimerRef.current = window.setTimeout(() => hideSuggestions(), 150);
  };

  const handleFocus = () => {
    if (blurTimerRef.current != null) {
      window.clearTimeout(blurTimerRef.current);
      blurTimerRef.current = null;
    }
    if (results.length > 0) {
      setVisible(true);
    }
  };

  return (
    <div className="venue-autocomplete">
      <div className={showFindButton ? "venue-autocomplete__row" : undefined}>
        <div className="venue-autocomplete__field" ref={fieldRef}>
          <Input
            id={id}
            label={label}
            value={value}
            maxLength={maxLength}
            disabled={disabled}
            placeholder={placeholder}
            /* Hint sits below the input+button row so Find aligns with the control, not the hint. */
            hint={showFindButton ? undefined : hint}
            icon={<i className="ti ti-map-pin" aria-hidden="true" />}
            autoComplete="off"
            aria-expanded={visible}
            aria-describedby={showFindButton && hint ? `${id}-hint` : undefined}
            onChange={(e) => handleChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
            onFocus={handleFocus}
          />
          {visible && results.length > 0 && (
            <ul
              ref={suggestRef}
              className="venue-suggest"
              style={suggestStyle}
              aria-label="Venue suggestions"
            >
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
        {showFindButton && (
          <Button
            type="button"
            variant="secondary"
            className="venue-autocomplete__find"
            disabled={disabled}
            loading={searching}
            loadingLabel="Searching…"
            icon={<i className="ti ti-map-search" aria-hidden="true" />}
            onClick={handleFind}
          >
            Find on map
          </Button>
        )}
      </div>
      {showFindButton && hint && (
        <span id={`${id}-hint`} className="at-hint venue-autocomplete__hint">
          {hint}
        </span>
      )}
      {noMatch && (
        <Notice variant="error" role="status" className="venue-autocomplete__notice">
          No match found on OpenStreetMap. Try a street address with city or country. On the
          Location tab you can also double-click the map to drop a pin and type the venue display
          name manually.
        </Notice>
      )}
      {searchError && (
        <Notice variant="error" role="alert" className="venue-autocomplete__notice">
          {searchError}
        </Notice>
      )}
    </div>
  );
}
