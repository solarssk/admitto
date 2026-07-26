import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, useToast } from "@admitto/ui";
import { fetchSystemLogs } from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { SystemLogEntryDto } from "../api/types.js";
import { FiltersMenu } from "../components/FiltersMenu.js";
import { useDelayedLoading } from "../hooks/useDelayedLoading.js";

type LevelFilter = "" | SystemLogEntryDto["level"];
type SourceFilter = "" | SystemLogEntryDto["source"];

const SEARCH_DEBOUNCE_MS = 300;
const POLL_INTERVAL_MS = 1750;
const MAX_RENDERED_ENTRIES = 1000;
// A single missed tick is normal network noise and never surfaced; this many in a row (~9s at
// the interval above) means the endpoint is genuinely down, not just one slow request.
const POLL_DEGRADED_THRESHOLD = 5;

const SOURCE_LABELS: Record<SystemLogEntryDto["source"], string> = {
  api: "API",
  db: "Database",
  cache: "Cache",
  mail: "Mail",
  admin: "Admin",
  security: "Security",
};

// No "Debug" option - nothing in this app ever logs at that level, so a filter option for it
// would always be empty.
const LEVEL_LABELS: Record<SystemLogEntryDto["level"], string> = {
  info: "Info",
  warn: "Warn",
  error: "Error",
};

/** "14:02:11.402 UTC" - UTC, not the viewer's local time, so a line means the same instant no
 * matter who's looking or where the server runs (an operator in India, a server in Poland, a
 * viewer in the US would otherwise each see a different clock for the same event). Also matches
 * the ISO timestamp already written to stdout and the Audit log's own UTC-primary convention, so
 * a live-tail line can be correlated with `docker logs` without a timezone conversion. */
function formatLogTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)} UTC`;
}

function formatLogLine(entry: SystemLogEntryDto): string {
  const base = `${formatLogTime(entry.ts)}  ${LEVEL_LABELS[entry.level].toUpperCase()}  ${SOURCE_LABELS[entry.source]}  ${entry.message}`;
  return entry.fields && Object.keys(entry.fields).length > 0 ? `${base}  ${JSON.stringify(entry.fields)}` : base;
}

/** Extracted from the console's render (SonarCloud S3358: nested ternary) - a plain
 * if/return chain reads clearer than 3 chained ternaries for the same
 * loading/error/empty/lines states, with identical output. */
function renderConsoleBody(
  showLoadingState: boolean,
  error: string | null,
  entries: SystemLogEntryDto[],
  onRetry: () => void,
): ReactNode {
  if (showLoadingState && entries.length === 0) {
    return <div className="system-log-panel__console-empty">Loading system logs…</div>;
  }
  if (error) {
    return (
      <div className="system-log-panel__console-empty system-log-panel__console-empty--error">
        <p>Could not load system logs: {error}</p>
        <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
          Retry
        </Button>
      </div>
    );
  }
  if (entries.length === 0) {
    return (
      <div className="system-log-panel__console-empty">
        <p className="system-log-panel__console-empty-title">No log activity yet</p>
        <p className="system-log-panel__console-empty-desc">
          Activity across the API, database, cache, mail transport, and admin actions will appear here as it happens.
        </p>
      </div>
    );
  }
  return entries.map((entry) => (
    <div key={entry.id} className={`system-log-panel__line system-log-panel__line--${entry.level}`}>
      <span className="system-log-panel__time">{formatLogTime(entry.ts)}</span>
      <span className="system-log-panel__level">{LEVEL_LABELS[entry.level].toUpperCase()}</span>
      <span className="system-log-panel__source">{SOURCE_LABELS[entry.source]}</span>
      <span className="system-log-panel__message">{entry.message}</span>
      {entry.fields && Object.keys(entry.fields).length > 0 && (
        <span className="system-log-panel__fields">{JSON.stringify(entry.fields)}</span>
      )}
    </div>
  ));
}

function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Imperative controls exposed to AuditLogPanel, which hosts the Live/Download buttons in the
 * shared Card header (next to the System/Audit toggle) rather than duplicating that header. */
export interface SystemLogsPanelHandle {
  toggleLive: () => void;
  download: () => void;
}

interface SystemLogsPanelProps {
  isDesktop: boolean;
  /** Rendered inline in this panel's own toolbar on mobile, where AuditLogPanel's Card header
   * only has room for the title and the System/Audit toggle - matches how AuditLogView's own
   * Clear filters/Export CSV move down the same way. Undefined on desktop, where AuditLogPanel
   * renders them in the Card header instead. */
  liveButton?: ReactNode;
  downloadButton?: ReactNode;
  /** Mirrors this panel's own `live` state up so the header's Live/Paused button can reflect it -
   * display only, the panel itself remains the source of truth. */
  onLiveChange?: (live: boolean) => void;
  /** Mirrors whether there's anything to copy/download, so the header's Download button can
   * disable itself the same way the footer's Copy/Clear view buttons already do. */
  onHasEntriesChange?: (hasEntries: boolean) => void;
}

/**
 * Live tail of the in-memory system-log buffer (see @admitto/shared/system-log) - raw
 * API/DB/Cache/Mail/Admin activity for diagnosing issues, not a durable audit trail (that's the
 * Audit log side of this same toggle). Everything shown here is also written to the container's
 * stdout independent of this view, so nothing is lost if the buffer resets or the UI is down.
 */
export const SystemLogsPanel = forwardRef<SystemLogsPanelHandle, SystemLogsPanelProps>(function SystemLogsPanel(
  { isDesktop, liveButton, downloadButton, onLiveChange, onHasEntriesChange },
  ref,
) {
  const [entries, setEntries] = useState<SystemLogEntryDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState<LevelFilter>("");
  const [source, setSource] = useState<SourceFilter>("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [live, setLive] = useState(true);
  // Bumped by the Retry action below - included in the snapshot effect's own deps so a
  // failed initial/filter-change load can be retried without touching level/source/search.
  const [retryTick, setRetryTick] = useState(0);
  // True once the live poll has failed several times in a row (lost superadmin role, the
  // endpoint returning 500s, a network outage) - a single missed tick is never surfaced, but a
  // sustained run of them must not leave the Live pill green and the lines silently stale
  // forever (external review on PR #593).
  const [pollDegraded, setPollDegraded] = useState(false);
  const { addToast } = useToast();
  const cursorRef = useRef(0);
  const pollFailureCountRef = useRef(0);
  const filtersRef = useRef({ level, source, search });
  const consoleRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    filtersRef.current = { level, source, search };
  }, [level, source, search]);

  useEffect(() => {
    onLiveChange?.(live);
  }, [live, onLiveChange]);

  useEffect(() => {
    onHasEntriesChange?.(entries.length > 0);
  }, [entries.length, onHasEntriesChange]);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  // Full snapshot on mount and whenever a filter changes - deliberately separate from the poll
  // effect below so pausing/resuming Live doesn't reset the currently-displayed lines.
  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    fetchSystemLogs(
      { level: level || undefined, source: source || undefined, search: search || undefined },
      ac.signal,
    )
      .then((data) => {
        if (ac.signal.aborted) return;
        setEntries(data.entries);
        cursorRef.current = data.cursor;
      })
      .catch((err) => {
        if (ac.signal.aborted) return;
        setError(operatorApiErrorMessage(err, "Failed to load system logs."));
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [level, source, search, retryTick]);

  // Polling loop, independent of filter changes - reads filtersRef/cursorRef fresh each tick so
  // toggling Live off and back on resumes from where it left off instead of resetting the view.
  useEffect(() => {
    if (!live) return;
    // Re-enabling Live always starts the degraded-state tracking fresh.
    pollFailureCountRef.current = 0;
    setPollDegraded(false);
    let currentAbort: AbortController | null = null;
    // Guards against overlapping polls (CodeRabbit review): without it, a response slower
    // than the 1.75s interval left the previous tick's request in flight when the next tick
    // started a new one - `currentAbort` only ever tracked the latest, so the earlier
    // request was never aborted, and its result could still resolve out of order and rewind
    // cursorRef to an older cursor. Skipping a tick while one is already in flight also means
    // there is only ever one request to abort on unmount/pause.
    let inFlight = false;

    const pollOnce = async () => {
      if (inFlight) return;
      inFlight = true;
      const ac = new AbortController();
      currentAbort = ac;
      const f = filtersRef.current;
      const requestedSince = cursorRef.current;
      const filterParams = { level: f.level || undefined, source: f.source || undefined, search: f.search || undefined };
      try {
        const data = await fetchSystemLogs({ since: requestedSince, ...filterParams }, ac.signal);
        if (ac.signal.aborted) return;
        // The server's cursor is lower than what we just asked for - the process restarted (a
        // fresh in-memory buffer starts its ids at 1 again) or otherwise reset, so `since` no
        // longer means anything and every entry logged since startup would otherwise be
        // silently skipped forever (external review on PR #593). Re-fetch a full snapshot
        // instead of just adopting the new (lower) cursor.
        if (data.cursor < requestedSince) {
          const snapshot = await fetchSystemLogs(filterParams, ac.signal);
          if (ac.signal.aborted) return;
          cursorRef.current = snapshot.cursor;
          setEntries(snapshot.entries);
        } else {
          cursorRef.current = data.cursor;
          if (data.entries.length > 0) {
            setEntries((prev) => {
              const next = [...prev, ...data.entries];
              return next.length > MAX_RENDERED_ENTRIES ? next.slice(next.length - MAX_RENDERED_ENTRIES) : next;
            });
          }
        }
        pollFailureCountRef.current = 0;
        setPollDegraded(false);
      } catch {
        // A single missed poll tick isn't worth surfacing - the next tick 1.75s later retries.
        // But a sustained run of failures (endpoint down, role revoked, network outage) must not
        // leave Live looking green with silently stale lines forever (external review on PR #593).
        pollFailureCountRef.current += 1;
        if (pollFailureCountRef.current >= POLL_DEGRADED_THRESHOLD) setPollDegraded(true);
      } finally {
        inFlight = false;
      }
    };

    const intervalId = window.setInterval(() => void pollOnce(), POLL_INTERVAL_MS);
    return () => {
      currentAbort?.abort();
      window.clearInterval(intervalId);
    };
  }, [live]);

  // New lines arriving while scrolled to the bottom should keep the view pinned there; if the
  // operator has scrolled up to read older lines, don't yank them back down.
  useEffect(() => {
    const el = consoleRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < 80) el.scrollTop = el.scrollHeight;
  }, [entries]);

  const lines = useMemo(() => entries.map(formatLogLine), [entries]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      addToast("Log lines copied to clipboard", "success");
    } catch {
      addToast("Could not copy — clipboard access was blocked.", "error");
    }
  };

  useImperativeHandle(
    ref,
    () => ({
      toggleLive: () => setLive((v) => !v),
      download: () => {
        downloadTextFile(
          `system-logs-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.log`,
          lines.join("\n"),
        );
      },
    }),
    [lines],
  );

  // A request that resolves near-instantly (localhost, a warm cache) shouldn't flip the empty
  // state between "Loading…" and "No log activity yet" every time a filter changes - only a
  // load that's genuinely taking a moment earns the loading copy.
  const showLoadingState = useDelayedLoading(loading);
  const activeFilterCount = (source ? 1 : 0) + (level ? 1 : 0);

  const sourceSelect = (
    <select
      id="system-log-filter-source"
      name="system-log-filter-source"
      className="at-select system-log-panel__field"
      aria-label={isDesktop ? "Source" : undefined}
      value={source}
      onChange={(e) => setSource(e.target.value as SourceFilter)}
    >
      <option value="">All sources</option>
      {(Object.keys(SOURCE_LABELS) as SystemLogEntryDto["source"][]).map((key) => (
        <option key={key} value={key}>
          {SOURCE_LABELS[key]}
        </option>
      ))}
    </select>
  );
  const levelSelect = (
    <select
      id="system-log-filter-level"
      name="system-log-filter-level"
      className="at-select system-log-panel__field"
      aria-label={isDesktop ? "Level" : undefined}
      value={level}
      onChange={(e) => setLevel(e.target.value as LevelFilter)}
    >
      <option value="">All levels</option>
      {(Object.keys(LEVEL_LABELS) as SystemLogEntryDto["level"][]).map((key) => (
        <option key={key} value={key}>
          {LEVEL_LABELS[key]}
        </option>
      ))}
    </select>
  );

  return (
    <div className="system-log-panel">
      <div className="system-log-panel__toolbar">
        <div className="system-log-panel__field system-log-panel__field--search">
          <input
            ref={searchInputRef}
            id="system-log-search"
            name="system-log-search"
            type="text"
            className="at-input"
            aria-label="Search message text"
            placeholder="Search message text…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          {searchInput.length > 0 && (
            <button
              type="button"
              className="audit-log-search-clear"
              onClick={() => {
                setSearchInput("");
                searchInputRef.current?.focus();
              }}
              aria-label="Clear search"
            >
              <i className="ti ti-x" aria-hidden="true" />
            </button>
          )}
        </div>
        {isDesktop ? (
          <>
            {sourceSelect}
            {levelSelect}
          </>
        ) : (
          <FiltersMenu activeCount={activeFilterCount} className="system-log-filters-menu">
            <div className="system-log-filters-menu__field">
              <label className="audit-log-filter__label" htmlFor="system-log-filter-source">
                Source
              </label>
              {sourceSelect}
            </div>
            <div className="system-log-filters-menu__field">
              <label className="audit-log-filter__label" htmlFor="system-log-filter-level">
                Level
              </label>
              {levelSelect}
            </div>
          </FiltersMenu>
        )}
        {!isDesktop && (liveButton || downloadButton) && (
          <div className="system-log-panel__toolbar-actions">
            {liveButton}
            {downloadButton}
          </div>
        )}
      </div>

      {live && pollDegraded && (
        <div className="system-log-panel__poll-warning" role="status">
          Live updates stopped coming through - the lines below may be out of date.{" "}
          <button type="button" className="system-log-panel__poll-warning-retry" onClick={() => setRetryTick((t) => t + 1)}>
            Retry now
          </button>
        </div>
      )}

      {/* Always renders this same dark shell, at the same height, regardless of content -
          Clear view (which empties `entries`) used to swap the whole console out for a
          plain light EmptyState card at a different height, which read as the panel itself
          breaking rather than a deliberately cleared terminal. */}
      <div ref={consoleRef} className="system-log-panel__console" role="log" aria-live="off">
        {renderConsoleBody(showLoadingState, error, entries, () => setRetryTick((t) => t + 1))}
      </div>

      <div className="system-log-panel__footer">
        <span className="system-log-panel__count">{`Showing ${entries.length} line${entries.length === 1 ? "" : "s"}`}</span>
        <div className="system-log-panel__footer-actions">
          <Button type="button" variant="secondary" size="sm" disabled={lines.length === 0} onClick={() => void handleCopy()}>
            Copy
          </Button>
          <Button type="button" variant="secondary" size="sm" disabled={entries.length === 0} onClick={() => setEntries([])}>
            Clear view
          </Button>
        </div>
      </div>
    </div>
  );
});
