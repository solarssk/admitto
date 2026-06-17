import type { LookupAttendeeResult } from "../api/types.js";

type ManualLookupPanelProps = {
  open: boolean;
  query: string;
  results: LookupAttendeeResult[];
  busy: boolean;
  canAct: boolean;
  onToggle: () => void;
  onQueryChange: (value: string) => void;
  onSearch: () => void;
  onSelect: (attendeeId: string) => void;
};

export function ManualLookupPanel({
  open,
  query,
  results,
  busy,
  canAct,
  onToggle,
  onQueryChange,
  onSearch,
  onSelect,
}: ManualLookupPanelProps) {
  return (
    <>
      <button
        type="button"
        className="checkin-action-btn checkin-action-btn--block"
        onClick={onToggle}
      >
        {open ? "Hide lookup" : "Manual lookup"}
      </button>

      {open && (
        <div className="checkin-lookup">
          <input
            className="at-input"
            placeholder="Name, email, or company"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            disabled={!canAct || busy}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onSearch();
              }
            }}
          />
          <button
            type="button"
            className="checkin-action-btn"
            disabled={!canAct || busy || !query.trim()}
            onClick={onSearch}
          >
            Search
          </button>
          <ul className="checkin-lookup__results">
            {results.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className="checkin-lookup__hit"
                  disabled={busy}
                  onClick={() => onSelect(r.id)}
                >
                  <strong>{r.name}</strong>
                  <span>
                    {[r.company, r.ticket_type].filter(Boolean).join(" · ") || "—"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
