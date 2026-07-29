import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { Link, useOutletContext, useParams } from "react-router";
import { Button, Card, PageHeader, Switch, Tooltip, useToast } from "@admitto/ui";
import {
  ApiError,
  commitImport,
  fetchImportHistory,
  previewImport,
  type EventFullMeta,
  type ImportHistoryEntry,
} from "../api/client.js";
import { hasApiErrorCode, operatorApiErrorMessage } from "../api/operator-api-error.js";
import type {
  EventDto,
  ImportCommitResponse,
  ImportPreviewResponse,
  ImportSampleRow,
  ImportSkippedRow,
} from "../api/types.js";
import { fetchAttendeeCustomFields, type CustomDataFieldDef } from "../attendees/customData.js";
import { useAuth } from "../auth/AuthProvider.js";
import { isSuperadmin } from "../auth/capabilities.js";
import { ARCHIVED_ACTION_TOOLTIP, ArchivedGuard, isEventArchived } from "../components/ArchivedGuard.js";
import { useConnectionState } from "../connection/ConnectionStateProvider.js";
import { useDelayedLoading } from "../hooks/useDelayedLoading.js";
import { formatEventDateTime } from "../utils/event-dates.js";
import { formatFileSize } from "../utils/formatFileSize.js";
import "../attendees/attendees.css";
import "./import.css";

type Step = "upload" | "preview" | "done";

const SAMPLE_DISPLAY_LIMIT = 20;

function pluralize(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}

/** The server caps invalid/skipped row detail at a fixed count (CodeRabbit review: a file where
 * every row is skipped/invalid would otherwise render tens of thousands of DOM rows) - this
 * folds the "showing first N of M" note into the section heading when the response was capped,
 * matching the Row preview card's own count note. */
function rowDetailHeading(label: string, shown: number, total: number): string {
  return total > shown ? `${label} (showing first ${shown} of ${total})` : label;
}

interface ImportSampleTableProps {
  rows: ImportSampleRow[];
  attributeFieldLabels: Array<{ source_field: string; label: string }>;
}

/** Preview table for the first valid import rows (optional columns shown when any row has data).
 * The enclosing Card carries its own "Row preview" title (with the showing-first-N-of-M count
 * folded in when relevant) — this used to repeat both in a second "Data preview" heading here,
 * reading as two headings for one table (PO feedback). */
function ImportSampleTable({ rows, attributeFieldLabels }: Readonly<ImportSampleTableProps>) {
  const displayRows = rows.slice(0, SAMPLE_DISPLAY_LIMIT);
  if (displayRows.length === 0) return null;

  const hasTicketType = rows.some((r) => r.ticket_type);
  const hasCompany = rows.some((r) => r.company);
  const hasDepartment = rows.some((r) => r.department);
  const hasExtUuid = rows.some((r) => r.external_uuid);
  const hasCustom = attributeFieldLabels.length > 0;

  return (
    <div className="import-sample">
      <div className="import-sample-wrap">
        <table className="table import-sample-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Name</th>
              <th>Email</th>
              {hasTicketType && <th>Ticket type</th>}
              {hasCompany && <th>Company</th>}
              {hasDepartment && <th>Department</th>}
              {hasExtUuid && <th>External UUID</th>}
              {hasCustom &&
                attributeFieldLabels.map((f) => (
                  <th key={f.source_field}>{f.label}</th>
                ))}
            </tr>
          </thead>
          <tbody>
            {displayRows.map((row) => (
              <tr key={row.rowIndex}>
                <td className="import-sample__row-num">{row.rowIndex}</td>
                <td>{row.name || <span className="import-sample__empty">-</span>}</td>
                <td>{row.email}</td>
                {hasTicketType && (
                  <td>{row.ticket_type || <span className="import-sample__empty">-</span>}</td>
                )}
                {hasCompany && (
                  <td>{row.company || <span className="import-sample__empty">-</span>}</td>
                )}
                {hasDepartment && (
                  <td>{row.department || <span className="import-sample__empty">-</span>}</td>
                )}
                {hasExtUuid && (
                  <td className="import-sample__uuid">
                    {row.external_uuid || <span className="import-sample__empty">-</span>}
                  </td>
                )}
                {hasCustom &&
                  attributeFieldLabels.map((f) => (
                    <td key={f.source_field}>
                      {row.custom_data[f.source_field] || (
                        <span className="import-sample__empty">-</span>
                      )}
                    </td>
                  ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface ImportHistoryCardProps {
  history: ImportHistoryEntry[] | null;
  error: string | null;
  eventTimezone: string | undefined;
  onRetry: () => void;
  showLoading: boolean;
}

/** One state at a time (error takes priority, then loading, then empty, then the table) — a
 * plain if/return chain instead of nested ternaries (Sonar S3358), which also reads closer to
 * how an operator actually encounters these: never more than one at once. */
function renderImportHistoryBody({ history, error, eventTimezone, onRetry, showLoading }: ImportHistoryCardProps) {
  if (error) {
    return (
      <div className="import-history__error">
        <p className="import-hint">{error}</p>
        <Button variant="secondary" onClick={onRetry}>
          Retry
        </Button>
      </div>
    );
  }
  if (history === null) {
    // A fetch that resolves near-instantly (localhost, a warm cache) would otherwise flash
    // this text on and off faster than it can register as "loading" — show it only once the
    // fetch has genuinely taken a moment.
    return showLoading ? <p className="import-hint import-history__loading">Loading…</p> : null;
  }
  if (history.length === 0) {
    return <p className="import-hint">No imports yet for this event.</p>;
  }
  return (
    <div className="attendees-table-wrap">
      <table className="table import-history-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>File</th>
            <th>Created</th>
            <th>Updated</th>
            <th>Skipped</th>
          </tr>
        </thead>
        <tbody>
          {history.map((entry) => (
            <tr key={entry.id}>
              <td className="import-history__date">
                {formatEventDateTime(entry.created_at, eventTimezone)}
              </td>
              <td className="import-history__file">
                {entry.filename ?? <span className="import-sample__empty">-</span>}
              </td>
              <td className="import-history__num import-history__num--ok">{entry.created}</td>
              <td className="import-history__num import-history__num--warn">{entry.updated}</td>
              <td className="import-history__num">{entry.skipped}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Email/Reason table explaining each skipped row — without it, "To skip: N" tells an operator
 * nothing about why (usually an existing attendee with Overwrite off), which reads as the import
 * silently doing nothing (PO feedback while testing #358 phase C). */
function SkippedRowsTable({ rows }: Readonly<{ rows: readonly ImportSkippedRow[] }>) {
  return (
    <div className="attendees-table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Email</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.email}-${index}`}>
              <td>{row.email}</td>
              <td>{row.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** "Import history" card from the design mockup — recent commits with their outcome counts,
 * read from the audit log (no dedicated table). Timestamps render in the event's timezone via
 * the central formatter, like other event-scoped tables. Errors render inline with a Retry,
 * per the toast-vs-inline convention (a load failure of a passive card shouldn't toast). */
function ImportHistoryCard(props: Readonly<ImportHistoryCardProps>) {
  const { history, error } = props;
  return (
    <Card
      title="Import history"
      className="import-card"
      /* Unpadded only when the table renders — it brings its own scroll wrapper (mockup's
       * padded={false} table card); every text state keeps the normal card padding. */
      padded={error !== null || history === null || history.length === 0}
    >
      {renderImportHistoryBody(props)}
    </Card>
  );
}

/** Row/Reason table shared by the preview step's parse.invalidRows and the done step's
 * commit-time invalidRows - same shape, same rendering, different source. */
function InvalidRowsTable({ rows }: Readonly<{ rows: readonly { rowIndex: number; reason: string }[] }>) {
  return (
    <div className="attendees-table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Row</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.rowIndex}>
              <td>{row.rowIndex}</td>
              <td>{row.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Toast copy for a caught API error - the 401 redirect is handled by the caller before this
 * runs, so this only needs to turn a non-redirect ApiError (or a non-ApiError failure) into the
 * message/duration pair addToast expects (Sonar S3776: keeps this branching out of ImportPage's
 * own cognitive-complexity count). */
function importApiErrorToast(err: unknown): { message: string; duration?: number } {
  if (!(err instanceof ApiError)) {
    return { message: "Request failed." };
  }
  const message = operatorApiErrorMessage(err, "Request failed.");
  const duration =
    hasApiErrorCode(err, "file too large") ||
    hasApiErrorCode(err, "too many rows") ||
    hasApiErrorCode(err, "invalid file content")
      ? 7000
      : undefined;
  return { message, duration };
}

/** Narrows a commit-import failure to its capacity-blocked shape (409 event_full) - returns the
 * capacity payload when the error is that specific shape, else null (Sonar S3776: the guard's
 * chain of && checks was adding nesting inside the commit handler's catch block). */
function extractCapacityBlockedMeta(err: unknown): EventFullMeta | null {
  if (!(err instanceof ApiError)) return null;
  if (err.status !== 409 || err.code !== "event_full") return null;
  return err.eventFull ?? null;
}

/** Commit is only enabled once a preview with valid rows exists, nothing is in flight, and any
 * capacity block has been explicitly overridden by a superadmin (Sonar S3776: the original nested
 * `!(a && !(b && c))` boolean expression was adding several points of nesting to ImportPage). */
function computeCanCommit(
  preview: ImportPreviewResponse | null,
  loading: boolean,
  capacityBlocked: EventFullMeta | null,
  superadmin: boolean,
  forceCapacity: boolean,
): boolean {
  if (preview === null || preview.parse.validCount === 0 || loading) return false;
  if (capacityBlocked === null) return true;
  return superadmin && forceCapacity;
}

/** Routes a failed preview/commit call to the right feedback surface: a hard 401 redirect (session
 * expired), or a toast otherwise. Extracted out of the component (Sonar S3776: this closure's own
 * branching, nested inside ImportPage, was counting against the component's complexity). */
function handleImportApiError(
  err: unknown,
  reportApiError: (status: number) => void,
  addToast: (message: string, variant: "error", duration?: number) => void,
): void {
  if (err instanceof ApiError) {
    reportApiError(err.status);
    if (err.status === 401) {
      const next = encodeURIComponent(window.location.pathname);
      window.location.assign(`/login?next=${next}`);
      return;
    }
  }
  const { message, duration } = importApiErrorToast(err);
  addToast(message, "error", duration);
}

interface UploadFileControlProps {
  event: EventDto;
  file: File | null;
  preview: ImportPreviewResponse | null;
  loading: boolean;
  step: Step;
  dragOver: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onDragOverChange: (over: boolean) => void;
  onSelectFile: (file: File | null) => void;
  onOpenFilePicker: () => void;
  onDropzoneKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void;
  onDrop: (e: DragEvent<HTMLButtonElement>) => void;
}

/** File-chip vs. drop-zone swap for step 1's fieldset, plus the always-present hidden native
 * input the dropzone proxies clicks to. Split out of ImportPage's own return (Sonar S3776: the
 * file ? … : … swap, its nested "valid rows vs file size" ternary, and the inline onDragOver
 * guard were all adding up inside ImportPage's own complexity count). */
function UploadFileControl({
  event,
  file,
  preview,
  loading,
  step,
  dragOver,
  fileInputRef,
  onDragOverChange,
  onSelectFile,
  onOpenFilePicker,
  onDropzoneKeyDown,
  onDrop,
}: Readonly<UploadFileControlProps>) {
  const archived = isEventArchived(event);
  return (
    <>
      {file ? (
        <div className="import-file-chip">
          <i className="ti ti-file-text" aria-hidden="true" />
          <div className="import-file-chip__info">
            <strong>{file.name}</strong>
            <span className="import-file-chip__meta">
              {preview
                ? `${preview.parse.validCount} valid ${pluralize(preview.parse.validCount, "row")}`
                : formatFileSize(file.size)}
            </span>
          </div>
          <button
            type="button"
            className="import-file-chip__remove"
            aria-label="Remove file"
            disabled={loading}
            onClick={() => onSelectFile(null)}
          >
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          className={["import-dropzone", dragOver && "import-dropzone--over"]
            .filter(Boolean)
            .join(" ")}
          tabIndex={archived ? -1 : 0}
          aria-label="Upload a CSV or XLSX file"
          onClick={onOpenFilePicker}
          onKeyDown={onDropzoneKeyDown}
          onDragOver={(e) => {
            e.preventDefault();
            if (!loading && !archived) onDragOverChange(true);
          }}
          onDragLeave={() => onDragOverChange(false)}
          onDrop={onDrop}
        >
          <i className="ti ti-cloud-upload" aria-hidden="true" />
          <b>Drop CSV/XLSX here</b>
          <span>or click to browse · max 5 MB · max 50 000 rows</span>
        </button>
      )}
      {/* Visually hidden but still labelled — the dropzone proxies clicks to it, and
       * it stays the real form control (tests and assistive tech target it). */}
      <div className="import-field sr-only">
        <label className="import-label" htmlFor="import-file">
          File (.csv or .xlsx)
        </label>
        <input
          id="import-file"
          ref={fileInputRef}
          type="file"
          accept=".csv,.xlsx"
          disabled={loading || step === "preview"}
          // Out of the tab order — the visible dropzone button right before it is
          // the real keyboard activation path; without this, Tab from the dropzone
          // landed on this invisible native control next, with no visible focus
          // target (Codex review).
          tabIndex={-1}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onSelectFile(e.target.files?.[0] ?? null)}
        />
      </div>
    </>
  );
}

/** Describes the type-specific note appended to a custom field's description in the "Required
 * CSV columns" table (select options, or the boolean Yes/No hint) - a plain lookup instead of a
 * nested ternary (Sonar S3776: kept this branching out of ImportPage's own complexity count). */
function attributeFieldNote(field: CustomDataFieldDef): string {
  if (field.type === "select" && field.options?.length) {
    return ` (select: ${field.options.join(", ")})`;
  }
  if (field.type === "boolean") {
    return " (Yes/No or true/false)";
  }
  return "";
}

/** One row of the "Required CSV columns" table for a custom attribute field - extracted
 * alongside attributeFieldNote so neither its ternary nor the nested one it replaces count
 * against ImportPage's own complexity. */
function renderAttributeFieldRow(field: CustomDataFieldDef) {
  return (
    <tr key={field.source_field}>
      <td>
        <code>{field.source_field}</code>
      </td>
      <td>{field.required ? "Yes" : "No"}</td>
      <td>
        {field.description || "No description provided"}
        {attributeFieldNote(field)}
      </td>
    </tr>
  );
}

interface CapacityBlockedBannerProps {
  capacityBlocked: EventFullMeta;
  event: EventDto;
  superadmin: boolean;
  canCreateAny: boolean;
  loading: boolean;
  forceCapacity: boolean;
  onForceCapacityChange: (checked: boolean) => void;
}

/** Capacity-block banner shown when a commit was rejected as event_full - only a superadmin
 * seeing rows still to create gets the override checkbox. Split out of the Validation summary
 * card (Sonar S3776: this banner's nested guards were adding up inside ImportPage's own
 * complexity count). */
function CapacityBlockedBanner({
  capacityBlocked,
  event,
  superadmin,
  canCreateAny,
  loading,
  forceCapacity,
  onForceCapacityChange,
}: Readonly<CapacityBlockedBannerProps>) {
  return (
    <div className="import-warn import-capacity-banner" role="alert">
      <p>
        Event is at capacity ({capacityBlocked.current}/{capacityBlocked.capacity}).
        {capacityBlocked.incoming != null && (
          <>
            {" "}
            Import would add {capacityBlocked.incoming} new attendee
            {capacityBlocked.incoming === 1 ? "" : "s"}.
          </>
        )}
      </p>
      {superadmin && canCreateAny && (
        <ArchivedGuard event={event} reasonId="force-capacity-reason" disabled={loading}>
          {(guard) => (
            <label className="import-checkbox">
              <input
                type="checkbox"
                checked={forceCapacity}
                onChange={(e) => onForceCapacityChange(e.target.checked)}
                {...guard}
              />
              <span>Override capacity limit (superadmin)</span>
            </label>
          )}
        </ArchivedGuard>
      )}
    </div>
  );
}

interface ValidationSummaryCardProps {
  preview: ImportPreviewResponse;
  loading: boolean;
  dryRun: boolean;
  canCommit: boolean;
  event: EventDto;
  superadmin: boolean;
  capacityBlocked: EventFullMeta | null;
  forceCapacity: boolean;
  importCount: number;
  onRevalidate: () => void;
  onCommit: () => void;
  onForceCapacityChange: (checked: boolean) => void;
}

/** "Validation summary" card for the preview step - counts, warnings, invalid/skipped row
 * tables, and the capacity-blocked banner. Split out of ImportPage's own return (Sonar S3776:
 * this card's several sibling `&&` sections were adding up inside ImportPage's own complexity
 * count). */
function ValidationSummaryCard({
  preview,
  loading,
  dryRun,
  canCommit,
  event,
  superadmin,
  capacityBlocked,
  forceCapacity,
  importCount,
  onRevalidate,
  onCommit,
  onForceCapacityChange,
}: Readonly<ValidationSummaryCardProps>) {
  return (
    <Card
      title="Validation summary"
      className="import-card"
      footer={
        <div className="import-actions">
          <Button variant="secondary" disabled={loading} onClick={onRevalidate}>
            {loading ? "Validating…" : "Re-validate"}
          </Button>
          <ArchivedGuard
            event={event}
            reasonId="import-commit-reason"
            disabled={!canCommit || dryRun}
            tooltip={dryRun ? "Turn off Dry run in Options to enable committing." : undefined}
          >
            {(guard) => (
              <Button variant="primary" onClick={onCommit} {...guard}>
                {loading
                  ? "Importing…"
                  : `Commit import (${importCount} ${pluralize(importCount, "attendee")})`}
              </Button>
            )}
          </ArchivedGuard>
        </div>
      }
    >
      <div className="import-stats">
        <div className="import-stat import-stat--ok">
          <span className="import-stat__value">{preview.summary.toCreate}</span>
          <span className="import-stat__label">To create</span>
        </div>
        <div className="import-stat import-stat--warn">
          <span className="import-stat__value">{preview.summary.toUpdate}</span>
          <span className="import-stat__label">To update</span>
        </div>
        <div className="import-stat import-stat--muted">
          <span className="import-stat__value">{preview.summary.toSkip}</span>
          <span className="import-stat__label">To skip</span>
        </div>
      </div>

      {preview.parse.validCount === 0 && (
        <p className="import-warn">
          No valid rows to import. Fix the file or choose a different file before committing.
        </p>
      )}

      {preview.parse.warnings.length > 0 && (
        <div className="import-warnings">
          <h3 className="import-subtitle">Warnings</h3>
          <ul>
            {preview.parse.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {preview.parse.invalidRows.length > 0 && (
        <div className="import-invalid">
          <h3 className="import-subtitle">
            {rowDetailHeading("Invalid rows", preview.parse.invalidRows.length, preview.parse.invalidCount)}
          </h3>
          <InvalidRowsTable rows={preview.parse.invalidRows} />
        </div>
      )}

      {preview.summary.skipped.length > 0 && (
        <div className="import-invalid">
          <h3 className="import-subtitle">
            {rowDetailHeading("Skipped rows", preview.summary.skipped.length, preview.summary.toSkip)}
          </h3>
          <SkippedRowsTable rows={preview.summary.skipped} />
        </div>
      )}

      {capacityBlocked && (
        <CapacityBlockedBanner
          capacityBlocked={capacityBlocked}
          event={event}
          superadmin={superadmin}
          canCreateAny={preview.summary.toCreate > 0}
          loading={loading}
          forceCapacity={forceCapacity}
          onForceCapacityChange={onForceCapacityChange}
        />
      )}
    </Card>
  );
}

/** Admin flow: upload CSV/XLSX → preview counts → commit import. */
export function ImportPage() {
  const { eventId } = useParams();
  const { event } = useOutletContext<{ event: EventDto }>();
  const { assignments } = useAuth();
  const { reportApiError } = useConnectionState();
  const { addToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const superadmin = isSuperadmin(assignments);

  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  // "Dry run" mirrors the existing two-phase flow (Validate = the dry run; committing is only
  // possible once it's switched off), it does not add a new server mode — the preview endpoint
  // has always been the no-writes pass.
  const [dryRun, setDryRun] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null);
  const [result, setResult] = useState<ImportCommitResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [capacityBlocked, setCapacityBlocked] = useState<EventFullMeta | null>(null);
  const [forceCapacity, setForceCapacity] = useState(false);
  const [attributeFields, setAttributeFields] = useState<CustomDataFieldDef[]>([]);
  const [history, setHistory] = useState<ImportHistoryEntry[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyToken, setHistoryToken] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(false);
  const showHistoryLoading = useDelayedLoading(historyLoading);

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    fetchAttendeeCustomFields(eventId)
      .then((fields) => {
        if (!cancelled) setAttributeFields(fields);
      })
      .catch(() => {
        if (!cancelled) setAttributeFields([]);
      });
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  const handleApiError = (err: unknown) => handleImportApiError(err, reportApiError, addToast);

  useEffect(() => {
    if (!eventId) return;
    const ac = new AbortController();
    setHistoryError(null);
    // Router reuses this component across a direct navigation from one event's import URL to
    // another's — reset to the loading state so the previous event's history can't flash under
    // the new event's timezone while this fetch is in flight (CodeRabbit review).
    setHistory(null);
    // A dedicated in-flight flag, not `history === null` - that stays true across a failed
    // fetch (history is never set) all the way through a subsequent Retry, so its rising edge
    // only ever fires once and useDelayedLoading's no-flash window never gets a fresh start on
    // retry (bot review).
    setHistoryLoading(true);
    fetchImportHistory(eventId, ac.signal)
      .then((items) => setHistory(items))
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setHistoryError("Couldn't load import history.");
      })
      .finally(() => {
        if (!ac.signal.aborted) setHistoryLoading(false);
      });
    return () => ac.abort();
  }, [eventId, historyToken]);

  /** Shared by the file picker's onChange and the dropzone's drop handler — same reset. */
  const selectFile = (picked: File | null) => {
    setFile(picked);
    setPreview(null);
    setCapacityBlocked(null);
    setForceCapacity(false);
    // A new file means a new, not-yet-reviewed validation summary — re-arm Dry run so a
    // switch left off from a previous file's summary can't immediately unlock committing
    // this one before its own summary has even been seen (Codex review).
    setDryRun(true);
    if (step === "preview") setStep("upload");
    // Browsers don't fire onChange when the same file is re-selected through the native
    // input unless its value is cleared first — otherwise Browse-ing the same file again
    // right after removing it would silently do nothing (CodeRabbit review).
    if (!picked && fileInputRef.current) fileInputRef.current.value = "";
  };

  const onDrop = (e: DragEvent<HTMLButtonElement>) => {
    e.preventDefault();
    setDragOver(false);
    if (loading || isEventArchived(event)) return;
    const dropped = e.dataTransfer.files?.[0] ?? null;
    if (!dropped) return;
    if (!/\.(csv|xlsx)$/i.test(dropped.name)) {
      addToast("Only .csv or .xlsx files can be imported.", "error");
      return;
    }
    selectFile(dropped);
  };

  const openFilePicker = () => {
    if (loading || isEventArchived(event)) return;
    fileInputRef.current?.click();
  };

  const onDropzoneKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openFilePicker();
    }
  };

  const onPreview = async () => {
    if (!eventId || !file) return;
    setLoading(true);
    try {
      const data = await previewImport(eventId, file, overwrite);
      setPreview(data);
      setStep("preview");
      // Force back to the safe state on every fresh validate (including Re-validate, which
      // also calls this) — toggling Dry run off *before* seeing this summary shouldn't count
      // as reviewing it; the operator must turn it off again after seeing these actual
      // results (code review: the switch had no step-aware guard, so pre-toggling it let the
      // Commit button start already enabled on the summary's first render).
      setDryRun(true);
    } catch (err) {
      handleApiError(err);
    } finally {
      setLoading(false);
    }
  };

  const onCommit = async (opts?: { force?: boolean }) => {
    if (!eventId || !file || !preview) return;
    setLoading(true);
    setCapacityBlocked(null);
    try {
      const data = await commitImport(eventId, file, overwrite, { force: opts?.force });
      setResult(data);
      setStep("done");
      setForceCapacity(false);
      setHistoryToken((n) => n + 1);
      addToast(
        `Attendees imported: ${data.created} created, ${data.updated} updated, ${data.skipped.length} skipped`,
        "success",
      );
    } catch (err) {
      const capacityMeta = extractCapacityBlockedMeta(err);
      if (capacityMeta) {
        setCapacityBlocked(capacityMeta);
      } else {
        handleApiError(err);
      }
    } finally {
      setLoading(false);
    }
  };

  const canCommit = computeCanCommit(preview, loading, capacityBlocked, superadmin, forceCapacity);

  const importCount =
    preview !== null ? preview.summary.toCreate + preview.summary.toUpdate : 0;

  if (!eventId) return <p>Missing event.</p>;

  return (
    <>
      <PageHeader
        title="Import attendees"
        subtitle="Upload a CSV or XLSX file to add or update attendee records."
        actions={
          <Link to={`/admin/events/${eventId}/attendees`}>
            <Button variant="secondary" icon={<i className="ti ti-arrow-left" aria-hidden="true" />}>
              Back to attendees
            </Button>
          </Link>
        }
      />


      {step !== "done" && (
        <div className="import-two-col">
          <div className="import-stack">
            <Card
              title="1 · Upload file"
              className="import-card"
              actions={
                <a
                  href={`/api/admin/events/${eventId}/import/template`}
                  download="admitto-import-template.csv"
                  className="at-btn at-btn--secondary at-btn--sm"
                >
                  <span className="at-btn__icon" aria-hidden="true">
                    <i className="ti ti-download" />
                  </span>
                  <span>Download CSV template</span>
                </a>
              }
            >
              <div className="import-form">
                <Tooltip
                  content={isEventArchived(event) ? ARCHIVED_ACTION_TOOLTIP : undefined}
                  className="import-upload-fieldset-wrapper"
                >
                  <fieldset className="import-upload-fieldset" disabled={isEventArchived(event)}>
                    <UploadFileControl
                      event={event}
                      file={file}
                      preview={preview}
                      loading={loading}
                      step={step}
                      dragOver={dragOver}
                      fileInputRef={fileInputRef}
                      onDragOverChange={setDragOver}
                      onSelectFile={selectFile}
                      onOpenFilePicker={openFilePicker}
                      onDropzoneKeyDown={onDropzoneKeyDown}
                      onDrop={onDrop}
                    />
                  </fieldset>
                </Tooltip>

                <details className="import-columns-info">
                  <summary>Required CSV columns</summary>
                  <table className="import-columns-table">
                    <thead>
                      <tr>
                        <th>Column</th>
                        <th>Required</th>
                        <th>Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr><td><code>first_name</code></td><td>Yes</td><td>Attendee&apos;s first name</td></tr>
                      <tr><td><code>last_name</code></td><td>Yes</td><td>Attendee&apos;s last name</td></tr>
                      <tr><td><code>email</code></td><td>Yes</td><td>Valid email address (used as unique key)</td></tr>
                      <tr>
                        <td><code>ticket_type</code></td>
                        <td>No</td>
                        <td>
                          Must match a{" "}
                          <Link to={`/admin/events/${eventId}/settings?tab=ticket-types`}>
                            ticket type configured for this event
                          </Link>
                          ; the whole row is skipped if this doesn&apos;t match
                        </td>
                      </tr>
                      <tr><td><code>company</code></td><td>No</td><td>Attendee&apos;s company</td></tr>
                      <tr><td><code>department</code></td><td>No</td><td>Department or team</td></tr>
                      <tr>
                        <td><code>external_uuid</code></td>
                        <td>No</td>
                        <td>
                          Only needed if your ticketing agency already assigns each attendee a
                          unique ID. Add it here so re-importing the same file updates that
                          person instead of creating a duplicate
                        </td>
                      </tr>
                      <tr>
                        <td><code>qr_payload</code></td>
                        <td>No</td>
                        <td>
                          Leave empty. Admitto generates a secure ticket code automatically. Only
                          fill this in if attendees already have a ticket code from elsewhere that
                          needs to match
                        </td>
                      </tr>
                      {attributeFields.map(renderAttributeFieldRow)}
                    </tbody>
                  </table>
                </details>
                {attributeFields.length > 0 ? (
                  <p className="import-hint">
                    Event attribute columns use the <code>source_field</code> slug (included in the
                    downloadable template). Export files may use human-readable labels; re-import accepts
                    those too.
                  </p>
                ) : null}
              </div>
            </Card>

            {step === "preview" && preview && (
              <Card
                title={
                  preview.parse.validCount > preview.sampleRows.length
                    ? `Row preview (showing first ${preview.sampleRows.length} of ${preview.parse.validCount} valid rows)`
                    : "Row preview"
                }
                className="import-card"
              >
                <ImportSampleTable
                  rows={preview.sampleRows}
                  attributeFieldLabels={preview.attributeFieldLabels}
                />
              </Card>
            )}
          </div>

          <div className="import-stack">
            <Card
              title="2 · Options"
              className="import-card"
              footer={
                step === "upload" ? (
                  <div className="import-actions">
                    <ArchivedGuard event={event} reasonId="import-preview-reason" disabled={!file || loading}>
                      {(guard) => (
                        <Button variant="primary" onClick={() => void onPreview()} {...guard}>
                          {loading ? "Validating…" : "Validate file"}
                        </Button>
                      )}
                    </ArchivedGuard>
                  </div>
                ) : undefined
              }
            >
              <Tooltip
                content={isEventArchived(event) ? ARCHIVED_ACTION_TOOLTIP : undefined}
                className="import-upload-fieldset-wrapper"
              >
                <fieldset className="import-upload-fieldset" disabled={isEventArchived(event)}>
                  <div className="import-option">
                    <Switch
                      label="Dry run (validate only, no writes)"
                      checked={dryRun}
                      // Only togglable once a validation summary is actually on screen — otherwise
                      // an operator could turn it off during the upload step, before ever seeing
                      // what a commit would do, and Commit import would arm the instant the
                      // preview arrived (Codex review).
                      disabled={loading || step !== "preview"}
                      onChange={(e) => setDryRun(e.target.checked)}
                    />
                    <span className="import-checkbox__hint">
                      Validation never writes anything. Turn this off after reviewing the summary to
                      enable committing.
                    </span>
                  </div>
                  <div className="import-option">
                    <Switch
                      label="Overwrite existing attendees"
                      checked={overwrite}
                      // Togglable at any step, including preview — flip it after seeing an existing
                      // attendee skipped in the Validation summary, then Re-validate (PO feedback:
                      // this used to lock the instant a summary appeared, with no way back except
                      // picking a new file).
                      disabled={loading}
                      onChange={(e) => setOverwrite(e.target.checked)}
                    />
                    <span className="import-checkbox__hint">
                      When off, existing attendees matched by email are skipped.
                    </span>
                  </div>
                </fieldset>
              </Tooltip>
            </Card>

            {step === "preview" && preview && (
              <ValidationSummaryCard
                preview={preview}
                loading={loading}
                dryRun={dryRun}
                canCommit={canCommit}
                event={event}
                superadmin={superadmin}
                capacityBlocked={capacityBlocked}
                forceCapacity={forceCapacity}
                importCount={importCount}
                onRevalidate={() => void onPreview()}
                onCommit={() => void onCommit({ force: forceCapacity && superadmin })}
                onForceCapacityChange={setForceCapacity}
              />
            )}

            <ImportHistoryCard
              history={history}
              error={historyError}
              eventTimezone={event.timezone}
              onRetry={() => setHistoryToken((n) => n + 1)}
              showLoading={showHistoryLoading}
            />
          </div>
        </div>
      )}

      {step === "done" && result && (
        <Card className="import-card">
          <div className="import-done">
            <div className="import-done__icon" aria-hidden="true">
              <i className="ti ti-circle-check" />
            </div>
            <h2 className="import-done__title">Import complete</h2>
            <p className="import-done__summary">
              {result.created} attendee{result.created === 1 ? "" : "s"} created · {result.updated}{" "}
              updated · {result.skipped.length} skipped
            </p>
            <div className="import-done__actions">
              <Button
                variant="secondary"
                onClick={() => {
                  setFile(null);
                  setPreview(null);
                  setResult(null);
                  setCapacityBlocked(null);
                  setForceCapacity(false);
                  setDryRun(true);
                  setStep("upload");
                }}
              >
                Import another file
              </Button>
              <Link to={`/admin/events/${eventId}/attendees`}>
                <Button variant="primary" icon={<i className="ti ti-users" aria-hidden="true" />}>
                  View attendees
                </Button>
              </Link>
            </div>
            <p className="import-hint">
              Reference ID: <code className="import-ref">{result.importId}</code>
              {" "}(include when contacting support)
            </p>
          </div>

          {result.skipped.length > 0 && (
            <div className="import-invalid">
              <h3 className="import-subtitle">
                {rowDetailHeading("Skipped rows", result.skipped.length, result.toSkip)}
              </h3>
              <SkippedRowsTable rows={result.skipped} />
            </div>
          )}

          {result.invalidRows.length > 0 && (
            <div className="import-invalid">
              <h3 className="import-subtitle">
                {rowDetailHeading("Invalid rows", result.invalidRows.length, result.invalidCount)}
              </h3>
              <p className="import-hint">
                Something about the event changed between preview and commit (e.g. a ticket type
                was removed) - these rows were not imported.
              </p>
              <InvalidRowsTable rows={result.invalidRows} />
            </div>
          )}
        </Card>
      )}
    </>
  );
}
