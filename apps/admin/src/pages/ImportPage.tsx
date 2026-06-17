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
      setError(
        err.status === 403
          ? "You do not have access to this event."
          : err.message || "Request failed.",
      );
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
            <p className="import-hint">
              <strong>Required columns:</strong> first_name, last_name, email.{" "}
              <strong>Optional:</strong> ticket_type, company, department, external_uuid, qr_payload.
            </p>

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
