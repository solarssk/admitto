import type {
  AttendeeCardDto,
  CheckInHistoryEntry,
  CheckInScanResponse,
  CheckInStatsResponse,
  EventDto,
  LookupAttendeeResult,
  MeResponse,
  ThemeResponse,
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

function isAdminAppPath(): boolean {
  const path = window.location.pathname;
  return path === "/admin" || path.startsWith("/admin/");
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
