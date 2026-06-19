import type {
  AttendeeCardDto,
  AttendeeDetailDto,
  AttendeesListParams,
  AttendeesListResponse,
  CheckInHistoryEntry,
  CheckInScanResponse,
  CheckInStatsResponse,
  DeliveryDto,
  EventDto,
  LookupAttendeeResult,
  MeResponse,
  ResendTicketBody,
  ThemeResponse,
  UpdateAttendeePatch,
  ImportPreviewResponse,
  ImportCommitResponse,
  EventItemDto,
  EventItemsListResponse,
  CreateEventItemBody,
  UpdateEventItemPatch,
  OpsConfigDto,
  UpdateOpsConfigPatch,
  EventTemplateDto,
  SaveTemplateBody,
  PreviewTemplateResponse,
  TestSendBody,
  TestSendResponse,
  EventDeliveriesListParams,
  EventDeliveriesListResponse,
} from "./types.js";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function parseJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = res.statusText || `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}

function jsonPostInit(body: unknown): RequestInit {
  return {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      Origin: window.location.origin,
    },
    body: JSON.stringify(body),
  };
}

function jsonDeleteInit(): RequestInit {
  return {
    method: "DELETE",
    credentials: "same-origin",
    headers: {
      Origin: window.location.origin,
    },
  };
}

function jsonPatchInit(body: unknown): RequestInit {
  return {
    method: "PATCH",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      Origin: window.location.origin,
    },
    body: JSON.stringify(body),
  };
}

function jsonPutInit(body: unknown): RequestInit {
  return {
    method: "PUT",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      Origin: window.location.origin,
    },
    body: JSON.stringify(body),
  };
}

function isAdminAppPath(): boolean {
  const path = window.location.pathname;
  return path === "/admin" || path.startsWith("/admin/");
}

/** Build a same-origin multipart POST request (browser sets Content-Type boundary). */
function multipartPostInit(formData: FormData): RequestInit {
  return {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Origin: window.location.origin,
    },
    body: formData,
  };
}

/** Build multipart form fields for an attendee import upload. */
function importFormData(file: File, overwrite: boolean): FormData {
  const fd = new FormData();
  fd.append("file", file);
  if (overwrite) fd.append("overwrite", "true");
  return fd;
}

/** Dry-run an attendee file import and return preview counts (no DB writes). */
export async function previewImport(
  eventId: string,
  file: File,
  overwrite: boolean,
): Promise<ImportPreviewResponse> {
  const res = await fetch(
    `/api/admin/events/${encodeURIComponent(eventId)}/import/preview`,
    multipartPostInit(importFormData(file, overwrite)),
  );
  return parseJson<ImportPreviewResponse>(res);
}

/** Commit an attendee file import after preview (creates/updates rows in the event). */
export async function commitImport(
  eventId: string,
  file: File,
  overwrite: boolean,
): Promise<ImportCommitResponse> {
  const res = await fetch(
    `/api/admin/events/${encodeURIComponent(eventId)}/import/commit`,
    multipartPostInit(importFormData(file, overwrite)),
  );
  return parseJson<ImportCommitResponse>(res);
}

export async function fetchMe(signal?: AbortSignal): Promise<MeResponse> {
  const url = isAdminAppPath() ? "/api/admin/me" : "/api/auth/me";
  const res = await fetch(url, { credentials: "same-origin", signal });
  return parseJson<MeResponse>(res);
}

export async function fetchAdminEvents(signal?: AbortSignal): Promise<EventDto[]> {
  const res = await fetch("/api/admin/events", { credentials: "same-origin", signal });
  const data = await parseJson<{ events: EventDto[] }>(res);
  return data.events;
}

export async function fetchCheckInEvents(signal?: AbortSignal): Promise<EventDto[]> {
  const res = await fetch("/api/checkin/events", { credentials: "same-origin", signal });
  const data = await parseJson<{ events: EventDto[] }>(res);
  return data.events;
}

export async function fetchStaffTheme(signal?: AbortSignal): Promise<ThemeResponse> {
  const url = isAdminAppPath() ? "/api/admin/theme" : "/api/staff/theme";
  const res = await fetch(url, { credentials: "same-origin", signal });
  return parseJson<ThemeResponse>(res);
}

export async function submitCheckInScan(
  eventId: string,
  scanned: string,
  deviceId?: string,
): Promise<CheckInScanResponse> {
  const res = await fetch("/api/checkin/scan", jsonPostInit({ eventId, scanned, deviceId }));
  return parseJson<CheckInScanResponse>(res);
}

export async function lookupCheckInAttendees(
  eventId: string,
  q: string,
): Promise<LookupAttendeeResult[]> {
  const res = await fetch("/api/checkin/lookup", jsonPostInit({ eventId, q }));
  const data = await parseJson<{ results: LookupAttendeeResult[] }>(res);
  return data.results;
}

export async function fetchAttendeeCard(
  eventId: string,
  attendeeId: string,
): Promise<AttendeeCardDto> {
  const res = await fetch(
    `/api/checkin/attendees/${encodeURIComponent(attendeeId)}?eventId=${encodeURIComponent(eventId)}`,
    { credentials: "same-origin" },
  );
  const data = await parseJson<{ card: AttendeeCardDto }>(res);
  return data.card;
}

export async function submitCheckInAdmit(
  eventId: string,
  attendeeId: string,
  deviceId?: string,
  method: "scan" | "manual" = "manual",
): Promise<CheckInScanResponse> {
  const res = await fetch(
    "/api/checkin/admit",
    jsonPostInit({ eventId, attendeeId, deviceId, method }),
  );
  return parseJson<CheckInScanResponse>(res);
}

export async function submitItemAction(
  eventId: string,
  attendeeId: string,
  itemKey: string,
  targetState: string,
  deviceId?: string,
): Promise<{ state: string; card: AttendeeCardDto }> {
  const res = await fetch(
    `/api/checkin/items/${encodeURIComponent(itemKey)}`,
    jsonPostInit({ eventId, attendeeId, targetState, deviceId }),
  );
  return parseJson<{ state: string; card: AttendeeCardDto }>(res);
}

export async function submitAttendeeNote(
  eventId: string,
  attendeeId: string,
  body: string,
  deviceId?: string,
): Promise<{ card: AttendeeCardDto }> {
  const res = await fetch("/api/checkin/notes", jsonPostInit({ eventId, attendeeId, body, deviceId }));
  return parseJson<{ card: AttendeeCardDto }>(res);
}

export async function undoLastCheckIn(
  eventId: string,
  deviceId?: string,
): Promise<{ card: AttendeeCardDto }> {
  const res = await fetch("/api/checkin/undo", jsonPostInit({ eventId, deviceId }));
  return parseJson<{ card: AttendeeCardDto }>(res);
}

export async function fetchCheckInHistory(
  eventId: string,
  limit = 8,
): Promise<CheckInHistoryEntry[]> {
  const res = await fetch(
    `/api/checkin/history?eventId=${encodeURIComponent(eventId)}&limit=${limit}`,
    { credentials: "same-origin" },
  );
  return parseJson<CheckInHistoryEntry[]>(res);
}

export async function fetchCheckInStats(eventId: string): Promise<CheckInStatsResponse> {
  const res = await fetch(`/api/checkin/stats?eventId=${encodeURIComponent(eventId)}`, {
    credentials: "same-origin",
  });
  return parseJson<CheckInStatsResponse>(res);
}

function attendeesListQuery(eventId: string, params: AttendeesListParams = {}): string {
  const q = new URLSearchParams();
  if (params.page != null) q.set("page", String(params.page));
  if (params.pageSize != null) q.set("pageSize", String(params.pageSize));
  if (params.q) q.set("q", params.q);
  if (params.status && params.status !== "all") q.set("status", params.status);
  if (params.ticket_type) q.set("ticket_type", params.ticket_type);
  const qs = q.toString();
  return `/api/admin/events/${encodeURIComponent(eventId)}/attendees${qs ? `?${qs}` : ""}`;
}

export async function fetchEventAttendees(
  eventId: string,
  params: AttendeesListParams = {},
  signal?: AbortSignal,
): Promise<AttendeesListResponse> {
  const res = await fetch(attendeesListQuery(eventId, params), {
    credentials: "same-origin",
    signal,
  });
  return parseJson<AttendeesListResponse>(res);
}

export async function fetchAttendeeDetail(
  eventId: string,
  attendeeId: string,
  signal?: AbortSignal,
): Promise<AttendeeDetailDto> {
  const res = await fetch(
    `/api/admin/events/${encodeURIComponent(eventId)}/attendees/${encodeURIComponent(attendeeId)}`,
    { credentials: "same-origin", signal },
  );
  return parseJson<AttendeeDetailDto>(res);
}

export async function updateAttendee(
  eventId: string,
  attendeeId: string,
  patch: UpdateAttendeePatch,
): Promise<AttendeeDetailDto> {
  const res = await fetch(
    `/api/admin/events/${encodeURIComponent(eventId)}/attendees/${encodeURIComponent(attendeeId)}`,
    jsonPatchInit(patch),
  );
  return parseJson<AttendeeDetailDto>(res);
}

export async function resendTicket(
  eventId: string,
  attendeeId: string,
  body: ResendTicketBody = {},
): Promise<DeliveryDto> {
  const res = await fetch(
    `/api/admin/events/${encodeURIComponent(eventId)}/attendees/${encodeURIComponent(attendeeId)}/resend`,
    jsonPostInit(body),
  );
  return parseJson<DeliveryDto>(res);
}

/** Fetch all event items for the Requirements admin screen. */
export async function fetchEventItems(
  eventId: string,
  signal?: AbortSignal,
): Promise<EventItemDto[]> {
  const res = await fetch(`/api/admin/events/${encodeURIComponent(eventId)}/items`, {
    credentials: "same-origin",
    signal,
  });
  const data = await parseJson<EventItemsListResponse>(res);
  return data.items;
}

/** Create a custom event item (key must be unique per event). */
export async function createEventItem(
  eventId: string,
  body: CreateEventItemBody,
): Promise<EventItemDto> {
  const res = await fetch(
    `/api/admin/events/${encodeURIComponent(eventId)}/items`,
    jsonPostInit(body),
  );
  return parseJson<EventItemDto>(res);
}

/** Update label, enabled flag, or config for an existing event item. */
export async function updateEventItem(
  eventId: string,
  itemId: string,
  patch: UpdateEventItemPatch,
): Promise<EventItemDto> {
  const res = await fetch(
    `/api/admin/events/${encodeURIComponent(eventId)}/items/${encodeURIComponent(itemId)}`,
    jsonPatchInit(patch),
  );
  return parseJson<EventItemDto>(res);
}

/** Delete an unused custom event item; throws ApiError 409 when blocked. */
export async function deleteEventItem(eventId: string, itemId: string): Promise<void> {
  const res = await fetch(
    `/api/admin/events/${encodeURIComponent(eventId)}/items/${encodeURIComponent(itemId)}`,
    jsonDeleteInit(),
  );
  await parseJson<{ ok: boolean }>(res);
}

/** Load parsed operational settings for an event (`ops_config`). */
export async function fetchOpsConfig(eventId: string, signal?: AbortSignal): Promise<OpsConfigDto> {
  const res = await fetch(`/api/admin/events/${encodeURIComponent(eventId)}/ops-config`, {
    credentials: "same-origin",
    signal,
  });
  return parseJson<OpsConfigDto>(res);
}

/** Patch operational settings (`badge_at_entry`, `require_confirm_on_scan`). */
export async function updateOpsConfig(
  eventId: string,
  patch: UpdateOpsConfigPatch,
): Promise<OpsConfigDto> {
  const res = await fetch(
    `/api/admin/events/${encodeURIComponent(eventId)}/ops-config`,
    jsonPatchInit(patch),
  );
  return parseJson<OpsConfigDto>(res);
}

/** Thrown when save/preview returns `template_validation_failed` with an error list. */
export class TemplateValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super("template_validation_failed");
    this.name = "TemplateValidationError";
  }
}

/** Parse template save/preview JSON; maps validation errors to `TemplateValidationError`. */
async function parseTemplateActionJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    try {
      const body = (await res.json()) as { error?: string; errors?: string[] };
      if (body.errors?.length) {
        throw new TemplateValidationError(body.errors);
      }
      throw new ApiError(res.status, body.error ?? res.statusText);
    } catch (err) {
      if (err instanceof TemplateValidationError || err instanceof ApiError) throw err;
      throw new ApiError(res.status, res.statusText);
    }
  }
  return (await res.json()) as T;
}

/** Load editable mail template for an event (event → org → builtin). */
export async function fetchEventTemplate(
  eventId: string,
  signal?: AbortSignal,
): Promise<EventTemplateDto> {
  const res = await fetch(`/api/admin/events/${encodeURIComponent(eventId)}/template`, {
    credentials: "same-origin",
    signal,
  });
  return parseJson<EventTemplateDto>(res);
}

/** Save and compile an event-scoped mail template. */
export async function saveEventTemplate(
  eventId: string,
  body: SaveTemplateBody,
): Promise<void> {
  const res = await fetch(
    `/api/admin/events/${encodeURIComponent(eventId)}/template`,
    jsonPutInit(body),
  );
  await parseTemplateActionJson<{ ok: boolean }>(res);
}

/** Render a draft template with sample data (no DB write). */
export async function previewEventTemplate(
  eventId: string,
  body: SaveTemplateBody,
): Promise<PreviewTemplateResponse> {
  const res = await fetch(
    `/api/admin/events/${encodeURIComponent(eventId)}/template/preview`,
    jsonPostInit(body),
  );
  return parseTemplateActionJson<PreviewTemplateResponse>(res);
}

/** Send a one-off test mail for the current event template. */
export async function testSendEventTemplate(
  eventId: string,
  body: TestSendBody,
): Promise<TestSendResponse> {
  const res = await fetch(
    `/api/admin/events/${encodeURIComponent(eventId)}/template/test-send`,
    jsonPostInit(body),
  );
  return parseJson<TestSendResponse>(res);
}

/** Build query string for paginated event delivery log requests. */
function deliveriesListQuery(eventId: string, params: EventDeliveriesListParams = {}): string {
  const q = new URLSearchParams();
  if (params.page != null) q.set("page", String(params.page));
  if (params.pageSize != null) q.set("pageSize", String(params.pageSize));
  if (params.status && params.status !== "all") q.set("status", params.status);
  const qs = q.toString();
  return `/api/admin/events/${encodeURIComponent(eventId)}/deliveries${qs ? `?${qs}` : ""}`;
}

/** Fetch paginated email delivery rows for an event (no rendered HTML). */
export async function fetchEventDeliveries(
  eventId: string,
  params: EventDeliveriesListParams = {},
  signal?: AbortSignal,
): Promise<EventDeliveriesListResponse> {
  const res = await fetch(deliveriesListQuery(eventId, params), {
    credentials: "same-origin",
    signal,
  });
  return parseJson<EventDeliveriesListResponse>(res);
}

/** Fetch distinct ticket types for an event (for the filter dropdown). */
export async function fetchTicketTypes(
  eventId: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const res = await fetch(
    `/api/admin/events/${encodeURIComponent(eventId)}/attendees/ticket-types`,
    { credentials: "same-origin", signal },
  );
  const data = await parseJson<{ types: string[] }>(res);
  return data.types;
}

/** Download a filtered attendee export and trigger browser save. */
export async function exportAttendees(
  eventId: string,
  params: { q?: string; status?: string; ticket_type?: string },
  format: "xlsx" | "csv",
): Promise<void> {
  const urlParams = new URLSearchParams({ format });
  if (params.q) urlParams.set("q", params.q);
  if (params.status && params.status !== "all") urlParams.set("status", params.status);
  if (params.ticket_type) urlParams.set("ticket_type", params.ticket_type);

  const res = await fetch(
    `/api/admin/events/${encodeURIComponent(eventId)}/attendees/export?${urlParams.toString()}`,
    { credentials: "same-origin" },
  );
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, message);
  }

  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const match = /filename="([^"]+)"/.exec(disposition);
  const filename = match?.[1] ?? `attendees.${format}`;

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
