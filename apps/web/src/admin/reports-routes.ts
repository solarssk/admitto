import type { Context } from "hono";
import { EMAIL_DELIVERY_SUCCESS_STATUSES, Prisma } from "@admitto/db";
import type { PrismaClient } from "@admitto/db";
import {
  CUSTOM_FIELD_NOT_ANSWERED_KEY,
  enabledWalletPlatforms,
  type EventCustomFieldReportsResponse,
  type EventWalletReportsResponse,
} from "@admitto/shared";
import { resolvePreviewEventTimeZone } from "@admitto/mail-templates";
import { loadEventTicketTypes, writeBulkActionLog, type TicketTypeInfo } from "@admitto/tickets";
import {
  adminAuditFromContext,
  assertEventManageAccess,
  countAttendeesByCustomFieldValue,
  countAttendeesWithCustomFieldAnswered,
  requireEventId,
  resolveUserDisplayMap,
  type UserDisplayRow,
} from "./admin-helpers.js";
import { sanitizeCsvCell } from "./csv-sanitize.js";
import { attachmentContentDisposition } from "./content-disposition.js";

const HOUR_LABELS = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, "0")}:00`);
const CSV_EXPORT_MAX = 10_000;
const PDF_LOG_MAX = 100;
export const ADMISSION_LOG_LIMIT = 500;
// A backstop against unbounded memory growth on the one query below that pulls whole rows into
// Node to aggregate in JS (platform mix, time-to-tap buckets), set at the same ceiling the
// CSV/XLSX importer already enforces on attendee count (xlsx-to-csv.ts's MAX_IMPORT_ROWS) - since
// a WalletPass is 1:1 with an Attendee, no real event can exceed this many passes anyway. Unlike
// ADMISSION_LOG_LIMIT above (a genuine display truncation - "here are the first N rows"), this
// cap being hit makes the platform/ticket-type/time-to-tap numbers a same-truncated-set-derived
// sample rather than an exact count - not silently, though: EventWalletReportsResponse carries a
// `passes_truncated` flag (computed against an unbounded COUNT of the same rows) so the frontend
// can say so, rather than presenting a sample as if it were the full picture.
const WALLET_AGGREGATE_MAX = 50_000;

export interface EventReportsResponse {
  timezone: string;
  event: {
    id: string;
    title: string;
    date: string;
    capacity: number | null;
  };
  summary: {
    total_attendees: number;
    admitted: number;
    no_shows: number;
    admission_rate_pct: number;
    peak_hour: string | null;
    peak_hour_count: number;
  };
  by_hour: Array<{ hour: string; count: number }>;
  /** Iterates the event's live TicketType catalog (batch 04 / #351) - a configured type with 0
   * attendees still appears, ordered same as the Event Settings tab. A trailing entry with
   * `key: null` covers attendees with no type set. A stored `ticket_type` can still reference no
   * live catalog row - the type was deleted after being assigned (same case AttendeeDetailPage.tsx
   * already surfaces as "(not in catalog)"), or an event's data was seeded/restored outside the
   * write paths that enforce catalog membership - so any remaining unmatched keys get their own
   * trailing entries too (Codex review, batch 04 / #387), instead of silently vanishing from the
   * breakdown while still counting in `summary` and the admission log. */
  by_ticket_type: Array<{
    key: string | null;
    type: string;
    color: string;
    total: number;
    admitted: number;
    admission_pct: number;
  }>;
  admission_log: Array<{
    attendee_id: string;
    name: string;
    email: string;
    ticket_type: string | null;
    admitted_at: string;
    /** Attendee.admitted_by, resolved - null covers the legacy/emergency bearer check-in path
     * (no authenticated session) or a row written outside the normal admit write path. */
    operator_user_id: string | null;
    operator_display_name: string | null;
    operator_email: string | null;
    /** Session.device_label at check-in time - secondary to operator_*, since it's a
     * self-declared, optional session attribute (an admin-role check-in never sets one -
     * DeviceLabelStep only gates the /operator route). */
    device_id: string | null;
    items: string[];
  }>;
  admission_log_truncated: boolean;
  admission_log_total: number;
  /** Only buckets with at least one admitted attendee - the frontend zero-fills the full status
   * set (it already owns the canonical order/labels via RSVP_LABELS) rather than duplicating that
   * list here. */
  by_rsvp_status: Array<{ status: string; count: number }>;
  /** Only "scan"/"manual" - the only two check-in sources that represent an actual admission
   * method (mirrors the same filter loadDeviceIdsByAttendee already uses); "undo"/"admin_revoke"
   * are lifecycle events, not admission methods. */
  by_checkin_method: Array<{ method: string; count: number }>;
  /** Admissions per operator, resolved from Attendee.admitted_by - grouped directly off Attendee
   * (not CheckIn), so unlike the breakdown above it needs no per-attendee dedup: admitted_at/
   * admitted_by are already the single current-admission pair, set atomically together in
   * admit.ts and cleared atomically together in undo.ts. `operator_user_id: null` covers the
   * same legacy/emergency bearer path as the admission log field above. */
  by_operator: Array<{
    operator_user_id: string | null;
    operator_display_name: string | null;
    operator_email: string | null;
    count: number;
  }>;
}

/** Display label for a raw ticket_type key/null in server-rendered CSV/PDF exports (the admin
 * SPA instead renders a colored TicketTypeBadge via the catalog it already has). */
function resolveTicketTypeLabel(catalog: TicketTypeInfo[], key: string | null): string {
  if (!key) return "(none)";
  return catalog.find((t) => t.key === key)?.label ?? key;
}

/** Display label for a resolved operator in server-rendered CSV/PDF exports (the admin SPA
 * instead composes its own label client-side from the raw operator_* fields it already has) -
 * mirrors resolveTicketTypeLabel above for the same reason. */
function resolveOperatorLabel(fields: OperatorFields): string {
  if (!fields.operator_user_id) return "(No operator)";
  return fields.operator_display_name ?? fields.operator_email ?? "Deleted user";
}

/** Same label as resolveOperatorLabel, plus the device label in parentheses when present - PDF
 * is a print/share visual artifact matching the on-screen table's merged presentation, unlike
 * CSV which keeps operator and device as separate raw-data columns. */
function resolveCheckedInByLabel(row: {
  operator_user_id: string | null;
  operator_display_name: string | null;
  operator_email: string | null;
  device_id: string | null;
}): string {
  const operator = resolveOperatorLabel(row);
  return row.device_id ? `${operator} (${row.device_id})` : operator;
}

function oneDecimalPct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

/** Keyed by the raw ticket_type column value (catalog key, or null for "no type set") - not a
 * display label, so the caller can match counts against catalog entries in order. */
function mergeTicketTypeCounts(
  rows: Array<{ ticket_type: string | null; _count: { _all: number } }>,
): Map<string | null, number> {
  const map = new Map<string | null, number>();
  for (const row of rows) {
    map.set(row.ticket_type, (map.get(row.ticket_type) ?? 0) + row._count._all);
  }
  return map;
}

function buildByHour(raw: Array<{ hour: string; count: bigint | number }>): EventReportsResponse["by_hour"] {
  const counts = new Map(raw.map((row) => [row.hour, Number(row.count)]));
  return HOUR_LABELS.map((hour) => ({ hour, count: counts.get(hour) ?? 0 }));
}

function resolvePeakHour(byHour: EventReportsResponse["by_hour"], admittedCount: number): {
  peak_hour: string | null;
  peak_hour_count: number;
} {
  if (admittedCount === 0) {
    return { peak_hour: null, peak_hour_count: 0 };
  }
  let peakHour = byHour[0]!.hour;
  let peakCount = 0;
  for (const row of byHour) {
    if (row.count > peakCount) {
      peakCount = row.count;
      peakHour = row.hour;
    }
  }
  return { peak_hour: peakHour, peak_hour_count: peakCount };
}

async function loadDeviceIdsByAttendee(
  db: PrismaClient,
  eventId: string,
  attendeeIds: string[],
): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  if (attendeeIds.length === 0) return map;

  // Newest first: a revoke leaves the attendee's original VALID row untouched (undo.ts only
  // inserts a separate UNDO row) and a re-admission sets admitted_at to the new time, so the
  // *latest* VALID row is the one that actually matches what "Admitted at" shows for a
  // re-admitted attendee - not the first one they ever scanned in on (CodeRabbit review).
  const checkIns = await db.checkIn.findMany({
    where: {
      event_id: eventId,
      attendee_id: { in: attendeeIds },
      status: "VALID",
      source: { in: ["scan", "manual"] },
    },
    orderBy: [{ checked_in_at: "desc" }, { id: "desc" }],
    select: { attendee_id: true, device_id: true, session_id: true },
  });

  // A superadmin's later device-label correction (SessionsPanel) should retroactively apply
  // here too (CodeRabbit review) - device_id is the frozen snapshot taken at check-in time,
  // but session_id (added after that snapshot existed, so null on older rows) lets a still-live
  // session's *current* device_label win instead. Falls back to the snapshot when there's no
  // session_id at all (the legacy/emergency-bearer path) or the session has since been purged
  // (short post-event retention, AGENTS.md) - a stale snapshot beats showing nothing.
  const sessionIds = [
    ...new Set(checkIns.map((row) => row.session_id).filter((id): id is string => id != null)),
  ];
  const sessions =
    sessionIds.length > 0
      ? await db.session.findMany({
          where: { id: { in: sessionIds } },
          select: { id: true, device_label: true },
        })
      : [];
  const labelBySessionId = new Map(sessions.map((s) => [s.id, s.device_label]));

  for (const row of checkIns) {
    if (!map.has(row.attendee_id)) {
      const session = row.session_id ? labelBySessionId.get(row.session_id) : undefined;
      map.set(row.attendee_id, session !== undefined ? session : row.device_id);
    }
  }
  return map;
}

/** Items currently in the attendee's hands - "issued" only, not "pending" (never handed out) or
 * "returned" (handed back). Ordered by the event's item key, same order as the Requirements tab. */
async function loadIssuedItemLabelsByAttendee(
  db: PrismaClient,
  eventId: string,
  attendeeIds: string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (attendeeIds.length === 0) return map;

  const states = await db.attendeeItemState.findMany({
    where: {
      attendee_id: { in: attendeeIds },
      state: "issued",
      event_item: { event_id: eventId },
    },
    orderBy: { event_item: { key: "asc" } },
    select: { attendee_id: true, event_item: { select: { label: true } } },
  });

  for (const row of states) {
    const labels = map.get(row.attendee_id) ?? [];
    labels.push(row.event_item.label);
    map.set(row.attendee_id, labels);
  }
  return map;
}

type AdmittedRow = {
  id: string;
  name: string;
  email: string;
  ticket_type: string | null;
  admitted_at: Date;
  admitted_by: string | null;
};

type OperatorFields = {
  operator_user_id: string | null;
  operator_display_name: string | null;
  operator_email: string | null;
};

/** Resolve a raw Attendee.admitted_by id against a batch-fetched user map - null stays null (no
 * operator, not a lookup miss); a non-null id absent from the map means the user was since
 * deleted. Both cases leave display_name/email null in the JSON response - callers distinguish
 * "no operator" (operator_user_id null) from "deleted user" (operator_user_id set, nothing
 * resolved) themselves; resolveOperatorLabel collapses both to their own string for CSV/PDF. */
function resolveOperatorFields(
  admittedBy: string | null,
  displayMap: Record<string, UserDisplayRow>,
): OperatorFields {
  if (!admittedBy) {
    return { operator_user_id: null, operator_display_name: null, operator_email: null };
  }
  const user = displayMap[admittedBy];
  return {
    operator_user_id: admittedBy,
    operator_display_name: user?.display_name ?? null,
    operator_email: user?.email ?? null,
  };
}

/** Ranked by count descending; ties broken by the resolved display label ascending - the
 * "no operator" null bucket sorts last on a tie, same convention the retired by_device
 * breakdown used for its unlabeled-device bucket. Exported and unit-testable directly (rather
 * than only through the full DB+HTTP integration path) because the two null-bucket branches
 * are each other's mirror image: whichever side of a comparator call a real, unordered `groupBy`
 * row happens to land on, the other can only be forced by picking the pre-sort array order
 * directly, which a real query can't guarantee. */
export function compareByOperatorRow(
  a: OperatorFields & { count: number },
  b: OperatorFields & { count: number },
): number {
  if (b.count !== a.count) return b.count - a.count;
  if (a.operator_user_id === null) return 1;
  if (b.operator_user_id === null) return -1;
  const labelA = a.operator_display_name ?? a.operator_email ?? "";
  const labelB = b.operator_display_name ?? b.operator_email ?? "";
  return labelA.localeCompare(labelB);
}

function mapAdmissionLogRow(
  row: AdmittedRow,
  operatorDisplayMap: Record<string, UserDisplayRow>,
  deviceByAttendee: Map<string, string | null>,
  itemsByAttendee: Map<string, string[]>,
): EventReportsResponse["admission_log"][number] {
  return {
    attendee_id: row.id,
    name: row.name,
    email: row.email,
    ticket_type: row.ticket_type,
    admitted_at: row.admitted_at.toISOString(),
    ...resolveOperatorFields(row.admitted_by, operatorDisplayMap),
    device_id: deviceByAttendee.get(row.id) ?? null,
    items: itemsByAttendee.get(row.id) ?? [],
  };
}

async function loadReportsAggregates(
  db: PrismaClient,
  eventId: string,
  logLimit: number,
  timeZone: string,
): Promise<{
  totalAttendees: number;
  admittedCount: number;
  byHour: EventReportsResponse["by_hour"];
  by_ticket_type: EventReportsResponse["by_ticket_type"];
  admission_log: EventReportsResponse["admission_log"];
  peak_hour: string | null;
  peak_hour_count: number;
  ticketTypeCatalog: TicketTypeInfo[];
  by_rsvp_status: EventReportsResponse["by_rsvp_status"];
  by_checkin_method: EventReportsResponse["by_checkin_method"];
  by_operator: EventReportsResponse["by_operator"];
}> {
  const [
    totalAttendees,
    admittedCount,
    byHourRaw,
    byTypeTotal,
    byTypeAdmitted,
    logRows,
    catalog,
    byRsvpStatusRaw,
    validCheckIns,
    byOperatorRaw,
  ] = await Promise.all([
      db.attendee.count({ where: { event_id: eventId } }),
      db.attendee.count({ where: { event_id: eventId, admitted_at: { not: null } } }),
      db.$queryRaw<Array<{ hour: string; count: bigint }>>`
        SELECT
          -- admitted_at is a naive TIMESTAMP storing UTC: the first AT TIME ZONE tags
          -- it as UTC, the second converts to the event timezone. A single AT TIME ZONE
          -- would *interpret* the naive value as event-local and shift every bucket.
          TO_CHAR(DATE_TRUNC('hour', (admitted_at AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone}), 'HH24:00') AS hour,
          COUNT(*)::bigint AS count
        FROM "Attendee"
        WHERE event_id = ${eventId} AND admitted_at IS NOT NULL
        GROUP BY 1
        ORDER BY 1
      `,
      db.attendee.groupBy({
        by: ["ticket_type"],
        where: { event_id: eventId },
        _count: { _all: true },
      }),
      db.attendee.groupBy({
        by: ["ticket_type"],
        where: { event_id: eventId, admitted_at: { not: null } },
        _count: { _all: true },
      }),
      db.attendee.findMany({
        where: { event_id: eventId, admitted_at: { not: null } },
        orderBy: { admitted_at: "asc" },
        take: logLimit,
        select: {
          id: true,
          name: true,
          email: true,
          ticket_type: true,
          admitted_at: true,
          admitted_by: true,
        },
      }),
      loadEventTicketTypes(db, eventId),
      db.attendee.groupBy({
        by: ["rsvp_status"],
        where: { event_id: eventId, admitted_at: { not: null } },
        _count: { _all: true },
      }),
      // attendee.admitted_at: { not: null } excludes an attendee who was admitted and then
      // revoked with no re-admission since - their original VALID row is otherwise still sitting
      // in this table (undo.ts never touches it), which would count them here despite them not
      // counting in summary.admitted at all (CodeRabbit review). Ordered newest-first so the
      // per-attendee dedup below (keep first seen) picks each attendee's *current* admission -
      // same convention as loadDeviceIdsByAttendee, just event-wide instead of scoped to a batch
      // of attendee IDs.
      db.checkIn.findMany({
        where: {
          event_id: eventId,
          status: "VALID",
          source: { in: ["scan", "manual"] },
          attendee: { admitted_at: { not: null } },
        },
        orderBy: [{ checked_in_at: "desc" }, { id: "desc" }],
        select: { attendee_id: true, source: true },
      }),
      // Grouped directly off Attendee (not CheckIn), same shape as by_ticket_type/by_rsvp_status
      // above - admitted_at/admitted_by are already the single current-admission pair (admit.ts
      // sets both atomically, undo.ts clears both atomically), so this needs no per-attendee
      // dedup the way the CheckIn-sourced breakdowns above do. orderBy makes the groupBy's own
      // row order deterministic - the .sort() below already fully orders the response, but
      // without this a fully tied pair (same count AND same resolved label) would otherwise come
      // back in whatever arbitrary order the query planner happened to produce that run.
      db.attendee.groupBy({
        by: ["admitted_by"],
        where: { event_id: eventId, admitted_at: { not: null } },
        _count: { _all: true },
        orderBy: { admitted_by: { sort: "asc", nulls: "first" } },
      }),
    ]);

  const byHour = buildByHour(byHourRaw);
  const { peak_hour, peak_hour_count } = resolvePeakHour(byHour, admittedCount);

  const totalByType = mergeTicketTypeCounts(byTypeTotal);
  const admittedByType = mergeTicketTypeCounts(byTypeAdmitted);

  const by_ticket_type: EventReportsResponse["by_ticket_type"] = catalog.map((t) => {
    const total = totalByType.get(t.key) ?? 0;
    const admitted = admittedByType.get(t.key) ?? 0;
    return { key: t.key, type: t.label, color: t.color, total, admitted, admission_pct: oneDecimalPct(admitted, total) };
  });
  // Every write path that sets ticket_type (create, patch, import, the backfill's blank-value
  // cleanup) normalizes an empty/whitespace submission to null before persisting - resolveTicketTypeLabel
  // (used by CSV/PDF export, above) already treats both the same way. A literal "" could still
  // reach here from data written outside those paths, so it's folded into the same (none) bucket
  // here too, instead of becoming its own confusing "" (not in catalog) entry below.
  const noneTotal = (totalByType.get(null) ?? 0) + (totalByType.get("") ?? 0);
  if (noneTotal > 0) {
    const noneAdmitted = (admittedByType.get(null) ?? 0) + (admittedByType.get("") ?? 0);
    by_ticket_type.push({
      key: null,
      type: "(none)",
      color: "gray",
      total: noneTotal,
      admitted: noneAdmitted,
      admission_pct: oneDecimalPct(noneAdmitted, noneTotal),
    });
  }

  const catalogKeys = new Set(catalog.map((t) => t.key));
  const unmatchedKeys = [...totalByType.keys()]
    .filter((key): key is string => key !== null && key !== "" && !catalogKeys.has(key))
    .sort((a, b) => a.localeCompare(b));
  for (const key of unmatchedKeys) {
    const total = totalByType.get(key) ?? 0;
    const admitted = admittedByType.get(key) ?? 0;
    by_ticket_type.push({
      key,
      type: `${key} (not in catalog)`,
      color: "gray",
      total,
      admitted,
      admission_pct: oneDecimalPct(admitted, total),
    });
  }

  const attendeeIds = logRows.map((row) => row.id);
  const operatorIds = [
    ...new Set(
      [...logRows.map((r) => r.admitted_by), ...byOperatorRaw.map((r) => r.admitted_by)].filter(
        (id): id is string => id != null,
      ),
    ),
  ];
  const [deviceByAttendee, itemsByAttendee, operatorDisplayMap] = await Promise.all([
    loadDeviceIdsByAttendee(db, eventId, attendeeIds),
    loadIssuedItemLabelsByAttendee(db, eventId, attendeeIds),
    resolveUserDisplayMap(db, operatorIds),
  ]);

  const admission_log = logRows.map((row) =>
    mapAdmissionLogRow(row as AdmittedRow, operatorDisplayMap, deviceByAttendee, itemsByAttendee),
  );

  const by_rsvp_status = byRsvpStatusRaw.map((row) => ({
    status: row.rsvp_status,
    count: row._count._all,
  }));
  // Deduped to one row per attendee (keep the earliest VALID check-in) before tallying -
  // grouping the raw rows directly would count every row, not every attendee: a revoke leaves
  // the original VALID row's status untouched (undo.ts only inserts a new UNDO row), so a
  // revoke-then-re-admit cycle leaves 2+ VALID rows for the same attendee, which the old
  // row-based groupBy counted twice, letting these breakdowns' totals exceed admittedCount.
  const seenAttendees = new Set<string>();
  const methodCounts = new Map<string, number>();
  for (const row of validCheckIns) {
    if (seenAttendees.has(row.attendee_id)) continue;
    seenAttendees.add(row.attendee_id);
    if (row.source === "scan" || row.source === "manual") {
      methodCounts.set(row.source, (methodCounts.get(row.source) ?? 0) + 1);
    }
  }
  const by_checkin_method = Array.from(methodCounts, ([method, count]) => ({ method, count }));
  const by_operator: EventReportsResponse["by_operator"] = byOperatorRaw
    .map((row) => ({
      ...resolveOperatorFields(row.admitted_by, operatorDisplayMap),
      count: row._count._all,
    }))
    .sort(compareByOperatorRow);

  return {
    totalAttendees,
    admittedCount,
    byHour,
    by_ticket_type,
    admission_log,
    ticketTypeCatalog: catalog,
    peak_hour,
    peak_hour_count,
    by_rsvp_status,
    by_checkin_method,
    by_operator,
  };
}

type TimeToTapBucketKey = "same_day" | "1_3" | "4_7" | "8_plus";

export function bucketForDays(days: number): TimeToTapBucketKey {
  if (days < 1) return "same_day";
  if (days <= 3) return "1_3";
  if (days <= 7) return "4_7";
  return "8_plus";
}

type RegistrationCountBucketKey = "1" | "2" | "3" | "4_plus";

/** registrationCount is appleActive + googleActive (the same enabledPlatforms-gated values
 * classifyPassPlatform uses), i.e. how many devices/accounts one attendee's one pass is
 * currently active on - never 0 here, since callers only bucket a pass once it's already
 * confirmed (platform !== "none"). */
export function bucketForRegistrationCount(registrationCount: number): RegistrationCountBucketKey {
  if (registrationCount <= 1) return "1";
  if (registrationCount === 2) return "2";
  if (registrationCount === 3) return "3";
  return "4_plus";
}

/** A Date as a YYYY-MM-DD string in the given IANA timezone - sv-SE locale is a well-known trick
 * for getting ISO-ordered digits straight out of Intl.DateTimeFormat (same approach as
 * formatAdmittedAtExport below), without pulling in a date library for one format call. */
function isoDateInZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    date,
  );
}

function addDaysToIsoDate(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + days));
  return dt.toISOString().slice(0, 10);
}

const WALLET_PASS_AGGREGATE_SELECT = {
  issued_at: true,
  first_confirmed_at: true,
  status: true,
  apple_active_registrations: true,
  google_active_registrations: true,
  registration_checked_at: true,
  attendee: {
    select: {
      ticket_type: true,
      // Every non-bounced TICKET delivery across initial and resend attempts, not just "initial"
      // (a "purpose: initial" filter would keep pointing at one that later hard-bounced -
      // applyBounceResult retains its sent_at, only status flips to "bounced" - overstating tap
      // time against a since-successful resend). No orderBy/take here (unlike a plain "earliest
      // sent_at" query) - see earliestDeliverySuccessAt's own comment for why: status "accepted"
      // is this codebase's only real terminal-success state today (no mailer adapter ever reports
      // "sent"), and ordering by a column that's always null would silently drop every real send.
      // template_id: null OR template.name === "ticket" scopes this to genuine ticket-email sends
      // only - without it, a Communication campaign send using a different template is recorded
      // with purpose "resend" too (resolveNoDeliveryScopeAndPurpose, bulk-send-routes.ts), so an
      // attendee who received a reminder/announcement before ever getting a ticket would have that
      // unrelated email's timestamp picked up here instead (bot review on this PR). Every genuine
      // ticket send resolves to either no custom template (template_id null, the compiled builtin)
      // or a MailTemplate row named "ticket" (resolveTemplateForEvent, mail-templates package) -
      // never any other name - so this mirrors that resolution rather than inventing a new rule.
      email_deliveries: {
        where: {
          status: { in: [...EMAIL_DELIVERY_SUCCESS_STATUSES] as string[] },
          OR: [{ template_id: null }, { template: { name: "ticket" } }] as Prisma.EmailDeliveryWhereInput[],
        },
        select: { accepted_at: true, sent_at: true, delivered_at: true },
      },
    },
  },
} as const;

type WalletPassAggregateRow = Prisma.WalletPassGetPayload<{ select: typeof WALLET_PASS_AGGREGATE_SELECT }>;

/** Earliest moment any of an attendee's non-bounced ticket-email deliveries left our system,
 * across every delivery attempt - the anchor for "time to wallet tap" and the wallet export's
 * "Ticket email first sent at" column. Reads accepted_at ahead of sent_at/delivered_at because
 * "accepted" is the only status any configured mailer adapter (graph/smtp/mock/exportOnly/
 * powerAutomate - see mapSendResult.ts) ever actually reports; sent_at/delivered_at exist in the
 * schema for a future webhook-driven pipeline stage and are read here too so this doesn't need to
 * change again once one exists. Within one delivery the three are chronologically ordered
 * (accepted -> sent -> delivered), so the first non-null of the three is that delivery's own
 * earliest known milestone; the overall result is the minimum of that across every delivery. */
export function earliestDeliverySuccessAt(
  deliveries: ReadonlyArray<{ accepted_at: Date | null; sent_at: Date | null; delivered_at: Date | null }>,
): Date | null {
  let earliest: Date | null = null;
  for (const delivery of deliveries) {
    const at = delivery.accepted_at ?? delivery.sent_at ?? delivery.delivered_at;
    if (at && (!earliest || at < earliest)) earliest = at;
  }
  return earliest;
}

/** Which wallet platform(s) a pass is actively registered on - "none" covers issued-but-never-
 * installed passes, kept distinct from "both" (registered on two devices) for the platform mix
 * breakdown below. */
export function classifyPassPlatform(
  appleActive: number,
  googleActive: number,
): "apple_only" | "google_only" | "both" | "none" {
  if (appleActive > 0 && googleActive > 0) return "both";
  if (appleActive > 0) return "apple_only";
  if (googleActive > 0) return "google_only";
  return "none";
}

/** Display label for classifyPassPlatform's result - used by the wallets CSV export's "Confirmed
 * platform" column. */
export function confirmedPlatformLabel(appleActive: number, googleActive: number): string {
  switch (classifyPassPlatform(appleActive, googleActive)) {
    case "both":
      return "Both";
    case "apple_only":
      return "Apple";
    case "google_only":
      return "Google";
    default:
      return "None";
  }
}

/** Whole days between the attendee's first ticket-link email and this pass actually being
 * confirmed installed on a wallet app (WalletPass.first_confirmed_at, stamped from PassCreator's
 * `first_pushnotification_registered` webhook - see applyFirstConfirmedAt), or null when either
 * timestamp is missing (most passes issued before this column existed, until the one-time
 * backfill and/or a later re-confirmation fill it in) or the pass was somehow confirmed before
 * that email was sent (skipped rather than counted as negative "time to tap"). Was `issued_at`
 * (first Add to Wallet tap) before - that measured engagement latency, not actual install; PO
 * decided the confirmed timestamp answers the question this card is meant to answer. */
export function computeTapDays(sentAt: Date | null | undefined, confirmedAt: Date | null): number | null {
  if (!sentAt || !confirmedAt) return null;
  const diffDays = (confirmedAt.getTime() - sentAt.getTime()) / 86_400_000;
  return diffDays >= 0 ? diffDays : null;
}

interface WalletPassAggregates {
  confirmed: number;
  appleOnly: number;
  googleOnly: number;
  both: number;
  mostRecentSync: Date | null;
  gotPassByType: Map<string | null, number>;
  confirmedByType: Map<string | null, number>;
  bucketCounts: Record<TimeToTapBucketKey, number>;
  tapDaySum: number;
  tapDayCount: number;
  registrationCountBuckets: Record<RegistrationCountBucketKey, number>;
}

/** Folds one pass's contribution into the running aggregates - split out of aggregateWalletPasses'
 * loop body below so that function's own cognitive complexity stays under Sonar's limit (every
 * branch here loses a nesting level once it's no longer inside a for loop). `enabledPlatforms`
 * zeroes a disabled platform's active-registration count before classification, so a pass
 * registered only on a platform the event owner has since turned off reads as "not installed"
 * here (and in adoption.confirmed) rather than as a still-live confirmation of a platform the
 * Wallets tab no longer offers. */
function applyWalletPassToAggregates(
  pass: WalletPassAggregateRow,
  enabledPlatforms: { apple: boolean; google: boolean },
  acc: WalletPassAggregates,
): void {
  const appleActive = enabledPlatforms.apple ? (pass.apple_active_registrations ?? 0) : 0;
  const googleActive = enabledPlatforms.google ? (pass.google_active_registrations ?? 0) : 0;
  const platform = classifyPassPlatform(appleActive, googleActive);
  if (platform === "both") acc.both++;
  else if (platform === "apple_only") acc.appleOnly++;
  else if (platform === "google_only") acc.googleOnly++;
  if (platform !== "none") {
    acc.confirmed++;
    acc.registrationCountBuckets[bucketForRegistrationCount(appleActive + googleActive)]++;
  }
  if (pass.registration_checked_at && (!acc.mostRecentSync || pass.registration_checked_at > acc.mostRecentSync)) {
    acc.mostRecentSync = pass.registration_checked_at;
  }

  const typeKey = pass.attendee.ticket_type;
  acc.gotPassByType.set(typeKey, (acc.gotPassByType.get(typeKey) ?? 0) + 1);
  if (platform !== "none") acc.confirmedByType.set(typeKey, (acc.confirmedByType.get(typeKey) ?? 0) + 1);

  // Gated on platform !== "none" (the same post-enabledPlatforms confirmed check as
  // confirmed/confirmedByType above), not just first_confirmed_at being set: a pass historically
  // confirmed on a platform the event has since disabled keeps its first_confirmed_at (it really
  // did happen), but must not count toward "Time to wallet install" while adoption.confirmed and
  // every other confirmed-based number in this same report no longer count it either.
  const tapDays =
    platform !== "none" ? computeTapDays(earliestDeliverySuccessAt(pass.attendee.email_deliveries), pass.first_confirmed_at) : null;
  if (tapDays !== null) {
    acc.tapDaySum += tapDays;
    acc.tapDayCount++;
    acc.bucketCounts[bucketForDays(tapDays)]++;
  }
}

/** Single pass over the (possibly sampled - see WALLET_AGGREGATE_MAX) pass rows, building every
 * per-pass-derived number the response needs in one place rather than several separate loops. */
export function aggregateWalletPasses(
  passes: WalletPassAggregateRow[],
  enabledPlatforms: { apple: boolean; google: boolean },
): WalletPassAggregates {
  const acc: WalletPassAggregates = {
    confirmed: 0,
    appleOnly: 0,
    googleOnly: 0,
    both: 0,
    mostRecentSync: null,
    gotPassByType: new Map<string | null, number>(),
    confirmedByType: new Map<string | null, number>(),
    bucketCounts: { same_day: 0, "1_3": 0, "4_7": 0, "8_plus": 0 },
    tapDaySum: 0,
    tapDayCount: 0,
    registrationCountBuckets: { "1": 0, "2": 0, "3": 0, "4_plus": 0 },
  };

  for (const pass of passes) {
    applyWalletPassToAggregates(pass, enabledPlatforms, acc);
  }

  return acc;
}

/** Ticket-type breakdown for the Wallets tab - same catalog-order-plus-fallbacks shape as the
 * admissions report's own by_ticket_type (see EventReportsResponse's doc comment above): a
 * "(none)" bucket for attendees with no type set, and a "(not in catalog)" bucket for stored
 * ticket_type values whose catalog row no longer exists. */
export function buildWalletTicketTypeBreakdown(
  catalog: TicketTypeInfo[],
  totalByType: Map<string | null, number>,
  gotPassByType: Map<string | null, number>,
  confirmedByType: Map<string | null, number>,
): EventWalletReportsResponse["by_ticket_type"] {
  const by_ticket_type: EventWalletReportsResponse["by_ticket_type"] = catalog.map((t) => {
    const total = totalByType.get(t.key) ?? 0;
    const typeGotPass = gotPassByType.get(t.key) ?? 0;
    const typeConfirmed = confirmedByType.get(t.key) ?? 0;
    return {
      key: t.key,
      type: t.label,
      color: t.color,
      total,
      got_pass: typeGotPass,
      pct: oneDecimalPct(typeGotPass, total),
      confirmed: typeConfirmed,
      confirmed_pct: oneDecimalPct(typeConfirmed, total),
    };
  });

  const noneTotal = (totalByType.get(null) ?? 0) + (totalByType.get("") ?? 0);
  if (noneTotal > 0) {
    const noneGotPass = (gotPassByType.get(null) ?? 0) + (gotPassByType.get("") ?? 0);
    const noneConfirmed = (confirmedByType.get(null) ?? 0) + (confirmedByType.get("") ?? 0);
    by_ticket_type.push({
      key: null,
      type: "(none)",
      color: "gray",
      total: noneTotal,
      got_pass: noneGotPass,
      pct: oneDecimalPct(noneGotPass, noneTotal),
      confirmed: noneConfirmed,
      confirmed_pct: oneDecimalPct(noneConfirmed, noneTotal),
    });
  }

  const catalogKeys = new Set(catalog.map((t) => t.key));
  for (const [key, total] of totalByType) {
    if (key === null || key === "" || catalogKeys.has(key)) continue;
    const typeGotPass = gotPassByType.get(key) ?? 0;
    const typeConfirmed = confirmedByType.get(key) ?? 0;
    by_ticket_type.push({
      key,
      type: "(not in catalog)",
      color: "gray",
      total,
      got_pass: typeGotPass,
      pct: oneDecimalPct(typeGotPass, total),
      confirmed: typeConfirmed,
      confirmed_pct: oneDecimalPct(typeConfirmed, total),
    });
  }

  return by_ticket_type;
}

/** Per-day counts in the event's own timezone, ascending, with a running total, zero-filled
 * through today (or the event date, whichever is earlier) so the chart reads as "flat since the
 * last real day" instead of just stopping there - capped at the event date so a long-past event
 * doesn't grow a trailing flat line for every day since. */
function buildIssuedByDay(
  issuedByDayRaw: Array<{ day: string; count: bigint }>,
  timeZone: string,
  eventDate: Date,
): EventWalletReportsResponse["issued_by_day"] {
  let cumulative = 0;
  const issued_by_day = issuedByDayRaw.map((row) => {
    cumulative += Number(row.count);
    return { date: row.day, count: Number(row.count), cumulative };
  });

  if (issued_by_day.length > 0) {
    const lastRealDay = issued_by_day.at(-1)!.date;
    const todayIso = isoDateInZone(new Date(), timeZone);
    const eventDateIso = isoDateInZone(eventDate, timeZone);
    const capIso = eventDateIso < todayIso ? eventDateIso : todayIso;
    let cursor = lastRealDay;
    while (cursor < capIso) {
      cursor = addDaysToIsoDate(cursor, 1);
      issued_by_day.push({ date: cursor, count: 0, cumulative });
    }
  }

  return issued_by_day;
}

async function loadWalletReportsAggregates(
  db: PrismaClient,
  eventId: string,
  timeZone: string,
  eventDate: Date,
  enabledPlatforms: { apple: boolean; google: boolean },
): Promise<EventWalletReportsResponse> {
  // "Confirmed" (active on at least one platform the event still offers), not merely issued - see
  // EventWalletReportsResponse.admission_by_wallet's own doc comment for why. Built once and
  // spread/negated below so the with/without-wallet split can't drift out of sync with itself.
  // Only checks a platform's registrations when the event still offers it, matching
  // aggregateWalletPasses above - a stale registration on a platform since disabled would
  // otherwise still count toward "with wallet" here while reading as not installed everywhere
  // else on this page (CodeRabbit review). `id: { in: [] }` (rather than a bare `OR: []`, whose
  // match-everything-or-nothing behavior isn't something to rely on) is the "matches nothing"
  // fallback for the case where neither platform is enabled.
  const confirmedWalletConditions = [
    ...(enabledPlatforms.apple ? [{ wallet_pass: { apple_active_registrations: { gt: 0 } } }] : []),
    ...(enabledPlatforms.google ? [{ wallet_pass: { google_active_registrations: { gt: 0 } } }] : []),
  ];
  const confirmedWalletFilter =
    confirmedWalletConditions.length > 0 ? { OR: confirmedWalletConditions } : { id: { in: [] as string[] } };

  const [
    totalAttendees,
    totalPassCount,
    passes,
    byTypeTotalRaw,
    catalog,
    issuedByDayRaw,
    withWalletTotal,
    withWalletAdmitted,
    withoutWalletTotal,
    withoutWalletAdmitted,
  ] = await Promise.all([
    db.attendee.count({ where: { event_id: eventId } }),
    // Unbounded, unlike the findMany below - a plain COUNT never has to hold rows in memory, so
    // it stays cheap and accurate at any scale and doubles as truncation detection for `passes`.
    db.walletPass.count({ where: { attendee: { event_id: eventId }, issued_at: { not: null } } }),
    db.walletPass.findMany({
      where: { attendee: { event_id: eventId }, issued_at: { not: null } },
      take: WALLET_AGGREGATE_MAX,
      select: WALLET_PASS_AGGREGATE_SELECT,
    }),
    db.attendee.groupBy({
      by: ["ticket_type"],
      where: { event_id: eventId },
      _count: { _all: true },
    }),
    loadEventTicketTypes(db, eventId),
    db.$queryRaw<Array<{ day: string; count: bigint }>>`
      SELECT
        TO_CHAR(DATE_TRUNC('day', (wp.issued_at AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone}), 'YYYY-MM-DD') AS day,
        COUNT(*)::bigint AS count
      FROM "WalletPass" wp
      JOIN "Attendee" a ON a.id = wp.attendee_id
      WHERE a.event_id = ${eventId} AND wp.issued_at IS NOT NULL
      GROUP BY 1
      ORDER BY 1
    `,
    db.attendee.count({ where: { event_id: eventId, ...confirmedWalletFilter } }),
    db.attendee.count({
      where: { event_id: eventId, admitted_at: { not: null }, ...confirmedWalletFilter },
    }),
    db.attendee.count({ where: { event_id: eventId, NOT: confirmedWalletFilter } }),
    db.attendee.count({
      where: { event_id: eventId, admitted_at: { not: null }, NOT: confirmedWalletFilter },
    }),
  ]);

  const {
    confirmed,
    appleOnly,
    googleOnly,
    both,
    mostRecentSync,
    gotPassByType,
    confirmedByType,
    bucketCounts,
    tapDaySum,
    tapDayCount,
    registrationCountBuckets,
  } = aggregateWalletPasses(passes, enabledPlatforms);

  const gotPass = passes.length;
  const totalByType = mergeTicketTypeCounts(byTypeTotalRaw);
  const by_ticket_type = buildWalletTicketTypeBreakdown(catalog, totalByType, gotPassByType, confirmedByType);
  const issued_by_day = buildIssuedByDay(issuedByDayRaw, timeZone, eventDate);

  const bucketOrder: TimeToTapBucketKey[] = ["same_day", "1_3", "4_7", "8_plus"];
  const buckets = bucketOrder.map((key) => ({
    key,
    count: bucketCounts[key],
    pct: oneDecimalPct(bucketCounts[key], tapDayCount),
  }));

  const registrationCountBucketOrder: RegistrationCountBucketKey[] = ["1", "2", "3", "4_plus"];
  const registrationCountBucketsList = registrationCountBucketOrder.map((key) => ({
    key,
    count: registrationCountBuckets[key],
    pct: oneDecimalPct(registrationCountBuckets[key], confirmed),
  }));

  return {
    total_attendees: totalAttendees,
    synced_at: mostRecentSync ? mostRecentSync.toISOString() : null,
    passes_truncated: totalPassCount > passes.length,
    adoption: {
      got_pass: gotPass,
      got_pass_pct: oneDecimalPct(gotPass, totalAttendees),
      confirmed,
      confirmed_pct: oneDecimalPct(confirmed, gotPass),
    },
    platform: {
      apple_only: appleOnly,
      google_only: googleOnly,
      both,
    },
    registrations_per_attendee: {
      buckets: registrationCountBucketsList,
    },
    by_ticket_type,
    issued_by_day,
    time_to_wallet_tap: {
      average_days: tapDayCount > 0 ? Math.round((tapDaySum / tapDayCount) * 10) / 10 : null,
      buckets,
    },
    admission_by_wallet: {
      with_wallet: {
        total: withWalletTotal,
        admitted: withWalletAdmitted,
        pct: oneDecimalPct(withWalletAdmitted, withWalletTotal),
      },
      without_wallet: {
        total: withoutWalletTotal,
        admitted: withoutWalletAdmitted,
        pct: oneDecimalPct(withoutWalletAdmitted, withoutWalletTotal),
      },
    },
  };
}

/** GET /api/admin/events/:eventId/reports/wallets — wallet adoption/platform/timing analytics,
 * computed entirely from data already collected (WalletPass, EmailDelivery, Attendee); no new
 * PassCreator API calls. Read-only, no audit, same access gate as the main reports endpoint. */
export async function handleGetWalletReports(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdParam = requireEventId(c);
  if (eventIdParam instanceof Response) return eventIdParam;
  const eventId = eventIdParam;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const event = await db.event.findUnique({
    where: { id: eventId },
    select: {
      timezone: true,
      date: true,
      wallet_enabled: true,
      wallet_apple_enabled: true,
      wallet_google_enabled: true,
      wallet_samsung_enabled: true,
    },
  });
  if (!event) return c.json({ error: "not_found" }, 404);

  const timeZone = resolvePreviewEventTimeZone(event.timezone);
  const platforms = enabledWalletPlatforms(event);
  const body = await loadWalletReportsAggregates(db, eventId, timeZone, event.date, platforms);
  c.header("Cache-Control", "no-store");
  return c.json(body);
}

/** Boolean-type display label for a stored custom_data value - always exactly "true"/"false" by
 * the time it's in the database (normalizeCustomDataFieldValue is the single normalizer behind
 * every write path: the attendee form, the PATCH endpoint, and CSV/XLSX import all route through
 * it), so no alias handling ("yes"/"no"/"1"/"0") is needed here despite the form accepting those
 * as input. */
function booleanValueLabel(value: string): string {
  return value === "true" ? "Yes" : "No";
}

/** One field's `select`/`boolean` category distribution, sorted by count descending with a
 * trailing "not answered" bucket so percentages always sum to 100 (same shape as the other
 * breakdown cards on this page - rsvpBreakdownRows et al on the frontend). A tied count falls
 * back to sorting by the raw value itself, not left to whatever order the GROUP BY below happens
 * to return - Postgres makes no row-order guarantee for a GROUP BY without an ORDER BY, and the
 * frontend assigns both a row's chart position and its color by array index (CodeRabbit review,
 * PR #1185), so an unstable order would visibly reshuffle a tied field between requests. */
async function loadCustomFieldDistribution(
  db: PrismaClient,
  eventId: string,
  field: { source_field: string; type: string },
  totalAttendees: number,
): Promise<EventCustomFieldReportsResponse["fields"][number]["distribution"]> {
  const valueCounts = await countAttendeesByCustomFieldValue(db, eventId, field.source_field);
  const labelFor = field.type === "boolean" ? booleanValueLabel : (value: string) => value;
  const rows = [...valueCounts.entries()]
    .map(([key, count]) => ({ key, label: labelFor(key), count, pct: oneDecimalPct(count, totalAttendees) }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));

  const answered = rows.reduce((sum, row) => sum + row.count, 0);
  const notAnswered = totalAttendees - answered;
  if (notAnswered > 0) {
    rows.push({
      key: CUSTOM_FIELD_NOT_ANSWERED_KEY,
      label: "Not answered",
      count: notAnswered,
      pct: oneDecimalPct(notAnswered, totalAttendees),
    });
  }
  return rows;
}

/** Deliberately generic by `EventCustomField.type` rather than special-cased per field - an
 * admin-defined field's meaning can't be known ahead of time, so the only thing this can key off
 * is its type. `select`/`boolean` chart as a category distribution; `text` is free-form and only
 * gets a fill-rate stat (see EventCustomFieldReportsResponse's own doc comment). */
async function loadCustomFieldReportsAggregates(
  db: PrismaClient,
  eventId: string,
): Promise<EventCustomFieldReportsResponse> {
  const [totalAttendees, customFields] = await Promise.all([
    db.attendee.count({ where: { event_id: eventId } }),
    db.eventCustomField.findMany({
      where: { event_id: eventId },
      // Same order as the Requirements page's own field list (event-custom-fields-routes.ts).
      orderBy: [{ created_at: "asc" }, { id: "asc" }],
    }),
  ]);

  const fields = await Promise.all(
    customFields.map(async (field) => {
      const type = field.type as EventCustomFieldReportsResponse["fields"][number]["type"];
      if (type === "text") {
        const answered = await countAttendeesWithCustomFieldAnswered(db, eventId, field.source_field);
        return {
          id: field.id,
          source_field: field.source_field,
          label: field.label,
          description: field.description,
          type,
          distribution: null,
          response_rate: { answered, pct: oneDecimalPct(answered, totalAttendees) },
        };
      }
      return {
        id: field.id,
        source_field: field.source_field,
        label: field.label,
        description: field.description,
        type,
        distribution: await loadCustomFieldDistribution(db, eventId, field, totalAttendees),
        response_rate: null,
      };
    }),
  );

  return { total_attendees: totalAttendees, fields };
}

/** GET /api/admin/events/:eventId/reports/custom-fields - one chart/stat per the event's own
 * EventCustomField registry. Read-only, no audit, same access gate as the other reports
 * endpoints. */
export async function handleGetCustomFieldReports(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdParam = requireEventId(c);
  if (eventIdParam instanceof Response) return eventIdParam;
  const eventId = eventIdParam;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const body = await loadCustomFieldReportsAggregates(db, eventId);
  c.header("Cache-Control", "no-store");
  return c.json(body);
}

/** Security headers for printable HTML report export (inline styles only; no scripts). */
export function getPrintableReportSecurityHeaders(): Record<string, string> {
  return {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Pragma": "no-cache",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy":
      "default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'none'",
  };
}

/** Shared by every printable HTML report export (admissions, wallets, ...) - the page chrome
 * (print hint, title, stats grid, table styling) is identical across report types; only the
 * event title/meta line, the stat tiles, and the per-report table sections differ. */
const PRINTABLE_REPORT_STYLE = `
    body { font-family: system-ui, sans-serif; margin: 2rem; color: #111; }
    h1 { margin-bottom: 0.25rem; }
    .meta { color: #555; margin-bottom: 1.5rem; }
    .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; margin-bottom: 2rem; }
    .stat { border: 1px solid #ddd; border-radius: 8px; padding: 1rem; }
    .stat strong { display: block; font-size: 1.5rem; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 2rem; font-size: 0.875rem; }
    th, td { border: 1px solid #ddd; padding: 0.5rem; text-align: left; }
    th { background: #f5f5f5; }
    .print-hint { background: #fff8e6; border: 1px solid #f0d78c; padding: 0.75rem 1rem; border-radius: 6px; margin-bottom: 1.5rem; }
    @media print {
      .print-hint, .no-print { display: none; }
      body { margin: 0.5in; }
    }`;

function renderPrintableReportHtml(opts: {
  titleSuffix: string;
  eventTitle: string;
  metaLine: string;
  statsHtml: string;
  sectionsHtml: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(opts.eventTitle)} - ${escapeHtml(opts.titleSuffix)}</title>
  <style>${PRINTABLE_REPORT_STYLE}
  </style>
</head>
<body>
  <p class="print-hint no-print">Use your browser&rsquo;s <strong>Print</strong> dialog and choose &ldquo;Save as PDF&rdquo; to export this report.</p>
  <h1>${escapeHtml(opts.eventTitle)}</h1>
  <p class="meta">${opts.metaLine}</p>
  <div class="stats">
    ${opts.statsHtml}
  </div>
  ${opts.sectionsHtml}
</body>
</html>`;
}

/** Format admitted_at for CSV/PDF export in the event timezone (YYYY-MM-DD HH:mm). */
function formatAdmittedAtExport(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(date)
    .replace(",", "");
}

function quoteCsvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Append bulk audit row after a successful reports export (CSV or printable HTML). */
async function auditReportsExported(
  db: PrismaClient,
  c: Context,
  eventId: string,
  format: "csv" | "pdf",
  count: number,
  truncated: boolean,
  report: "admissions" | "wallets" = "admissions",
): Promise<void> {
  await db.$transaction(async (tx) => {
    await writeBulkActionLog(tx, {
      event_id: eventId,
      action_type: "reports_exported",
      audit: adminAuditFromContext(c),
      metadata: { format, report, count, truncated },
    });
  });
}

/** GET /api/admin/events/:eventId/reports — aggregated admission stats (read-only, no audit). */
export async function handleGetReports(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdParam = requireEventId(c);
  if (eventIdParam instanceof Response) return eventIdParam;
  const eventId = eventIdParam;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const event = await db.event.findUnique({
    where: { id: eventId },
    select: { id: true, title: true, date: true, capacity: true, timezone: true },
  });
  if (!event) return c.json({ error: "not_found" }, 404);

  const timeZone = resolvePreviewEventTimeZone(event.timezone);
  const aggregates = await loadReportsAggregates(db, eventId, ADMISSION_LOG_LIMIT, timeZone);

  const body: EventReportsResponse = {
    timezone: timeZone,
    event: {
      id: event.id,
      title: event.title,
      date: event.date.toISOString(),
      capacity: event.capacity,
    },
    summary: {
      total_attendees: aggregates.totalAttendees,
      admitted: aggregates.admittedCount,
      no_shows: aggregates.totalAttendees - aggregates.admittedCount,
      admission_rate_pct: oneDecimalPct(aggregates.admittedCount, aggregates.totalAttendees),
      peak_hour: aggregates.peak_hour,
      peak_hour_count: aggregates.peak_hour_count,
    },
    by_hour: aggregates.byHour,
    by_ticket_type: aggregates.by_ticket_type,
    admission_log: aggregates.admission_log,
    admission_log_truncated: aggregates.admittedCount > ADMISSION_LOG_LIMIT,
    admission_log_total: aggregates.admittedCount,
    by_rsvp_status: aggregates.by_rsvp_status,
    by_checkin_method: aggregates.by_checkin_method,
    by_operator: aggregates.by_operator,
  };

  c.header("Cache-Control", "no-store");
  return c.json(body);
}

/** GET .../reports/export?format=csv&report=admissions — one row per admitted attendee. */
async function exportAdmissionsReportsCsv(
  db: PrismaClient,
  c: Context,
  eventId: string,
  event: { slug: string },
  timeZone: string,
  dateStamp: string,
): Promise<Response> {
  const [totalAdmitted, rows, catalog] = await Promise.all([
    db.attendee.count({ where: { event_id: eventId, admitted_at: { not: null } } }),
    db.attendee.findMany({
      where: { event_id: eventId, admitted_at: { not: null } },
      orderBy: { admitted_at: "asc" },
      take: CSV_EXPORT_MAX,
      select: {
        id: true,
        name: true,
        email: true,
        ticket_type: true,
        admitted_at: true,
        admitted_by: true,
      },
    }),
    loadEventTicketTypes(db, eventId),
  ]);

  const truncated = totalAdmitted > CSV_EXPORT_MAX;

  const attendeeIds = rows.map((row) => row.id);
  const operatorIds = [
    ...new Set(rows.map((r) => r.admitted_by).filter((id): id is string => id != null)),
  ];
  const [deviceByAttendee, itemsByAttendee, operatorDisplayMap] = await Promise.all([
    loadDeviceIdsByAttendee(db, eventId, attendeeIds),
    loadIssuedItemLabelsByAttendee(db, eventId, attendeeIds),
    resolveUserDisplayMap(db, operatorIds),
  ]);

  const admittedAtHeader = `Admitted at (${timeZone})`;
  const header = ["Name", "Email", "Ticket type", admittedAtHeader, "Checked in by", "Device", "Items"]
    .map((col) => quoteCsvCell(col))
    .join(",");
  const dataRows = rows.map((row) =>
    [
      row.name,
      row.email,
      resolveTicketTypeLabel(catalog, row.ticket_type),
      formatAdmittedAtExport(row.admitted_at!, timeZone),
      resolveOperatorLabel(resolveOperatorFields(row.admitted_by, operatorDisplayMap)),
      deviceByAttendee.get(row.id) ?? "",
      (itemsByAttendee.get(row.id) ?? []).join(", "),
    ]
      .map((cell) => quoteCsvCell(sanitizeCsvCell(String(cell))))
      .join(","),
  );

  const truncationNotice = truncated
    ? [
        quoteCsvCell(
          sanitizeCsvCell(
            `Export truncated: first ${CSV_EXPORT_MAX} of ${totalAdmitted} admissions.`,
          ),
        ),
        quoteCsvCell(""),
        quoteCsvCell(""),
        quoteCsvCell(""),
        quoteCsvCell(""),
        quoteCsvCell(""),
        quoteCsvCell(""),
      ].join(",")
    : null;

  const csvBody = [header, ...(truncationNotice ? [truncationNotice] : []), ...dataRows].join(
    "\r\n",
  );
  const bom = "﻿";
  const filename = `admissions-${event.slug}-${dateStamp}.csv`;

  await auditReportsExported(db, c, eventId, "csv", rows.length, truncated);

  return new Response(bom + csvBody, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": attachmentContentDisposition(filename),
      "Cache-Control": "no-store",
      "Pragma": "no-cache",
      "X-Content-Type-Options": "nosniff",
      "X-Admission-Log-Total": String(totalAdmitted),
      "X-Admission-Log-Truncated": String(truncated),
    },
  });
}

/** GET .../reports/export?format=pdf&report=admissions — printable summary. */
async function exportAdmissionsReportsPdf(
  db: PrismaClient,
  c: Context,
  eventId: string,
  event: { title: string; date: Date },
  timeZone: string,
): Promise<Response> {
  const aggregates = await loadReportsAggregates(db, eventId, PDF_LOG_MAX, timeZone);
  const eventDate = event.date.toISOString().slice(0, 10);

  const typeRows = aggregates.by_ticket_type
    .map(
      (t) =>
        `<tr><td>${escapeHtml(t.type)}</td><td>${t.admitted}</td><td>${t.total}</td><td>${t.admission_pct}%</td></tr>`,
    )
    .join("");

  const logRows = aggregates.admission_log
    .map(
      (r) =>
        `<tr><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.email)}</td><td>${escapeHtml(resolveTicketTypeLabel(aggregates.ticketTypeCatalog, r.ticket_type))}</td><td>${escapeHtml(formatAdmittedAtExport(new Date(r.admitted_at), timeZone))}</td><td>${escapeHtml(resolveCheckedInByLabel(r))}</td><td>${escapeHtml(r.items.join(", ") || "-")}</td></tr>`,
    )
    .join("");

  const statsHtml = [
    { label: "Total attendees", value: String(aggregates.totalAttendees) },
    { label: "Admitted", value: String(aggregates.admittedCount) },
    { label: "No-shows", value: String(aggregates.totalAttendees - aggregates.admittedCount) },
    { label: "Admission rate", value: `${oneDecimalPct(aggregates.admittedCount, aggregates.totalAttendees)}%` },
  ]
    .map((s) => `<div class="stat"><span>${s.label}</span><strong>${s.value}</strong></div>`)
    .join("");

  const sectionsHtml = `
  <h2>By ticket type</h2>
  <table>
    <thead><tr><th>Type</th><th>Admitted</th><th>Total</th><th>Rate</th></tr></thead>
    <tbody>${typeRows || '<tr><td colspan="4">No attendees</td></tr>'}</tbody>
  </table>
  <h2>Admission log${aggregates.admittedCount > PDF_LOG_MAX ? ` (first ${PDF_LOG_MAX} of ${aggregates.admittedCount})` : ""}</h2>
  <table>
    <thead><tr><th>Name</th><th>Email</th><th>Ticket type</th><th>Admitted at</th><th>Checked in by</th><th>Items</th></tr></thead>
    <tbody>${logRows || '<tr><td colspan="6">No admissions yet</td></tr>'}</tbody>
  </table>`;

  const html = renderPrintableReportHtml({
    titleSuffix: "Admission report",
    eventTitle: event.title,
    metaLine: `Event date: ${escapeHtml(eventDate)} · Times in ${escapeHtml(timeZone)} · Generated ${escapeHtml(new Date().toISOString())}`,
    statsHtml,
    sectionsHtml,
  });

  await auditReportsExported(
    db,
    c,
    eventId,
    "pdf",
    aggregates.admittedCount,
    aggregates.admittedCount > PDF_LOG_MAX,
  );

  return new Response(html, {
    status: 200,
    headers: getPrintableReportSecurityHeaders(),
  });
}

/** GET /api/admin/events/:eventId/reports/export?format=csv|pdf&report=admissions|wallets */
export async function handleExportReports(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdParam = requireEventId(c);
  if (eventIdParam instanceof Response) return eventIdParam;
  const eventId = eventIdParam;

  const formatRaw = c.req.query("format") ?? "csv";
  if (formatRaw !== "csv" && formatRaw !== "pdf") {
    return c.json({ error: "format must be csv or pdf" }, 400);
  }
  const reportRaw = c.req.query("report") ?? "admissions";
  if (reportRaw !== "admissions" && reportRaw !== "wallets") {
    return c.json({ error: "report must be admissions or wallets" }, 400);
  }

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const event = await db.event.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      title: true,
      date: true,
      slug: true,
      capacity: true,
      timezone: true,
      wallet_enabled: true,
      wallet_apple_enabled: true,
      wallet_google_enabled: true,
      wallet_samsung_enabled: true,
    },
  });
  if (!event) return c.json({ error: "not_found" }, 404);

  const timeZone = resolvePreviewEventTimeZone(event.timezone);
  const dateStamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");

  if (reportRaw === "wallets") {
    const platforms = enabledWalletPlatforms(event);
    return formatRaw === "csv"
      ? exportWalletReportsCsv(db, c, eventId, event, timeZone, dateStamp, platforms)
      : exportWalletReportsPdf(db, c, eventId, event, timeZone, platforms);
  }

  return formatRaw === "csv"
    ? exportAdmissionsReportsCsv(db, c, eventId, event, timeZone, dateStamp)
    : exportAdmissionsReportsPdf(db, c, eventId, event, timeZone);
}

const WALLET_EXPORT_ATTENDEE_SELECT = {
  id: true,
  name: true,
  email: true,
  ticket_type: true,
  admitted_at: true,
  admitted_by: true,
  wallet_pass: {
    select: {
      status: true,
      issued_at: true,
      voided_at: true,
      apple_active_registrations: true,
      apple_inactive_registrations: true,
      google_active_registrations: true,
      google_inactive_registrations: true,
      registration_checked_at: true,
    },
  },
  // Same shape and reasoning as WALLET_PASS_AGGREGATE_SELECT above - fed through
  // earliestDeliverySuccessAt rather than a plain earliest-sent_at query, see its own comment,
  // including the template_id/template.name scoping to genuine ticket-email sends only.
  email_deliveries: {
    where: {
      status: { in: [...EMAIL_DELIVERY_SUCCESS_STATUSES] as string[] },
      OR: [{ template_id: null }, { template: { name: "ticket" } }] as Prisma.EmailDeliveryWhereInput[],
    },
    select: { accepted_at: true, sent_at: true, delivered_at: true },
  },
} as const;

type WalletExportAttendeeRow = Prisma.AttendeeGetPayload<{ select: typeof WALLET_EXPORT_ATTENDEE_SELECT }>;

/** One CSV row for exportWalletReportsCsv below - pulled out of the row-mapping callback since
 * its own branching (a wallet-pass-present/absent check per column, plus the confirmed-platform
 * lookup) pushed that callback's own cognitive complexity over the limit. */
export function buildWalletExportCsvRow(
  row: WalletExportAttendeeRow,
  catalog: TicketTypeInfo[],
  timeZone: string,
  operatorDisplayMap: Record<string, UserDisplayRow>,
  enabledPlatforms: { apple: boolean; google: boolean },
): string {
  const pass = row.wallet_pass;
  const appleActive = pass?.apple_active_registrations ?? 0;
  const googleActive = pass?.google_active_registrations ?? 0;
  const emailFirstSentAt = earliestDeliverySuccessAt(row.email_deliveries);
  // registration_checked_at null means the pass has never completed a sync - the active/inactive
  // counts and confirmed-platform label below are all derived from that sync, so leave them blank
  // (unknown) rather than exporting 0/"None", which would misrepresent "never synced" as the
  // affirmative "confirmed not installed" result and corrupt any downstream recompute from this
  // archive (bot review).
  const synced = pass?.registration_checked_at != null;
  // A disabled platform's own two columns go blank the same way an unsynced pass's do - the event
  // owner turned that platform off, so a stale registration from before it was disabled is no
  // longer a relevant "confirmed" signal; matches the same platform toggles the Wallets tab and
  // PDF are gated by (WalletsReportsTab.tsx, exportWalletReportsPdf below).
  const appleColumnsBlank = !synced || !enabledPlatforms.apple;
  const googleColumnsBlank = !synced || !enabledPlatforms.google;
  const confirmedAppleActive = enabledPlatforms.apple ? appleActive : 0;
  const confirmedGoogleActive = enabledPlatforms.google ? googleActive : 0;
  const confirmedPlatform = synced ? confirmedPlatformLabel(confirmedAppleActive, confirmedGoogleActive) : "";

  return [
    row.name,
    row.email,
    resolveTicketTypeLabel(catalog, row.ticket_type),
    pass?.status ?? "No pass",
    pass?.issued_at ? formatAdmittedAtExport(pass.issued_at, timeZone) : "",
    appleColumnsBlank ? "" : String(appleActive),
    appleColumnsBlank ? "" : String(pass!.apple_inactive_registrations ?? 0),
    googleColumnsBlank ? "" : String(googleActive),
    googleColumnsBlank ? "" : String(pass!.google_inactive_registrations ?? 0),
    confirmedPlatform,
    pass?.voided_at ? formatAdmittedAtExport(pass.voided_at, timeZone) : "",
    pass?.registration_checked_at ? formatAdmittedAtExport(pass.registration_checked_at, timeZone) : "",
    emailFirstSentAt ? formatAdmittedAtExport(emailFirstSentAt, timeZone) : "",
    row.admitted_at ? "Yes" : "No",
    row.admitted_at ? formatAdmittedAtExport(row.admitted_at, timeZone) : "",
    resolveOperatorLabel(resolveOperatorFields(row.admitted_by, operatorDisplayMap)),
  ]
    .map((cell) => quoteCsvCell(sanitizeCsvCell(String(cell))))
    .join(",");
}

/** GET .../reports/export?format=csv&report=wallets - one row per attendee, not the Wallets
 * tab's own aggregate cards: archiving this data (or feeding it to another tool) needs the full
 * underlying population to recompute any of those aggregates later, which a pre-aggregated
 * summary throws away. Mirrors ATTENDEE_DETAIL_SELECT's wallet_pass join (attendees-api-routes.ts)
 * plus the same "first ticket email sent" join loadWalletReportsAggregates above already uses for
 * time-to-tap. Scoped to every attendee (not just those with a pass, unlike the admissions export
 * above which is admitted-only) - "no pass" and "not admitted" are both meaningful rows here, not
 * gaps to filter out. */
async function exportWalletReportsCsv(
  db: PrismaClient,
  c: Context,
  eventId: string,
  event: { title: string; slug: string },
  timeZone: string,
  dateStamp: string,
  enabledPlatforms: { apple: boolean; google: boolean },
): Promise<Response> {
  const [totalAttendees, rows, catalog] = await Promise.all([
    db.attendee.count({ where: { event_id: eventId } }),
    db.attendee.findMany({
      where: { event_id: eventId },
      orderBy: { name: "asc" },
      take: CSV_EXPORT_MAX,
      select: WALLET_EXPORT_ATTENDEE_SELECT,
    }),
    loadEventTicketTypes(db, eventId),
  ]);

  const truncated = totalAttendees > CSV_EXPORT_MAX;

  const operatorIds = [
    ...new Set(rows.map((row) => row.admitted_by).filter((id): id is string => id != null)),
  ];
  const operatorDisplayMap = await resolveUserDisplayMap(db, operatorIds);

  const columns = [
    "Name",
    "Email",
    "Ticket type",
    "Wallet pass status",
    `Pass issued at (${timeZone})`,
    "Apple Wallet active registrations",
    "Apple Wallet inactive registrations",
    "Google Wallet active registrations",
    "Google Wallet inactive registrations",
    "Confirmed platform",
    `Pass voided at (${timeZone})`,
    `Registration last checked at (${timeZone})`,
    `Ticket email first sent at (${timeZone})`,
    "Admitted",
    `Admitted at (${timeZone})`,
    "Checked in by",
  ];
  const header = columns.map((col) => quoteCsvCell(col)).join(",");

  const dataRows = rows.map((row) => buildWalletExportCsvRow(row, catalog, timeZone, operatorDisplayMap, enabledPlatforms));

  const truncationNotice = truncated
    ? [
        quoteCsvCell(sanitizeCsvCell(`Export truncated: first ${CSV_EXPORT_MAX} of ${totalAttendees} attendees.`)),
        ...new Array(columns.length - 1).fill(quoteCsvCell("")),
      ].join(",")
    : null;

  const csvBody = [header, ...(truncationNotice ? [truncationNotice] : []), ...dataRows].join("\r\n");
  const bom = "﻿";
  const filename = `wallets-${event.slug}-${dateStamp}.csv`;

  await auditReportsExported(db, c, eventId, "csv", rows.length, truncated, "wallets");

  return new Response(bom + csvBody, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": attachmentContentDisposition(filename),
      "Cache-Control": "no-store",
      "Pragma": "no-cache",
      "X-Content-Type-Options": "nosniff",
      "X-Wallets-Export-Total": String(totalAttendees),
      "X-Wallets-Export-Truncated": String(truncated),
    },
  });
}

/** GET .../reports/export?format=pdf&report=wallets - printable summary mirroring the Wallets
 * tab's own cards (adoption, platform, by-ticket-type, time-to-tap, admission-by-wallet-status),
 * not a per-attendee table like the admissions PDF above - "Formatted summary for sharing" is
 * the export menu's own description of what PDF is for (EXPORT_FORMATS, ReportsPage.tsx); the
 * CSV export above is where the full per-attendee raw data lives. */
async function exportWalletReportsPdf(
  db: PrismaClient,
  c: Context,
  eventId: string,
  event: { title: string; date: Date },
  timeZone: string,
  enabledPlatforms: { apple: boolean; google: boolean },
): Promise<Response> {
  const aggregates = await loadWalletReportsAggregates(db, eventId, timeZone, event.date, enabledPlatforms);
  const eventDate = event.date.toISOString().slice(0, 10);

  // Same buckets-always-populated issue as tapRows below: these rows exist even with zero
  // installed passes (every count would just read 0), so the "No wallet passes installed"
  // fallback a few lines down was unreachable dead code - branch on adoption.confirmed instead
  // (not got_pass: this breakdown is the platform split among installed passes, not issued
  // ones), matching the Wallets tab's own whole-page EmptyState condition.
  const platformRows =
    aggregates.adoption.confirmed === 0
      ? ""
      : [
          enabledPlatforms.apple && { label: "Apple Wallet only", count: aggregates.platform.apple_only },
          enabledPlatforms.google && { label: "Google Wallet only", count: aggregates.platform.google_only },
          // "More than one wallet" only has a meaning once two platforms are both offered -
          // aggregateWalletPasses already zeroes .both to 0 when only one is enabled, but the row
          // label itself would still misleadingly imply the option exists.
          enabledPlatforms.apple && enabledPlatforms.google && { label: "More than one wallet", count: aggregates.platform.both },
        ]
          .filter((row): row is { label: string; count: number } => row !== false)
          .map(
            (row) =>
              `<tr><td>${escapeHtml(row.label)}</td><td>${row.count}</td><td>${oneDecimalPct(row.count, aggregates.adoption.confirmed)}%</td></tr>`,
          )
          .join("");

  const typeRows = aggregates.by_ticket_type
    .map((t) => `<tr><td>${escapeHtml(t.type)}</td><td>${t.got_pass}</td><td>${t.total}</td><td>${t.pct}%</td></tr>`)
    .join("");

  const registrationCountLabels: Record<string, string> = {
    "1": "1 device",
    "2": "2 devices",
    "3": "3 devices",
    "4_plus": "4+ devices",
  };
  // Same buckets-always-populated issue as platformRows/tapRows above - branch on
  // adoption.confirmed, matching the Wallets tab's own "Not enough data yet." condition for this
  // card.
  const registrationCountRows =
    aggregates.adoption.confirmed === 0
      ? ""
      : aggregates.registrations_per_attendee.buckets
          .map((b) => `<tr><td>${escapeHtml(registrationCountLabels[b.key] ?? b.key)}</td><td>${b.count}</td><td>${b.pct}%</td></tr>`)
          .join("");

  const tapBucketLabels: Record<string, string> = {
    same_day: "Same day",
    "1_3": "1-3 days",
    "4_7": "4-7 days",
    "8_plus": "8+ days",
  };
  // buckets is always 4 zero-filled entries even with no data at all, so mapping it always
  // produces a non-empty string - branch on average_days (null only when nothing to average)
  // instead, matching the Wallets tab's own "Not enough data yet." condition.
  const tapRows =
    aggregates.time_to_wallet_tap.average_days === null
      ? ""
      : aggregates.time_to_wallet_tap.buckets
          .map((b) => `<tr><td>${escapeHtml(tapBucketLabels[b.key] ?? b.key)}</td><td>${b.count}</td><td>${b.pct}%</td></tr>`)
          .join("");

  const statsHtml = [
    { label: "Total attendees", value: String(aggregates.total_attendees) },
    { label: "Issued", value: `${aggregates.adoption.got_pass} (${aggregates.adoption.got_pass_pct}% of attendees)` },
    { label: "Installed", value: `${aggregates.adoption.confirmed} (${aggregates.adoption.confirmed_pct}% of issued)` },
  ]
    .map((s) => `<div class="stat"><span>${s.label}</span><strong>${s.value}</strong></div>`)
    .join("");

  // Same warning as WalletsReportsTab's own Notice (apps/admin/src/pages/WalletsReportsTab.tsx) -
  // the PDF otherwise only carries a "Generated" timestamp, so a partial WALLET_AGGREGATE_MAX
  // sample would read as a complete report with no indication these specific numbers are
  // sampled (bot review). .print-hint's existing warning-box styling, without no-print, since
  // this needs to survive into the saved/printed PDF, not just the on-screen preview.
  const truncatedWarningHtml = aggregates.passes_truncated
    ? `<p class="print-hint">This event has more issued wallet passes than a single report can process at once, so platform mix, devices per attendee, adoption by ticket type, and time-to-wallet-tap below are based on a partial sample rather than every pass. Cumulative passes issued and admission rate by wallet status are unaffected - both come from a full count, not a sample.</p>`
    : "";

  const sectionsHtml = `
  ${truncatedWarningHtml}
  <h2>Wallet platform</h2>
  <table>
    <thead><tr><th>Platform</th><th>Passes</th><th>Share of installed</th></tr></thead>
    <tbody>${platformRows || '<tr><td colspan="3">No wallet passes installed yet</td></tr>'}</tbody>
  </table>
  <h2>Devices per attendee</h2>
  <table>
    <thead><tr><th>Devices</th><th>Attendees</th><th>Share</th></tr></thead>
    <tbody>${registrationCountRows || '<tr><td colspan="3">No wallet passes installed yet</td></tr>'}</tbody>
  </table>
  <h2>Adoption by ticket type</h2>
  <table>
    <thead><tr><th>Type</th><th>Got pass</th><th>Total</th><th>Rate</th></tr></thead>
    <tbody>${typeRows || '<tr><td colspan="4">No attendees</td></tr>'}</tbody>
  </table>
  <h2>Time to wallet install</h2>
  <table>
    <thead><tr><th>Days after ticket email</th><th>Passes</th><th>Share</th></tr></thead>
    <tbody>${tapRows || '<tr><td colspan="3">Not enough data yet</td></tr>'}</tbody>
  </table>
  <h2>Admission rate by wallet status</h2>
  <table>
    <thead><tr><th>Group</th><th>Admitted</th><th>Total</th><th>Rate</th></tr></thead>
    <tbody>
      <tr><td>Has a wallet pass</td><td>${aggregates.admission_by_wallet.with_wallet.admitted}</td><td>${aggregates.admission_by_wallet.with_wallet.total}</td><td>${aggregates.admission_by_wallet.with_wallet.pct}%</td></tr>
      <tr><td>No wallet pass</td><td>${aggregates.admission_by_wallet.without_wallet.admitted}</td><td>${aggregates.admission_by_wallet.without_wallet.total}</td><td>${aggregates.admission_by_wallet.without_wallet.pct}%</td></tr>
    </tbody>
  </table>`;

  // The on-screen Wallets tab surfaces synced_at (via syncedHint in WalletsReportsTab.tsx) so a
  // stale/never-synced platform-adoption number isn't read as current - the PDF needs the same
  // caveat, since it only otherwise carries a "Generated" timestamp for when the export ran, not
  // when the underlying wallet-pass registration data was last refreshed from PassCreator.
  const syncedLine = aggregates.synced_at
    ? `Synced ${escapeHtml(formatAdmittedAtExport(new Date(aggregates.synced_at), timeZone))}`
    : "Not synced yet";

  const html = renderPrintableReportHtml({
    titleSuffix: "Wallet report",
    eventTitle: event.title,
    metaLine: `Event date: ${escapeHtml(eventDate)} · Times in ${escapeHtml(timeZone)} · ${syncedLine} · Generated ${escapeHtml(new Date().toISOString())}`,
    statsHtml,
    sectionsHtml,
  });

  await auditReportsExported(db, c, eventId, "pdf", aggregates.adoption.got_pass, aggregates.passes_truncated, "wallets");

  return new Response(html, {
    status: 200,
    headers: getPrintableReportSecurityHeaders(),
  });
}
