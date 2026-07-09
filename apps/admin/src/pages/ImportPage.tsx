import { useEffect, useRef, useState } from "react";
import { Link, useOutletContext, useParams } from "react-router-dom";
import { Button, Card, PageHeader, useToast } from "@admitto/ui";
import { ApiError, commitImport, fetchEventItems, previewImport, type EventFullMeta } from "../api/client.js";
import { hasApiErrorCode, operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { EventDto, ImportCommitResponse, ImportPreviewResponse, ImportSampleRow } from "../api/types.js";
import {
  flattenCustomDataFieldsFromItems,
  type CustomDataFieldDef,
} from "../attendees/customData.js";
import { useAuth } from "../auth/AuthProvider.js";
import { isSuperadmin } from "../auth/capabilities.js";
import { ARCHIVED_ACTION_TOOLTIP, ArchivedGuard, isEventArchived } from "../components/ArchivedGuard.js";
import { useConnectionState } from "../connection/ConnectionStateProvider.js";
import "../attendees/attendees.css";
import "./import.css";

type Step = "upload" | "preview" | "done";

const SAMPLE_DISPLAY_LIMIT = 20;

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
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null);
  const [result, setResult] = useState<ImportCommitResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [capacityBlocked, setCapacityBlocked] = useState<EventFullMeta | null>(null);
  const [forceCapacity, setForceCapacity] = useState(false);
  const [attributeFields, setAttributeFields] = useState<CustomDataFieldDef[]>([]);

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    fetchEventItems(eventId)
      .then((items) => {
        if (!cancelled) setAttributeFields(flattenCustomDataFieldsFromItems(items));
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
        <Card className="import-card">
          <div className="import-form">
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
                  <tr><td><code>ticket_type</code></td><td>No</td><td>Ticket category (free text)</td></tr>
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
            <p className="import-hint import-hint--limits">
              <strong>Limits:</strong> max 5 MB · max 50 000 data rows · .csv or .xlsx only.
            </p>
            {attributeFields.length > 0 ? (
              <p className="import-hint">
                Event attribute columns use the <code>source_field</code> slug (included in the
                downloadable template). Export files may use human-readable labels — re-import accepts
                those too.
              </p>
            ) : null}
            <a
              href={`/api/admin/events/${eventId}/import/template`}
              download="admitto-import-template.csv"
              className="at-btn at-btn--secondary import-template-btn"
            >
              Download CSV template
            </a>

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
              <div className="import-field">
                <label className="import-label" htmlFor="import-file">
                  File (.csv or .xlsx)
                </label>
                <input
                  id="import-file"
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.xlsx"
                  disabled={loading || step === "preview"}
                  onChange={(e) => {
                    const picked = e.target.files?.[0] ?? null;
                    setFile(picked);
                    setPreview(null);
                    if (step === "preview") setStep("upload");
                  }}
                />
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

            {step === "upload" && (
              <div className="import-actions">
                <ArchivedGuard event={event} reasonId="import-preview-reason" disabled={!file || loading}>
                  {(guard) => (
                    <Button variant="primary" onClick={() => void onPreview()} {...guard}>
                      {loading ? "Previewing…" : "Preview"}
                    </Button>
                  )}
                </ArchivedGuard>
              </div>
            )}
          </div>
        </Card>
      )}

      {step === "preview" && preview && (
        <Card className="import-card">
          <h2 className="import-section-title">Preview</h2>
          <div className="import-stats">
            <div className="import-stat">
              <span className="import-stat__value">{preview.summary.toCreate}</span>
              <span className="import-stat__label">To create</span>
            </div>
            <div className="import-stat">
              <span className="import-stat__value">{preview.summary.toUpdate}</span>
              <span className="import-stat__label">To update</span>
            </div>
            <div className="import-stat">
              <span className="import-stat__value">{preview.summary.toSkip}</span>
              <span className="import-stat__label">To skip</span>
            </div>
          </div>

          <ImportSampleTable
            rows={preview.sampleRows}
            totalValid={preview.parse.validCount}
            attributeFieldLabels={preview.attributeFieldLabels}
          />

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
              <div className="attendees-table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Row</th>
                      <th>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.parse.invalidRows.map((row) => (
                      <tr key={row.rowIndex}>
                        <td>{row.rowIndex}</td>
                        <td>{row.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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

          <div className="import-actions">
            <Button
              variant="secondary"
              disabled={loading}
              onClick={() => {
                setStep("upload");
                setPreview(null);
                setCapacityBlocked(null);
                setForceCapacity(false);
              }}
            >
              Choose another file
            </Button>
            <ArchivedGuard event={event} reasonId="import-commit-reason" disabled={!canCommit}>
              {(guard) => (
                <Button
                  variant="primary"
                  onClick={() => void onCommit({ force: forceCapacity && superadmin })}
                  {...guard}
                >
                  {loading
                    ? "Importing…"
                    : `Import ${importCount} attendee${importCount === 1 ? "" : "s"}`}
                </Button>
              )}
            </ArchivedGuard>
          </div>
        </Card>
      )}

      {step === "done" && result && (
        <Card className="import-card">
          <h2 className="import-section-title">Import complete</h2>
          <p className="import-hint">
            Reference ID: <code className="import-ref">{result.importId}</code>
            {" "}(include when contacting support)
          </p>
          <div className="import-stats">
            <div className="import-stat">
              <span className="import-stat__value">{result.created}</span>
              <span className="import-stat__label">Created</span>
            </div>
            <div className="import-stat">
              <span className="import-stat__value">{result.updated}</span>
              <span className="import-stat__label">Updated</span>
            </div>
            <div className="import-stat">
              <span className="import-stat__value">{result.skipped.length}</span>
              <span className="import-stat__label">Skipped</span>
            </div>
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

          <div className="import-actions">
            <Link to={`/admin/events/${eventId}/attendees`}>
              <Button variant="primary">Back to attendees</Button>
            </Link>
          </div>
        </Card>
      )}
    </>
  );
}
