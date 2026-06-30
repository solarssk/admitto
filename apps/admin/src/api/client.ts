import type {
  AttendeeCardDto,
  AttendeeDetailDto,
  AttendeesListParams,
  AttendeesListResponse,
  BrandingThemeDto,
  CheckInHistoryEntry,
  CheckInScanResponse,
  CheckInStatsResponse,
  DeliveryDto,
  EventDto,
  EventSettingsDto,
  LookupAttendeeResult,
  MeResponse,
  ResendTicketBody,
  ThemeResponse,
  UpdateAttendeePatch,
  ImportPreviewResponse,
  ImportCommitResponse,
  BulkResendResponse,
  EventItemDto,
  EventItemsListResponse,
  CreateEventItemBody,
  UpdateEventItemPatch,
  OpsConfigDto,
  UpdateOpsConfigPatch,
  EventTemplateDto,
  SaveTemplateBody,
  PreviewTemplateResponse,
  RsvpStatus,
  TestSendBody,
  TestSendResponse,
  MailSettingsResponse,
  SaveMailSettingsBody,
  EventDeliveriesListParams,
  EventDeliveriesListResponse,
  SessionsResponse,
  SecuritySettingsDto,
  PatchSecuritySettingsBody,
  UserListResponse,
  CreateAdminUserBody,
  PatchAdminUserBody,
  GrantUserRoleBody,
  ResetUserPasswordBody,
  UserListItemDto,
  RoleAssignmentsListResponse,
  SetupChecksResponse,
  SetupOrgBrandingDto,
  PatchSetupOrgBrandingBody,
  AuditLogResponse,
  EventOverviewDto,
  EventReportsResponse,
  AccountDto,
  PatchAccountProfileBody,
  PatchAccountPasswordBody,
  PatchAccountPasswordResponse,
  MfaEnrollResponse,
  ConfirmMfaTotpBody,
  ResetMfaBody,
  ResetMfaResponse,
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

type ApiErrorBody = { error?: string; detail?: string; code?: string };

function messageFromApiErrorBody(body: ApiErrorBody): string | undefined {
  const detail = body.detail?.trim();
  if (detail) return detail;
  const error = body.error?.trim();
  if (error) return error;
  const code = body.code?.trim();
  if (code) return code;
  return undefined;
}

async function parseJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = res.statusText || `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as ApiErrorBody;
      message = messageFromApiErrorBody(body) ?? message;
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

/** Set optional device label on the current operator session (post-login step). */
export async function submitSessionDeviceLabel(deviceLabel: string): Promise<{ device_label: string | null }> {
  const res = await fetch("/api/auth/session/device-label", jsonPostInit({ device_label: deviceLabel }));
  return parseJson<{ device_label: string | null }>(res);
}

/** Load admin picker events; pass includeArchived to list archived rows. */
export async function fetchAdminEvents(
  opts?: { includeArchived?: boolean; signal?: AbortSignal },
): Promise<EventDto[]> {
  const params = opts?.includeArchived ? "?includeArchived=true" : "";
  const res = await fetch(`/api/admin/events${params}`, {
    credentials: "same-origin",
    signal: opts?.signal,
  });
  const data = await parseJson<{ events: EventDto[] }>(res);
  return data.events;
}

/** Create a new event (superadmin or org admin). */
export async function createEvent(body: {
  title: string;
  slug: string;
  date: string;
  timezone: string;
  location?: string;
}): Promise<EventDto> {
  const res = await fetch("/api/admin/events", jsonPostInit(body));
  const data = await parseJson<{ event: EventDto }>(res);
  return data.event;
}

/** Archive an event (superadmin-only POST). */
export async function archiveEvent(eventId: string): Promise<void> {
  const res = await fetch(`/api/admin/events/${eventId}/archive`, jsonPostInit({}));
  await parseJson(res);
}

/** Restore an archived event to active (superadmin-only POST). */
export async function unarchiveEvent(eventId: string): Promise<void> {
  const res = await fetch(`/api/admin/events/${eventId}/unarchive`, jsonPostInit({}));
  await parseJson(res);
}

/** Load event settings for the settings page. */
export async function fetchEventSettings(
  eventId: string,
  signal?: AbortSignal,
): Promise<EventSettingsDto> {
  const res = await fetch(`/api/admin/events/${encodeURIComponent(eventId)}/settings`, {
    credentials: "same-origin",
    signal,
  });
  return parseJson<EventSettingsDto>(res);
}

/** Patch basic event fields (title, date, location, capacity). */
export async function patchEvent(
  eventId: string,
  body: Partial<{ title: string; date: string; timezone: string; location: string | null; capacity: number | null }>,
): Promise<{ event: EventSettingsDto }> {
  const res = await fetch(`/api/admin/events/${encodeURIComponent(eventId)}`, jsonPatchInit(body));
  return parseJson<{ event: EventSettingsDto }>(res);
}

/** Download PII export CSV (superadmin only). Caller handles blob save. */
export async function exportEventPii(eventId: string, signal?: AbortSignal): Promise<Response> {
  const res = await fetch(`/api/admin/events/${encodeURIComponent(eventId)}/export-pii`, {
    credentials: "same-origin",
    signal,
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as ApiErrorBody;
      message = messageFromApiErrorBody(body) ?? message;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, message);
  }
  return res;
}

export async function fetchCheckInEvents(signal?: AbortSignal): Promise<EventDto[]> {
  const res = await fetch("/api/checkin/events", { credentials: "same-origin", signal });
  const data = await parseJson<{ events: EventDto[] }>(res);
  return data.events;
}

/** Load instance branding theme for the staff or admin SPA. */
export async function fetchStaffTheme(signal?: AbortSignal): Promise<ThemeResponse> {
  const url = isAdminAppPath() ? "/api/admin/theme" : "/api/staff/theme";
  const res = await fetch(url, { credentials: "same-origin", signal });
  return parseJson<ThemeResponse>(res);
}

/** Persist instance branding theme (superadmin-only PUT). */
export async function saveStaffTheme(body: BrandingThemeDto): Promise<ThemeResponse> {
  const url = isAdminAppPath() ? "/api/admin/theme" : "/api/staff/theme";
  const res = await fetch(url, jsonPutInit(body));
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

export async function fetchCheckInOpsConfig(eventId: string): Promise<OpsConfigDto> {
  const res = await fetch(
    `/api/checkin/ops-config?eventId=${encodeURIComponent(eventId)}`,
    { credentials: "same-origin" },
  );
  return parseJson<OpsConfigDto>(res);
}

function attendeesListQuery(eventId: string, params: AttendeesListParams = {}): string {
  const q = new URLSearchParams();
  if (params.page != null) q.set("page", String(params.page));
  if (params.pageSize != null) q.set("pageSize", String(params.pageSize));
  if (params.q) q.set("q", params.q);
  if (params.status && params.status !== "all") q.set("status", params.status);
  if (params.ticket_type) q.set("ticket_type", params.ticket_type);
  if (params.rsvp_status) q.set("rsvp_status", params.rsvp_status);
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


export async function createAttendee(
  eventId: string,
  body: {
    email: string;
    name: string;
    company?: string;
    department?: string;
    ticket_type?: string;
    custom_data?: Record<string, unknown>;
  },
): Promise<AttendeeDetailDto> {
  const res = await fetch(
    `/api/admin/events/${encodeURIComponent(eventId)}/attendees`,
    jsonPostInit(body),
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

/** Queue ticket emails for many attendees (undelivered or all). */
export async function bulkResendTickets(
  eventId: string,
  target: "unsent" | "all",
): Promise<BulkResendResponse> {
  const res = await fetch(
    `/api/admin/events/${encodeURIComponent(eventId)}/attendees/bulk-resend`,
    jsonPostInit({ target }),
  );
  return parseJson<BulkResendResponse>(res);
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
      throw new ApiError(res.status, messageFromApiErrorBody(body) ?? body.error ?? res.statusText);
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
  if (params.purpose && params.purpose !== "all") q.set("purpose", params.purpose);
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
  params: { q?: string; status?: string; ticket_type?: string; rsvp_status?: RsvpStatus },
  format: "xlsx" | "csv" | "pdf",
  signal?: AbortSignal,
): Promise<void> {
  const urlParams = new URLSearchParams({ format });
  if (params.q) urlParams.set("q", params.q);
  if (params.status && params.status !== "all") urlParams.set("status", params.status);
  if (params.ticket_type) urlParams.set("ticket_type", params.ticket_type);
  if (params.rsvp_status) urlParams.set("rsvp_status", params.rsvp_status);

  const res = await fetch(
    `/api/admin/events/${encodeURIComponent(eventId)}/attendees/export?${urlParams.toString()}`,
    { credentials: "same-origin", signal },
  );
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as ApiErrorBody;
      message = messageFromApiErrorBody(body) ?? message;
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

/** Load instance mail transport settings (superadmin). */
export async function fetchMailSettings(signal?: AbortSignal): Promise<MailSettingsResponse> {
  const res = await fetch("/api/admin/mail-settings", { credentials: "same-origin", signal });
  return parseJson<MailSettingsResponse>(res);
}

/** Save instance mail transport settings (superadmin). */
export async function saveMailSettings(body: SaveMailSettingsBody): Promise<MailSettingsResponse> {
  const res = await fetch("/api/admin/mail-settings", jsonPutInit(body));
  return parseJson<MailSettingsResponse>(res);
}

/** Send a transport-level test email (superadmin). */
export async function sendMailTransportTest(to: string): Promise<TestSendResponse> {
  const res = await fetch("/api/admin/mail-settings/test", jsonPostInit({ to }));
  return parseJson<TestSendResponse>(res);
}

export async function fetchSessions(
  role?: string,
  signal?: AbortSignal,
): Promise<SessionsResponse> {
  const q = role && role !== "all" ? `?role=${encodeURIComponent(role)}` : "";
  const res = await fetch(`/api/admin/sessions${q}`, { credentials: "same-origin", signal });
  return parseJson<SessionsResponse>(res);
}

export async function revokeSessionById(sessionId: string): Promise<void> {
  const res = await fetch(`/api/admin/sessions/${sessionId}/revoke`, jsonPostInit({}));
  await parseJson<unknown>(res);
}

export async function revokeAllOperatorSessions(
  eventId: string,
): Promise<{ revokedCount: number }> {
  const res = await fetch(
    `/api/admin/events/${encodeURIComponent(eventId)}/revoke-all-operator-sessions`,
    jsonPostInit({}),
  );
  return parseJson<{ revokedCount: number }>(res);
}

export async function fetchSecuritySettings(signal?: AbortSignal): Promise<SecuritySettingsDto> {
  const res = await fetch("/api/admin/system-settings", { credentials: "same-origin", signal });
  return parseJson<SecuritySettingsDto>(res);
}

export async function patchSecuritySettings(
  body: PatchSecuritySettingsBody,
): Promise<SecuritySettingsDto> {
  const res = await fetch("/api/admin/system-settings", jsonPatchInit(body));
  return parseJson<SecuritySettingsDto>(res);
}

function usersListQuery(
  params: {
    q?: string;
    page?: number;
    pageSize?: number;
    organizationId?: string;
    role?: string;
    status?: string;
  } = {},
): string {
  const q = new URLSearchParams();
  if (params.q) q.set("q", params.q);
  if (params.page != null) q.set("page", String(params.page));
  if (params.pageSize != null) q.set("pageSize", String(params.pageSize));
  if (params.organizationId) q.set("organizationId", params.organizationId);
  if (params.role && params.role !== "all") q.set("role", params.role);
  if (params.status && params.status !== "all") q.set("status", params.status);
  const qs = q.toString();
  return `/api/admin/users${qs ? `?${qs}` : ""}`;
}

export async function fetchAdminOrganizations(signal?: AbortSignal): Promise<
  Array<{ id: string; name: string }>
> {
  const res = await fetch("/api/admin/organizations", { credentials: "same-origin", signal });
  const data = await parseJson<{ organizations: Array<{ id: string; name: string }> }>(res);
  return data.organizations;
}

export async function fetchAdminUsers(
  params: {
    q?: string;
    page?: number;
    pageSize?: number;
    organizationId?: string;
    role?: string;
    status?: string;
  } = {},
  signal?: AbortSignal,
): Promise<UserListResponse> {
  const res = await fetch(usersListQuery(params), { credentials: "same-origin", signal });
  return parseJson<UserListResponse>(res);
}

export async function createAdminUser(body: CreateAdminUserBody): Promise<{ user: UserListItemDto }> {
  const res = await fetch("/api/admin/users", jsonPostInit(body));
  return parseJson<{ user: UserListItemDto }>(res);
}

export async function patchAdminUser(
  id: string,
  body: PatchAdminUserBody,
): Promise<{ user: UserListItemDto }> {
  const res = await fetch(`/api/admin/users/${encodeURIComponent(id)}`, jsonPatchInit(body));
  return parseJson<{ user: UserListItemDto }>(res);
}

export async function grantUserRole(
  id: string,
  body: GrantUserRoleBody,
): Promise<{ assignment: { id: string; role: string; scope_type: string; scope_id: string | null } }> {
  const res = await fetch(`/api/admin/users/${encodeURIComponent(id)}/roles`, jsonPostInit(body));
  return parseJson(res);
}

export async function revokeUserRole(id: string, assignmentId: string): Promise<void> {
  const res = await fetch(
    `/api/admin/users/${encodeURIComponent(id)}/roles/${encodeURIComponent(assignmentId)}`,
    jsonDeleteInit(),
  );
  if (!res.ok) {
    let message = res.statusText || `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as ApiErrorBody;
      message = messageFromApiErrorBody(body) ?? message;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, message);
  }
}

export async function resetUserMfa(id: string): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/admin/users/${encodeURIComponent(id)}/reset-2fa`, jsonPostInit({}));
  return parseJson<{ ok: boolean }>(res);
}

export async function resetUserPassword(
  id: string,
  body: ResetUserPasswordBody,
): Promise<{ ok: boolean }> {
  const res = await fetch(
    `/api/admin/users/${encodeURIComponent(id)}/reset-password`,
    jsonPostInit(body),
  );
  return parseJson<{ ok: boolean }>(res);
}

export async function revokeUserSessions(
  id: string,
): Promise<{ ok: boolean; sessionsRevoked: number }> {
  const res = await fetch(
    `/api/admin/users/${encodeURIComponent(id)}/revoke-sessions`,
    jsonPostInit({}),
  );
  return parseJson<{ ok: boolean; sessionsRevoked: number }>(res);
}

export async function fetchRoleAssignments(
  params: { page?: number; pageSize?: number } = {},
  signal?: AbortSignal,
): Promise<RoleAssignmentsListResponse> {
  const q = new URLSearchParams();
  if (params.page != null) q.set("page", String(params.page));
  if (params.pageSize != null) q.set("pageSize", String(params.pageSize));
  const qs = q.toString();
  const res = await fetch(`/api/admin/role-assignments${qs ? `?${qs}` : ""}`, {
    credentials: "same-origin",
    signal,
  });
  return parseJson<RoleAssignmentsListResponse>(res);
}

/** Load system readiness checks for first-run wizard step 1 (superadmin). */
export async function fetchSetupChecks(signal?: AbortSignal): Promise<SetupChecksResponse> {
  const res = await fetch("/api/admin/setup/checks", { credentials: "same-origin", signal });
  return parseJson<SetupChecksResponse>(res);
}

/** Load instance organisation name and logo URL for setup wizard branding step. */
export async function fetchOrgBranding(signal?: AbortSignal): Promise<SetupOrgBrandingDto> {
  const res = await fetch("/api/admin/setup/org-branding", { credentials: "same-origin", signal });
  return parseJson<SetupOrgBrandingDto>(res);
}

/** Save organisation name and HTTPS logo URL during first-run branding step. */
export async function patchOrgBranding(
  body: PatchSetupOrgBrandingBody,
): Promise<SetupOrgBrandingDto> {
  const res = await fetch("/api/admin/setup/org-branding", jsonPatchInit(body));
  return parseJson<SetupOrgBrandingDto>(res);
}

/** Mark first-run onboarding wizard complete (superadmin, POST setup/complete). */
export async function completeSetup(): Promise<{ setup_complete: boolean }> {
  const res = await fetch("/api/admin/setup/complete", jsonPostInit({}));
  return parseJson<{ setup_complete: boolean }>(res);
}

/** Load paginated instance admin audit log (superadmin). Pass ISO instants for date bounds (local-day from UI). */
export async function fetchAuditLog(
  params: {
    page?: number;
    pageSize?: number;
    actionType?: string;
    start?: string;
    end?: string;
  },
  signal?: AbortSignal,
): Promise<AuditLogResponse> {
  const q = new URLSearchParams();
  if (params.page != null) q.set("page", String(params.page));
  if (params.pageSize != null) q.set("pageSize", String(params.pageSize));
  if (params.actionType) q.set("action_type", params.actionType);
  if (params.start) q.set("start", params.start);
  if (params.end) q.set("end", params.end);
  const qs = q.toString();
  const res = await fetch(`/api/admin/audit-log${qs ? `?${qs}` : ""}`, {
    credentials: "same-origin",
    signal,
  });
  return parseJson<AuditLogResponse>(res);
}

export async function fetchAccount(signal?: AbortSignal): Promise<AccountDto> {
  const res = await fetch("/api/account", { credentials: "same-origin", signal });
  return parseJson<AccountDto>(res);
}

export async function patchAccountProfile(
  body: PatchAccountProfileBody,
): Promise<{ display_name: string | null; preferred_locale: string | null }> {
  const res = await fetch("/api/account/profile", jsonPatchInit(body));
  return parseJson<{ display_name: string | null; preferred_locale: string | null }>(res);
}

export async function patchAccountPassword(body: PatchAccountPasswordBody): Promise<PatchAccountPasswordResponse> {
  const res = await fetch("/api/account/password", jsonPatchInit(body));
  return parseJson<PatchAccountPasswordResponse>(res);
}

export async function fetchAccountSessions(signal?: AbortSignal): Promise<SessionsResponse> {
  const res = await fetch("/api/account/sessions", { credentials: "same-origin", signal });
  return parseJson<SessionsResponse>(res);
}

export async function deleteAccountSession(sessionId: string): Promise<void> {
  const res = await fetch(`/api/account/sessions/${encodeURIComponent(sessionId)}`, jsonDeleteInit());
  await parseJson<unknown>(res);
}

export async function enrollMfaTotp(): Promise<MfaEnrollResponse> {
  const res = await fetch("/api/account/mfa/totp/enroll", jsonPostInit({}));
  return parseJson<MfaEnrollResponse>(res);
}

export async function confirmMfaTotp(body: ConfirmMfaTotpBody): Promise<{ ok: true }> {
  const res = await fetch("/api/account/mfa/totp/confirm", jsonPostInit(body));
  return parseJson<{ ok: true }>(res);
}

export async function resetMfa(body: ResetMfaBody): Promise<ResetMfaResponse> {
  const res = await fetch("/api/account/mfa/reset", jsonPostInit(body));
  return parseJson<ResetMfaResponse>(res);
}

/** Load aggregated admission report for an event. */
export async function fetchEventOverview(
  eventId: string,
  signal?: AbortSignal,
): Promise<EventOverviewDto> {
  const res = await fetch(
    `/api/admin/events/${encodeURIComponent(eventId)}/overview`,
    { credentials: "same-origin", signal },
  );
  return parseJson<EventOverviewDto>(res);
}

export async function fetchEventReports(
  eventId: string,
  signal?: AbortSignal,
): Promise<EventReportsResponse> {
  const res = await fetch(
    `/api/admin/events/${encodeURIComponent(eventId)}/reports`,
    { credentials: "same-origin", signal },
  );
  return parseJson<EventReportsResponse>(res);
}

/** Download admission log CSV export and trigger browser save. */
export async function exportEventReportsCsv(
  eventId: string,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(
    `/api/admin/events/${encodeURIComponent(eventId)}/reports/export?format=csv`,
    { credentials: "same-origin", signal },
  );
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as ApiErrorBody;
      message = messageFromApiErrorBody(body) ?? message;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, message);
  }

  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const match = /filename="([^"]+)"/.exec(disposition);
  const filename = match?.[1] ?? "admissions.csv";

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Same-origin URL for printable HTML report (open in new tab for Save as PDF). */
export function eventReportsPrintUrl(eventId: string): string {
  return `/api/admin/events/${encodeURIComponent(eventId)}/reports/export?format=pdf`;
}

