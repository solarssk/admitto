import type { EventDto, MeResponse, ThemeResponse } from "./types.js";

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
    throw new ApiError(res.status, res.statusText || `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function fetchMe(signal?: AbortSignal): Promise<MeResponse> {
  const res = await fetch("/api/auth/me", { credentials: "same-origin", signal });
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
  const res = await fetch("/api/staff/theme", { credentials: "same-origin", signal });
  return parseJson<ThemeResponse>(res);
}
