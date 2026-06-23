import { useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button, Card, PageHeader } from "@admitto/ui";
import { ApiError, commitImport, previewImport } from "../api/client.js";
import type { ImportCommitResponse, ImportPreviewResponse } from "../api/types.js";
import { useConnectionState } from "../connection/ConnectionStateProvider.js";
import "../attendees/attendees.css";
import "./import.css";

type Step = "upload" | "preview" | "done";

/** Admin flow: upload CSV/XLSX → preview counts → commit import. */
export function ImportPage() {
  const { eventId } = useParams();
  const { reportApiError } = useConnectionState();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null);
  const [result, setResult] = useState<ImportCommitResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleApiError = (err: unknown) => {
    if (err instanceof ApiError) {
      reportApiError(err.status);
      if (err.status === 401) {
        const next = encodeURIComponent(window.location.pathname);
        window.location.assign(`/login?next=${next}`);
        return;
      }
      const msg = (() => {
        if (err.status === 403) return "You do not have access to this event.";
        if (err.message === "file too large") return "File exceeds the 5 MB limit. Split the file and import in parts.";
        if (err.message === "too many rows") return "File exceeds the 50 000 row limit. Split the file and import in parts.";
        if (err.message === "unsupported file type") return "Unsupported file type. Upload a .csv or .xlsx file.";
        if (err.message === "empty file") return "The file is empty.";
        if (err.message === "invalid file content") return "The file could not be read. Check that it is a valid CSV or XLSX.";
        return err.message || "Request failed.";
      })();
      setError(msg);
    } else {
      setError("Request failed.");
    }
  };

  const onPreview = async () => {
    if (!eventId || !file) return;
    setLoading(true);
    setError(null);
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

  const onCommit = async () => {
    if (!eventId || !file || !preview) return;
    setLoading(true);
    setError(null);
    try {
      const data = await commitImport(eventId, file, overwrite);
      setResult(data);
      setStep("done");
    } catch (err) {
      handleApiError(err);
    } finally {
      setLoading(false);
    }
  };

  const canCommit =
    preview !== null && preview.parse.validCount > 0 && !loading;

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

      {error && <p className="text-error">{error}</p>}

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
                </tbody>
              </table>
            </details>
            <p className="import-hint import-hint--limits">
              <strong>Limits:</strong> max 5 MB · max 50 000 data rows · .csv or .xlsx only.
            </p>
            <a
              href={`/api/admin/events/${eventId}/import/template`}
              download="admitto-import-template.csv"
              className="at-btn at-btn--secondary import-template-btn"
            >
              Download CSV template
            </a>

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

            {step === "upload" && (
              <div className="import-actions">
                <Button
                  variant="primary"
                  disabled={!file || loading}
                  onClick={() => void onPreview()}
                >
                  {loading ? "Previewing…" : "Preview"}
                </Button>
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

          <div className="import-actions">
            <Button
              variant="secondary"
              disabled={loading}
              onClick={() => {
                setStep("upload");
                setPreview(null);
              }}
            >
              Choose another file
            </Button>
            <Button
              variant="primary"
              disabled={!canCommit}
              onClick={() => void onCommit()}
            >
              {loading
                ? "Importing…"
                : `Import ${importCount} attendee${importCount === 1 ? "" : "s"}`}
            </Button>
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
