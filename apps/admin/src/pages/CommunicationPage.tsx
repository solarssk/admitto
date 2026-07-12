import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useBlocker, useOutletContext, useParams } from "react-router-dom";
import { Badge, Button, Card, Input, PageHeader, Select, StatusBadge, Tabs, useToast } from "@admitto/ui";
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
import { hasApiErrorCode, operatorApiErrorMessage } from "../api/operator-api-error.js";
import type {
  DeliveryDto,
  EventDeliveriesListParams,
  EventDto,
  EventTemplateDto,
  MailTemplateDetail,
  MailTemplateListItem,
} from "../api/types.js";
import { useConnectionState } from "../connection/ConnectionStateProvider.js";
import { ARCHIVED_ACTION_TOOLTIP, ArchivedGuard, isEventArchived } from "../components/ArchivedGuard.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { CommunicationSendDialog } from "../communication/CommunicationSendDialog.js";
import { CreateTemplateDialog } from "../communication/CreateTemplateDialog.js";
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

/** Human-readable alt text for a known image placeholder; custom asset tokens just use their
 * own name (they have no separate display-name field). */
function imagePlaceholderAltText(name: string): string {
  switch (name) {
    case "logo_url":
      return "Logo";
    case "header_image_url":
      return "Header image";
    case "qr_image_url":
      return "Ticket QR code";
    default:
      return name;
  }
}

/** Markup inserted for an image placeholder — a ready-to-use image element, not a bare
 * `{{name}}` token. A bare token never displays a picture on its own; it needs to be the `src`
 * of an actual image element, so the picker inserts one directly. */
function imagePlaceholderMarkup(name: string, format: TemplateFormat): string {
  const alt = imagePlaceholderAltText(name);
  return format === "mjml"
    ? `<mj-image src="{{${name}}}" alt="${alt}" width="200px" />`
    : `<img src="{{${name}}}" alt="${alt}" width="200" style="max-width:100%;" />`;
}

/** True when [start, end] falls inside the `<mjml>...</mjml>` root found in `value` — strictly
 * after the opening tag's closing `>` and at/before the closing tag's start. Returns true (i.e.
 * "assume fine, don't second-guess it") when no recognizable `<mjml ...>`/`</mjml>` pair exists,
 * since we can't reason about a template shape we don't recognize. */
function isWithinMjmlRoot(value: string, start: number, end: number): boolean {
  const openMatch = /<mjml[^>]*>/i.exec(value);
  const closeIdx = value.lastIndexOf("</mjml>");
  if (!openMatch || closeIdx === -1) return true;
  const openTagEnd = openMatch.index + openMatch[0].length;
  return start >= openTagEnd && end <= closeIdx;
}

/** Last `</mj-column>` position in an MJML body, or -1 if none is found. Used as a safe fallback
 * insertion point — see `insertPlaceholder` for why this is needed. */
function findMjmlColumnFallbackIndex(value: string): number {
  return value.lastIndexOf("</mj-column>");
}

/** True when [start, end] falls inside some `<mj-column ...>...</mj-column>` pair in `value`.
 * Being "within the `<mjml>` root" isn't enough on its own — a cursor can sit inside the root
 * but between components (e.g. right after `</mj-section>` and before `</mj-body>`, or between
 * two sibling `<mj-section>` blocks), which is just as much a loose-text-drop hazard as being
 * outside the root entirely (see the comment in `insertTokenIntoField`). `<mj-column>` is the
 * innermost element every real template's text content actually lives inside (see
 * DEFAULT_BODY_MJML in packages/mail-templates), and MJML doesn't nest one `<mj-column>` inside
 * another, so a simple sequential tag scan — matching the pragmatic style of
 * `findMjmlColumnFallbackIndex` above — is enough without a full XML parser. */
function isInsideMjColumn(value: string, start: number, end: number): boolean {
  const openTagPattern = /<mj-column[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = openTagPattern.exec(value))) {
    const openEnd = match.index + match[0].length;
    const closeIdx = value.indexOf("</mj-column>", openEnd);
    if (closeIdx !== -1 && start >= openEnd && end <= closeIdx) return true;
  }
  return false;
}

const DELIVERY_PAGE_SIZE = 25;

type DirtyProtectedAction =
  | { kind: "select"; key: string }
  | { kind: "create" }
  | { kind: "delete"; templateId: string; name: string };

/** Sort template list items by label for the sidebar. */
function sortTemplates(items: MailTemplateListItem[]): MailTemplateListItem[] {
  return [...items].sort((a, b) => a.label.localeCompare(b.label));
}

/** Strip editor-only fields from a template detail row for list display. */
function templateListItemFromDetail(detail: MailTemplateDetail): MailTemplateListItem {
  const { body_template: _body, compiled_html_template: _compiled, ...item } = detail;
  return item;
}

/** Map API delete errors to operator-facing copy. */
function mailTemplateDeleteErrorMessage(err: ApiError): string {
  return operatorApiErrorMessage(err, "Delete failed.");
}

type TemplateSelectionLoad =
  | { kind: "legacy"; data: EventTemplateDto }
  | {
      kind: "detail";
      data: {
        name: string;
        subject_template: string;
        body_template: string;
        template_format: TemplateFormat;
      };
    };

/** Minimal client-side email shape check (submit is via button, not native form validation). */
function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** Admin screen for event mail template editing, preview, test-send, and delivery log. */
export function CommunicationPage() {
  const { eventId } = useParams();
  const { event } = useOutletContext<{ event: EventDto }>();
  const { reportApiError } = useConnectionState();
  const { addToast } = useToast();

  const [tab, setTab] = useState("compose");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [templates, setTemplates] = useState<MailTemplateListItem[]>([]);
  const [activeKey, setActiveKey] = useState<string>("virtual-ticket");
  const [activeTemplateName, setActiveTemplateName] = useState("ticket");
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [templateActionBusy, setTemplateActionBusy] = useState(false);
  const [editorSnapshotMissing, setEditorSnapshotMissing] = useState(false);

  const [source, setSource] = useState<EventTemplateDto["source"]>("builtin");
  const [allowedPlaceholders, setAllowedPlaceholders] = useState<string[]>([]);
  const [requiredPlaceholders, setRequiredPlaceholders] = useState<string[]>([]);
  const [imagePlaceholders, setImagePlaceholders] = useState<string[]>([]);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [format, setFormat] = useState<TemplateFormat>("mjml");
  const [savedSubject, setSavedSubject] = useState("");
  const [savedBody, setSavedBody] = useState("");
  const [savedFormat, setSavedFormat] = useState<TemplateFormat>("mjml");
  const [activeField, setActiveField] = useState<ActiveField>("body");

  const [validationErrors, setValidationErrors] = useState<string[]>([]);
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
  const createTemplateSeqRef = useRef(0);
  const deleteTemplateSeqRef = useRef(0);
  const createInFlightRef = useRef(false);
  const currentEventIdRef = useRef(eventId);
  /** Latest legacy ticket snapshot; refreshed on each virtual-ticket selection and after save. */
  const legacyTemplateRef = useRef<EventTemplateDto | null>(null);

  const [dirtyConfirmOpen, setDirtyConfirmOpen] = useState(false);
  const [pendingDirtyAction, setPendingDirtyAction] = useState<DirtyProtectedAction | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ templateId: string; name: string } | null>(
    null,
  );

  const isDirty = isTemplateDirty(
    { subject, body, format },
    { subject: savedSubject, body: savedBody, format: savedFormat },
  );
  const localConfirmOpen =
    dirtyConfirmOpen || deleteConfirmOpen || createDialogOpen || overrideConfirmOpen;
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      isDirty &&
      !localConfirmOpen &&
      currentLocation.pathname !== nextLocation.pathname,
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
    setEditorSnapshotMissing(false);
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
    setEditorSnapshotMissing(false);
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
    async (key: string): Promise<TemplateSelectionLoad> => {
      if (key === "virtual-ticket") {
        legacyTemplateRef.current = await fetchEventTemplate(eventId!);
        return { kind: "legacy", data: legacyTemplateRef.current };
      }
      const detail = await fetchEventTemplateById(eventId!, key);
      return { kind: "detail", data: detail };
    },
    [eventId],
  );

  const applyLoadedTemplateSelection = useCallback(
    (key: string, result: TemplateSelectionLoad) => {
      if (result.kind === "legacy") applyLegacyTemplate(result.data);
      else applyDetailTemplate(result.data);
      setActiveKey(key);
    },
    [applyDetailTemplate, applyLegacyTemplate],
  );

  const applySelectTemplate = useCallback(
    async (key: string) => {
      if (!eventId || (key === activeKey && !editorSnapshotMissing)) return;
      const seq = ++templateSelectionSeqRef.current;
      setValidationErrors([]);
      setPreviewSubject(null);
      setPreviewHtml(null);
      setTemplateActionBusy(true);
      try {
        const result = await loadTemplateSelection(key);
        if (seq !== templateSelectionSeqRef.current) return;
        applyLoadedTemplateSelection(key, result);
      } catch (err) {
        if (seq !== templateSelectionSeqRef.current) return;
        if (err instanceof ApiError) {
          reportApiError(err.status);
          addToast(operatorApiErrorMessage(err, "Request failed."), "error");
        } else {
          addToast("Failed to load template.", "error");
        }
      } finally {
        if (seq === templateSelectionSeqRef.current) {
          setTemplateActionBusy(false);
        }
      }
    },
    [activeKey, applyLoadedTemplateSelection, editorSnapshotMissing, eventId, loadTemplateSelection, reportApiError, addToast],
  );

  const runDirtyProtectedAction = useCallback(
    (action: DirtyProtectedAction) => {
      if (action.kind === "select") {
        void applySelectTemplate(action.key);
        return;
      }
      if (action.kind === "create") {
        setCreateDialogOpen(true);
        return;
      }
      setPendingDelete({ templateId: action.templateId, name: action.name });
      setDeleteConfirmOpen(true);
    },
    [applySelectTemplate],
  );

  const requestDirtyProtectedAction = useCallback(
    (action: DirtyProtectedAction) => {
      if (!eventId) return;
      if (action.kind === "select" && action.key === activeKey && !editorSnapshotMissing) return;
      if (action.kind === "delete" && action.name === "ticket") return;
      if (isDirty) {
        setPendingDirtyAction(action);
        setDirtyConfirmOpen(true);
        return;
      }
      runDirtyProtectedAction(action);
    },
    [activeKey, editorSnapshotMissing, eventId, isDirty, runDirtyProtectedAction],
  );

  const executeCreateTemplate = async (label: string) => {
    if (!eventId || createInFlightRef.current) return;
    createInFlightRef.current = true;
    const seq = ++createTemplateSeqRef.current;
    setTemplateActionBusy(true);
    try {
      const created = await createEventTemplate(eventId, {
        label,
        template_format: "mjml",
      });
      if (seq !== createTemplateSeqRef.current) return;
      setTemplates((prev) => sortTemplates([...prev, created]));
      applyDetailTemplate(created);
      setActiveKey(created.id);
      setCreateDialogOpen(false);
    } catch (err) {
      if (seq !== createTemplateSeqRef.current) return;
      if (err instanceof ApiError) {
        reportApiError(err.status);
        addToast(operatorApiErrorMessage(err, "Request failed."), "error");
      } else {
        addToast("Create failed.", "error");
      }
    } finally {
      createInFlightRef.current = false;
      if (seq === createTemplateSeqRef.current) {
        setTemplateActionBusy(false);
      }
    }
  };

  const executeDeleteTemplate = useCallback(async (templateId: string) => {
    const scopeEventId = eventId;
    if (!scopeEventId) return;
    const seq = ++deleteTemplateSeqRef.current;
    const deletedWasActive = templateId === activeKey;
    setTemplateActionBusy(true);
    try {
      await deleteEventTemplate(scopeEventId, templateId);
      if (seq !== deleteTemplateSeqRef.current || scopeEventId !== currentEventIdRef.current) return;

      const items = await fetchEventTemplates(scopeEventId);
      if (seq !== deleteTemplateSeqRef.current || scopeEventId !== currentEventIdRef.current) return;

      setTemplates(items);
      setDeleteConfirmOpen(false);
      setPendingDelete(null);

      if (!deletedWasActive) return;

      const ticket = items.find((t) => t.name === "ticket");
      if (ticket) {
        let loaded = false;
        let lastErr: unknown;
        for (let attempt = 0; attempt < 2 && !loaded; attempt++) {
          if (seq !== deleteTemplateSeqRef.current || scopeEventId !== currentEventIdRef.current) return;
          try {
            const detail = await fetchEventTemplateById(scopeEventId, ticket.id);
            if (seq !== deleteTemplateSeqRef.current || scopeEventId !== currentEventIdRef.current) return;
            applyDetailTemplate(detail);
            setActiveKey(ticket.id);
            loaded = true;
          } catch (err) {
            lastErr = err;
          }
        }
        if (!loaded) {
          if (seq !== deleteTemplateSeqRef.current || scopeEventId !== currentEventIdRef.current) return;
          if (lastErr instanceof ApiError) reportApiError(lastErr.status);
          setActiveKey(ticket.id);
          setEditorSnapshotMissing(true);
          setSubject("");
          setBody("");
          setSavedSubject("");
          setSavedBody("");
          setValidationErrors([]);
          setPreviewSubject(null);
          setPreviewHtml(null);
          addToast("Template deleted. Could not load ticket template — reload the page.", "warning");
        }
      } else {
        try {
          legacyTemplateRef.current = await fetchEventTemplate(scopeEventId);
          if (seq !== deleteTemplateSeqRef.current || scopeEventId !== currentEventIdRef.current) return;
          applyLegacyTemplate(legacyTemplateRef.current);
          setActiveKey("virtual-ticket");
        } catch {
          if (seq !== deleteTemplateSeqRef.current || scopeEventId !== currentEventIdRef.current) return;
          if (legacyTemplateRef.current) {
            applyLegacyTemplate(legacyTemplateRef.current);
            setActiveKey("virtual-ticket");
            addToast(
              "Template deleted. Inherited ticket could not be refreshed — showing last known copy.",
              "warning",
            );
          } else {
            setActiveKey("virtual-ticket");
            addToast("Template deleted. Could not load inherited ticket — reload the page.", "warning");
          }
        }
      }
    } catch (err) {
      if (seq !== deleteTemplateSeqRef.current || scopeEventId !== currentEventIdRef.current) return;
      if (err instanceof ApiError) {
        reportApiError(err.status);
        addToast(mailTemplateDeleteErrorMessage(err), "error");
      } else {
        addToast("Delete failed.", "error");
      }
    } finally {
      if (seq === deleteTemplateSeqRef.current) {
        setTemplateActionBusy(false);
      }
    }
  }, [activeKey, applyDetailTemplate, applyLegacyTemplate, eventId, reportApiError, addToast]);

  const sendTemplateId = editorSnapshotMissing
    ? undefined
    : activeKey === "virtual-ticket"
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
    currentEventIdRef.current = eventId;
    deleteTemplateSeqRef.current += 1;
    setTemplateActionBusy(false);
    setDeleteConfirmOpen(false);
    setPendingDelete(null);
  }, [eventId]);

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
        legacyTemplateRef.current = data;
        setTemplates(items);
        setAllowedPlaceholders(data.allowed_placeholders);
        setRequiredPlaceholders(data.required_url_placeholders);
        setImagePlaceholders(data.image_placeholders ?? []);
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

  /** Insert a token at a field's cursor, then move the cursor to right after it.
   *
   * Reads and writes the actual DOM element's `value`/selection synchronously (not the React
   * state closure or a `requestAnimationFrame`-deferred selection restore) so that clicking a
   * placeholder chip multiple times in a row — even faster than React can re-render between
   * clicks — always appends after the previous insertion instead of silently overwriting it or
   * splicing into the middle of it. Previously, reading `el.selectionStart` and the `body`/
   * `subject` state at click time could both be stale if a prior click's state update and
   * rAF-scheduled cursor move hadn't been committed yet, causing rapid repeated clicks to insert
   * at the same stale position and produce broken, nested markup (e.g. a second `<mj-image>`
   * landing inside the first one's `src="..."` attribute). Setting `el.value`/selection directly
   * keeps every insertion's start position accurate regardless of click timing, since React skips
   * touching the DOM value/selection of a controlled input when they already match its state.
   */
  function insertTokenIntoField(
    el: HTMLInputElement | HTMLTextAreaElement | null,
    token: string,
    setValue: (value: string) => void,
  ) {
    if (!el) return;
    let start = el.selectionStart ?? el.value.length;
    let end = el.selectionEnd ?? el.value.length;
    let insertion = token;

    // MJML silently discards any markup outside the `<mjml>...</mjml>` root — no error, no
    // warning, it just never reaches the compiled output. This happens in practice whenever a
    // chip is clicked before the textarea has ever been focused (the browser then reports
    // selectionStart/End as 0, i.e. the very start of the raw text, which sits *before* `<mjml>`
    // opens). The same silent drop also happens for loose text nodes *inside* the root but
    // between components (e.g. between two sibling `<mj-section>`s) — `isWithinMjmlRoot` alone
    // doesn't catch that, so also redirect whenever the cursor isn't inside a `<mj-column>`.
    // Redirect to a location guaranteed to be inside a valid `<mj-column>` instead, and wrap bare
    // `{{token}}` text in its own `<mj-text>` — a bare token needs the same wrapping a real edit
    // at a normal cursor position would already have from surrounding markup.
    if (
      el === bodyRef.current &&
      format === "mjml" &&
      (!isWithinMjmlRoot(el.value, start, end) || !isInsideMjColumn(el.value, start, end))
    ) {
      const fallbackIdx = findMjmlColumnFallbackIndex(el.value);
      if (fallbackIdx !== -1) {
        start = fallbackIdx;
        end = fallbackIdx;
        insertion = token.startsWith("<mj-") ? token : `<mj-text>${token}</mj-text>`;
      }
    }

    const newValue = insertAtCursor(el.value, insertion, start, end);
    const newCursorPos = start + insertion.length;
    el.value = newValue;
    el.setSelectionRange(newCursorPos, newCursorPos);
    el.focus();
    setValue(newValue);
  }

  const insertPlaceholder = (name: string) => {
    // Subjects are plain text (no HTML rendering), so always insert the bare token there. In the
    // body, an image placeholder gets a ready-to-use image element instead of a bare token —
    // {{logo_url}} alone never displays a picture, it needs to be an <img>/<mj-image> src.
    const token =
      activeField === "body" && imagePlaceholders.includes(name)
        ? imagePlaceholderMarkup(name, format)
        : `{{${name}}}`;
    if (activeField === "subject") {
      insertTokenIntoField(subjectRef.current, token, setSubject);
      return;
    }
    insertTokenIntoField(bodyRef.current, token, setBody);
  };

  const handlePreview = async () => {
    if (!eventId || editorSnapshotMissing) return;
    setPreviewLoading(true);
    setValidationErrors([]);
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
        addToast(operatorApiErrorMessage(err, "Request failed."), "error");
      } else {
        addToast("Preview failed.", "error");
      }
    } finally {
      setPreviewLoading(false);
    }
  };

  const performSave = async () => {
    if (!eventId) return;
    setValidationErrors([]);
    setSaving(true);
    try {
      if (activeKey === "virtual-ticket") {
        await saveEventTemplate(eventId, templatePayload());
        legacyTemplateRef.current = await fetchEventTemplate(eventId);
        const items = await fetchEventTemplates(eventId);
        setTemplates(items);
        const ticket = items.find((t) => t.name === "ticket");
        if (ticket) {
          setActiveKey(ticket.id);
          const detail = await fetchEventTemplateById(eventId, ticket.id);
          applyDetailTemplate(detail);
        } else {
          applyLegacyTemplate(legacyTemplateRef.current);
        }
      } else {
        const saved = await saveEventTemplateById(eventId, activeKey, templatePayload());
        applyDetailTemplate(saved);
        setTemplates((prev) =>
          sortTemplates(prev.map((t) => (t.id === activeKey ? templateListItemFromDetail(saved) : t))),
        );
      }
      addToast("Template saved.", "success");
      setPreviewSubject(null);
      setPreviewHtml(null);
    } catch (err) {
      if (err instanceof TemplateValidationError) {
        setValidationErrors(err.errors);
      } else if (err instanceof ApiError) {
        reportApiError(err.status);
        addToast(operatorApiErrorMessage(err, "Request failed."), "error");
      } else {
        addToast("Save failed.", "error");
      }
    } finally {
      setSaving(false);
      setOverrideConfirmOpen(false);
    }
  };

  const handleSave = () => {
    if (!eventId || editorSnapshotMissing) return;
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
    if (!eventId || editorSnapshotMissing) return;
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
          err.status === 400 && hasApiErrorCode(err, "validation_failed")
            ? "Enter a valid email address."
            : operatorApiErrorMessage(err, "Send failed.");
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
            <ArchivedGuard event={event} reasonId="send-email-reason">
              {(guard) => (
                <Button variant="secondary" onClick={() => setSendDialogOpen(true)} {...guard}>
                  Send email
                </Button>
              )}
            </ArchivedGuard>
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
                <ArchivedGuard event={event} reasonId="new-template-reason" disabled={templateActionBusy}>
                  {(guard) => (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => requestDirtyProtectedAction({ kind: "create" })}
                      {...guard}
                    >
                      New
                    </Button>
                  )}
                </ArchivedGuard>
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
                      onClick={() => requestDirtyProtectedAction({ kind: "select", key: "virtual-ticket" })}
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
                      onClick={() => requestDirtyProtectedAction({ kind: "select", key: t.id })}
                    >
                      {t.label}
                    </button>
                    <ArchivedGuard
                      event={event}
                      reasonId={`delete-template-${t.id}-reason`}
                      disabled={t.name === "ticket" || templateActionBusy}
                    >
                      {(guard) => (
                        <button
                          type="button"
                          className="communication-templates__delete"
                          aria-label={`Delete ${t.label}`}
                          onClick={() =>
                            requestDirtyProtectedAction({
                              kind: "delete",
                              templateId: t.id,
                              name: t.name,
                            })
                          }
                          {...guard}
                        >
                          <i className="ti ti-trash" aria-hidden="true" />
                        </button>
                      )}
                    </ArchivedGuard>
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
                  {allowedPlaceholders.map((p) => {
                    const isImage = imagePlaceholders.includes(p);
                    const isRequired = requiredPlaceholders.includes(p);
                    const titleParts = [
                      isRequired && "Required placeholder",
                      isImage && "Inserts a ready-to-use image",
                    ].filter((part): part is string => Boolean(part));
                    return (
                      <button
                        key={p}
                        type="button"
                        className={[
                          "communication-chip",
                          isRequired && "communication-chip--required",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        onClick={() => insertPlaceholder(p)}
                        title={titleParts.length ? titleParts.join(" · ") : undefined}
                      >
                        {isImage && <i className="ti ti-photo" aria-hidden="true" />}
                        {`{{${p}}}`}
                      </button>
                    );
                  })}
                </div>
              </div>

              <fieldset
                className={["communication-editor-fieldset", isEventArchived(event) && "at-tooltip"]
                  .filter(Boolean)
                  .join(" ")}
                data-tooltip={isEventArchived(event) ? ARCHIVED_ACTION_TOOLTIP : undefined}
                disabled={isEventArchived(event)}
              >
                <Input
                  ref={subjectRef}
                  label="Subject"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  onFocus={() => setActiveField("subject")}
                  onClick={() => setActiveField("subject")}
                  disabled={editorSnapshotMissing}
                />
              </fieldset>

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

              <fieldset
                className={["communication-editor-fieldset", isEventArchived(event) && "at-tooltip"]
                  .filter(Boolean)
                  .join(" ")}
                data-tooltip={isEventArchived(event) ? ARCHIVED_ACTION_TOOLTIP : undefined}
                disabled={isEventArchived(event)}
              >
                <div className="communication-body-field">
                  <label htmlFor="communication-body">{format === "mjml" ? "MJML body" : "HTML body"}</label>
                  <textarea
                    id="communication-body"
                    ref={bodyRef}
                    className="communication-textarea"
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    onFocus={() => setActiveField("body")}
                    disabled={editorSnapshotMissing}
                  />
                </div>
              </fieldset>

              {validationErrors.length > 0 && (
                <div className="communication-errors" role="alert">
                  <ul>
                    {validationErrors.map((msg) => (
                      <li key={msg}>{msg}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="communication-actions">
                <ArchivedGuard
                  event={event}
                  reasonId="preview-template-reason"
                  disabled={previewLoading || editorSnapshotMissing}
                >
                  {(guard) => (
                    <Button variant="secondary" onClick={() => void handlePreview()} {...guard}>
                      {previewLoading ? "Previewing…" : "Preview"}
                    </Button>
                  )}
                </ArchivedGuard>
                <ArchivedGuard
                  event={event}
                  reasonId="save-template-reason"
                  disabled={saving || !isDirty || editorSnapshotMissing}
                >
                  {(guard) => (
                    <Button variant="primary" onClick={handleSave} {...guard}>
                      {saving ? "Saving…" : isDirty ? "Save *" : "Saved"}
                    </Button>
                  )}
                </ArchivedGuard>
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
              <ArchivedGuard
                event={event}
                reasonId="send-test-reason"
                disabled={testSending || !isValidEmail(testEmail.trim()) || editorSnapshotMissing}
              >
                {(guard) => (
                  <Button variant="secondary" onClick={() => void handleTestSend()} {...guard}>
                    {testSending ? "Sending…" : "Send test"}
                  </Button>
                )}
              </ArchivedGuard>
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
                        {formatDateTime(row.sent_at ?? row.accepted_at ?? row.failed_at)}
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
        open={dirtyConfirmOpen}
        title="Discard unsaved changes?"
        message="You have unsaved template changes. Continuing will discard them."
        confirmLabel="Discard"
        confirmVariant="danger"
        cancelLabel="Keep editing"
        onConfirm={() => {
          setDirtyConfirmOpen(false);
          const action = pendingDirtyAction;
          setPendingDirtyAction(null);
          if (action) runDirtyProtectedAction(action);
        }}
        onCancel={() => {
          setDirtyConfirmOpen(false);
          setPendingDirtyAction(null);
        }}
      />
      <ConfirmDialog
        open={deleteConfirmOpen}
        title="Delete template?"
        message={
          pendingDelete
            ? `Delete "${templates.find((t) => t.id === pendingDelete.templateId)?.label ?? pendingDelete.name}"? This cannot be undone.`
            : "Delete this template?"
        }
        confirmLabel="Delete"
        confirmVariant="danger"
        loading={templateActionBusy}
        onCancel={() => {
          if (templateActionBusy) return;
          setDeleteConfirmOpen(false);
          setPendingDelete(null);
        }}
        onConfirm={() => {
          if (pendingDelete) void executeDeleteTemplate(pendingDelete.templateId);
        }}
      />
      <CreateTemplateDialog
        open={createDialogOpen}
        busy={templateActionBusy}
        onClose={() => {
          if (templateActionBusy) return;
          setCreateDialogOpen(false);
        }}
        onCreate={(label) => void executeCreateTemplate(label)}
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
        open={blocker.state === "blocked" && !localConfirmOpen}
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
