import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Avatar } from "@admitto/ui";
import type { LookupAttendeeResult } from "../api/types.js";
import { checkinSearchFieldAttrs } from "./searchFieldAttrs.js";

const SEARCH_DEBOUNCE_MS = 300;
const MIN_QUERY_LEN = 2;
// A value this long is a pasted/scanned token, not a name search — matches
// the scan bar's WEDGE_AUTO_SUBMIT_LEN so both entry points agree on where
// "name search" ends and "raw token" begins.
const TOKEN_LEN_THRESHOLD = 20;

type CameraOverlayManualSearchProps = {
  allowManualLookup: boolean;
  onSearch: (query: string) => Promise<LookupAttendeeResult[]>;
  onSelectAttendee: (attendeeId: string) => void;
  onManualEntry: (query: string) => Promise<boolean>;
  manualError?: string | null;
  onClearManualError?: () => void;
  onBack: () => void;
};

/** Full-screen search — replaces the camera view while active (#433, mockup ManualSearch.jsx parity). */
export function CameraOverlayManualSearch({
  allowManualLookup,
  onSearch,
  onSelectAttendee,
  onManualEntry,
  manualError,
  onClearManualError,
  onBack,
}: CameraOverlayManualSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LookupAttendeeResult[]>([]);
  const [searched, setSearched] = useState(false);
  const timerRef = useRef<number | null>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    return () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const runSearch = async (value: string) => {
    const seq = ++seqRef.current;
    const found = await onSearch(value);
    if (seq === seqRef.current) {
      setResults(found);
      setSearched(true);
    }
  };

  const onChange = (value: string) => {
    setQuery(value);
    if (manualError) onClearManualError?.();
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    const trimmed = value.trim();
    if (!allowManualLookup || trimmed.length < MIN_QUERY_LEN || trimmed.length >= TOKEN_LEN_THRESHOLD) {
      seqRef.current += 1;
      setResults([]);
      setSearched(false);
      return;
    }
    timerRef.current = window.setTimeout(() => void runSearch(trimmed), SEARCH_DEBOUNCE_MS);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    const trimmed = query.trim();
    if (!trimmed) return;
    // A pasted/scanned token, or an exact query the operator wants to
    // submit directly — same pipeline as the main scan bar.
    void onManualEntry(trimmed);
  };

  return (
    <div className="ms">
      <div className="ms__header">
        <button type="button" className="ms__back" onClick={onBack}>
          <i className="ti ti-arrow-left" aria-hidden="true" /> Back to scanner
        </button>
        <h2>Manual check-in</h2>
        <p>Search by name or email when the QR code doesn&apos;t scan</p>
      </div>
      <div className="ms__body">
        <div className="ms__input">
          <i className="ti ti-search" aria-hidden="true" />
          <input
            autoFocus
            type="text"
            id="ck-overlay-manual-search"
            name="ck-overlay-manual-search"
            value={query}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Name or email address…"
            aria-label="Search by name or email"
            aria-invalid={manualError ? true : undefined}
            aria-describedby={manualError ? "ck-overlay-manual-error" : undefined}
            {...checkinSearchFieldAttrs}
          />
          {query && (
            <button
              type="button"
              className="ms__clear"
              aria-label="Clear search"
              onClick={() => onChange("")}
            >
              <i className="ti ti-x" aria-hidden="true" />
            </button>
          )}
        </div>

        {manualError && (
          <p id="ck-overlay-manual-error" className="ms__error" role="alert">
            {manualError}
          </p>
        )}

        {!allowManualLookup && (
          <div className="ms__empty">
            <i className="ti ti-ban" aria-hidden="true" />
            <span>Manual lookup is disabled for this event — use QR scan only.</span>
          </div>
        )}

        {allowManualLookup && results.length > 0 && (
          <ul className="ms__results">
            {results.map((a) => (
              <li key={a.id} className="ms__row" onClick={() => onSelectAttendee(a.id)}>
                <Avatar name={a.name} />
                <div className="ms__info">
                  <strong>{a.name}</strong>
                  <span>{[a.company, a.ticket_type].filter(Boolean).join(" · ") || "—"}</span>
                </div>
                {a.check_in_status === "admitted" && (
                  <span className="ms__checked">
                    <i className="ti ti-circle-check" aria-hidden="true" /> checked in
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}

        {allowManualLookup && searched && results.length === 0 && query.trim().length >= MIN_QUERY_LEN && (
          <div className="ms__empty">
            <i className="ti ti-user-off" aria-hidden="true" />
            <span>No attendees found for &quot;{query.trim()}&quot;</span>
          </div>
        )}
      </div>
    </div>
  );
}
