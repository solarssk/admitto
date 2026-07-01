import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useBlocker, useParams } from "react-router-dom";
import { Badge, Button, Card, Input, PageHeader, Select, StatusBadge, Tabs } from "@admitto/ui";
import {
  ApiError,
  createEventTemplate,
  deleteEventTemplate,
  fetchEventDeliveries,
  fetchEventOverview,
  fetchEventTemplate,
  fetchEventTemplateById,
  fetchEventTemplates,
  previewEventTemplate,
  previewEventTemplateById,
  saveEventTemplate,
  saveEventTemplateById,
  TemplateValidationError,
  testSendEventTemplate,
  testSendEventTemplateById,
} from "../api/client.js";
import type {
  DeliveryDto,
  EventDeliveriesListParams,
  EventTemplateDto,
  MailTemplateListItem,
} from "../api/types.js";
import { useConnectionState } from "../connection/ConnectionStateProvider.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { CommunicationSendDialog } from "../communication/CommunicationSendDialog.js";
import "../communication/communication.css";
import { isTemplateDirty } from "../communication/templateDirty.js";
import { formatUtcDateTime } from "../utils/event-dates.js";

type ActiveField = "subject" | "body";
type TemplateFormat = "mjml" | "html";

/** Format an ISO timestamp for the delivery log table. */
function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return formatUtcDateTime(iso);
}

/** Insert placeholder text at the textarea cursor selection. */
function insertAtCursor(value: string, insertion: string, start: number, end: number): string {
  return value.slice(0, start) + insertion + value.slice(end);
}

const DELIVERY_PAGE_SIZE = 25;

/** Minimal client-side email shape check (submit is via button, not native form validation). */
function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** Admin screen for event mail template editing, preview, test-send, and delivery log. */
export function CommunicationPage() {
  const { eventId } = useParams();
  const { reportApiError } = useConnectionState();

  const [tab, setTab] = useState("compose");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [templates, setTemplates] = useState<MailTemplateListItem[]>([]);
  const [activeKey, setActiveKey] = useState<string>("virtual-ticket");
  const [activeTemplateName, setActiveTemplateName] = useState("ticket");
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [templateActionBusy, setTemplateActionBusy] = useState(false);

  const [source, setSource] = useState<EventTemplateDto["source"]>("builtin");
  const [allowedPlaceholders, setAllowedPlaceholders] = useState<string[]>([]);
  const [requiredPlaceholders, setRequiredPlaceholders] = useState<string[]>([]);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [format, setFormat] = useState<TemplateFormat>("mjml");
  const [savedSubject, setSavedSubject] = useState("");
  const [savedBody, setSavedBody] = useState("");
  const [savedFormat, setSavedFormat] = useState<TemplateFormat>("mjml");
  const [activeField, setActiveField] = useState<ActiveField>("body");

  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [overrideConfirmOpen, setOverrideConfirmOpen] = useState(false);
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
  const [deliveryStatus, setDeliveryStatus] = useState<EventDeliveriesListParams["status"]>("all");
  const [deliveryPurpose, setDeliveryPurpose] = useState<EventDeliveriesListParams["purpose"]>("all");
  const [deliveriesLoading, setDeliveriesLoading] = useState(false);
  const [deliveriesError, setDeliveriesError] = useState<string | null>(null);
  const [emailBounced, setEmailBounced] = useState(0);

  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  const templateSelectionSeqRef = useRef(0);

  const [templateSwitchConfirmOpen, setTemplateSwitchConfirmOpen] = useState(false);
  const [pendingTemplateKey, setPendingTemplateKey] = useState<string | null>(null);

  const isDirty = isTemplateDirty(
    { subject, body, format },
    { subject: savedSubject, body: savedBody, format: savedFormat },
  );
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      isDirty && currentLocation.pathname !== nextLocation.pathname,
  );

  const templatePayload = useCallback(
    () => ({
      subject_template: subject,
      body_template: body,
      template_format: format,
    }),
    [subject, body, format],
  );

  const applyLegacyTemplate = useCallback((data: EventTemplateDto) => {
    setSource(data.source);
    setSubject(data.subject_template);
    setBody(data.body_template);
    setFormat(data.template_format);
    setSavedSubject(data.subject_template);
    setSavedBody(data.body_template);
    setSavedFormat(data.template_format);
    setActiveTemplateName("ticket");
  }, []);

  const applyDetailTemplate = useCallback((detail: {
    name: string;
    subject_template: string;
    body_template: string;
    template_format: TemplateFormat;
  }) => {
    setSource("event");
    setActiveTemplateName(detail.name);
    setSubject(detail.subject_template);
    setBody(detail.body_template);
    setFormat(detail.template_format);
    setSavedSubject(detail.subject_template);
    setSavedBody(detail.body_template);
    setSavedFormat(detail.template_format);
  }, []);

  const loadTemplateSelection = useCallback(
    async (key: string, legacy: EventTemplateDto) => {
      if (key === "virtual-ticket") {
        applyLegacyTemplate(legacy);
        return;
      }
      const detail = await fetchEventTemplateById(eventId!, key);
      applyDetailTemplate(detail);
    },
    [applyDetailTemplate, applyLegacyTemplate, eventId],
  );

  const applySelectTemplate = useCallback(
    async (key: string) => {
      if (!eventId || key === activeKey) return;
      const seq = ++templateSelectionSeqRef.current;
      setValidationErrors([]);
      setSaveStatus(null);
      setPreviewSubject(null);
      setPreviewHtml(null);
      setTemplateActionBusy(true);
      try {
        const legacy = await fetchEventTemplate(eventId);
        if (seq !== templateSelectionSeqRef.current) return;
        await loadTemplateSelection(key, legacy);
        if (seq !== templateSelectionSeqRef.current) return;
        setActiveKey(key);
      } catch (err) {
        if (seq !== templateSelectionSeqRef.current) return;
        if (err instanceof ApiError) {
          reportApiError(err.status);
          setError("Failed to load template.");
        }
      } finally {
        if (seq === templateSelectionSeqRef.current) {
          setTemplateActionBusy(false);
        }
      }
    },
    [activeKey, eventId, loadTemplateSelection, reportApiError],
  );

  const requestSelectTemplate = useCallback(
    (key: string) => {
      if (!eventId || key === activeKey) return;
      if (isDirty) {
        setPendingTemplateKey(key);
        setTemplateSwitchConfirmOpen(true);
        return;
      }
      void applySelectTemplate(key);
    },
    [activeKey, applySelectTemplate, eventId, isDirty],
  );

  const handleCreateTemplate = async () => {
    if (!eventId) return;
    const label = window.prompt("Template label");
    if (!label?.trim()) return;
    setTemplateActionBusy(true);
    try {
      const created = await createEventTemplate(eventId, {
        label: label.trim(),
        template_format: "mjml",
      });
      setTemplates((prev) =>
        [...prev, created].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setActiveKey(created.id);
      applyDetailTemplate(created);
    } catch (err) {
      if (err instanceof ApiError) {
        reportApiError(err.status);
        setSaveStatus(err.message);
      } else {
        setSaveStatus("Create failed.");
      }
    } finally {
      setTemplateActionBusy(false);
    }
  };

  const handleDeleteTemplate = async (templateId: string, name: string) => {
    if (!eventId || name === "ticket") return;
    if (!window.confirm("Delete this template?")) return;
    setTemplateActionBusy(true);
    try {
      await deleteEventTemplate(eventId, templateId);
      const items = await fetchEventTemplates(eventId);
      setTemplates(items);
      const ticket = items.find((t) => t.name === "ticket");
      if (ticket) {
        setActiveKey(ticket.id);
        const detail = await fetchEventTemplateById(eventId, ticket.id);
        applyDetailTemplate(detail);
      } else {
        setActiveKey("virtual-ticket");
        const legacy = await fetchEventTemplate(eventId);
        applyLegacyTemplate(legacy);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        reportApiError(err.status);
        setSaveStatus(err.message);
      } else {
        setSaveStatus("Delete failed.");
      }
    } finally {
      setTemplateActionBusy(false);
    }
  };

  const sendTemplateId =
    activeKey === "virtual-ticket"
      ? templates.find((t) => t.name === "ticket")?.id
      : activeKey;

  const loadDeliveries = useCallback(async (signal?: AbortSignal) => {
    if (!eventId) return;
    setDeliveriesLoading(true);
    setDeliveriesError(null);
    try {
      const data = await fetchEventDeliveries(
        eventId,
        {
          page: deliveryPage,
          pageSize: DELIVERY_PAGE_SIZE,
          status: deliveryStatus,
          purpose: deliveryPurpose,
        },
        signal,
      );
      if (signal?.aborted) return;
      setDeliveries(data.items);
      setDeliveryTotal(data.total);
    } catch (err) {
      if (signal?.aborted || (err instanceof DOMException && err.name === "AbortError")) {
        return;
      }
      if (err instanceof ApiError) {
        reportApiError(err.status);
        if (err.status === 401) {
          const next = encodeURIComponent(window.location.pathname);
          window.location.assign(`/login?next=${next}`);
          return;
        }
      }
      setDeliveriesError("Failed to load deliveries.");
    } finally {
      if (!signal?.aborted) {
        setDeliveriesLoading(false);
      }
    }
  }, [eventId, deliveryPage, deliveryStatus, deliveryPurpose, reportApiError]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!eventId) return;
      setLoading(true);
      setError(null);
      try {
        const [items, data] = await Promise.all([
          fetchEventTemplates(eventId),
          fetchEventTemplate(eventId),
        ]);
        if (cancelled) return;
        setTemplates(items);
        setAllowedPlaceholders(data.allowed_placeholders);
        setRequiredPlaceholders(data.required_url_placeholders);
        const ticket = items.find((t) => t.name === "ticket");
        if (ticket) {
          setActiveKey(ticket.id);
          const detail = await fetchEventTemplateById(eventId, ticket.id);
          if (cancelled) return;
          applyDetailTemplate(detail);
        } else {
          setActiveKey("virtual-ticket");
          applyLegacyTemplate(data);
        }
        setValidationErrors([]);
        setSaveStatus(null);
        setPreviewSubject(null);
        setPreviewHtml(null);
      } catch (err) {
        if (cancelled) return;
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
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId, reportApiError, applyDetailTemplate, applyLegacyTemplate]);

  useLayoutEffect(() => {
    setEmailBounced(0);
  }, [eventId]);

  useEffect(() => {
    if (!eventId) return;
    const ac = new AbortController();
    void fetchEventOverview(eventId, ac.signal)
      .then((data) => {
        if (!ac.signal.aborted) setEmailBounced(data.email_bounced);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (ac.signal.aborted) return;
        setEmailBounced(0);
        if (err instanceof ApiError) {
          reportApiError(err.status);
        }
      });
    return () => ac.abort();
  }, [eventId, reportApiError]);

  useEffect(() => {
    if (tab !== "log") return;
    const controller = new AbortController();
    void loadDeliveries(controller.signal);
    return () => controller.abort();
  }, [tab, loadDeliveries]);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(deliveryTotal / DELIVERY_PAGE_SIZE));
    if (deliveryTotal === 0) {
      if (deliveryPage !== 1) setDeliveryPage(1);
    } else if (deliveryPage > maxPage) {
      setDeliveryPage(maxPage);
    }
  }, [deliveryTotal, deliveryPage]);

  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  const insertPlaceholder = (name: string) => {
    const token = `{{${name}}}`;
    if (activeField === "subject") {
      const el = subjectRef.current;
      const start = el?.selectionStart ?? subject.length;
      const end = el?.selectionEnd ?? subject.length;
      setSubject(insertAtCursor(subject, token, start, end));
      requestAnimationFrame(() => {
        if (el) {
          el.focus();
          el.setSelectionRange(start + token.length, start + token.length);
        }
      });
      return;
    }
    const el = bodyRef.current;
    const start = el?.selectionStart ?? body.length;
    const end = el?.selectionEnd ?? body.length;
    setBody(insertAtCursor(body, token, start, end));
    requestAnimationFrame(() => {
      if (el) {
        el.focus();
        el.setSelectionRange(start + token.length, start + token.length);
      }
    });
  };

  const handlePreview = async () => {
    if (!eventId) return;
    setPreviewLoading(true);
    setValidationErrors([]);
    setSaveStatus(null);
    try {
      const data =
        activeKey === "virtual-ticket"
          ? await previewEventTemplate(eventId, templatePayload())
          : await previewEventTemplateById(eventId, activeKey, templatePayload());
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

  const performSave = async () => {
    if (!eventId) return;
    setValidationErrors([]);
    setSaveStatus(null);
    setSaving(true);
    try {
      if (activeKey === "virtual-ticket") {
        await saveEventTemplate(eventId, templatePayload());
        const items = await fetchEventTemplates(eventId);
        setTemplates(items);
        const ticket = items.find((t) => t.name === "ticket");
        if (ticket) {
          setActiveKey(ticket.id);
          const detail = await fetchEventTemplateById(eventId, ticket.id);
          applyDetailTemplate(detail);
        } else {
          setSource("event");
          setSavedSubject(subject);
          setSavedBody(body);
          setSavedFormat(format);
        }
      } else {
        await saveEventTemplateById(eventId, activeKey, templatePayload());
        setSavedSubject(subject);
        setSavedBody(body);
        setSavedFormat(format);
        setTemplates((prev) =>
          prev.map((t) =>
            t.id === activeKey
              ? {
                  ...t,
                  subject_template: subject,
                  template_format: format,
                  updated_at: new Date().toISOString(),
                }
              : t,
          ),
        );
      }
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
    } finally {
      setSaving(false);
      setOverrideConfirmOpen(false);
    }
  };

  const handleSave = () => {
    if (!eventId) return;
    if (activeKey === "virtual-ticket" && source !== "event") {
      setOverrideConfirmOpen(true);
      return;
    }
    void performSave();
  };

  const overrideConfirmMessage =
    source === "organization"
      ? "This will create an event-specific template override (replacing the organization template for this event). Continue?"
      : "This will create an event-specific template override (replacing the default template for this event). Continue?";

  const handleTestSend = async () => {
    if (!eventId) return;
    setTestStatus(null);
    setTestSending(true);
    try {
      const result =
        activeKey === "virtual-ticket"
          ? await testSendEventTemplate(eventId, { to: testEmail.trim() })
          : await testSendEventTemplateById(eventId, activeKey, { to: testEmail.trim() });
      if (result.status === "sent") {
        setTestStatus({ kind: "ok", message: "Test email sent." });
      } else {
        setTestStatus({ kind: "error", message: result.error ?? "Send failed." });
      }
    } catch (err) {
      if (err instanceof ApiError) {
        reportApiError(err.status);
        const message =
          err.status === 400 && err.message === "validation_failed"
            ? "Enter a valid email address."
            : err.message;
        setTestStatus({ kind: "error", message });
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

  const deliveryPages = Math.max(1, Math.ceil(deliveryTotal / DELIVERY_PAGE_SIZE));
  const effectiveDeliveryPage = Math.min(deliveryPage, deliveryPages);
  const deliveryRangeStart = (effectiveDeliveryPage - 1) * DELIVERY_PAGE_SIZE + 1;
  const deliveryRangeEnd = Math.min(effectiveDeliveryPage * DELIVERY_PAGE_SIZE, deliveryTotal);

  return (
    <div className="screen">
      <PageHeader
        title="Communication"
        subtitle="Outlook-safe ticket email · Microsoft Graph transport"
        actions={
          sendTemplateId ? (
            <Button variant="secondary" onClick={() => setSendDialogOpen(true)}>
              Send email
            </Button>
          ) : undefined
        }
      />

      {emailBounced > 0 && (
        <div className="bounce-banner" role="alert">
          <i className="ti ti-alert-triangle" aria-hidden="true" />
          <span>
            <strong>
              {emailBounced} email{emailBounced !== 1 ? "s" : ""} bounced
            </strong>
            {" — these addresses will not receive future mail. "}
            <button
              type="button"
              className="bounce-banner__link"
              onClick={() => {
                setTab("log");
                setDeliveryStatus("bounced");
                setDeliveryPage(1);
              }}
            >
              View delivery log
            </button>
          </span>
        </div>
      )}

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "compose", label: isDirty ? "Compose *" : "Compose" },
          { id: "log", label: "Delivery log", count: deliveryTotal || undefined },
        ]}
      />

      {tab === "compose" ? (
        <>
          {activeKey === "virtual-ticket" && source !== "event" && (
            <div className="communication-default-banner">
              Using default template — save to customize for this event.
            </div>
          )}

          <div className="communication-compose">
            <nav className="communication-templates" aria-label="Email templates">
              <div className="communication-templates__header">
                <span>Templates</span>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={templateActionBusy}
                  onClick={() => void handleCreateTemplate()}
                >
                  New
                </Button>
              </div>
              <ul className="communication-templates__list">
                {!templates.some((t) => t.name === "ticket") && (
                  <li
                    className={[
                      "communication-templates__item",
                      activeKey === "virtual-ticket" && "communication-templates__item--active",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <button
                      type="button"
                      disabled={templateActionBusy}
                      onClick={() => requestSelectTemplate("virtual-ticket")}
                    >
                      Ticket email (inherited)
                    </button>
                  </li>
                )}
                {templates.map((t) => (
                  <li
                    key={t.id}
                    className={[
                      "communication-templates__item",
                      activeKey === t.id && "communication-templates__item--active",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <button
                      type="button"
                      disabled={templateActionBusy}
                      onClick={() => requestSelectTemplate(t.id)}
                    >
                      {t.label}
                    </button>
                    <button
                      type="button"
                      className="communication-templates__delete"
                      aria-label={`Delete ${t.label}`}
                      disabled={t.name === "ticket" || templateActionBusy}
                      onClick={() => void handleDeleteTemplate(t.id, t.name)}
                    >
                      <i className="ti ti-trash" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </nav>

            <Card
              title={activeTemplateName === "ticket" ? "Ticket template" : "Template"}
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
                ref={subjectRef}
                label="Subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                onFocus={() => setActiveField("subject")}
                onClick={() => setActiveField("subject")}
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
                <span className="communication-format-hint muted">
                  Changing format does not convert the template body.
                </span>
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
                  role="status"
                  aria-live="polite"
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
                <Button variant="primary" onClick={handleSave} disabled={saving || !isDirty}>
                  {saving ? "Saving…" : isDirty ? "Save *" : "Saved"}
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
                    sandbox=""
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
                disabled={testSending || !isValidEmail(testEmail.trim())}
              >
                {testSending ? "Sending…" : "Send test"}
              </Button>
            </div>
            {testStatus && (
              <p
                role="status"
                aria-live="polite"
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
                setDeliveryStatus(e.target.value as EventDeliveriesListParams["status"]);
                setDeliveryPage(1);
              }}
            >
              <option value="all">All</option>
              <option value="queued">Queued</option>
              <option value="accepted">Accepted</option>
              <option value="sent">Sent</option>
              <option value="delivered">Delivered</option>
              <option value="failed">Failed</option>
              <option value="bounced">Bounced</option>
              <option value="rejected">Rejected</option>
            </Select>
            <Select
              label="Purpose"
              value={deliveryPurpose}
              onChange={(e) => {
                setDeliveryPurpose(e.target.value as EventDeliveriesListParams["purpose"]);
                setDeliveryPage(1);
              }}
            >
              <option value="all">All purposes</option>
              <option value="initial">Initial send</option>
              <option value="resend">Resend</option>
            </Select>
          </div>

          <Card padded={false}>
            {deliveriesLoading ? (
              <div className="communication-empty">Loading deliveries…</div>
            ) : deliveriesError ? (
              <div className="communication-empty">{deliveriesError}</div>
            ) : deliveries.length === 0 ? (
              <div className="communication-empty">No messages sent yet.</div>
            ) : (
              <table className="table communication-table">
                <thead>
                  <tr>
                    <th>Recipient</th>
                    <th>Subject</th>
                    <th>Purpose</th>
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
                      <td>{row.purpose === "resend" ? "Resend" : "Initial"}</td>
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
            {!deliveriesError && deliveryTotal > 0 && (
              <div className="communication-pager">
                <span>
                  Showing {deliveryRangeStart}–{deliveryRangeEnd} of {deliveryTotal}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={effectiveDeliveryPage <= 1}
                  onClick={() => setDeliveryPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={effectiveDeliveryPage >= deliveryPages}
                  onClick={() => setDeliveryPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            )}
          </Card>
        </>
      )}
      <ConfirmDialog
        open={templateSwitchConfirmOpen}
        title="Discard unsaved changes?"
        message="You have unsaved template changes. Switching templates will discard them."
        confirmLabel="Discard"
        confirmVariant="danger"
        cancelLabel="Keep editing"
        onConfirm={() => {
          setTemplateSwitchConfirmOpen(false);
          const key = pendingTemplateKey;
          setPendingTemplateKey(null);
          if (key) void applySelectTemplate(key);
        }}
        onCancel={() => {
          setTemplateSwitchConfirmOpen(false);
          setPendingTemplateKey(null);
        }}
      />
      <ConfirmDialog
        open={overrideConfirmOpen}
        title="Create event template override"
        message={overrideConfirmMessage}
        confirmLabel="Continue"
        loading={saving}
        onCancel={() => setOverrideConfirmOpen(false)}
        onConfirm={() => void performSave()}
      />
      <ConfirmDialog
        open={blocker.state === "blocked"}
        title="Discard unsaved changes?"
        message="You have unsaved template changes. They will be lost if you leave this page."
        confirmLabel="Discard"
        confirmVariant="danger"
        cancelLabel="Keep editing"
        onConfirm={() => blocker.proceed?.()}
        onCancel={() => blocker.reset?.()}
      />
      {eventId && sendTemplateId && (
        <CommunicationSendDialog
          open={sendDialogOpen}
          eventId={eventId}
          templateId={sendTemplateId}
          onClose={() => setSendDialogOpen(false)}
        />
      )}
    </div>
  );
}
