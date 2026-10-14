/**
 * Persist export AdminJob filter metadata without raw search text (often name/email).
 * Working copy keeps `q` only while the job is pending/running; terminal updates scrub it.
 */
import type {
  AttendeeExportRsvpStatus,
  AttendeeListFilterParams,
  AttendeeMailStatusFilter,
} from "./attendees-list-filters.js";
import type { Prisma } from "@admitto/db";

/** Called under the event's exclusive attendee-job queue lock, in the erasure/removal transaction. */
export async function invalidateEventExports(tx: Prisma.TransactionClient, eventId: string): Promise<void> {
  // Keep completed-job history and the storage key: physical deletion can fail and must remain retryable.
  // Normalize sparse/non-object metadata too, so every old export carries the same explicit marker.
  await tx.$executeRaw`
    UPDATE "AdminJob" SET "result_json" =
      (CASE WHEN jsonb_typeof("result_json") = 'object' THEN "result_json" ELSE '{}'::jsonb END)
      || '{"invalidated":true}'::jsonb
    WHERE "event_id" = ${eventId} AND "type" = 'export'
  `;
}

/** Logical download availability is independent of the file's physical cleanup. */
export function isExportInvalidated(resultJson: unknown): boolean {
  return resultJson !== null && typeof resultJson === "object" && !Array.isArray(resultJson)
    && (resultJson as Record<string, unknown>).invalidated === true;
}

/** Same shape as AttendeeCustomFieldFilter, minus the free-text `text` value itself - a custom
 * text field can hold arbitrary organiser-defined content (dietary notes, etc.), so it gets the
 * same "presence only" treatment `has_query` already gives the main search box below. `select`/
 * `boolean` values are safe to keep verbatim - they can only ever be one of that field's own
 * fixed, non-free-text options. */
type RedactedCustomFieldFilter = {
  source_field: string;
  type: "text" | "select" | "boolean";
  values?: string[];
  has_text?: boolean;
};

export type RedactedAttendeeListFilters = {
  status?: AttendeeListFilterParams["status"];
  ticket_type?: string[] | null;
  rsvp_status?: AttendeeExportRsvpStatus[];
  mail_status?: AttendeeMailStatusFilter[];
  customFields?: RedactedCustomFieldFilter[];
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
    customFields: filters.customFields?.map((field) =>
      field.type === "text"
        ? { source_field: field.source_field, type: field.type, has_text: Boolean(field.text) }
        : { source_field: field.source_field, type: field.type, values: field.values },
    ),
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
