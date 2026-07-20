import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { Link, useOutletContext, useParams } from "react-router-dom";
import { Button, Card, PageHeader, Switch, useToast } from "@admitto/ui";
import {
  ApiError,
  commitImport,
  fetchImportHistory,
  previewImport,
  type EventFullMeta,
  type ImportHistoryEntry,
} from "../api/client.js";
import { hasApiErrorCode, operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { EventDto, ImportCommitResponse, ImportPreviewResponse, ImportSampleRow } from "../api/types.js";
import { fetchAttendeeCustomFields, type CustomDataFieldDef } from "../attendees/customData.js";
import { useAuth } from "../auth/AuthProvider.js";
import { isSuperadmin } from "../auth/capabilities.js";
import { ARCHIVED_ACTION_TOOLTIP, ArchivedGuard, isEventArchived } from "../components/ArchivedGuard.js";
import { useConnectionState } from "../connection/ConnectionStateProvider.js";
import { formatEventDateTime } from "../utils/event-dates.js";
import "../attendees/attendees.css";
import "./import.css";

type Step = "upload" | "preview" | "done";

const SAMPLE_DISPLAY_LIMIT = 20;

function pluralize(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}

interface ImportSampleTableProps {
  rows: ImportSampleRow[];
  totalValid: number;
  attributeFieldLabels: Array<{ source_field: string; label: string }>;
}

/** Preview table for the first valid import rows (optional columns shown when any row has data). */
function ImportSampleTable({ rows, totalValid, attributeFieldLabels }: ImportSampleTableProps) {
  const displayRows = rows.slice(0, SAMPLE_DISPLAY_LIMIT);
  if (displayRows.length === 0) return null;

  const hasTicketType = rows.some((r) => r.ticket_type);
  const hasCompany = rows.some((r) => r.company);
  const hasDepartment = rows.some((r) => r.department);
  const hasExtUuid = rows.some((r) => r.external_uuid);
  const hasCustom = attributeFieldLabels.length > 0;

  return (
    <div className="import-sample">
      <h3 className="import-subtitle">
        Data preview
        {totalValid > displayRows.length && (
          <span className="import-sample__note">
            {" "}
            — showing first {displayRows.length} of {totalValid} valid rows
          </span>
        )}
      </h3>
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
                <td>{row.name || <span className="import-sample__empty">—</span>}</td>
                <td>{row.email}</td>
                {hasTicketType && (
                  <td>{row.ticket_type || <span className="import-sample__empty">—</span>}</td>
                )}
                {hasCompany && (
                  <td>{row.company || <span className="import-sample__empty">—</span>}</td>
                )}
                {hasDepartment && (
                  <td>{row.department || <span className="import-sample__empty">—</span>}</td>
                )}
                {hasExtUuid && (
                  <td className="import-sample__uuid">
                    {row.external_uuid || <span className="import-sample__empty">—</span>}
                  </td>
                )}
                {hasCustom &&
                  attributeFieldLabels.map((f) => (
                    <td key={f.source_field}>
                      {row.custom_data[f.source_field] || (
                        <span className="import-sample__empty">—</span>
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
}

/** One state at a time (error takes priority, then loading, then empty, then the table) — a
 * plain if/return chain instead of nested ternaries (Sonar S3358), which also reads closer to
 * how an operator actually encounters these: never more than one at once. */
function renderImportHistoryBody({ history, error, eventTimezone, onRetry }: ImportHistoryCardProps) {
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
    return <p className="import-hint import-history__loading">Loading…</p>;
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
                {entry.filename ?? <span className="import-sample__empty">—</span>}
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
function InvalidRowsTable({ rows }: { rows: readonly { rowIndex: number; reason: string }[] }) {
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

  const handleApiError = (err: unknown) => {
    if (err instanceof ApiError) {
      reportApiError(err.status);
      if (err.status === 401) {
        const next = encodeURIComponent(window.location.pathname);
        window.location.assign(`/login?next=${next}`);
        return;
      }
      const msg = operatorApiErrorMessage(err, "Request failed.");
      const duration =
        hasApiErrorCode(err, "file too large") ||
        hasApiErrorCode(err, "too many rows") ||
        hasApiErrorCode(err, "invalid file content")
          ? 7000
          : undefined;
      addToast(msg, "error", duration);
    } else {
      addToast("Request failed.", "error");
    }
  };

  useEffect(() => {
    if (!eventId) return;
    const ac = new AbortController();
    setHistoryError(null);
    fetchImportHistory(eventId, ac.signal)
      .then((items) => setHistory(items))
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setHistoryError("Couldn't load import history.");
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
      if (err instanceof ApiError && err.status === 409 && err.code === "event_full" && err.eventFull) {
        setCapacityBlocked(err.eventFull);
      } else {
        handleApiError(err);
      }
    } finally {
      setLoading(false);
    }
  };

  const canCommit =
    preview !== null &&
    preview.parse.validCount > 0 &&
    !loading &&
    !(capacityBlocked != null && !(superadmin && forceCapacity));

  const importCount =
    preview !== null ? preview.summary.toCreate + preview.summary.toUpdate : 0;

  if (!eventId) return <p>Missing event.</p>;

  return (
    <>
      <PageHeader
        title="Import attendees"
        subtitle="Upload a CSV or XLSX file to add or update attendee records."
      />

      <p className="import-back">
        <Link to={`/admin/events/${eventId}/attendees`}>← Back to attendees</Link>
      </p>


      {step !== "done" && (
        <div className="import-two-col">
          <div className="import-stack">
            <Card title="1 · Upload file" className="import-card">
              <div className="import-form">
                <fieldset
                  className={[
                    "import-upload-fieldset",
                    isEventArchived(event) && "at-tooltip at-tooltip--below",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  data-tooltip={isEventArchived(event) ? ARCHIVED_ACTION_TOOLTIP : undefined}
                  disabled={isEventArchived(event)}
                >
                  {file ? (
                    <div className="import-file-chip">
                      <i className="ti ti-file-text" aria-hidden="true" />
                      <div className="import-file-chip__info">
                        <strong>{file.name}</strong>
                        <span className="import-file-chip__meta">
                          {preview
                            ? `${preview.parse.validCount} valid ${pluralize(preview.parse.validCount, "row")}`
                            : `${Math.max(1, Math.round(file.size / 1024))} KB`}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="import-file-chip__remove"
                        aria-label="Remove file"
                        disabled={loading}
                        onClick={() => selectFile(null)}
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
                      tabIndex={isEventArchived(event) ? -1 : 0}
                      aria-label="Upload a CSV or XLSX file"
                      onClick={openFilePicker}
                      onKeyDown={onDropzoneKeyDown}
                      onDragOver={(e) => {
                        e.preventDefault();
                        if (!loading && !isEventArchived(event)) setDragOver(true);
                      }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={onDrop}
                    >
                      <i className="ti ti-cloud-upload" aria-hidden="true" />
                      <b>Drop CSV/XLSX here</b>
                      <span>or click to browse · max 5 MB · max 50 000 rows</span>
                    </button>
                  )}
                  {/* Visually hidden but still labelled — the dropzone proxies clicks to it, and
                   * it stays the real form control (tests and assistive tech target it). */}
                  <div className="import-field import-field--visually-hidden">
                    <label className="import-label" htmlFor="import-file">
                      File (.csv or .xlsx)
                    </label>
                    <input
                      id="import-file"
                      ref={fileInputRef}
                      type="file"
                      accept=".csv,.xlsx"
                      disabled={loading}
                      // Out of the tab order — the visible dropzone button right before it is
                      // the real keyboard activation path; without this, Tab from the dropzone
                      // landed on this invisible native control next, with no visible focus
                      // target (Codex review).
                      tabIndex={-1}
                      onChange={(e) => selectFile(e.target.files?.[0] ?? null)}
                    />
                  </div>
                </fieldset>

                <a
                  href={`/api/admin/events/${eventId}/import/template`}
                  download="admitto-import-template.csv"
                  className="at-btn at-btn--secondary import-template-btn"
                >
                  Download CSV template
                </a>

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
                      <tr><td><code>external_uuid</code></td><td>No</td><td>External ID for deduplication</td></tr>
                      <tr><td><code>qr_payload</code></td><td>No</td><td>Custom QR code payload (auto-generated if empty)</td></tr>
                      {attributeFields.map((field) => (
                        <tr key={field.source_field}>
                          <td>
                            <code>{field.source_field}</code>
                          </td>
                          <td>{field.required ? "Yes" : "No"}</td>
                          <td>
                            {field.label}
                            {field.type === "select" && field.options?.length
                              ? ` — select: ${field.options.join(", ")}`
                              : field.type === "boolean"
                                ? " — Yes/No or true/false"
                                : ""}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
                {attributeFields.length > 0 ? (
                  <p className="import-hint">
                    Event attribute columns use the <code>source_field</code> slug (included in the
                    downloadable template). Export files may use human-readable labels — re-import accepts
                    those too.
                  </p>
                ) : null}
              </div>
            </Card>

            {step === "preview" && preview && (
              <Card title="Row preview" className="import-card">
                <ImportSampleTable
                  rows={preview.sampleRows}
                  totalValid={preview.parse.validCount}
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
              <fieldset
                className={[
                  "import-upload-fieldset",
                  isEventArchived(event) && "at-tooltip at-tooltip--below",
                ]
                  .filter(Boolean)
                  .join(" ")}
                data-tooltip={isEventArchived(event) ? ARCHIVED_ACTION_TOOLTIP : undefined}
                disabled={isEventArchived(event)}
              >
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
                <label className="import-checkbox">
                  <input
                    type="checkbox"
                    checked={overwrite}
                    disabled={loading || step === "preview"}
                    onChange={(e) => setOverwrite(e.target.checked)}
                  />
                  <span>
                    Overwrite existing attendees
                    <span className="import-checkbox__hint">
                      When off, existing attendees matched by email are skipped.
                    </span>
                  </span>
                </label>
              </fieldset>
            </Card>

            {step === "preview" && preview && (
              <Card
                title="Validation summary"
                className="import-card"
                footer={
                  <div className="import-actions">
                    <Button variant="secondary" disabled={loading} onClick={() => void onPreview()}>
                      {loading ? "Validating…" : "Re-validate"}
                    </Button>
                    <ArchivedGuard
                      event={event}
                      reasonId="import-commit-reason"
                      disabled={!canCommit || dryRun}
                      tooltip={
                        dryRun ? "Turn off Dry run in Options to enable committing." : undefined
                      }
                    >
                      {(guard) => (
                        <Button
                          variant="primary"
                          onClick={() => void onCommit({ force: forceCapacity && superadmin })}
                          {...guard}
                        >
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
                    <h3 className="import-subtitle">Invalid rows</h3>
                    <InvalidRowsTable rows={preview.parse.invalidRows} />
                  </div>
                )}

                {capacityBlocked && (
                  <div className="import-warn import-capacity-banner" role="alert">
                    <p>
                      Event is at capacity ({capacityBlocked.current}/{capacityBlocked.capacity}).
                      {capacityBlocked.incoming != null && (
                        <> Import would add {capacityBlocked.incoming} new attendee{capacityBlocked.incoming === 1 ? "" : "s"}.</>
                      )}
                    </p>
                    {superadmin && preview.summary.toCreate > 0 && (
                      <ArchivedGuard event={event} reasonId="force-capacity-reason" disabled={loading}>
                        {(guard) => (
                          <label className="import-checkbox">
                            <input
                              type="checkbox"
                              checked={forceCapacity}
                              onChange={(e) => setForceCapacity(e.target.checked)}
                              {...guard}
                            />
                            <span>Override capacity limit (superadmin)</span>
                          </label>
                        )}
                      </ArchivedGuard>
                    )}
                  </div>
                )}
              </Card>
            )}

            <ImportHistoryCard
              history={history}
              error={historyError}
              eventTimezone={event.timezone}
              onRetry={() => setHistoryToken((n) => n + 1)}
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
              <h3 className="import-subtitle">Skipped rows</h3>
              <div className="attendees-table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Email</th>
                      <th>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.skipped.map((row, idx) => (
                      <tr key={`${row.email}-${idx}`}>
                        <td>{row.email}</td>
                        <td>{row.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {result.invalidRows.length > 0 && (
            <div className="import-invalid">
              <h3 className="import-subtitle">Invalid rows</h3>
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
