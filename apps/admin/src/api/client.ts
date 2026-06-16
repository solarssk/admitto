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

function isAdminAppPath(): boolean {
  const path = window.location.pathname;
  return path === "/admin" || path.startsWith("/admin/");
}

/** Session bootstrap on `/operator`; CF/session admin bootstrap on `/admin` (ADR 0017). */
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

/** Theme read — admin path behind CF; operator path session-only. */
export async function fetchStaffTheme(signal?: AbortSignal): Promise<ThemeResponse> {
  const url = isAdminAppPath() ? "/api/admin/theme" : "/api/staff/theme";
  const res = await fetch(url, { credentials: "same-origin", signal });
  return parseJson<ThemeResponse>(res);
}
