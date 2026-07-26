import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Button, EmptyState, useToast } from "@admitto/ui";
import { fetchSystemLogs } from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { SystemLogEntryDto } from "../api/types.js";

type LevelFilter = "" | SystemLogEntryDto["level"];
type SourceFilter = "" | SystemLogEntryDto["source"];

const SEARCH_DEBOUNCE_MS = 300;
const POLL_INTERVAL_MS = 1750;
const MAX_RENDERED_ENTRIES = 1000;

const SOURCE_LABELS: Record<SystemLogEntryDto["source"], string> = {
  api: "API",
  db: "DB",
  cache: "Cache",
  mail: "Mail",
  admin: "Admin",
};

// No "Debug" option - nothing in this app ever logs at that level, so a filter option for it
// would always be empty.
const LEVEL_LABELS: Record<SystemLogEntryDto["level"], string> = {
  info: "Info",
  warn: "Warn",
  error: "Error",
};

/** "14:02:11.402" in the viewer's own local time - a live tail is read in the moment, unlike
 * the audit log's UTC-primary convention for a durable historical record. */
function formatLogTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function formatLogLine(entry: SystemLogEntryDto): string {
  return `${formatLogTime(entry.ts)}  ${LEVEL_LABELS[entry.level].toUpperCase()}  ${SOURCE_LABELS[entry.source]}  ${entry.message}`;
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
  { onLiveChange, onHasEntriesChange },
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
  const { addToast } = useToast();
  const cursorRef = useRef(0);
  const filtersRef = useRef({ level, source, search });
  const consoleRef = useRef<HTMLDivElement>(null);

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
  }, [level, source, search]);

  // Polling loop, independent of filter changes - reads filtersRef/cursorRef fresh each tick so
  // toggling Live off and back on resumes from where it left off instead of resetting the view.
  useEffect(() => {
    if (!live) return;
    let currentAbort: AbortController | null = null;
    const intervalId = window.setInterval(() => {
      const ac = new AbortController();
      currentAbort = ac;
      const f = filtersRef.current;
      fetchSystemLogs(
        {
          since: cursorRef.current,
          level: f.level || undefined,
          source: f.source || undefined,
          search: f.search || undefined,
        },
        ac.signal,
      )
        .then((data) => {
          if (ac.signal.aborted) return;
          cursorRef.current = data.cursor;
          if (data.entries.length === 0) return;
          setEntries((prev) => {
            const next = [...prev, ...data.entries];
            return next.length > MAX_RENDERED_ENTRIES ? next.slice(next.length - MAX_RENDERED_ENTRIES) : next;
          });
        })
        .catch(() => {
          // A single missed poll tick isn't worth surfacing - the next tick 1.75s later retries.
        });
    }, POLL_INTERVAL_MS);
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

  return (
    <div className="system-log-panel">
      <div className="system-log-panel__toolbar">
        <div className="system-log-panel__field system-log-panel__field--search">
          <input
            id="system-log-search"
            name="system-log-search"
            type="text"
            className="at-input"
            aria-label="Search message text"
            placeholder="Search message text…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
        <select
          id="system-log-filter-source"
          name="system-log-filter-source"
          className="at-select system-log-panel__field"
          aria-label="Source"
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
        <select
          id="system-log-filter-level"
          name="system-log-filter-level"
          className="at-select system-log-panel__field"
          aria-label="Level"
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
      </div>

      {loading && entries.length === 0 ? (
        <EmptyState title="Loading system logs…" />
      ) : error ? (
        <EmptyState title="Could not load system logs" description={error} />
      ) : entries.length === 0 ? (
        <EmptyState
          icon={<i className="ti ti-terminal-2" aria-hidden="true" />}
          title="No log activity yet"
          description="Activity across the API, database, cache, mail transport, and admin actions will appear here as it happens."
        />
      ) : (
        <div ref={consoleRef} className="system-log-panel__console" role="log" aria-live="off">
          {entries.map((entry) => (
            <div key={entry.id} className={`system-log-panel__line system-log-panel__line--${entry.level}`}>
              <span className="system-log-panel__time">{formatLogTime(entry.ts)}</span>
              <span className="system-log-panel__level">{LEVEL_LABELS[entry.level].toUpperCase()}</span>
              <span className="system-log-panel__source">{SOURCE_LABELS[entry.source]}</span>
              <span className="system-log-panel__message">{entry.message}</span>
            </div>
          ))}
        </div>
      )}

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
