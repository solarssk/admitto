import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Badge, Button, Card, Input, PageHeader, Select, StatusBadge, Tabs } from "@admitto/ui";
import {
  ApiError,
  fetchEventDeliveries,
  fetchEventTemplate,
  previewEventTemplate,
  saveEventTemplate,
  TemplateValidationError,
  testSendEventTemplate,
} from "../api/client.js";
import type { DeliveryDto, EventTemplateDto } from "../api/types.js";
import { useConnectionState } from "../connection/ConnectionStateProvider.js";
import "../communication/communication.css";

type ActiveField = "subject" | "body";
type TemplateFormat = "mjml" | "html";

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function insertAtCursor(value: string, insertion: string, start: number, end: number): string {
  return value.slice(0, start) + insertion + value.slice(end);
}

export function CommunicationPage() {
  const { eventId } = useParams();
  const { reportApiError } = useConnectionState();

  const [tab, setTab] = useState("compose");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [source, setSource] = useState<EventTemplateDto["source"]>("builtin");
  const [allowedPlaceholders, setAllowedPlaceholders] = useState<string[]>([]);
  const [requiredPlaceholders, setRequiredPlaceholders] = useState<string[]>([]);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [format, setFormat] = useState<TemplateFormat>("mjml");
  const [activeField, setActiveField] = useState<ActiveField>("body");

  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [previewSubject, setPreviewSubject] = useState<string | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [testEmail, setTestEmail] = useState("");
  const [testStatus, setTestStatus] = useState<{ kind: "ok" | "error"; message: string } | null>(
    null,
  );
  const [testSending, setTestSending] = useState(false);

  const [deliveries, setDeliveries] = useState<DeliveryDto[]>([]);
  const [deliveryTotal, setDeliveryTotal] = useState(0);
  const [deliveryPage, setDeliveryPage] = useState(1);
  const [deliveryPageSize] = useState(25);
  const [deliveryStatus, setDeliveryStatus] = useState("all");
  const [deliveriesLoading, setDeliveriesLoading] = useState(false);

  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const templatePayload = useCallback(
    () => ({
      subject_template: subject,
      body_template: body,
      template_format: format,
    }),
    [subject, body, format],
  );

  const loadTemplate = useCallback(async () => {
    if (!eventId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchEventTemplate(eventId);
      setSource(data.source);
      setAllowedPlaceholders(data.allowed_placeholders);
      setRequiredPlaceholders(data.required_url_placeholders);
      setSubject(data.subject_template);
      setBody(data.body_template);
      setFormat(data.template_format);
      setValidationErrors([]);
      setSaveStatus(null);
      setPreviewSubject(null);
      setPreviewHtml(null);
    } catch (err) {
      if (err instanceof ApiError) {
        reportApiError(err.status);
        if (err.status === 401) {
          const next = encodeURIComponent(window.location.pathname);
          window.location.assign(`/login?next=${next}`);
          return;
        }
        setError(err.status === 403 ? "You do not have access to this event." : "Failed to load template.");
      } else {
        setError("Failed to load template.");
      }
    } finally {
      setLoading(false);
    }
  }, [eventId, reportApiError]);

  const loadDeliveries = useCallback(async () => {
    if (!eventId) return;
    setDeliveriesLoading(true);
    try {
      const data = await fetchEventDeliveries(eventId, {
        page: deliveryPage,
        pageSize: deliveryPageSize,
        status: deliveryStatus,
      });
      setDeliveries(data.items);
      setDeliveryTotal(data.total);
    } catch (err) {
      if (err instanceof ApiError) {
        reportApiError(err.status);
        if (err.status === 401) {
          const next = encodeURIComponent(window.location.pathname);
          window.location.assign(`/login?next=${next}`);
          return;
        }
      }
      setDeliveries([]);
      setDeliveryTotal(0);
    } finally {
      setDeliveriesLoading(false);
    }
  }, [eventId, deliveryPage, deliveryPageSize, deliveryStatus, reportApiError]);

  useEffect(() => {
    void loadTemplate();
  }, [loadTemplate]);

  useEffect(() => {
    if (tab === "log") {
      void loadDeliveries();
    }
  }, [tab, loadDeliveries]);

  const insertPlaceholder = (name: string) => {
    const token = `{{${name}}}`;
    if (activeField === "subject") {
      setSubject((prev) => prev + token);
      return;
    }
    const el = bodyRef.current;
    const start = el?.selectionStart ?? body.length;
    const end = el?.selectionEnd ?? body.length;
    setBody(insertAtCursor(body, token, start, end));
  };

  const handlePreview = async () => {
    if (!eventId) return;
    setPreviewLoading(true);
    setValidationErrors([]);
    setSaveStatus(null);
    try {
      const data = await previewEventTemplate(eventId, templatePayload());
      setPreviewSubject(data.subject);
      setPreviewHtml(data.html);
    } catch (err) {
      setPreviewSubject(null);
      setPreviewHtml(null);
      if (err instanceof TemplateValidationError) {
        setValidationErrors(err.errors);
      } else if (err instanceof ApiError) {
        reportApiError(err.status);
        setSaveStatus(err.message);
      } else {
        setSaveStatus("Preview failed.");
      }
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleSave = async () => {
    if (!eventId) return;
    setValidationErrors([]);
    setSaveStatus(null);
    try {
      await saveEventTemplate(eventId, templatePayload());
      setSource("event");
      setSaveStatus("Template saved.");
      setPreviewSubject(null);
      setPreviewHtml(null);
    } catch (err) {
      if (err instanceof TemplateValidationError) {
        setValidationErrors(err.errors);
      } else if (err instanceof ApiError) {
        reportApiError(err.status);
        setSaveStatus(err.message);
      } else {
        setSaveStatus("Save failed.");
      }
    }
  };

  const handleTestSend = async () => {
    if (!eventId) return;
    setTestStatus(null);
    setTestSending(true);
    try {
      const result = await testSendEventTemplate(eventId, { to: testEmail.trim() });
      if (result.status === "sent") {
        setTestStatus({ kind: "ok", message: "Test email sent." });
      } else {
        setTestStatus({ kind: "error", message: result.error ?? "Send failed." });
      }
    } catch (err) {
      if (err instanceof ApiError) {
        reportApiError(err.status);
        setTestStatus({ kind: "error", message: err.message });
      } else {
        setTestStatus({ kind: "error", message: "Send failed." });
      }
    } finally {
      setTestSending(false);
    }
  };

  if (!eventId) return <p>Missing event.</p>;
  if (loading) return <p>Loading communication…</p>;
  if (error) return <p>{error}</p>;

  const deliveryPages = Math.max(1, Math.ceil(deliveryTotal / deliveryPageSize));

  return (
    <div className="screen">
      <PageHeader
        title="Communication"
        subtitle="Outlook-safe ticket email · Microsoft Graph transport"
      />

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "compose", label: "Compose" },
          { id: "log", label: "Delivery log", count: deliveryTotal || undefined },
        ]}
      />

      {tab === "compose" ? (
        <>
          {source !== "event" && (
            <div className="communication-default-banner">
              Using default template — save to customize for this event.
            </div>
          )}

          <div className="communication-compose">
            <Card
              title="Template"
              actions={<Badge variant="neutral">Outlook-safe</Badge>}
            >
              <div className="communication-ph-row">
                <span className="communication-overline">Insert placeholder</span>
                <div className="communication-chips">
                  {allowedPlaceholders.map((p) => (
                    <button
                      key={p}
                      type="button"
                      className={[
                        "communication-chip",
                        requiredPlaceholders.includes(p) && "communication-chip--required",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onClick={() => insertPlaceholder(p)}
                      title={
                        requiredPlaceholders.includes(p) ? "Required placeholder" : undefined
                      }
                    >
                      {`{{${p}}}`}
                    </button>
                  ))}
                </div>
              </div>

              <Input
                label="Subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                onFocus={() => setActiveField("subject")}
              />

              <div className="communication-format-row">
                <Button
                  variant={format === "mjml" ? "primary" : "secondary"}
                  size="sm"
                  onClick={() => setFormat("mjml")}
                >
                  MJML
                </Button>
                <Button
                  variant={format === "html" ? "primary" : "secondary"}
                  size="sm"
                  onClick={() => setFormat("html")}
                >
                  HTML
                </Button>
              </div>

              <div className="communication-body-field">
                <label htmlFor="communication-body">{format === "mjml" ? "MJML body" : "HTML body"}</label>
                <textarea
                  id="communication-body"
                  ref={bodyRef}
                  className="communication-textarea"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  onFocus={() => setActiveField("body")}
                />
              </div>

              {validationErrors.length > 0 && (
                <div className="communication-errors" role="alert">
                  <ul>
                    {validationErrors.map((msg) => (
                      <li key={msg}>{msg}</li>
                    ))}
                  </ul>
                </div>
              )}

              {saveStatus && (
                <p
                  className={[
                    "communication-status",
                    saveStatus.endsWith(".") && !saveStatus.toLowerCase().includes("fail")
                      ? "communication-status--ok"
                      : "communication-status--error",
                  ].join(" ")}
                >
                  {saveStatus}
                </p>
              )}

              <div className="communication-actions">
                <Button variant="secondary" onClick={() => void handlePreview()} disabled={previewLoading}>
                  {previewLoading ? "Previewing…" : "Preview"}
                </Button>
                <Button variant="primary" onClick={() => void handleSave()}>
                  Save
                </Button>
              </div>
            </Card>

            <Card title="Preview">
              {previewHtml ? (
                <>
                  <div className="communication-preview-subject">
                    <strong>Subject</strong>
                    <span>{previewSubject}</span>
                  </div>
                  <iframe
                    className="communication-preview-frame"
                    title="Email preview"
                    sandbox="allow-same-origin"
                    srcDoc={previewHtml}
                  />
                </>
              ) : (
                <div className="communication-preview-empty">Click Preview to render the draft.</div>
              )}
            </Card>
          </div>

          <Card title="Send test" className="communication-test-send">
            <div className="communication-test-row">
              <Input
                label="Recipient email"
                type="email"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                placeholder="you@example.com"
              />
              <Button
                variant="secondary"
                onClick={() => void handleTestSend()}
                disabled={testSending || !testEmail.trim()}
              >
                {testSending ? "Sending…" : "Send test"}
              </Button>
            </div>
            {testStatus && (
              <p
                className={[
                  "communication-status",
                  testStatus.kind === "ok" ? "communication-status--ok" : "communication-status--error",
                ].join(" ")}
              >
                {testStatus.message}
              </p>
            )}
          </Card>
        </>
      ) : (
        <>
          <div className="communication-log-toolbar">
            <Select
              label="Status"
              value={deliveryStatus}
              onChange={(e) => {
                setDeliveryStatus(e.target.value);
                setDeliveryPage(1);
              }}
            >
              <option value="all">All</option>
              <option value="accepted">Accepted</option>
              <option value="sent">Sent</option>
              <option value="failed">Failed</option>
              <option value="queued">Queued</option>
            </Select>
          </div>

          <Card padded={false}>
            {deliveriesLoading ? (
              <div className="communication-empty">Loading deliveries…</div>
            ) : deliveries.length === 0 ? (
              <div className="communication-empty">No messages sent yet.</div>
            ) : (
              <table className="table communication-table">
                <thead>
                  <tr>
                    <th>Recipient</th>
                    <th>Subject</th>
                    <th>Status</th>
                    <th>Queued</th>
                    <th>Sent / Failed</th>
                    <th>Error</th>
                  </tr>
                </thead>
                <tbody>
                  {deliveries.map((row) => (
                    <tr key={row.id}>
                      <td className="mono">{row.recipient_email ?? "—"}</td>
                      <td>{row.rendered_subject ?? "—"}</td>
                      <td>
                        <StatusBadge status={row.status} />
                      </td>
                      <td className="mono muted">{formatDateTime(row.queued_at)}</td>
                      <td className="mono muted">
                        {formatDateTime(row.sent_at ?? row.failed_at)}
                      </td>
                      <td className="muted">{row.error_code ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {deliveryTotal > 0 && (
              <div className="communication-pager">
                <span>
                  Page {deliveryPage} of {deliveryPages} ({deliveryTotal} total)
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={deliveryPage <= 1}
                  onClick={() => setDeliveryPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={deliveryPage >= deliveryPages}
                  onClick={() => setDeliveryPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
