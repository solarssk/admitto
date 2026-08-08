import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type ReactNode,
  type RefObject,
  type SetStateAction,
} from "react";
import { useBlocker, useOutletContext, useParams, useSearchParams } from "react-router";
import {
  Badge,
  Button,
  Card,
  HintLabel,
  Input,
  Notice,
  PageHeader,
  Select,
  Spinner,
  Tabs,
  Tooltip,
  useToast,
  type ToastVariant,
} from "@admitto/ui";
import {
  ApiError,
  createEventTemplate,
  deleteEventTemplate,
  fetchEventDeliveries,
  fetchEventMailSettings,
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
  updateEventTemplateMetadata,
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
import { browserClockTime, formatEventDate } from "../utils/event-dates.js";
import { useDelayedLoading, whenShown } from "../hooks/useDelayedLoading.js";
import { ARCHIVED_ACTION_TOOLTIP, ArchivedGuard, isEventArchived } from "../components/ArchivedGuard.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { SearchableSelect } from "../components/SearchableSelect.js";
import { Segmented, type SegmentedOption } from "../components/Segmented.js";
import { CommunicationSendPanel } from "../communication/CommunicationSendPanel.js";
import { CreateTemplateDialog } from "../communication/CreateTemplateDialog.js";
import { EditTemplateModal } from "../communication/EditTemplateModal.js";
import { DEFAULT_TEMPLATE_ICON } from "../communication/templateIcons.js";
import { DELIVERY_PAGE_SIZE_DEFAULT, DELIVERY_POLL_INTERVAL_MS, DeliveryLogTab } from "../communication/DeliveryLogTable.js";
import "../communication/communication.css";
import { isTemplateDirty } from "../communication/templateDirty.js";

type ActiveField = "subject" | "body";
type TemplateFormat = "mjml" | "html";

/** Result of the last "Send test" attempt. `template`/`subject` are only meaningful on success -
 * they name exactly what got sent, since "Test email sent." alone doesn't say which template or
 * confirm the subject line actually used. */
type TestSendStatus =
  | { kind: "ok"; message: string; template: string; subject: string | null; email: string }
  | { kind: "error"; message: string; email: string };

/** Placeholders that stay valid (already-saved templates using them keep rendering) but are no
 * longer offered as an insertable chip: `header_image_url` has no organisation-level branding
 * field to fall back to (org branding only manages a logo, see BrandingSettingsPanel) and
 * the per-event header image override was intentionally dropped in favour of the general-purpose
 * image asset library — inserting it would always produce a permanently empty image with no way
 * to fill it in. Filtered client-side, not removed from the server's ALLOWED_PLACEHOLDERS
 * whitelist, so it's not a backward-compat break for any already-saved template. */
const HIDDEN_PLACEHOLDERS = new Set(["header_image_url"]);

const TEMPLATE_FORMAT_OPTIONS: ReadonlyArray<SegmentedOption<TemplateFormat>> = [
  { value: "mjml", label: "MJML" },
  { value: "html", label: "HTML" },
];

/** Groups the insert-placeholder chips into readable sections instead of one long flat row -
 * a custom asset token (name not listed in any group) falls back to its own trailing "Images"
 * group, added dynamically in TemplateEditorCard below. */
const PLACEHOLDER_GROUPS: ReadonlyArray<{ label: string; names: readonly string[] }> = [
  { label: "Attendee", names: ["first_name", "last_name", "full_name", "email"] },
  {
    label: "Event",
    names: [
      "event_name",
      "event_date",
      "event_location",
      "event_address",
      "event_map_url",
      "google_maps_url",
      "apple_maps_url",
      "directions_text",
      "accessibility_text",
    ],
  },
  { label: "Ticket & QR", names: ["ticket_url", "qr_image_url", "download_page_url"] },
  { label: "Wallet", names: ["apple_wallet_url", "google_wallet_url"] },
  { label: "Branding", names: ["logo_url"] },
];

/** Wallet-add links get a ticket icon on their chip (like the image chips get a photo icon) -
 * they're not images, but they're just as easy to skim past as a bare token otherwise. */
const WALLET_PLACEHOLDERS = new Set(["apple_wallet_url", "google_wallet_url"]);

/** One-line explanation shown as the chip's tooltip - what a token actually resolves to, not
 * just its name. Custom image asset tokens (dynamic, not in this map) fall back to a generic
 * description rather than showing no tooltip at all. */
function placeholderDescription(name: string, isImage: boolean): string {
  const known: Record<string, string> = {
    first_name: "Attendee's first name.",
    last_name: "Attendee's last name.",
    full_name: "Attendee's full name.",
    email: "Attendee's email address.",
    event_name: "This event's title.",
    event_date: "This event's date, formatted for the event's own timezone.",
    event_location: "Venue name.",
    event_address: "Venue's street address.",
    event_map_url: "Static map image of the venue.",
    google_maps_url: "Link to open the venue in Google Maps.",
    apple_maps_url: "Link to open the venue in Apple Maps.",
    directions_text: "Getting-there directions, if set in Event settings.",
    accessibility_text: "Accessibility notes, if set in Event settings.",
    ticket_url: "Link to the attendee's own ticket page.",
    qr_image_url: "The attendee's scannable QR code image.",
    download_page_url: "Link to the ticket download page.",
    apple_wallet_url: "Link to add the ticket to Apple Wallet.",
    google_wallet_url: "Link to add the ticket to Google Wallet.",
    logo_url: "Your organisation's logo image.",
  };
  return known[name] ?? (isImage ? "Custom image asset for this event." : `{{${name}}}`);
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
    case "event_map_url":
      return "Event location map";
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

/** True when [start, end] falls inside some `<mj-text ...>...</mj-text>` pair in `value`. A
 * bare `{{token}}` inserted there is fine (that's exactly what mj-text is for), but an image
 * element (`<mj-image>`) is not a valid child of mj-text — MJML rejects the nested markup at
 * compile time (bot review). Same sequential-scan approach as `isInsideMjColumn`. */
function isInsideMjText(value: string, start: number, end: number): boolean {
  const openTagPattern = /<mj-text[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = openTagPattern.exec(value))) {
    const openEnd = match.index + match[0].length;
    const closeIdx = value.indexOf("</mj-text>", openEnd);
    if (closeIdx !== -1 && start >= openEnd && end <= closeIdx) return true;
  }
  return false;
}

/** True when `index` sits inside a quoted HTML attribute value, e.g. between the quotes of an
 * existing `<mj-image src="|">` an admin is editing. Splicing a full element there (instead of a
 * bare token) produces markup nested inside an attribute value, which fails to compile (bot
 * review) — `insertTokenIntoField` uses this to always fall back to the bare token in that one
 * spot, regardless of placeholder type. Ported from `isInsideQuotedAttribute` in
 * `packages/mail-templates/src/htmlContext.ts` (kept in sync manually, same pattern as
 * `apps/admin/src/utils/safeBrandingLogoHref.ts`) — not imported directly, since that package
 * pulls in the MJML compiler and DB access, neither of which belong in this client bundle. */
function isInsideQuotedAttributeValue(value: string, index: number): boolean {
  const tagStart = value.lastIndexOf("<", index);
  if (tagStart === -1) return false;
  if (value[tagStart + 1] === "/" || value[tagStart + 1] === "!") return false;

  let inQuote: '"' | "'" | null = null;
  for (let i = tagStart + 1; i < index; i++) {
    const ch = value[i]!;
    if (inQuote) {
      if (ch === inQuote) inQuote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuote = ch;
      continue;
    }
    if (ch === ">" || (ch === "/" && value[i + 1] === ">")) return false;
  }
  return inQuote !== null;
}

/**
 * Resolves where and what to insert into an MJML template body — adjusting away from the raw
 * cursor selection when it's somewhere the requested markup can't safely land. Three MJML-
 * specific hazards this guards against, in order — each one found by bot review on a previous
 * edit:
 *
 * 1. Cursor inside an existing quoted attribute value (e.g. filling in `<mj-image src="">`):
 *    always the bare token, right there, never a full element — an element spliced inside an
 *    attribute value is nested-inside-a-string markup that fails to compile.
 * 2. Cursor outside the `<mjml>...</mjml>` root, or inside the root but between components
 *    (not inside any `<mj-column>`): MJML silently drops content there with no error — redirect
 *    into the template's last `<mj-column>` instead, wrapping a bare token in its own
 *    `<mj-text>` so it isn't itself dropped as loose text between components.
 * 3. Image markup specifically landing inside an existing `<mj-text>`: not silently dropped,
 *    outright invalid (`<mj-image>` can't nest inside `<mj-text>`) — redirect the same way as
 *    (2). A bare token inside `<mj-text>` is fine as-is and skips this case.
 *
 * Returns the unchanged selection and `token` as-is when none of the hazards apply.
 */
function resolveMjmlInsertion(
  value: string,
  start: number,
  end: number,
  token: string,
  bareToken: string,
): { start: number; end: number; insertion: string } {
  if (isInsideQuotedAttributeValue(value, start)) {
    return { start, end, insertion: bareToken };
  }
  const isImageMarkup = token.startsWith("<mj-");
  const needsFallback =
    !isWithinMjmlRoot(value, start, end) ||
    !isInsideMjColumn(value, start, end) ||
    (isImageMarkup && isInsideMjText(value, start, end));
  if (!needsFallback) {
    return { start, end, insertion: token };
  }
  const fallbackIdx = findMjmlColumnFallbackIndex(value);
  if (fallbackIdx === -1) {
    return { start, end, insertion: token };
  }
  const insertion = token.startsWith("<mj-") ? token : `<mj-text>${token}</mj-text>`;
  return { start: fallbackIdx, end: fallbackIdx, insertion };
}

type DirtyProtectedAction =
  | { kind: "select"; key: string }
  | { kind: "create" }
  | { kind: "delete"; templateId: string; name: string };

type TemplateDetailSnapshot = {
  name: string;
  subject_template: string;
  body_template: string;
  template_format: TemplateFormat;
};

type DeleteRecoveryContext = {
  seq: number;
  scopeEventId: string;
  deleteTemplateSeqRef: RefObject<number>;
  currentEventIdRef: RefObject<string | undefined>;
};

type TicketDeleteRecoveryOptions = DeleteRecoveryContext & {
  ticket: MailTemplateListItem;
  applyDetailTemplate: (detail: TemplateDetailSnapshot) => void;
  setActiveKey: Dispatch<SetStateAction<string>>;
  setEditorSnapshotMissing: Dispatch<SetStateAction<boolean>>;
  setSubject: Dispatch<SetStateAction<string>>;
  setBody: Dispatch<SetStateAction<string>>;
  setSavedSubject: Dispatch<SetStateAction<string>>;
  setSavedBody: Dispatch<SetStateAction<string>>;
  setValidationErrors: Dispatch<SetStateAction<string[]>>;
  setPreviewSubject: Dispatch<SetStateAction<string | null>>;
  setPreviewHtml: Dispatch<SetStateAction<string | null>>;
  reportApiError: (status: number) => void;
  addToast: (message: string, variant?: ToastVariant, duration?: number) => void;
};

type LegacyDeleteRecoveryOptions = DeleteRecoveryContext & {
  legacyTemplateRef: MutableRefObject<EventTemplateDto | null>;
  applyLegacyTemplate: (data: EventTemplateDto) => void;
  setActiveKey: Dispatch<SetStateAction<string>>;
  addToast: (message: string, variant?: ToastVariant, duration?: number) => void;
};

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

/** True once a delete flow's in-flight seq/event guard has gone stale — a newer delete request or
 * an event switch has superseded the async continuation currently running. Shared by
 * `executeDeleteTemplate` and its post-delete recovery helpers so they all bail out the same way. */
function isDeleteStale(
  seq: number,
  scopeEventId: string,
  currentSeq: number,
  currentEventId: string | undefined,
): boolean {
  return seq !== currentSeq || scopeEventId !== currentEventId;
}

/** Maps a failed initial-template-load error to UI state: reported status code, redirect on 401,
 * or an operator-facing message. Extracted from the mount effect so that function's own cognitive
 * complexity stays low. */
function handleInitialTemplateLoadError(
  err: unknown,
  isCancelled: () => boolean,
  reportApiError: (status: number) => void,
  setError: (message: string) => void,
): void {
  if (isCancelled()) return;
  if (!(err instanceof ApiError)) {
    setError("Failed to load template.");
    return;
  }
  reportApiError(err.status);
  if (err.status === 401) {
    const next = encodeURIComponent(window.location.pathname);
    window.location.assign(`/login?next=${next}`);
    return;
  }
  setError(err.status === 403 ? "You do not have access to this event." : "Failed to load template.");
}

/** Maps a failed deliveries load to UI state, or suppresses it for a silent poll tick (mirrors
 * AuditLogPanel's useLogQuery: a single missed live-refresh is normal noise, not worth surfacing
 * over rows already on screen). Extracted from loadDeliveries so that function's own cognitive
 * complexity stays low. */
function handleDeliveriesLoadError(
  err: unknown,
  silent: boolean,
  aborted: boolean,
  reportApiError: (status: number) => void,
  setDeliveriesError: (message: string) => void,
): void {
  if (aborted || (err instanceof DOMException && err.name === "AbortError")) return;
  if (silent) return;
  if (err instanceof ApiError) {
    reportApiError(err.status);
    if (err.status === 401) {
      const next = encodeURIComponent(window.location.pathname);
      window.location.assign(`/login?next=${next}`);
      return;
    }
  }
  setDeliveriesError("Failed to load deliveries.");
}

/** Retries loading the "ticket" template detail after a delete (the template that just got deleted
 * was the active one, and a "ticket" template still exists), applying it once loaded, or falling
 * back to a blank/missing editor snapshot if both attempts fail. Extracted from
 * `executeDeleteTemplate` so that function's own cognitive complexity stays low. */
async function recoverTicketAfterDelete({
  ticket,
  seq,
  scopeEventId,
  deleteTemplateSeqRef,
  currentEventIdRef,
  applyDetailTemplate,
  setActiveKey,
  setEditorSnapshotMissing,
  setSubject,
  setBody,
  setSavedSubject,
  setSavedBody,
  setValidationErrors,
  setPreviewSubject,
  setPreviewHtml,
  reportApiError,
  addToast,
}: Readonly<TicketDeleteRecoveryOptions>): Promise<void> {
  let loaded = false;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2 && !loaded; attempt++) {
    if (isDeleteStale(seq, scopeEventId, deleteTemplateSeqRef.current, currentEventIdRef.current)) return;
    try {
      const detail = await fetchEventTemplateById(scopeEventId, ticket.id);
      if (isDeleteStale(seq, scopeEventId, deleteTemplateSeqRef.current, currentEventIdRef.current)) return;
      applyDetailTemplate(detail);
      setActiveKey(ticket.id);
      loaded = true;
    } catch (err) {
      lastErr = err;
    }
  }
  if (loaded) return;
  if (isDeleteStale(seq, scopeEventId, deleteTemplateSeqRef.current, currentEventIdRef.current)) return;
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
  addToast("Template deleted. Could not load ticket template. Reload the page.", "warning");
}

/** Refetches the inherited (legacy) ticket template after a delete leaves no explicit "ticket"
 * template, applying it, or falling back to the last-known cached copy (or an operator-facing
 * warning) if the refetch fails. Extracted from `executeDeleteTemplate` so that function's own
 * cognitive complexity stays low. */
/** Exported for unit tests - the null-cache branch is hard to reach through the mounted page
 * because a successful initial load always populates `legacyTemplateRef` first. */
export async function recoverLegacyAfterDelete({
  scopeEventId,
  seq,
  deleteTemplateSeqRef,
  currentEventIdRef,
  legacyTemplateRef,
  applyLegacyTemplate,
  setActiveKey,
  addToast,
}: Readonly<LegacyDeleteRecoveryOptions>): Promise<void> {
  try {
    legacyTemplateRef.current = await fetchEventTemplate(scopeEventId);
    if (isDeleteStale(seq, scopeEventId, deleteTemplateSeqRef.current, currentEventIdRef.current)) return;
    applyLegacyTemplate(legacyTemplateRef.current);
    setActiveKey("virtual-ticket");
  } catch {
    if (isDeleteStale(seq, scopeEventId, deleteTemplateSeqRef.current, currentEventIdRef.current)) return;
    if (legacyTemplateRef.current) {
      applyLegacyTemplate(legacyTemplateRef.current);
      setActiveKey("virtual-ticket");
      addToast(
        "Template deleted. Inherited ticket could not be refreshed. Showing last known copy.",
        "warning",
      );
    } else {
      setActiveKey("virtual-ticket");
      addToast("Template deleted. Could not load default ticket. Reload the page.", "warning");
    }
  }
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
  return /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(value);
}

/** Label shown in the test-send result card for whichever template was just sent. */
export function resolveTestSendTemplateLabel(
  activeKey: string,
  templates: ReadonlyArray<{ id: string; label: string }>,
): string {
  if (activeKey === "virtual-ticket") return "Ticket email";
  return templates.find((t) => t.id === activeKey)?.label ?? "Template";
}

/** Test-send always renders from the saved template, not the live draft - only report the
 * previewed subject when it's known to match (no unsaved edits), rather than claiming an
 * unsaved draft subject was what actually went out. */
function testSendReportedSubject(isDirty: boolean, previewSubject: string | null): string | null {
  return isDirty ? null : previewSubject;
}

/** The template id to send from the Send tab (`CommunicationSendPanel`) — the current explicit
 * template's id, or (for the virtual/inherited ticket) whichever real "ticket" template exists.
 * `undefined` covers two different cases the caller must not conflate: the editor snapshot
 * couldn't be loaded (sending is unavailable — see `editorSnapshotMissing`), or the event never
 * saved an explicit "ticket" override (sending is fine — the backend's `sendEventBulk` already
 * falls back to the built-in default template when `templateId` is omitted). */
function resolveSendTemplateId(
  editorSnapshotMissing: boolean,
  activeKey: string,
  templates: MailTemplateListItem[],
): string | undefined {
  if (editorSnapshotMissing) return undefined;
  if (activeKey === "virtual-ticket") return templates.find((t) => t.name === "ticket")?.id;
  return activeKey;
}

/** Options for the template picker `SearchableSelect` — shared by the Send tab's Message card
 * and the Templates tab's picker bar so both always list the exact same templates the exact
 * same way, icon included. The virtual "Ticket email" entry only appears when there's no
 * explicit "ticket" override yet (same condition TemplatePickerBar's own count/badge logic
 * uses) - it keeps the ticket icon (it IS the built-in ticket template); every real saved
 * template uses its own chosen icon (set via the edit modal), falling back to the same default
 * shown there when unset, so the two read as visually distinct kinds of thing by default without
 * needing a text label to say so. */
function templatePickerOptions(
  templates: MailTemplateListItem[],
): Array<{ id: string; label: string; icon: string }> {
  return [
    ...(!templates.some((t) => t.name === "ticket")
      ? [{ id: "virtual-ticket", label: "Ticket email", icon: "ticket" }]
      : []),
    ...templates.map((t) => ({ id: t.id, label: t.label, icon: t.icon ?? DEFAULT_TEMPLATE_ICON })),
  ];
}

/** Bounced-email warning banner shown above the tabs; renders nothing when there are no bounces. */
function EmailBounceBanner({ count, onViewLog }: Readonly<{ count: number; onViewLog: () => void }>) {
  if (count <= 0) return null;
  return (
    <Notice variant="warning" role="alert">
      <strong>
        {count} email{count !== 1 ? "s" : ""} bounced
      </strong>
      {". These addresses will not receive future mail. "}
      <button type="button" className="bounce-banner__link" onClick={onViewLog}>
        View delivery log
      </button>
    </Notice>
  );
}

/** Banner telling the operator they're viewing the org/global default rather than an
 * event-specific override; renders nothing once an event-specific template is active. */
function DefaultTemplateBanner({
  activeKey,
  source,
}: Readonly<{
  activeKey: string;
  source: EventTemplateDto["source"];
}>) {
  if (activeKey !== "virtual-ticket" || source === "event") return null;
  return (
    <Notice variant="info">
      This event has no template of its own yet, so it's sending the shared default shown below.
      Edit and save it to create a copy that only affects this event.
    </Notice>
  );
}

/** Send tab: template picker (shares the same selection/preview state as the Templates tab, so
 * either tab reflects what the other last picked/rendered) plus the recipients/send panel. */
function SendTab({
  event,
  templates,
  activeKey,
  source,
  requestDirtyProtectedAction,
  eventId,
  sendTemplateId,
  editorSnapshotMissing,
  isDirty,
  previewHtml,
  previewSubject,
  previewLoading,
  senderName,
  senderAddress,
  onPreview,
  onOpenTemplate,
  testEmail,
  setTestEmail,
  testSending,
  onTestSend,
  testStatus,
}: Readonly<{
  event: EventDto;
  templates: MailTemplateListItem[];
  activeKey: string;
  source: EventTemplateDto["source"];
  requestDirtyProtectedAction: (action: DirtyProtectedAction) => void;
  eventId: string;
  sendTemplateId: string | undefined;
  editorSnapshotMissing: boolean;
  isDirty: boolean;
  previewHtml: string | null;
  previewSubject: string | null;
  previewLoading: boolean;
  senderName: string | null;
  senderAddress: string | null;
  onPreview: () => Promise<void>;
  onOpenTemplate: () => void;
  testEmail: string;
  setTestEmail: Dispatch<SetStateAction<string>>;
  testSending: boolean;
  onTestSend: () => Promise<void>;
  testStatus: TestSendStatus | null;
}>) {
  // Keeps the preview in sync with whichever template is picked, matching the mockup's
  // always-rendered preview - unlike the Templates tab, there's no draft being actively typed
  // into here, so there's no reason to make the admin click a separate Preview button first.
  useEffect(() => {
    void onPreview();
    // onPreview closes over live subject/body/format state and is a fresh function every
    // render, so it's intentionally left out here - only an actual template or event switch
    // should re-trigger this, not every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, eventId]);

  return (
    <div className="communication-send-tab">
      <Card
        title={
          <HintLabel hint="The template picked here is the same one shown on the Templates tab.">
            Message
          </HintLabel>
        }
      >
        <div className="settings-card-stack">
          <p className="settings-card-intro">
            Pick which saved template this event's ticket emails use, and preview exactly what
            recipients will see before you send.
          </p>
          <div className="communication-half-field">
            <SearchableSelect
              id="communication-send-template"
              label="Template"
              placeholder="Choose a template…"
              searchPlaceholder="Search templates…"
              emptyLabel="No templates found"
              value={activeKey}
              options={templatePickerOptions(templates)}
              onChange={(id) => requestDirtyProtectedAction({ kind: "select", key: id })}
            />
          </div>
          <DefaultTemplateBanner activeKey={activeKey} source={source} />
          <div className="communication-preview-toolbar">
            <span className="communication-preview-toolbar__label">
              <i className="ti ti-eye" aria-hidden="true" /> Preview
            </span>
            <button
              type="button"
              className="communication-preview-toolbar__open"
              onClick={onOpenTemplate}
            >
              <i className="ti ti-external-link" aria-hidden="true" /> Open template
            </button>
          </div>
          {previewLoading ? (
            <div className="communication-preview-empty">Loading preview…</div>
          ) : (
            <PreviewBody
              previewHtml={previewHtml}
              previewSubject={previewSubject}
              eventTitle={event.title}
              senderName={senderName}
              senderAddress={senderAddress}
            />
          )}
        </div>
      </Card>

      <CommunicationSendPanel
        event={event}
        eventId={eventId}
        templateId={sendTemplateId}
        snapshotMissing={editorSnapshotMissing}
        isDirty={isDirty}
      />

      <SendTestCard
        event={event}
        testEmail={testEmail}
        setTestEmail={setTestEmail}
        testSending={testSending}
        editorSnapshotMissing={editorSnapshotMissing}
        onTestSend={onTestSend}
        testStatus={testStatus}
      />
    </div>
  );
}

/** Top toolbar for the Templates tab: which template is open, when it was last saved (or a
 * "Default template" badge for the virtual entry, which has no save history of its own), and
 * "New template". The template list used to live in a side rail; moving the picker up here
 * frees that width for the editor/preview split below instead of splitting the page three ways. */
function TemplatePickerBar({
  event,
  templateActionBusy,
  contentSaving,
  templates,
  activeKey,
  source,
  canEdit,
  onEdit,
  requestDirtyProtectedAction,
}: Readonly<{
  event: EventDto;
  templateActionBusy: boolean;
  /** Content Save in flight - blocks identity Edit so metadata PATCH cannot race the PUT. */
  contentSaving: boolean;
  templates: MailTemplateListItem[];
  activeKey: string;
  source: EventTemplateDto["source"];
  canEdit: boolean;
  onEdit: () => void;
  requestDirtyProtectedAction: (action: DirtyProtectedAction) => void;
}>) {
  const activeMeta = templates.find((t) => t.id === activeKey);
  const isDefault = activeKey === "virtual-ticket" && source !== "event";
  const identityBusy = templateActionBusy || contentSaving;
  return (
    <Card>
      <div className="communication-template-picker">
        <div className="communication-half-field communication-template-picker__select">
          <SearchableSelect
            id="communication-templates-picker"
            label="Template"
            showLabel={false}
            placeholder="Choose a template…"
            searchPlaceholder="Search templates…"
            emptyLabel="No templates found"
            value={activeKey}
            disabled={templateActionBusy}
            options={templatePickerOptions(templates)}
            onChange={(id) => requestDirtyProtectedAction({ kind: "select", key: id })}
          />
        </div>
        {isDefault ? (
          <Badge variant="neutral">Default template</Badge>
        ) : (
          activeMeta && (
            <Badge variant="neutral">
              <i className="ti ti-clock" aria-hidden="true" /> Last edited{" "}
              {formatEventDate(activeMeta.updated_at, event.timezone)}
            </Badge>
          )
        )}
        <span className="communication-template-picker__actions">
          <ArchivedGuard
            event={event}
            reasonId="edit-template-reason"
            disabled={!canEdit || identityBusy}
            tooltip={!canEdit ? "Save this template once to edit its details." : undefined}
          >
            {(guard) => (
              <button
                type="button"
                className="communication-template-picker__edit"
                aria-label="Edit template"
                onClick={onEdit}
                {...guard}
              >
                <i className="ti ti-pencil" aria-hidden="true" />
              </button>
            )}
          </ArchivedGuard>
          <ArchivedGuard event={event} reasonId="new-template-reason" disabled={templateActionBusy}>
            {(guard) => (
              <Button
                variant="secondary"
                icon={<i className="ti ti-plus" aria-hidden="true" />}
                onClick={() => requestDirtyProtectedAction({ kind: "create" })}
                {...guard}
              >
                New template
              </Button>
            )}
          </ArchivedGuard>
        </span>
      </div>
    </Card>
  );
}

/** Placeholder chips, subject/format/body editor fields, validation errors, and the
 * preview/save actions row for the currently selected template. */
/** Insert-placeholder chips, grouped into readable sections (Attendee/Event/Ticket & QR/Wallet/
 * Branding) instead of one long flat row - a placeholder outside every fixed group (a custom
 * per-event image asset token) falls into its own trailing "Images" group. */
function PlaceholderChips({
  allowedPlaceholders,
  imagePlaceholders,
  requiredPlaceholders,
  onInsertPlaceholder,
  eventId,
  logoUrl,
  headerImageUrl,
}: Readonly<{
  allowedPlaceholders: string[];
  imagePlaceholders: string[];
  requiredPlaceholders: string[];
  onInsertPlaceholder: (name: string) => void;
  eventId: string;
  /** Resolved real branding (event -> organization -> "") - shown as-is when configured; no
   * preview at all (falls back to the generic photo icon) when neither scope has one set, since
   * there's no further built-in default to show. */
  logoUrl: string;
  headerImageUrl: string;
}>) {
  const allowedSet = new Set(allowedPlaceholders);
  const grouped = new Set<string>();
  const groups = PLACEHOLDER_GROUPS.map((g) => ({
    label: g.label,
    names: g.names.filter((n) => allowedSet.has(n)),
  })).filter((g) => g.names.length > 0);
  groups.forEach((g) => g.names.forEach((n) => grouped.add(n)));
  const custom = allowedPlaceholders.filter((n) => !grouped.has(n));
  if (custom.length > 0) groups.push({ label: "Images", names: custom });

  // The real per-event/org values a send would actually use - not samples. qr_image_url has no
  // real-until-sent equivalent (it's generated per attendee), so it keeps an illustrative sample
  // instead (see CHIP_QR_SAMPLE_DATA_URI). event_map_url always points at the real static-map
  // route; PlaceholderChip falls back to the generic icon itself if that 404s (no location set).
  // apple_wallet_url/google_wallet_url use the same real badge assets the ticket page itself
  // renders (served at these exact paths - see apps/web/src/wallet-badges.ts), not samples.
  const samples: Record<string, string> = {
    qr_image_url: CHIP_QR_SAMPLE_DATA_URI,
    event_map_url: `/m/${encodeURIComponent(eventId)}.png`,
    apple_wallet_url: "/assets/apple-wallet-badge.svg",
    google_wallet_url: "/assets/google-wallet-badge.svg",
  };
  if (logoUrl) samples.logo_url = logoUrl;
  if (headerImageUrl) samples.header_image_url = headerImageUrl;

  return (
    <>
      {groups.map((group) => (
        <div key={group.label} className="communication-ph-row">
          <span className="communication-overline">{group.label}</span>
          <div className="communication-chips">
            {group.names.map((p) => (
              <PlaceholderChip
                key={p}
                name={p}
                isImage={imagePlaceholders.includes(p)}
                isRequired={requiredPlaceholders.includes(p)}
                onInsert={onInsertPlaceholder}
                sample={samples[p]}
              />
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

/** One placeholder chip - required ones are outlined, wallet-add links get a ticket icon so
 * they read as "important" the same way an image chip does instead of blending into a bare-
 * token wall of text. A chip with a `sample` image (see PlaceholderChips - the real configured
 * logo/header, the real per-event map, or an illustrative QR graphic) shows that image instead
 * of a text tooltip - a picture of what the placeholder looks like is more useful than a
 * description once there are several image placeholders to tell apart, and required-ness still
 * reads from the chip's own outline styling either way. It's always visible as a small
 * thumbnail (not hover-only - a hidden-until-hover preview is easy to miss entirely), plus a
 * larger version on hover/focus for anyone who wants a closer look. A sample that fails to load
 * (event_map_url 404s when the event has no location set) falls back to the plain icon+tooltip
 * presentation, same as a chip with no sample at all. Chips without a (working) sample - plain
 * text/link placeholders, and per-event custom image tokens with no fixed sample - keep the
 * app's own Tooltip (@admitto/ui), not a native browser title tooltip. */
function PlaceholderChip({
  name,
  isImage,
  isRequired,
  onInsert,
  sample,
}: Readonly<{
  name: string;
  isImage: boolean;
  isRequired: boolean;
  onInsert: (name: string) => void;
  sample?: string;
}>) {
  const [sampleFailed, setSampleFailed] = useState(false);
  const showSample = !!sample && !sampleFailed;
  const titleParts = [
    isRequired && "Required placeholder",
    placeholderDescription(name, isImage),
  ].filter((part): part is string => Boolean(part));
  const chip = (
    <button
      type="button"
      className={["communication-chip", isRequired && "communication-chip--required"]
        .filter(Boolean)
        .join(" ")}
      onClick={() => onInsert(name)}
    >
      {showSample ? (
        <img
          className="communication-chip-thumb"
          src={sample}
          alt=""
          width={16}
          height={16}
          onError={() => setSampleFailed(true)}
        />
      ) : (
        isImage && <i className="ti ti-photo" aria-hidden="true" />
      )}
      {WALLET_PLACEHOLDERS.has(name) && <i className="ti ti-ticket" aria-hidden="true" />}
      {`{{${name}}}`}
      {showSample && (
        <span className="communication-chip-preview" aria-hidden="true">
          <img src={sample} alt="" width={100} height={100} />
        </span>
      )}
    </button>
  );
  return showSample ? chip : <Tooltip content={titleParts.join(" · ")}>{chip}</Tooltip>;
}

function TemplateEditorCard({
  event,
  activeTemplateName,
  allowedPlaceholders,
  imagePlaceholders,
  requiredPlaceholders,
  onInsertPlaceholder,
  brandingLogoUrl,
  brandingHeaderUrl,
  subjectRef,
  subject,
  setSubject,
  setActiveField,
  editorSnapshotMissing,
  format,
  onRequestFormat,
  bodyRef,
  body,
  setBody,
  validationErrors,
  saving,
  templateActionBusy,
  isDirty,
  saveButtonLabel,
  onSave,
}: Readonly<{
  event: EventDto;
  activeTemplateName: string;
  allowedPlaceholders: string[];
  imagePlaceholders: string[];
  requiredPlaceholders: string[];
  onInsertPlaceholder: (name: string) => void;
  brandingLogoUrl: string;
  brandingHeaderUrl: string;
  subjectRef: RefObject<HTMLInputElement | null>;
  subject: string;
  setSubject: Dispatch<SetStateAction<string>>;
  setActiveField: Dispatch<SetStateAction<ActiveField>>;
  editorSnapshotMissing: boolean;
  format: TemplateFormat;
  onRequestFormat: (next: TemplateFormat) => void;
  bodyRef: RefObject<HTMLTextAreaElement | null>;
  body: string;
  setBody: Dispatch<SetStateAction<string>>;
  validationErrors: string[];
  saving: boolean;
  templateActionBusy: boolean;
  isDirty: boolean;
  saveButtonLabel: string;
  onSave: () => void;
}>) {
  return (
    <Card
      title={activeTemplateName === "ticket" ? "Ticket template" : "Template"}
      actions={
        <Segmented
          ariaLabel="Template format"
          className="communication-format-toggle"
          value={format}
          onChange={onRequestFormat}
          options={TEMPLATE_FORMAT_OPTIONS}
        />
      }
    >
      <p className="communication-format-hint muted">
        Changing format does not convert the template body. Switching a non-empty template asks
        for confirmation first.
      </p>

      <PlaceholderChips
        allowedPlaceholders={allowedPlaceholders}
        imagePlaceholders={imagePlaceholders}
        requiredPlaceholders={requiredPlaceholders}
        onInsertPlaceholder={onInsertPlaceholder}
        eventId={event.id}
        logoUrl={brandingLogoUrl}
        headerImageUrl={brandingHeaderUrl}
      />

      <Tooltip
        content={isEventArchived(event) ? ARCHIVED_ACTION_TOOLTIP : undefined}
        className="communication-editor-fieldset-wrapper"
      >
        <fieldset className="communication-editor-fieldset" disabled={isEventArchived(event)}>
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
      </Tooltip>

      <Tooltip
        content={isEventArchived(event) ? ARCHIVED_ACTION_TOOLTIP : undefined}
        className="communication-editor-fieldset-wrapper"
      >
        <fieldset className="communication-editor-fieldset" disabled={isEventArchived(event)}>
          <div className="communication-body-field">
            <label htmlFor="communication-body">{format === "mjml" ? "MJML body" : "HTML body"}</label>
            <textarea
              id="communication-body"
              ref={bodyRef}
              className="communication-textarea"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onFocus={() => setActiveField("body")}
              onKeyDown={(e) => {
                // Tab's default action moves focus to the next field, same as any other input -
                // fine for a form, wrong for a code editor, where the operator expects Tab to
                // indent instead of leaving the textarea entirely.
                if (e.key !== "Tab") return;
                e.preventDefault();
                const el = e.currentTarget;
                const start = el.selectionStart;
                const end = el.selectionEnd;
                const next = `${body.slice(0, start)}  ${body.slice(end)}`;
                setBody(next);
                requestAnimationFrame(() => {
                  el.selectionStart = el.selectionEnd = start + 2;
                });
              }}
              disabled={editorSnapshotMissing}
            />
          </div>
        </fieldset>
      </Tooltip>

      {validationErrors.length === 1 && (
        <Notice variant="error" role="alert" className="communication-errors">
          {validationErrors[0]}
        </Notice>
      )}
      {validationErrors.length > 1 && (
        <Notice variant="error" role="alert" className="communication-errors">
          <ul>
            {validationErrors.map((msg) => (
              <li key={msg}>{msg}</li>
            ))}
          </ul>
        </Notice>
      )}

      <div className="communication-actions">
        <ArchivedGuard
          event={event}
          reasonId="save-template-reason"
          disabled={saving || templateActionBusy || !isDirty || editorSnapshotMissing}
        >
          {(guard) => (
            <Button
              variant="primary"
              icon={<i className="ti ti-device-floppy" aria-hidden="true" />}
              onClick={onSave}
              {...guard}
            >
              {saveButtonLabel}
            </Button>
          )}
        </ArchivedGuard>
      </div>
    </Card>
  );
}

/** Rendered email preview: the compiled HTML in a sandboxed iframe, or a prompt to run Preview. */
/** Rendered subject + sandboxed iframe body, or the empty-state prompt - no Card wrapper, so it
 * can sit inside either its own "Preview" card (Templates tab) or the Send tab's "Message" card. */
/** The preview endpoint fills {{ticket_url}}/{{qr_image_url}} with fixed sample values
 * (packages/mail-templates/src/preview.ts `DEFAULT_SAMPLE_VARS`) so a template can be validated
 * and rendered without a real attendee - but a live https:// URL to a domain nothing actually
 * hosts renders as a broken image and a dead-end link, reading as broken rather than deliberate.
 * Swapped here for a same-origin-safe, always-rendering placeholder before the admin ever sees
 * it; the sandboxed iframe already blocks navigation on the link either way, so this is purely
 * cosmetic, not a security boundary. */
const SAMPLE_TICKET_URL = "https://tickets.example.com/t/sample-token";
const SAMPLE_QR_IMAGE_URL = "https://tickets.example.com/q/sample-token.png";
/** Matches `DEFAULT_SAMPLE_VARS.email` (packages/mail-templates/src/preview.ts) - the "to"
 * address every preview is rendered for, shown in the mail-client chrome below. */
const SAMPLE_RECIPIENT_EMAIL = "alex@example.com";
function svgDataUri(inner: string): string {
  return (
    "data:image/svg+xml;charset=UTF-8," +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">${inner}</svg>`,
    )
  );
}

/** A real-looking (but not scannable) QR pattern: the three corner finder squares every QR code
 * has, plus a fixed, deterministic scatter of data modules elsewhere - recognizable as "this is
 * a QR code" at a glance, unlike a text-labeled box. */
function sampleQrDataUri(): string {
  const modules = 20;
  const m = 200 / modules;
  const finder = (mx: number, my: number) =>
    `<rect x="${mx * m}" y="${my * m}" width="${7 * m}" height="${7 * m}" fill="#1a1a1a"/>` +
    `<rect x="${(mx + 1) * m}" y="${(my + 1) * m}" width="${5 * m}" height="${5 * m}" fill="#fff"/>` +
    `<rect x="${(mx + 2) * m}" y="${(my + 2) * m}" width="${3 * m}" height="${3 * m}" fill="#1a1a1a"/>`;
  const inFinderZone = (x: number, y: number) =>
    (x < 8 && y < 8) || (x >= modules - 8 && y < 8) || (x < 8 && y >= modules - 8);
  let cells = "";
  for (let y = 0; y < modules; y++) {
    for (let x = 0; x < modules; x++) {
      if (inFinderZone(x, y)) continue;
      if ((x * 7 + y * 13 + x * y) % 3 === 0) {
        cells += `<rect x="${x * m}" y="${y * m}" width="${m}" height="${m}" fill="#1a1a1a"/>`;
      }
    }
  }
  return svgDataUri(
    '<rect width="200" height="200" fill="#fff"/>' +
      finder(0, 0) +
      finder(modules - 7, 0) +
      finder(0, modules - 7) +
      cells,
  );
}

/** Placeholder-chip hover preview for qr_image_url (see PlaceholderChips) - QR has no real
 * until-sent equivalent (it's generated per attendee), so this stays an illustrative sample
 * that looks like a QR code, for recognition in the picker. logo_url/header_image_url/
 * event_map_url use the real configured/resolved values instead (built in PlaceholderChips) -
 * deliberately NOT reused for the rendered *email* preview below (see
 * SAMPLE_QR_PLACEHOLDER_DATA_URI) - a realistic-looking-but-fake QR code substituted into "what
 * the recipient will actually see" reads as a real, scannable code with no indication it isn't;
 * the honest, clearly-labeled placeholder there is the correct one. */
const CHIP_QR_SAMPLE_DATA_URI = sampleQrDataUri();

/** Swapped into the rendered *email* preview (not the chip picker above) in place of the
 * backend's fixed sample QR URL, which nothing actually hosts - stays an honest, clearly-labeled
 * "not a real code" placeholder on purpose, unlike the chip preview's realistic graphic. */
const SAMPLE_QR_PLACEHOLDER_DATA_URI = svgDataUri(
  '<rect width="200" height="200" fill="#f1f3f5"/>' +
    '<rect x="0.5" y="0.5" width="199" height="199" fill="none" stroke="#ced4da"/>' +
    '<text x="100" y="94" text-anchor="middle" font-family="sans-serif" font-size="13" fill="#495057">Sample QR</text>' +
    '<text x="100" y="114" text-anchor="middle" font-family="sans-serif" font-size="13" fill="#495057">preview only</text>',
);

function sanitizeSamplePreviewHtml(html: string): string {
  return html.split(SAMPLE_QR_IMAGE_URL).join(SAMPLE_QR_PLACEHOLDER_DATA_URI).split(SAMPLE_TICKET_URL).join("#");
}

/** Reads like a real inbox (Gmail-style toolbar + sender row) instead of a bare subject line
 * over an iframe, so a template preview looks like an email instead of pasted markup. The
 * toolbar icons are inert chrome (no back/archive/reply destination exists here) - hidden from
 * assistive tech rather than announced as buttons that do nothing. */
function PreviewBody({
  previewHtml,
  previewSubject,
  eventTitle,
  senderName,
  senderAddress,
  toolbarLabel,
  loading = false,
}: Readonly<{
  previewHtml: string | null;
  previewSubject: string | null;
  eventTitle: string;
  /** Real configured "From" display name (Settings → Mail transport → Sender), when readable -
   * falls back to the event title so the preview never shows a blank sender. */
  senderName: string | null;
  senderAddress: string | null;
  /** Renders in place of the inert back-arrow, as real (not aria-hidden) content - lets a
   * caller (Templates tab) fold its own "Preview"/"Updating…" caption into this same bar
   * instead of stacking a second one above it. Omit to keep the plain decorative arrow. */
  toolbarLabel?: ReactNode;
  /** Shows the mail-client chrome immediately with a spinner in place of the rendered body,
   * instead of the plain empty-state text, while a preview fetch is in flight - so the card
   * itself never appears to load late, only its content does. Only the Templates tab (which
   * auto-previews on every mount/switch) passes this; the Send tab keeps its own separate
   * loading branch before ever reaching this component. */
  loading?: boolean;
}>) {
  if (!previewHtml && !loading) {
    return <div className="communication-preview-empty">Preview will appear here.</div>;
  }
  const displayName = senderName || eventTitle;
  const sampleTime = browserClockTime(new Date());
  return (
    <div className="communication-mail-client">
      <div className="communication-mail-client__toolbar" aria-hidden={toolbarLabel ? undefined : true}>
        {toolbarLabel ? (
          <span className="communication-mail-client__toolbar-label">{toolbarLabel}</span>
        ) : (
          <i className="ti ti-arrow-left" aria-hidden="true" />
        )}
        <span className="communication-mail-client__toolbar-actions" aria-hidden="true">
          <i className="ti ti-archive" aria-hidden="true" />
          <i className="ti ti-trash" aria-hidden="true" />
          <i className="ti ti-corner-up-left" aria-hidden="true" />
          <i className="ti ti-dots" aria-hidden="true" />
        </span>
      </div>
      <div className="communication-mail-client__subject">{previewSubject}</div>
      <div className="communication-mail-client__from">
        <span className="communication-mail-client__avatar" aria-hidden="true">
          <i className="ti ti-mail" aria-hidden="true" />
        </span>
        <div className="communication-mail-client__from-text">
          <div className="communication-mail-client__from-name">
            {displayName}
            {senderAddress && <span className="communication-mail-client__from-address"> &lt;{senderAddress}&gt;</span>}
          </div>
          <div className="communication-mail-client__to">to {SAMPLE_RECIPIENT_EMAIL}</div>
        </div>
        <div className="communication-mail-client__meta" aria-hidden="true">
          <span className="communication-mail-client__folder">
            <i className="ti ti-inbox" aria-hidden="true" /> Inbox
          </span>
          <span className="communication-mail-client__time">
            <i className="ti ti-clock" aria-hidden="true" /> {sampleTime}
          </span>
        </div>
      </div>
      {previewHtml ? (
        <iframe
          className="communication-preview-frame"
          title="Email preview"
          sandbox=""
          srcDoc={sanitizeSamplePreviewHtml(previewHtml)}
        />
      ) : (
        <div className="communication-preview-frame communication-preview-frame--loading">
          <Spinner label="Loading preview" />
        </div>
      )}
    </div>
  );
}

/** Templates tab's preview column - no Card wrapper (the mail-client chrome below already draws
 * its own box; wrapping it in a second one nested it inside a card-in-a-card border, per PO
 * report) and no manual refresh button, since the editor auto-previews on a debounce instead of
 * requiring a click. */
function TemplatesPreviewPanel({
  previewHtml,
  previewSubject,
  eventTitle,
  senderName,
  senderAddress,
  previewLoading,
}: Readonly<{
  previewHtml: string | null;
  previewSubject: string | null;
  eventTitle: string;
  senderName: string | null;
  senderAddress: string | null;
  previewLoading: boolean;
}>) {
  const updatingStatus = previewLoading ? <span className="muted"> · Updating…</span> : null;
  return (
    <div className="communication-templates-preview">
      <PreviewBody
        previewHtml={previewHtml}
        previewSubject={previewSubject}
        eventTitle={eventTitle}
        senderName={senderName}
        senderAddress={senderAddress}
        loading={previewLoading}
        toolbarLabel={
          <>
            <i className="ti ti-eye" aria-hidden="true" /> Preview
            {updatingStatus}
          </>
        }
      />
    </div>
  );
}

/** Test-send card: recipient email input, send button, and the last test-send result. */
function SendTestCard({
  event,
  testEmail,
  setTestEmail,
  testSending,
  editorSnapshotMissing,
  onTestSend,
  testStatus,
}: Readonly<{
  event: EventDto;
  testEmail: string;
  setTestEmail: Dispatch<SetStateAction<string>>;
  testSending: boolean;
  editorSnapshotMissing: boolean;
  onTestSend: () => Promise<void>;
  testStatus: TestSendStatus | null;
}>) {
  return (
    <Card
      title={
        <HintLabel hint="Doesn't count as a delivery to any attendee, and isn't recorded in the delivery log.">
          Send test
        </HintLabel>
      }
    >
      <div className="settings-card-stack">
        <p className="settings-card-intro">
          Sends this exact template to one address, so you can check formatting and placeholders
          before sending it to attendees.
        </p>
        <div className="mail-test-send__row">
          <div className="mail-test-send__controls">
            <Input
              label="Recipient"
              type="email"
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
              placeholder="you@example.com"
            />
            <div className="mail-test-send__send-control">
              <ArchivedGuard
                event={event}
                reasonId="send-test-reason"
                disabled={testSending || !isValidEmail(testEmail.trim()) || editorSnapshotMissing}
              >
                {(guard) => (
                  <Button
                    variant="secondary"
                    icon={<i className="ti ti-send" aria-hidden="true" />}
                    onClick={() => void onTestSend()}
                    {...guard}
                  >
                    {testSending ? "Sending…" : "Send test"}
                  </Button>
                )}
              </ArchivedGuard>
            </div>
          </div>
        </div>
        {testStatus && <TestSendResultPreview status={testStatus} />}
      </div>
    </Card>
  );
}

/** Same "nice report" pattern as the mail transport Send test email card (Event/Organisation
 * settings) - reuses its global .mail-preview* classes so a test-send result always looks the
 * same everywhere in the app, just without that card's transport/bounce-specific fields. */
function TestSendResultPreview({ status }: Readonly<{ status: TestSendStatus }>) {
  const isOk = status.kind === "ok";
  return (
    <output className={`mail-preview ${isOk ? "mail-preview--ok" : "mail-preview--error"}`}>
      <div className="mail-preview__head">
        <div className="mail-preview__head-main">
          <i
            className={`ti ${isOk ? "ti-circle-check" : "ti-circle-x"} mail-preview__head-icon${isOk ? "" : " mail-preview__head-icon--error"}`}
            aria-hidden="true"
          />
          <div className="mail-preview__head-text">
            <b>{status.message}</b>
            <span>to {status.email}</span>
          </div>
        </div>
      </div>
      {isOk && (
        <div className="test-mail-summary">
          <div>
            <span>Template</span>
            <b>{status.template}</b>
          </div>
          {status.subject && (
            <div>
              <span>Subject</span>
              <b>{status.subject}</b>
            </div>
          )}
        </div>
      )}
    </output>
  );
}

const TAB_IDS = ["send", "templates", "log"] as const;

/** Admin screen for event mail template editing, preview, test-send, and delivery log. */
export function CommunicationPage() {
  const { eventId } = useParams();
  const { event } = useOutletContext<{ event: EventDto }>();
  const { reportApiError } = useConnectionState();
  const { addToast } = useToast();

  // URL is the source of truth for the active tab (matches Organisation settings' own
  // General/Mail/.../Logs tabs) - a refresh or shared link lands back on the same tab instead
  // of always resetting to Send.
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const tab = TAB_IDS.find((id) => id === tabParam) ?? "send";
  const setTab = useCallback(
    (next: string) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (next === "send") params.delete("tab");
          else params.set("tab", next);
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [templates, setTemplates] = useState<MailTemplateListItem[]>([]);
  const [activeKey, setActiveKey] = useState<string>("virtual-ticket");
  const [activeTemplateName, setActiveTemplateName] = useState("ticket");
  const [templateActionBusy, setTemplateActionBusy] = useState(false);
  const [editorSnapshotMissing, setEditorSnapshotMissing] = useState(false);

  const [source, setSource] = useState<EventTemplateDto["source"]>("builtin");
  const [allowedPlaceholders, setAllowedPlaceholders] = useState<string[]>([]);
  const [requiredPlaceholders, setRequiredPlaceholders] = useState<string[]>([]);
  const [imagePlaceholders, setImagePlaceholders] = useState<string[]>([]);
  /** Resolved event/org branding (event -> organization -> ""), for the placeholder-chip hover
   * preview - fetched once on load, same for every template since it's a property of the event,
   * not of whichever template is currently open. */
  const [brandingLogoUrl, setBrandingLogoUrl] = useState("");
  const [brandingHeaderUrl, setBrandingHeaderUrl] = useState("");
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
  const [testStatus, setTestStatus] = useState<TestSendStatus | null>(null);
  const [testSending, setTestSending] = useState(false);

  const [deliveries, setDeliveries] = useState<DeliveryDto[]>([]);
  const [deliveryTotal, setDeliveryTotal] = useState(0);
  const [deliveryPage, setDeliveryPage] = useState(1);
  const [deliveryPageSize, setDeliveryPageSize] = useState(DELIVERY_PAGE_SIZE_DEFAULT);
  const [deliveryStatus, setDeliveryStatus] =
    useState<NonNullable<EventDeliveriesListParams["status"]>>("all");
  const [deliveryPurpose, setDeliveryPurpose] =
    useState<NonNullable<EventDeliveriesListParams["purpose"]>>("all");
  const [deliveryTemplateId, setDeliveryTemplateId] = useState("all");
  const [deliverySearchInput, setDeliverySearchInput] = useState("");
  const [deliverySearch, setDeliverySearch] = useState("");
  const [deliveriesLoading, setDeliveriesLoading] = useState(false);
  const [deliveriesError, setDeliveriesError] = useState<string | null>(null);
  const [deliveriesLive, setDeliveriesLive] = useState(true);
  const [emailBounced, setEmailBounced] = useState(0);
  const [senderName, setSenderName] = useState<string | null>(null);
  const [senderAddress, setSenderAddress] = useState<string | null>(null);

  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  const templateSelectionSeqRef = useRef(0);
  const previewSeqRef = useRef(0);
  const createTemplateSeqRef = useRef(0);
  const deleteTemplateSeqRef = useRef(0);
  const metadataSaveSeqRef = useRef(0);
  const createInFlightRef = useRef(false);
  const currentEventIdRef = useRef(eventId);
  /** Latest legacy ticket snapshot; refreshed on each virtual-ticket selection and after save. */
  const legacyTemplateRef = useRef<EventTemplateDto | null>(null);

  const [dirtyConfirmOpen, setDirtyConfirmOpen] = useState(false);
  const [pendingDirtyAction, setPendingDirtyAction] = useState<DirtyProtectedAction | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [pendingFormat, setPendingFormat] = useState<TemplateFormat | null>(null);

  const isDirty = isTemplateDirty(
    { subject, body, format },
    { subject: savedSubject, body: savedBody, format: savedFormat },
  );
  const localConfirmOpen =
    dirtyConfirmOpen ||
    editModalOpen ||
    createDialogOpen ||
    overrideConfirmOpen ||
    pendingFormat !== null;

  /** Switching MJML<->HTML never converts the body, so it's blind data loss on a non-empty
   * template - gate it behind an explicit confirm instead of flipping state on click. */
  const requestFormatChange = useCallback(
    (next: TemplateFormat) => {
      if (next === format) return;
      if (body.trim() === "" && subject.trim() === "") {
        setFormat(next);
        return;
      }
      setPendingFormat(next);
    },
    [format, body, subject],
  );
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
      // Deliberately NOT clearing previewSubject/previewHtml here - the previously-rendered
      // template stays on screen (stale but not wrong) until the new one's own preview replaces
      // it a moment later, instead of the whole mail-client box collapsing to an empty state on
      // every switch (PO report: felt broken, especially since there's no manual Preview button
      // to click anymore to bring it back).
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
      if (isDeleteStale(seq, scopeEventId, deleteTemplateSeqRef.current, currentEventIdRef.current)) return;

      const items = await fetchEventTemplates(scopeEventId);
      if (isDeleteStale(seq, scopeEventId, deleteTemplateSeqRef.current, currentEventIdRef.current)) return;

      setTemplates(items);
      setEditModalOpen(false);

      if (!deletedWasActive) return;

      const ticket = items.find((t) => t.name === "ticket");
      if (!ticket) {
        await recoverLegacyAfterDelete({
          scopeEventId,
          seq,
          deleteTemplateSeqRef,
          currentEventIdRef,
          legacyTemplateRef,
          applyLegacyTemplate,
          setActiveKey,
          addToast,
        });
        return;
      }
      await recoverTicketAfterDelete({
        ticket,
        seq,
        scopeEventId,
        deleteTemplateSeqRef,
        currentEventIdRef,
        applyDetailTemplate,
        setActiveKey,
        setEditorSnapshotMissing,
        setSubject,
        setBody,
        setSavedSubject,
        setSavedBody,
        setValidationErrors,
        setPreviewSubject,
        setPreviewHtml,
        reportApiError,
        addToast,
      });
    } catch (err) {
      if (isDeleteStale(seq, scopeEventId, deleteTemplateSeqRef.current, currentEventIdRef.current)) return;
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

  const runDirtyProtectedAction = useCallback(
    (action: DirtyProtectedAction) => {
      if (action.kind === "select") {
        void applySelectTemplate(action.key);
        return;
      }
      if (action.kind === "delete") {
        void executeDeleteTemplate(action.templateId);
        return;
      }
      setCreateDialogOpen(true);
    },
    [applySelectTemplate, executeDeleteTemplate],
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

  const executeSaveTemplateMetadata = useCallback(
    async (templateId: string, draft: { label: string; icon: string | null; description: string | null }) => {
      const scopeEventId = eventId;
      if (!scopeEventId || saving) return;
      const seq = ++metadataSaveSeqRef.current;
      setTemplateActionBusy(true);
      try {
        const updated = await updateEventTemplateMetadata(scopeEventId, templateId, draft);
        if (isDeleteStale(seq, scopeEventId, metadataSaveSeqRef.current, currentEventIdRef.current)) return;
        setTemplates((prev) => sortTemplates(prev.map((t) => (t.id === templateId ? updated : t))));
        setEditModalOpen(false);
        addToast("Template updated.", "success");
      } catch (err) {
        if (isDeleteStale(seq, scopeEventId, metadataSaveSeqRef.current, currentEventIdRef.current)) return;
        if (err instanceof ApiError) {
          reportApiError(err.status);
          addToast(operatorApiErrorMessage(err, "Request failed."), "error");
        } else {
          addToast("Update failed.", "error");
        }
      } finally {
        if (seq === metadataSaveSeqRef.current) {
          setTemplateActionBusy(false);
        }
      }
    },
    [eventId, reportApiError, addToast, saving],
  );

  const sendTemplateId = resolveSendTemplateId(editorSnapshotMissing, activeKey, templates);

  const loadDeliveries = useCallback(async (signal?: AbortSignal, opts?: { silent?: boolean }) => {
    if (!eventId) return;
    const silent = opts?.silent ?? false;
    if (!silent) {
      setDeliveriesLoading(true);
      setDeliveriesError(null);
    }
    try {
      const data = await fetchEventDeliveries(
        eventId,
        {
          page: deliveryPage,
          pageSize: deliveryPageSize,
          status: deliveryStatus,
          purpose: deliveryPurpose,
          search: deliverySearch || undefined,
          templateId: deliveryTemplateId,
        },
        signal,
      );
      if (signal?.aborted) return;
      setDeliveries(data.items);
      setDeliveryTotal(data.total);
      // A silent poll can be the first successful response after an initial/request error -
      // its fresh rows must clear the stale error state too (mirrors AuditLogPanel's useLogQuery).
      if (silent) setDeliveriesError(null);
    } catch (err) {
      handleDeliveriesLoadError(err, silent, Boolean(signal?.aborted), reportApiError, setDeliveriesError);
    } finally {
      if (!signal?.aborted && !silent) {
        setDeliveriesLoading(false);
      }
    }
  }, [
    eventId,
    deliveryPage,
    deliveryPageSize,
    deliveryStatus,
    deliveryPurpose,
    deliverySearch,
    deliveryTemplateId,
    reportApiError,
  ]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setDeliverySearch(deliverySearchInput.trim());
      setDeliveryPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [deliverySearchInput]);

  useEffect(() => {
    currentEventIdRef.current = eventId;
    deleteTemplateSeqRef.current += 1;
    previewSeqRef.current += 1;
    metadataSaveSeqRef.current += 1;
    setTemplateActionBusy(false);
    setEditModalOpen(false);
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
        setAllowedPlaceholders(data.allowed_placeholders.filter((p) => !HIDDEN_PLACEHOLDERS.has(p)));
        setRequiredPlaceholders(data.required_url_placeholders);
        setImagePlaceholders(data.image_placeholders ?? []);
        setBrandingLogoUrl(data.logo_url);
        setBrandingHeaderUrl(data.header_image_url);
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
        handleInitialTemplateLoadError(err, () => cancelled, reportApiError, setError);
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

  // Preview's sender row shows the real configured "From" - falls back to the event title
  // (previous behavior) if mail settings can't be read, e.g. an operator role without access
  // to Settings - this is decorative, not worth surfacing as an error.
  useEffect(() => {
    if (!eventId) return;
    const ac = new AbortController();
    void fetchEventMailSettings(eventId, ac.signal)
      .then((data) => {
        if (ac.signal.aborted) return;
        setSenderName(data.fields.fromName.value?.trim() || null);
        setSenderAddress(data.fields.fromAddress.value?.trim() || null);
      })
      .catch(() => {
        if (ac.signal.aborted) return;
        setSenderName(null);
        setSenderAddress(null);
      });
    return () => ac.abort();
  }, [eventId]);

  // Loads regardless of which tab is active (not gated on tab === "log") so the "Delivery log"
  // tab's own count badge is correct as soon as the page mounts, instead of staying blank until
  // the operator actually clicks into that tab - same fix already applied to Active sessions'
  // own tab count (see ActiveSessionsTab's onCountChange).
  useEffect(() => {
    const controller = new AbortController();
    void loadDeliveries(controller.signal);
    return () => controller.abort();
  }, [loadDeliveries]);

  // Keeps polling regardless of which tab is active, mirroring AuditLogPanel's Audit/Security
  // views (both poll continuously even while the operator is looking at System) - so the count
  // and the table, once opened, both stay current without a manual refresh.
  useEffect(() => {
    if (!deliveriesLive) return;
    const controller = new AbortController();
    const intervalId = window.setInterval(
      () => void loadDeliveries(controller.signal, { silent: true }),
      DELIVERY_POLL_INTERVAL_MS,
    );
    return () => {
      window.clearInterval(intervalId);
      controller.abort();
    };
  }, [deliveriesLive, loadDeliveries]);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(deliveryTotal / deliveryPageSize));
    if (deliveryTotal === 0) {
      if (deliveryPage !== 1) setDeliveryPage(1);
    } else if (deliveryPage > maxPage) {
      setDeliveryPage(maxPage);
    }
  }, [deliveryTotal, deliveryPage, deliveryPageSize]);

  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
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
  /**
   * Inserts `token` (the caller's preferred markup — possibly a full `<mj-image>`/`<img>`
   * element) at the field's cursor, falling back to `bareToken` (always just `{{name}}`) instead
   * when the preferred markup can't safely go where the cursor actually is — see
   * `resolveMjmlInsertion` for the MJML-specific hazards this guards against.
   */
  function insertTokenIntoField(
    el: HTMLInputElement | HTMLTextAreaElement | null,
    token: string,
    bareToken: string,
    setValue: (value: string) => void,
  ) {
    if (!el) return;
    let start = el.selectionStart ?? el.value.length;
    let end = el.selectionEnd ?? el.value.length;
    let insertion = token;

    if (el === bodyRef.current && format === "mjml") {
      ({ start, end, insertion } = resolveMjmlInsertion(el.value, start, end, token, bareToken));
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
    const bareToken = `{{${name}}}`;
    const token =
      activeField === "body" && imagePlaceholders.includes(name)
        ? imagePlaceholderMarkup(name, format)
        : bareToken;
    if (activeField === "subject") {
      insertTokenIntoField(subjectRef.current, token, bareToken, setSubject);
      return;
    }
    insertTokenIntoField(bodyRef.current, token, bareToken, setBody);
  };

  const handlePreview = async () => {
    if (!eventId || editorSnapshotMissing) return;
    const scopeEventId = eventId;
    const seq = ++previewSeqRef.current;
    setPreviewLoading(true);
    setValidationErrors([]);
    try {
      const data =
        activeKey === "virtual-ticket"
          ? await previewEventTemplate(scopeEventId, templatePayload())
          : await previewEventTemplateById(scopeEventId, activeKey, templatePayload());
      if (isDeleteStale(seq, scopeEventId, previewSeqRef.current, currentEventIdRef.current)) return;
      setPreviewSubject(data.subject);
      setPreviewHtml(data.html);
    } catch (err) {
      if (isDeleteStale(seq, scopeEventId, previewSeqRef.current, currentEventIdRef.current)) return;
      // Deliberately NOT clearing previewSubject/previewHtml here - same reasoning as
      // applySelectTemplate's own comment: the last successful preview stays on screen (stale
      // but not wrong) instead of the whole mail-client box collapsing to empty text every time
      // a keystroke makes the draft briefly invalid (PO report: the mail-client imitation must
      // never disappear - the validation error below the editor is the right place for this).
      if (err instanceof TemplateValidationError) {
        setValidationErrors(err.errors);
      } else if (err instanceof ApiError) {
        reportApiError(err.status);
        addToast(operatorApiErrorMessage(err, "Request failed."), "error");
      } else {
        addToast("Preview failed.", "error");
      }
    } finally {
      if (seq === previewSeqRef.current) setPreviewLoading(false);
    }
  };

  // Templates tab: live preview instead of click-to-preview, debounced so rapid typing fires one
  // render request after a pause rather than one per keystroke. Only while that tab is actually
  // open - the Send tab already gets its own immediate (non-debounced) preview-on-template-switch
  // effect inside SendTab itself, since there's no draft being typed there to debounce against.
  useEffect(() => {
    if (tab !== "templates" || editorSnapshotMissing) return;
    const t = window.setTimeout(() => {
      void handlePreview();
    }, 500);
    return () => window.clearTimeout(t);
    // handlePreview closes over live subject/body/format/activeKey state and is a fresh function
    // every render (same reasoning as SendTab's own preview-on-switch effect) - only these
    // primitives should actually restart the debounce timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, subject, body, format, activeKey, editorSnapshotMissing]);

  const performSave = async () => {
    if (!eventId || templateActionBusy) return;
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
    // SendTestCard already disables the button while the editor snapshot is missing; eventId is
    // always present on this routed page. No extra guard here - it would be an untestable
    // defensive branch that Codecov flags as a forever-false partial.
    // Snapshotted once so the result below always reports the address this request actually
    // used, even if the operator edits the field again while the request is in flight or after
    // it resolves.
    const submittedEmail = testEmail.trim();
    setTestStatus(null);
    setTestSending(true);
    try {
      const result =
        activeKey === "virtual-ticket"
          ? await testSendEventTemplate(eventId!, { to: submittedEmail })
          : await testSendEventTemplateById(eventId!, activeKey, { to: submittedEmail });
      if (result.status === "sent") {
        setTestStatus({
          kind: "ok",
          message: "Test email sent.",
          template: resolveTestSendTemplateLabel(activeKey, templates),
          subject: testSendReportedSubject(isDirty, previewSubject),
          email: submittedEmail,
        });
      } else {
        setTestStatus({ kind: "error", message: result.error ?? "Send failed.", email: submittedEmail });
      }
    } catch (err) {
      if (err instanceof ApiError) {
        reportApiError(err.status);
        const message =
          err.status === 400 && hasApiErrorCode(err, "validation_failed")
            ? "Enter a valid email address."
            : operatorApiErrorMessage(err, "Send failed.");
        setTestStatus({ kind: "error", message, email: submittedEmail });
      } else {
        setTestStatus({ kind: "error", message: "Send failed.", email: submittedEmail });
      }
    } finally {
      setTestSending(false);
    }
  };

  // A fetch that resolves near-instantly (localhost, a warm cache) would otherwise flash
  // these "Loading…" placeholders on and off faster than they can register as loading —
  // show them only once the fetch has genuinely taken a moment.
  const showLoading = useDelayedLoading(loading);

  if (!eventId) return <p>Missing event.</p>;
  if (loading) return whenShown(showLoading, <p>Loading communication…</p>);
  if (error) return <p>{error}</p>;

  const unsavedTemplateLabel = isDirty ? "Save *" : "Saved";
  const saveButtonLabel = saving ? "Saving…" : unsavedTemplateLabel;

  const hasActiveDeliveryFilters =
    deliveryStatus !== "all" ||
    deliveryPurpose !== "all" ||
    deliveryTemplateId !== "all" ||
    deliverySearchInput.trim() !== "";

  function clearDeliveryFilters() {
    setDeliveryStatus("all");
    setDeliveryPurpose("all");
    setDeliveryTemplateId("all");
    setDeliverySearchInput("");
    setDeliverySearch("");
    setDeliveryPage(1);
  }

  // Matches templatePickerOptions' own list exactly: every saved template, plus the virtual
  // "Ticket email" entry when there's no explicit "ticket" override yet - that virtual entry is
  // a real, selectable, sendable template from the operator's point of view even though it has
  // no MailTemplateListItem row of its own.
  const templateTabCount = templates.length + (templates.some((t) => t.name === "ticket") ? 0 : 1);

  const activeTemplateMeta = templates.find((t) => t.id === activeKey) ?? null;

  return (
    <div className="screen">
      <PageHeader title="Communication" subtitle="Ticket email templates and delivery log" />

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "send", label: "Send" },
          {
            id: "templates",
            label: isDirty ? "Templates *" : "Templates",
            // Always ≥ 1: an empty list still counts the virtual inherited ticket row.
            count: templateTabCount,
          },
          { id: "log", label: "Delivery log", count: deliveryTotal || undefined },
        ]}
      />

      <EmailBounceBanner
        count={emailBounced}
        onViewLog={() => {
          setTab("log");
          setDeliveryStatus("bounced");
          setDeliveryPage(1);
        }}
      />

      {tab === "send" && (
        <SendTab
          event={event}
          templates={templates}
          activeKey={activeKey}
          source={source}
          requestDirtyProtectedAction={requestDirtyProtectedAction}
          eventId={eventId}
          sendTemplateId={sendTemplateId}
          editorSnapshotMissing={editorSnapshotMissing}
          isDirty={isDirty}
          previewHtml={previewHtml}
          previewSubject={previewSubject}
          previewLoading={previewLoading}
          senderName={senderName}
          senderAddress={senderAddress}
          onPreview={handlePreview}
          onOpenTemplate={() => setTab("templates")}
          testEmail={testEmail}
          setTestEmail={setTestEmail}
          testSending={testSending}
          onTestSend={handleTestSend}
          testStatus={testStatus}
        />
      )}

      {tab === "templates" && (
        <div className="communication-templates-tab">
          <TemplatePickerBar
            event={event}
            templateActionBusy={templateActionBusy}
            contentSaving={saving}
            templates={templates}
            activeKey={activeKey}
            source={source}
            canEdit={activeKey !== "virtual-ticket"}
            onEdit={() => setEditModalOpen(true)}
            requestDirtyProtectedAction={requestDirtyProtectedAction}
          />

          <div className="communication-templates-split">
            <TemplateEditorCard
              event={event}
              activeTemplateName={activeTemplateName}
              allowedPlaceholders={allowedPlaceholders}
              imagePlaceholders={imagePlaceholders}
              requiredPlaceholders={requiredPlaceholders}
              onInsertPlaceholder={insertPlaceholder}
              brandingLogoUrl={brandingLogoUrl}
              brandingHeaderUrl={brandingHeaderUrl}
              subjectRef={subjectRef}
              subject={subject}
              setSubject={setSubject}
              setActiveField={setActiveField}
              editorSnapshotMissing={editorSnapshotMissing}
              format={format}
              onRequestFormat={requestFormatChange}
              bodyRef={bodyRef}
              body={body}
              setBody={setBody}
              validationErrors={validationErrors}
              saving={saving}
              templateActionBusy={templateActionBusy}
              isDirty={isDirty}
              saveButtonLabel={saveButtonLabel}
              onSave={handleSave}
            />

            <TemplatesPreviewPanel
              previewHtml={previewHtml}
              previewSubject={previewSubject}
              eventTitle={event.title}
              senderName={senderName}
              senderAddress={senderAddress}
              previewLoading={previewLoading}
            />
          </div>

          <SendTestCard
            event={event}
            testEmail={testEmail}
            setTestEmail={setTestEmail}
            testSending={testSending}
            editorSnapshotMissing={editorSnapshotMissing}
            onTestSend={handleTestSend}
            testStatus={testStatus}
          />
        </div>
      )}

      {tab === "log" && (
        <DeliveryLogTab
          eventId={eventId}
          eventTimezone={event.timezone}
          deliveries={deliveries}
          deliveryTotal={deliveryTotal}
          deliveriesLoading={deliveriesLoading}
          deliveriesError={deliveriesError}
          templates={templates}
          page={deliveryPage}
          onPageChange={setDeliveryPage}
          pageSize={deliveryPageSize}
          onPageSizeChange={setDeliveryPageSize}
          status={deliveryStatus}
          onStatusChange={setDeliveryStatus}
          purpose={deliveryPurpose}
          onPurposeChange={setDeliveryPurpose}
          templateId={deliveryTemplateId}
          onTemplateIdChange={setDeliveryTemplateId}
          searchInput={deliverySearchInput}
          search={deliverySearch}
          onSearchChange={setDeliverySearchInput}
          live={deliveriesLive}
          onLiveChange={setDeliveriesLive}
          hasActiveFilters={hasActiveDeliveryFilters}
          onClearFilters={clearDeliveryFilters}
          onRetry={() => void loadDeliveries()}
        />
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
      <EditTemplateModal
        open={editModalOpen}
        template={activeTemplateMeta}
        busy={templateActionBusy || saving}
        onClose={() => {
          if (templateActionBusy || saving) return;
          setEditModalOpen(false);
        }}
        onSave={(templateId, draft) => void executeSaveTemplateMetadata(templateId, draft)}
        onDelete={(templateId) => {
          const name = activeTemplateMeta?.name ?? "";
          requestDirtyProtectedAction({ kind: "delete", templateId, name });
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
        open={pendingFormat !== null}
        title={`Switch to ${pendingFormat === "html" ? "HTML" : "MJML"}?`}
        message="Changing format does not convert the template body - the current content will likely stop rendering correctly and this can't be undone automatically."
        confirmLabel="Switch format"
        confirmVariant="danger"
        cancelLabel="Keep editing"
        onConfirm={() => {
          // Dialog only opens while pendingFormat is set, so the cast is safe and avoids a
          // branch Codecov would otherwise flag as a forever-false partial.
          setFormat(pendingFormat as TemplateFormat);
          setPendingFormat(null);
        }}
        onCancel={() => setPendingFormat(null)}
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
    </div>
  );
}
