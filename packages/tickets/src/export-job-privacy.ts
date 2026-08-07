/**
 * Persist export AdminJob filter metadata without raw search text (often name/email).
 * Working copy keeps `q` only while the job is pending/running; terminal updates scrub it.
 */
import type {
  AttendeeExportRsvpStatus,
  AttendeeListFilterParams,
  AttendeeMailStatusFilter,
} from "./attendees-list-filters.js";

export type RedactedAttendeeListFilters = {
  status?: AttendeeListFilterParams["status"];
  ticket_type?: string | null;
  rsvp_status?: AttendeeExportRsvpStatus;
  mail_status?: AttendeeMailStatusFilter;
  has_query: boolean;
};

export function redactAttendeeListFiltersForStorage(
  filters: AttendeeListFilterParams,
): RedactedAttendeeListFilters {
  return {
    status: filters.status,
    ticket_type: filters.ticket_type ?? null,
    rsvp_status: filters.rsvp_status,
    mail_status: filters.mail_status,
    has_query: Boolean(filters.q && String(filters.q).trim()),
  };
}

/** Deep-scrub `request.filters.q` out of an export job's result_json (best-effort). */
export function scrubExportJobResultJson(resultJson: unknown): unknown {
  if (!resultJson || typeof resultJson !== "object" || Array.isArray(resultJson)) {
    return resultJson;
  }
  const root = { ...(resultJson as Record<string, unknown>) };
  const request = root.request;
  if (!request || typeof request !== "object" || Array.isArray(request)) return root;
  const req = { ...(request as Record<string, unknown>) };
  const filters = req.filters;
  if (!filters || typeof filters !== "object" || Array.isArray(filters)) return root;
  const raw = filters as AttendeeListFilterParams;
  req.filters = redactAttendeeListFiltersForStorage(raw);
  root.request = req;
  return root;
}
