import type {
  AttendeeCardDto,
  AttendeeDetailDto,
  AttendeeMailStatusFilter,
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
  BulkCheckInResponse,
  BulkRevokePassResponse,
  EventItemDto,
  EventItemsListResponse,
  CreateEventItemBody,
  UpdateEventItemPatch,
  OpsConfigDto,
  UpdateOpsConfigPatch,
  EventTemplateDto,
  SaveTemplateBody,
  PreviewTemplateResponse,
  MailTemplateListItem,
  MailTemplateDetail,
  BulkSendBody,
  BulkSendDryRunResponse,
  BulkSendQueuedResponse,
  BulkSendStatusResponse,
  RsvpStatus,
  TestSendBody,
  TemplateTestSendResponse,
  MailTransportTestSendResponse,
  MailSettingsResponse,
  EventMailSettingsResponse,
  SaveMailSettingsBody,
  EventDeliveriesListParams,
  EventDeliveriesListResponse,
  SessionsResponse,
  SystemSettingsDto,
  PatchSystemSettingsBody,
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
  EventContactDto,
  EventResourceDto,
  EventReportsResponse,
  AccountDto,
  PatchAccountProfileBody,
  PatchAccountPasswordBody,
  PatchAccountPasswordResponse,
  MfaEnrollResponse,
  ConfirmMfaTotpBody,
  ResetMfaBody,
  ResetMfaResponse,
  IdentityProvidersListResponse,
  ToggleProviderResponse,
  CfAccessSummaryDto,
  ProviderDetailDto,
  ProviderRequestBody,
  ProviderTestDraftBody,
  DiscoverPreviewResponse,
  DiscoverResponse,
  TestResponse,
  CfAccessUpdateBody,
  CfAccessTestResult,
  EventImageAssetDto,
  EventImageAssetsListResponse,
  EventCustomFieldDto,
  EventCustomFieldsListResponse,
  CreateEventCustomFieldBody,
  UpdateEventCustomFieldPatch,
  TicketTypeDto,
  TicketTypesListResponse,
  CreateTicketTypeBody,
  UpdateTicketTypePatch,
} from "./types.js";

export type EventFullMeta = {
  /** Event capacity limit when a 409 `event_full` response includes structured metadata. */
  capacity: number;
  /** Active attendee count at the time of the capacity check. */
  current: number;
  /** New rows an import would add (import commit only). */
  incoming?: number;
  /** Projected total after import (import commit only). */
  projected?: number;
};

/** Thrown when an admin API request fails; may include structured `event_full` metadata on 409. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
    public readonly eventFull?: EventFullMeta,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type ApiErrorBody = {
  error?: unknown;
  detail?: unknown;
  code?: unknown;
  capacity?: number;
  current?: number;
  incoming?: number;
  projected?: number;
};

/** Coerce an API error JSON field to a trimmed string when present. */
function stringField(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

/** Human-readable message from a failed API JSON body. */
function messageFromApiErrorBody(body: ApiErrorBody): string | undefined {
  return stringField(body.detail) ?? stringField(body.error) ?? stringField(body.code);
}

/** Machine-readable error code from a failed API JSON body. */
function apiErrorCodeFromBody(body: ApiErrorBody): string | undefined {
  return stringField(body.code) ?? stringField(body.error);
}

/** Parse structured capacity fields from a 409 `event_full` API error body. */
function eventFullFromBody(body: ApiErrorBody): EventFullMeta | undefined {
  if (apiErrorCodeFromBody(body) !== "event_full" || body.capacity == null || body.current == null) {
    return undefined;
  }
  return {
    capacity: body.capacity,
    current: body.current,
    incoming: body.incoming,
    projected: body.projected,
  };
}

async function parseJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = res.statusText || `HTTP ${res.status}`;
    let code: string | undefined;
    let eventFull: EventFullMeta | undefined;
    try {
      const body = (await res.json()) as ApiErrorBody;
      message = messageFromApiErrorBody(body) ?? message;
      code = apiErrorCodeFromBody(body);
      eventFull = eventFullFromBody(body);
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, message, code, eventFull);
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
      "X-Client-Timezone": Intl.DateTimeFormat().resolvedOptions().timeZone,
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
      "X-Client-Timezone": Intl.DateTimeFormat().resolvedOptions().timeZone,
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
      "X-Client-Timezone": Intl.DateTimeFormat().resolvedOptions().timeZone,
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
      "X-Client-Timezone": Intl.DateTimeFormat().resolvedOptions().timeZone,
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
      "X-Client-Timezone": Intl.DateTimeFormat().resolvedOptions().timeZone,
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

export interface ImportHistoryEntry {
  id: string;
  created_at: string;
  filename: string | null;
  created: number;
  updated: number;
  skipped: number;
}

/** Recent committed imports for the event (newest first), read from the audit log. */
export async function fetchImportHistory(
  eventId: string,
  signal?: AbortSignal,
): Promise<ImportHistoryEntry[]> {
  const res = await fetch(
    `/api/admin/events/${encodeURIComponent(eventId)}/import/history`,
    { credentials: "same-origin", signal },
  );
  const body = await parseJson<{ items: ImportHistoryEntry[] }>(res);
  return body.items;
}

/** Commit an attendee file import after preview (creates/updates rows in the event). */
export async function commitImport(
  eventId: string,
  file: File,
  overwrite: boolean,
  /** When true, appends `?force=1` for superadmin capacity override (audited server-side). */
  options?: { force?: boolean },
): Promise<ImportCommitResponse> {
  const forceQuery = options?.force ? "?force=1" : "";
  const res = await fetch(
    `/api/admin/events/${encodeURIComponent(eventId)}/import/commit${forceQuery}`,
    multipartPostInit(importFormData(file, overwrite)),
  );
  return parseJson<ImportCommitResponse>(res);
}

/** Upload a branding image (superadmin); returns public `/uploads/...` URL. */
export async function uploadFile(formData: FormData): Promise<{ url: string }> {
  const res = await fetch("/api/admin/uploads", multipartPostInit(formData));
  return parseJson<{ url: string }>(res);
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

/** Permanently delete an event (superadmin-only DELETE). Only never-used events qualify. */
export async function deleteEvent(eventId: string): Promise<void> {
  const res = await fetch(`/api/admin/events/${encodeURIComponent(eventId)}`, jsonDeleteInit());
  await parseJson(res);
}

/** Revoke every currently-admitted attendee's check-in for the event (superadmin-only, blocked on archived events). */
export async function revokeAllCheckIns(eventId: string): Promise<{ revokedCount: number }> {
  const res = await fetch(
    `/api/admin/events/${encodeURIComponent(eventId)}/revoke-all-checkins`,
    jsonPostInit({}),
  );
  return parseJson<{ revokedCount: number }>(res);
}

/** Reset every issued/returned item hand-out back to pending for the event (superadmin-only, blocked on archived events). */
export async function revokeAllItemsIssued(eventId: string): Promise<{ revokedCount: number }> {
  const res = await fetch(
    `/api/admin/events/${encodeURIComponent(eventId)}/revoke-all-items`,
    jsonPostInit({}),
  );
  return parseJson<{ revokedCount: number }>(res);
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

/** Patch basic event fields (title, date, location, capacity, branding overrides). */
export async function patchEvent(
  eventId: string,
  body: Partial<{
    title: string;
    date: string;
    timezone: string;
    location: string | null;
    capacity: number | null;
    logo_url: string | null;
    header_image_url: string | null;
  }>,
): Promise<{ event: EventSettingsDto }> {
  const res = await fetch(`/api/admin/events/${encodeURIComponent(eventId)}`, jsonPatchInit(body));
  return parseJson<{ event: EventSettingsDto }>(res);
}

/** Upload an event-scoped branding image (logo or header); returns public `/uploads/...` URL. */
export async function uploadEventBrandingFile(
  eventId: string,
  formData: FormData,
): Promise<{ url: string }> {
  const res = await fetch(
    `/api/admin/events/${encodeURIComponent(eventId)}/branding-upload`,
    multipartPostInit(formData),
  );
  return parseJson<{ url: string }>(res);
}

/** List named branding image assets for an event (the {{token}} asset library). */
export async function fetchEventImageAssets(
  eventId: string,
  signal?: AbortSignal,
): Promise<EventImageAssetDto[]> {
  const res = await fetch(`/api/admin/events/${encodeURIComponent(eventId)}/image-assets`, {
    credentials: "same-origin",
    signal,
  });
  const data = await parseJson<EventImageAssetsListResponse>(res);
  return data.items;
}

/** Upload a new named branding image asset (file + token); throws ApiError on validation/conflict. */
export async function createEventImageAsset(
  eventId: string,
  file: File,
  token: string,
): Promise<EventImageAssetDto> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("token", token);
  const res = await fetch(
    `/api/admin/events/${encodeURIComponent(eventId)}/image-assets`,
    multipartPostInit(fd),
  );
  return parseJson<EventImageAssetDto>(res);
}

/** Delete a named branding image asset. Rejected with 409 asset_in_use while one of the event's
 * saved email templates still references the asset's {{token}} — remove it from the template first. */
export async function deleteEventImageAsset(eventId: string, assetId: string): Promise<void> {
  const res = await fetch(
    `/api/admin/events/${encodeURIComponent(eventId)}/image-assets/${encodeURIComponent(assetId)}`,
    jsonDeleteInit(),
  );
  await parseJson<{ ok: boolean }>(res);
}

/** List an event's custom attendee data field registry (dietary, shirt size, ...). */
export async function fetchEventCustomFields(
  eventId: string,
  signal?: AbortSignal,
): Promise<EventCustomFieldDto[]> {
  const res = await fetch(`/api/admin/events/${encodeURIComponent(eventId)}/custom-fields`, {
    credentials: "same-origin",
    signal,
  });
  const data = await parseJson<EventCustomFieldsListResponse>(res);
  return data.items;
}

/** Define a new custom attendee data field for an event; throws ApiError on validation/conflict. */
export async function createEventCustomField(
  eventId: string,
  body: CreateEventCustomFieldBody,
): Promise<EventCustomFieldDto> {
  const res = await fetch(
    `/api/admin/events/${encodeURIComponent(eventId)}/custom-fields`,
    jsonPostInit(body),
  );
  return parseJson<EventCustomFieldDto>(res);
}

/** Update a custom field's label/type/required/options. source_field is immutable after create. */
export async function updateEventCustomField(
  eventId: string,
  fieldId: string,
  patch: UpdateEventCustomFieldPatch,
): Promise<EventCustomFieldDto> {
  const res = await fetch(
    `/api/admin/events/${encodeURIComponent(eventId)}/custom-fields/${encodeURIComponent(fieldId)}`,
    jsonPatchInit(patch),
  );
  return parseJson<EventCustomFieldDto>(res);
}

/** Delete a custom field. Rejected with 409 field_in_use while an event item still shows it as an
 * operator hint — remove it from the item first. */
export async function deleteEventCustomField(eventId: string, fieldId: string): Promise<void> {
  const res = await fetch(
    `/api/admin/events/${encodeURIComponent(eventId)}/custom-fields/${encodeURIComponent(fieldId)}`,
    jsonDeleteInit(),
  );
  await parseJson<{ ok: boolean }>(res);
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

/** Admin/superadmin-only: reset a handed-out item back to "pending" so it can be issued again. */
export async function revokeItemState(
  eventId: string,
  attendeeId: string,
  itemKey: string,
): Promise<{ card: AttendeeCardDto }> {
  const res = await fetch(
    `/api/admin/events/${encodeURIComponent(eventId)}/attendees/${encodeURIComponent(attendeeId)}/items/${encodeURIComponent(itemKey)}/revoke`,
    jsonPostInit({}),
  );
  return parseJson<{ card: AttendeeCardDto }>(res);
}

export async function undoLastCheckIn(
  eventId: string,
  deviceId?: string,
): Promise<{ card: AttendeeCardDto }> {
  const res = await fetch("/api/checkin/undo", jsonPostInit({ eventId, deviceId }));
  return parseJson<{ card: AttendeeCardDto }>(res);
}

/** Admin/superadmin-only: reverse this attendee's current admission regardless of who checked them in or when. */
export async function revokeAttendeeCheckIn(
  eventId: string,
  attendeeId: string,
): Promise<{ card: AttendeeCardDto }> {
  const res = await fetch(
    `/api/admin/events/${encodeURIComponent(eventId)}/attendees/${encodeURIComponent(attendeeId)}/revoke-checkin`,
    jsonPostInit({}),
  );
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
  if (params.mail_status) q.set("mail_status", params.mail_status);
  if (params.sortBy && params.sortBy !== "name") q.set("sortBy", params.sortBy);
  if (params.sortDir && params.sortDir !== "asc") q.set("sortDir", params.sortDir);
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

/** Patch attendee profile, RSVP, or pass status; optional `force` bypasses capacity on restore. */
export async function updateAttendee(
  eventId: string,
  attendeeId: string,
  patch: UpdateAttendeePatch,
  options?: { force?: boolean },
): Promise<AttendeeDetailDto> {
  const forceQuery = options?.force ? "?force=1" : "";
  const res = await fetch(
    `/api/admin/events/${encodeURIComponent(eventId)}/attendees/${encodeURIComponent(attendeeId)}${forceQuery}`,
    jsonPatchInit(patch),
  );
  return parseJson<AttendeeDetailDto>(res);
}

/** Permanently erase an attendee's record (GDPR erasure) — profile, deliveries, wallet pass,
 * and check-ins. Irreversible; see docs/DSAR-PROCEDURE.md. */
export async function deleteAttendee(eventId: string, attendeeId: string): Promise<void> {
  const res = await fetch(
    `/api/admin/events/${encodeURIComponent(eventId)}/attendees/${encodeURIComponent(attendeeId)}`,
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

/** Permanently erase a selection of attendees at once (GDPR erasure), from the Attendees
 * list's row-selection bulk bar. Same effect as calling `deleteAttendee` once per id. */
export async function bulkDeleteAttendees(
  eventId: string,
  attendeeIds: string[],
): Promise<{ deletedCount: number }> {
  const res = await fetch(
    `/api/admin/events/${encodeURIComponent(eventId)}/attendees/bulk-delete`,
    jsonPostInit({ attendeeIds }),
  );
  return parseJson<{ deletedCount: number }>(res);
}

export interface BulkTicketTypeResponse {
  updatedCount: number;
  alreadySetCount: number;
}

/** Assign one catalog ticket type to every selected attendee. Ids outside the event are
 * silently ignored server-side; rows already carrying the type are counted separately. */
export async function bulkChangeTicketType(
  eventId: string,
  attendeeIds: string[],
  ticketType: string,
): Promise<BulkTicketTypeResponse> {
  const res = await fetch(
    `/api/admin/events/${encodeURIComponent(eventId)}/attendees/bulk-ticket-type`,
    jsonPostInit({ attendeeIds, ticket_type: ticketType }),
  );
  return parseJson<BulkTicketTypeResponse>(res);
}

/** Manually check in a selection of attendees at once (no QR scan), from the Attendees list's
 * row-selection bulk bar. Same single-use CAS admission path as scan check-in. */
export async function bulkCheckInAttendees(
  eventId: string,
  attendeeIds: string[],
): Promise<BulkCheckInResponse> {
  const res = await fetch(
    `/api/admin/events/${encodeURIComponent(eventId)}/attendees/bulk-checkin`,
    jsonPostInit({ attendeeIds }),
  );
  return parseJson<BulkCheckInResponse>(res);
}

export async function bulkRevokePass(
  eventId: string,
  attendeeIds: string[],
): Promise<BulkRevokePassResponse> {
  const res = await fetch(
    `/api/admin/events/${encodeURIComponent(eventId)}/attendees/bulk-revoke-pass`,
    jsonPostInit({ attendeeIds }),
  );
  return parseJson<BulkRevokePassResponse>(res);
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
      const body = (await res.json()) as { error?: unknown; errors?: string[] };
      if (body.errors?.length) {
        throw new TemplateValidationError(body.errors);
      }
      const errorCode = stringField(body.error);
      throw new ApiError(
        res.status,
        messageFromApiErrorBody(body) ?? errorCode ?? res.statusText,
        errorCode,
      );
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
): Promise<TemplateTestSendResponse> {
  const res = await fetch(
    `/api/admin/events/${encodeURIComponent(eventId)}/template/test-send`,
    jsonPostInit(body),
  );
  return parseJson<TemplateTestSendResponse>(res);
}

/** List event-scoped mail templates. */
export async function fetchEventTemplates(
  eventId: string,
  signal?: AbortSignal,
): Promise<MailTemplateListItem[]> {
  const res = await fetch(`/api/admin/events/${encodeURIComponent(eventId)}/templates`, {
    credentials: "same-origin",
    signal,
  });
  const body = await parseJson<{ items: MailTemplateListItem[] }>(res);
  return body.items;
}

/** Load one event mail template by id. */
export async function fetchEventTemplateById(
  eventId: string,
  templateId: string,
  signal?: AbortSignal,
): Promise<MailTemplateDetail> {
  const res = await fetch(
    `/api/admin/events/${encodeURIComponent(eventId)}/templates/${encodeURIComponent(templateId)}`,
    { credentials: "same-origin", signal },
  );
  return parseJson<MailTemplateDetail>(res);
}

/** Save an event-scoped mail template by id. */
export async function saveEventTemplateById(
  eventId: string,
  templateId: string,
  body: SaveTemplateBody,
): Promise<MailTemplateDetail> {
  const res = await fetch(
    `/api/admin/events/${encodeURIComponent(eventId)}/templates/${encodeURIComponent(templateId)}`,
    jsonPutInit(body),
  );
  return parseTemplateActionJson<MailTemplateDetail>(res);
}

/** Create a new event-scoped mail template. */
export async function createEventTemplate(
  eventId: string,
  body: { label: string; template_format: "mjml" | "html"; subject_template?: string; body_template?: string },
): Promise<MailTemplateDetail> {
  const res = await fetch(
    `/api/admin/events/${encodeURIComponent(eventId)}/templates`,
    jsonPostInit(body),
  );
  return parseTemplateActionJson<MailTemplateDetail>(res);
}

/** Delete an event-scoped mail template. */
export async function deleteEventTemplate(eventId: string, templateId: string): Promise<void> {
  const res = await fetch(
    `/api/admin/events/${encodeURIComponent(eventId)}/templates/${encodeURIComponent(templateId)}`,
    jsonDeleteInit(),
  );
  await parseJson<{ ok: boolean }>(res);
}

/** Render a draft template by id with sample data (no DB write). */
export async function previewEventTemplateById(
  eventId: string,
  templateId: string,
  body: SaveTemplateBody,
): Promise<PreviewTemplateResponse> {
  const res = await fetch(
    `/api/admin/events/${encodeURIComponent(eventId)}/templates/${encodeURIComponent(templateId)}/preview`,
    jsonPostInit(body),
  );
  return parseTemplateActionJson<PreviewTemplateResponse>(res);
}

/** Send a test mail for a specific event template. */
export async function testSendEventTemplateById(
  eventId: string,
  templateId: string,
  body: TestSendBody,
): Promise<TemplateTestSendResponse> {
  const res = await fetch(
    `/api/admin/events/${encodeURIComponent(eventId)}/templates/${encodeURIComponent(templateId)}/test-send`,
    jsonPostInit(body),
  );
  return parseJson<TemplateTestSendResponse>(res);
}

/** Queue or dry-run a bulk send for selected attendees. */
export async function sendEventBulk(
  eventId: string,
  body: BulkSendBody & { dryRun: true },
): Promise<BulkSendDryRunResponse>;
export async function sendEventBulk(
  eventId: string,
  body: Omit<BulkSendBody, "dryRun"> & { dryRun?: false },
): Promise<BulkSendQueuedResponse>;
export async function sendEventBulk(
  eventId: string,
  body: BulkSendBody,
): Promise<BulkSendDryRunResponse | BulkSendQueuedResponse> {
  const res = await fetch(
    `/api/admin/events/${encodeURIComponent(eventId)}/send`,
    jsonPostInit(body),
  );
  return parseJson<BulkSendDryRunResponse | BulkSendQueuedResponse>(res);
}

/** Poll bulk send batch progress. */
export async function fetchBulkSendStatus(
  eventId: string,
  batchId: string,
  signal?: AbortSignal,
): Promise<BulkSendStatusResponse> {
  const res = await fetch(
    `/api/admin/events/${encodeURIComponent(eventId)}/send/status/${encodeURIComponent(batchId)}`,
    { credentials: "same-origin", signal },
  );
  return parseJson<BulkSendStatusResponse>(res);
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
/** List an event's ticket-type catalog (label/color, each with a live attendee count) — the
 * single source of truth consumed by the add/edit attendee form, filters, bulk-send, import,
 * and Reports alike (batch 04 / #351). */
/** Reads the admin route under `/admin` (staffAdminGate), the check-in route everywhere else
 * (`/operator`) - check-in operators often lack admin-panel access and would 403 on the admin
 * route, leaving every ticket-type badge on the check-in surface stuck in gray (Codex review,
 * batch 04 / #351). Same branch shape as fetchStaffTheme/saveStaffTheme above. */
export async function fetchTicketTypes(
  eventId: string,
  signal?: AbortSignal,
): Promise<TicketTypeDto[]> {
  const url = isAdminAppPath()
    ? `/api/admin/events/${encodeURIComponent(eventId)}/ticket-types`
    : `/api/checkin/ticket-types?eventId=${encodeURIComponent(eventId)}`;
  const res = await fetch(url, { credentials: "same-origin", signal });
  const data = await parseJson<TicketTypesListResponse>(res);
  return data.items;
}

/** Define a new ticket type for an event; throws ApiError on validation/limit. */
export async function createTicketType(
  eventId: string,
  body: CreateTicketTypeBody,
): Promise<TicketTypeDto> {
  const res = await fetch(
    `/api/admin/events/${encodeURIComponent(eventId)}/ticket-types`,
    jsonPostInit(body),
  );
  return parseJson<TicketTypeDto>(res);
}

/** Update a ticket type's label/color. `key` is immutable after create. */
export async function updateTicketType(
  eventId: string,
  typeId: string,
  patch: UpdateTicketTypePatch,
): Promise<TicketTypeDto> {
  const res = await fetch(
    `/api/admin/events/${encodeURIComponent(eventId)}/ticket-types/${encodeURIComponent(typeId)}`,
    jsonPatchInit(patch),
  );
  return parseJson<TicketTypeDto>(res);
}

/** Delete a ticket type. Rejected with 409 type_in_use while an attendee still has this type. */
export async function deleteTicketType(eventId: string, typeId: string): Promise<void> {
  const res = await fetch(
    `/api/admin/events/${encodeURIComponent(eventId)}/ticket-types/${encodeURIComponent(typeId)}`,
    jsonDeleteInit(),
  );
  await parseJson<{ ok: boolean }>(res);
}

type AttendeeExportFormat = "xlsx" | "csv" | "pdf";

/** Shared by both export entry points: validates the response, then triggers the browser
 * download from the returned blob. */
async function downloadExportResponse(res: Response, format: AttendeeExportFormat): Promise<void> {
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

/** Filtered export (header "Export" menu) — the current list filters as XLSX/CSV/PDF. */
export async function exportAttendees(
  eventId: string,
  params: {
    q?: string;
    status?: string;
    ticket_type?: string;
    rsvp_status?: RsvpStatus;
    mail_status?: AttendeeMailStatusFilter;
  },
  format: AttendeeExportFormat,
  signal?: AbortSignal,
): Promise<void> {
  const urlParams = new URLSearchParams({ format });
  if (params.q) urlParams.set("q", params.q);
  if (params.status && params.status !== "all") urlParams.set("status", params.status);
  if (params.ticket_type) urlParams.set("ticket_type", params.ticket_type);
  if (params.rsvp_status) urlParams.set("rsvp_status", params.rsvp_status);
  if (params.mail_status) urlParams.set("mail_status", params.mail_status);

  const res = await fetch(
    `/api/admin/events/${encodeURIComponent(eventId)}/attendees/export?${urlParams.toString()}`,
    { credentials: "same-origin", signal },
  );
  await downloadExportResponse(res, format);
}

/** Explicit-selection export (bulk bar's "Export selected") — a POST with the ids in the JSON
 * body, not a GET with them in the query string: the default reverse-proxy access log records
 * the full request URI, and this app's own access log deliberately excludes query strings for
 * exactly this reason (Codex review, #520). */
export async function exportSelectedAttendees(
  eventId: string,
  attendeeIds: string[],
  format: AttendeeExportFormat,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`/api/admin/events/${encodeURIComponent(eventId)}/attendees/export-selected`, {
    ...jsonPostInit({ attendee_ids: attendeeIds, format }),
    signal,
  });
  await downloadExportResponse(res, format);
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
export async function sendMailTransportTest(to: string): Promise<MailTransportTestSendResponse> {
  const res = await fetch("/api/admin/mail-settings/test", jsonPostInit({ to }));
  return parseJson<MailTransportTestSendResponse>(res);
}

/** Load an event's dedicated mail transport override, or its inherited (effective) org
 * values plus hasEventOverride:false when it has none. */
export async function fetchEventMailSettings(
  eventId: string,
  signal?: AbortSignal,
): Promise<EventMailSettingsResponse> {
  const res = await fetch(`/api/admin/events/${encodeURIComponent(eventId)}/mail-settings`, {
    credentials: "same-origin",
    signal,
  });
  return parseJson<EventMailSettingsResponse>(res);
}

/** Create or update an event's dedicated mail transport override. */
export async function saveEventMailSettings(
  eventId: string,
  body: SaveMailSettingsBody,
): Promise<EventMailSettingsResponse> {
  const res = await fetch(
    `/api/admin/events/${encodeURIComponent(eventId)}/mail-settings`,
    jsonPutInit(body),
  );
  return parseJson<EventMailSettingsResponse>(res);
}

/** Remove an event's dedicated mail transport override, reverting it to inherit the org's. */
export async function clearEventMailSettings(eventId: string): Promise<EventMailSettingsResponse> {
  const res = await fetch(
    `/api/admin/events/${encodeURIComponent(eventId)}/mail-settings`,
    jsonDeleteInit(),
  );
  return parseJson<EventMailSettingsResponse>(res);
}

/** Send a transport-level test email using whatever transport actually resolves for this
 * event (dedicated override or inherited org transport). */
export async function sendEventMailTransportTest(
  eventId: string,
  to: string,
): Promise<MailTransportTestSendResponse> {
  const res = await fetch(
    `/api/admin/events/${encodeURIComponent(eventId)}/mail-settings/test`,
    jsonPostInit({ to }),
  );
  return parseJson<MailTransportTestSendResponse>(res);
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

export async function fetchSecuritySettings(signal?: AbortSignal): Promise<SystemSettingsDto> {
  const res = await fetch("/api/admin/system-settings", { credentials: "same-origin", signal });
  return parseJson<SystemSettingsDto>(res);
}

export async function patchSecuritySettings(
  body: PatchSystemSettingsBody,
): Promise<SystemSettingsDto> {
  const res = await fetch("/api/admin/system-settings", jsonPatchInit(body));
  return parseJson<SystemSettingsDto>(res);
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

/** Load instance organisation name and logo URL — setup wizard branding step and Settings → General. */
export async function fetchOrgBranding(signal?: AbortSignal): Promise<SetupOrgBrandingDto> {
  const res = await fetch("/api/admin/setup/org-branding", { credentials: "same-origin", signal });
  return parseJson<SetupOrgBrandingDto>(res);
}

/** Save organisation name and HTTPS logo URL — setup wizard branding step and Settings → General. */
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

export async function cancelMfaEnroll(): Promise<void> {
  const res = await fetch("/api/account/mfa/totp/enroll", jsonDeleteInit());
  await parseJson<unknown>(res);
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

export async function patchEventNote(eventId: string, note: string | null): Promise<void> {
  const res = await fetch(`/api/admin/events/${encodeURIComponent(eventId)}/note`, {
    method: "PATCH",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ note }),
  });
  await parseJson(res);
}

export async function createEventContact(
  eventId: string,
  data: { name: string; role?: string | null; phone?: string | null; email?: string | null; note?: string | null },
): Promise<EventContactDto> {
  const res = await fetch(`/api/admin/events/${encodeURIComponent(eventId)}/contacts`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return parseJson<EventContactDto>(res);
}

export async function updateEventContact(
  eventId: string,
  contactId: string,
  data: { name?: string; role?: string | null; phone?: string | null; email?: string | null; note?: string | null },
): Promise<EventContactDto> {
  const res = await fetch(
    `/api/admin/events/${encodeURIComponent(eventId)}/contacts/${encodeURIComponent(contactId)}`,
    {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    },
  );
  return parseJson<EventContactDto>(res);
}

export async function deleteEventContact(eventId: string, contactId: string): Promise<void> {
  const res = await fetch(
    `/api/admin/events/${encodeURIComponent(eventId)}/contacts/${encodeURIComponent(contactId)}`,
    { method: "DELETE", credentials: "same-origin" },
  );
  await parseJson(res);
}

export async function createEventResource(
  eventId: string,
  data: { title: string; type?: "link" | "file"; url: string; description?: string | null },
): Promise<EventResourceDto> {
  const res = await fetch(`/api/admin/events/${encodeURIComponent(eventId)}/resources`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return parseJson<EventResourceDto>(res);
}

export async function updateEventResource(
  eventId: string,
  resourceId: string,
  data: { title?: string; type?: "link" | "file"; url?: string; description?: string | null },
): Promise<EventResourceDto> {
  const res = await fetch(
    `/api/admin/events/${encodeURIComponent(eventId)}/resources/${encodeURIComponent(resourceId)}`,
    {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    },
  );
  return parseJson<EventResourceDto>(res);
}

export async function deleteEventResource(eventId: string, resourceId: string): Promise<void> {
  const res = await fetch(
    `/api/admin/events/${encodeURIComponent(eventId)}/resources/${encodeURIComponent(resourceId)}`,
    { method: "DELETE", credentials: "same-origin" },
  );
  await parseJson(res);
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

// --- Identity providers & Cloudflare Access (SPA Settings → Identity, #266) ---

/** List configured OIDC identity providers (superadmin). */
export async function fetchIdentityProviders(
  signal?: AbortSignal,
): Promise<IdentityProvidersListResponse> {
  const res = await fetch("/api/admin/identity/providers", { credentials: "same-origin", signal });
  return parseJson<IdentityProvidersListResponse>(res);
}

/** Load Cloudflare Access config + env locks for the Identity overview summary card. */
export async function fetchCfAccessSummary(
  signal?: AbortSignal,
): Promise<CfAccessSummaryDto> {
  const res = await fetch("/api/admin/identity/cf-access", { credentials: "same-origin", signal });
  return parseJson<CfAccessSummaryDto>(res);
}

/** Toggle an OIDC provider's enabled flag (superadmin). Returns the new enabled state. */
export async function toggleIdentityProvider(providerId: string): Promise<ToggleProviderResponse> {
  const res = await fetch(
    `/api/admin/identity/providers/${encodeURIComponent(providerId)}/toggle`,
    jsonPostInit({}),
  );
  return parseJson<ToggleProviderResponse>(res);
}

/** Load one OIDC provider with mappings for the SPA editor (superadmin). */
export async function fetchIdentityProvider(
  providerId: string,
  signal?: AbortSignal,
): Promise<ProviderDetailDto> {
  const res = await fetch(`/api/admin/identity/providers/${encodeURIComponent(providerId)}`, {
    credentials: "same-origin",
    signal,
  });
  return parseJson<ProviderDetailDto>(res);
}

/** Create a new OIDC identity provider (superadmin). Returns the saved provider. */
export async function createIdentityProvider(body: ProviderRequestBody): Promise<ProviderDetailDto> {
  const res = await fetch("/api/admin/identity/providers", jsonPostInit(body));
  return parseJson<ProviderDetailDto>(res);
}

/** Update an existing OIDC provider (full-form PUT, mappings replace-all). */
export async function updateIdentityProvider(
  providerId: string,
  body: ProviderRequestBody,
): Promise<ProviderDetailDto> {
  const res = await fetch(
    `/api/admin/identity/providers/${encodeURIComponent(providerId)}`,
    jsonPutInit(body),
  );
  return parseJson<ProviderDetailDto>(res);
}

/** Discover OIDC endpoints from the issuer's `.well-known/openid-configuration`
 *  and persist them on the provider (edit mode only; superadmin). */
export async function discoverIdentityProvider(
  providerId: string,
): Promise<DiscoverResponse> {
  const res = await fetch(
    `/api/admin/identity/providers/${encodeURIComponent(providerId)}/discover`,
    jsonPostInit({}),
  );
  return parseJson<DiscoverResponse>(res);
}

/** Probe the provider's authorization/token/JWKS endpoints (edit mode only). */
export async function testIdentityProvider(providerId: string): Promise<TestResponse> {
  const res = await fetch(
    `/api/admin/identity/providers/${encodeURIComponent(providerId)}/test`,
    jsonPostInit({}),
  );
  return parseJson<TestResponse>(res);
}

/** Probe OIDC endpoints from a draft body without persisting a provider (create + edit). */
export async function testIdentityProviderDraft(body: ProviderTestDraftBody): Promise<TestResponse> {
  const res = await fetch("/api/admin/identity/providers/test", jsonPostInit(body));
  return parseJson<TestResponse>(res);
}

/** Discover OIDC endpoints from an issuer without persisting (create mode autofill). */
export async function discoverIdentityProviderPreview(issuer: string): Promise<DiscoverPreviewResponse> {
  const res = await fetch(
    "/api/admin/identity/providers/discover-preview",
    jsonPostInit({ issuer }),
  );
  return parseJson<DiscoverPreviewResponse>(res);
}

/** Save Cloudflare Access config (superadmin). Patch semantics: omitted fields keep
 *  the stored value, env-locked fields are overridden server-side. Returns the full
 *  refreshed config + locks. */
export async function updateCfAccess(body: CfAccessUpdateBody): Promise<CfAccessSummaryDto> {
  const res = await fetch("/api/admin/identity/cf-access", jsonPutInit(body));
  return parseJson<CfAccessSummaryDto>(res);
}

/** Probe the Cloudflare Access team domain's JWKS endpoint. Sends the draft team
 *  domain when provided so the operator can test before saving; otherwise the server
 *  tests the stored value. */
export async function testCfAccess(teamDomain?: string): Promise<CfAccessTestResult> {
  const res = await fetch(
    "/api/admin/identity/cf-access/test",
    jsonPostInit(teamDomain === undefined ? {} : { teamDomain }),
  );
  return parseJson<CfAccessTestResult>(res);
}
