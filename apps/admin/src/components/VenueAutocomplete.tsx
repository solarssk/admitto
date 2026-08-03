import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { Button, Input, Notice } from "@admitto/ui";
import { searchGeocoding } from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { GeocodingResultDto } from "../api/types.js";
import "./venue-autocomplete.css";

const SEARCH_DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;
const SUGGEST_MAX_HEIGHT_PX = 320;
const SUGGEST_MARGIN_PX = 4;
const VIEWPORT_PAD_PX = 8;

const HIDDEN_FIXED: CSSProperties = {
  position: "fixed",
  visibility: "hidden",
  // Above add-attendee-modal (z-index 1000) when this list escapes overflow:auto.
  zIndex: 1100,
};

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
  onChange,
  onSelectResult,
  onContactConfigured,
}: Readonly<VenueAutocompleteProps>) {
  const [results, setResults] = useState<GeocodingResultDto[]>([]);
  const [visible, setVisible] = useState(false);
  const [suggestStyle, setSuggestStyle] = useState<CSSProperties>(HIDDEN_FIXED);
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

  useEffect(() => {
    return () => {
      if (searchTimerRef.current != null) window.clearTimeout(searchTimerRef.current);
      if (blurTimerRef.current != null) window.clearTimeout(blurTimerRef.current);
    };
  }, []);

  useLayoutEffect(() => {
    if (!visible || !fieldRef.current || !suggestRef.current) return;

    const updatePlacement = () => {
      const field = fieldRef.current!;
      const list = suggestRef.current!;
      const fieldBox = field.getBoundingClientRect();
      const anchor =
        field.querySelector<HTMLElement>("input") ?? field;
      const rect = anchor.getBoundingClientRect();
      const listHeight = Math.min(list.scrollHeight, SUGGEST_MAX_HEIGHT_PX);
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      const above =
        spaceBelow < listHeight + SUGGEST_MARGIN_PX && spaceAbove > spaceBelow;
      const available = (above ? spaceAbove : spaceBelow) - SUGGEST_MARGIN_PX - VIEWPORT_PAD_PX;
      const maxHeight = Math.max(120, Math.min(SUGGEST_MAX_HEIGHT_PX, available));
      const height = Math.min(list.scrollHeight, maxHeight);
      const top = above
        ? rect.top - height - SUGGEST_MARGIN_PX
        : rect.bottom + SUGGEST_MARGIN_PX;

      setSuggestStyle({
        position: "fixed",
        top,
        left: fieldBox.left,
        width: fieldBox.width,
        maxHeight,
        visibility: "visible",
        zIndex: 1100,
      });
    };

    updatePlacement();
    window.addEventListener("resize", updatePlacement);
    // Capture scroll: a fixed list would drift when the modal body scrolls under it.
    // Ignore scrolls that originate inside the list itself.
    const onScroll = (event: Event) => {
      if (suggestRef.current?.contains(event.target as Node)) return;
      setVisible(false);
    };
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", updatePlacement);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [visible, results.length]);

  const runSearch = async (query: string, opts?: { fromFindButton?: boolean }) => {
    const seq = ++seqRef.current;
    if (opts?.fromFindButton) setSearching(true);
    try {
      const res = await searchGeocoding(query);
      if (seq !== seqRef.current) return;
      setResults(res.results);
      setSuggestStyle(HIDDEN_FIXED);
      setVisible(res.results.length > 0);
      setNoMatch(opts?.fromFindButton === true && res.results.length === 0);
      setSearchError(null);
      onContactConfigured?.(res.contact_configured);
    } catch (err) {
      if (seq !== seqRef.current) return;
      setResults([]);
      setVisible(false);
      if (opts?.fromFindButton) {
        setNoMatch(false);
        setSearchError(operatorApiErrorMessage(err, "Address lookup failed. Try again shortly."));
      }
    } finally {
      if (opts?.fromFindButton && seq === seqRef.current) setSearching(false);
    }
  };

  const hideSuggestions = () => {
    setVisible(false);
    setSuggestStyle(HIDDEN_FIXED);
  };

  const handleChange = (text: string) => {
    onChange(text);
    setNoMatch(false);
    setSearchError(null);
    if (searchTimerRef.current != null) window.clearTimeout(searchTimerRef.current);
    const trimmed = text.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      seqRef.current += 1;
      setResults([]);
      hideSuggestions();
      return;
    }
    searchTimerRef.current = window.setTimeout(() => {
      void runSearch(trimmed);
    }, SEARCH_DEBOUNCE_MS);
  };

  const handleFind = () => {
    if (searchTimerRef.current != null) window.clearTimeout(searchTimerRef.current);
    const trimmed = value.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setNoMatch(false);
      setSearchError(null);
      setResults([]);
      hideSuggestions();
      return;
    }
    void runSearch(trimmed, { fromFindButton: true });
  };

  const handleSelect = (result: GeocodingResultDto) => {
    seqRef.current += 1;
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
      setSuggestStyle(HIDDEN_FIXED);
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
            disabled={disabled || searching}
            onClick={handleFind}
          >
            <i className="ti ti-map-search" aria-hidden="true" />
            {searching ? "Searching…" : "Find on map"}
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
