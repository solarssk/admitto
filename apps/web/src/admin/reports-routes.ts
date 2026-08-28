import type { Context } from "hono";
import { Prisma } from "@admitto/db";
import type { PrismaClient } from "@admitto/db";
import type { EventWalletReportsResponse } from "@admitto/shared";
import { resolvePreviewEventTimeZone } from "@admitto/mail-templates";
import { loadEventTicketTypes, writeBulkActionLog, type TicketTypeInfo } from "@admitto/tickets";
import {
  adminAuditFromContext,
  assertEventManageAccess,
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
  status: true,
  apple_active_registrations: true,
  google_active_registrations: true,
  registration_checked_at: true,
  attendee: {
    select: {
      ticket_type: true,
      // Earliest non-bounced send across initial and resend attempts - a "purpose: initial" filter
      // would keep pointing at an initial that later hard-bounced (applyBounceResult retains its
      // sent_at, only status flips to "bounced"), overstating tap time against a since-successful
      // resend, or dropping the attendee entirely if the initial send never got a sent_at at all.
      email_deliveries: {
        where: { sent_at: { not: null }, status: { not: "bounced" } },
        orderBy: { sent_at: "asc" },
        take: 1,
        select: { sent_at: true },
      },
    },
  },
} as const;

type WalletPassAggregateRow = Prisma.WalletPassGetPayload<{ select: typeof WALLET_PASS_AGGREGATE_SELECT }>;

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

/** Whole days between the attendee's first ticket-link email and this pass being issued, or null
 * when either timestamp is missing or the pass was somehow issued before that email was sent
 * (skipped rather than counted as negative "time to tap"). */
export function computeTapDays(sentAt: Date | null | undefined, issuedAt: Date | null): number | null {
  if (!sentAt || !issuedAt) return null;
  const diffDays = (issuedAt.getTime() - sentAt.getTime()) / 86_400_000;
  return diffDays >= 0 ? diffDays : null;
}

interface WalletPassAggregates {
  confirmed: number;
  cancelled: number;
  appleOnly: number;
  googleOnly: number;
  both: number;
  mostRecentSync: Date | null;
  gotPassByType: Map<string | null, number>;
  bucketCounts: Record<TimeToTapBucketKey, number>;
  tapDaySum: number;
  tapDayCount: number;
}

/** Single pass over the (possibly sampled - see WALLET_AGGREGATE_MAX) pass rows, building every
 * per-pass-derived number the response needs in one place rather than several separate loops. */
function aggregateWalletPasses(passes: WalletPassAggregateRow[]): WalletPassAggregates {
  let confirmed = 0;
  let cancelled = 0;
  let appleOnly = 0;
  let googleOnly = 0;
  let both = 0;
  let mostRecentSync: Date | null = null;
  const gotPassByType = new Map<string | null, number>();
  const bucketCounts: Record<TimeToTapBucketKey, number> = { same_day: 0, "1_3": 0, "4_7": 0, "8_plus": 0 };
  let tapDaySum = 0;
  let tapDayCount = 0;

  for (const pass of passes) {
    const platform = classifyPassPlatform(pass.apple_active_registrations ?? 0, pass.google_active_registrations ?? 0);
    if (platform === "both") both++;
    else if (platform === "apple_only") appleOnly++;
    else if (platform === "google_only") googleOnly++;
    if (platform !== "none") confirmed++;
    if (pass.status === "voided") cancelled++;
    if (pass.registration_checked_at && (!mostRecentSync || pass.registration_checked_at > mostRecentSync)) {
      mostRecentSync = pass.registration_checked_at;
    }

    const typeKey = pass.attendee.ticket_type;
    gotPassByType.set(typeKey, (gotPassByType.get(typeKey) ?? 0) + 1);

    const tapDays = computeTapDays(pass.attendee.email_deliveries[0]?.sent_at, pass.issued_at);
    if (tapDays !== null) {
      tapDaySum += tapDays;
      tapDayCount++;
      bucketCounts[bucketForDays(tapDays)]++;
    }
  }

  return { confirmed, cancelled, appleOnly, googleOnly, both, mostRecentSync, gotPassByType, bucketCounts, tapDaySum, tapDayCount };
}

/** Ticket-type breakdown for the Wallets tab - same catalog-order-plus-fallbacks shape as the
 * admissions report's own by_ticket_type (see EventReportsResponse's doc comment above): a
 * "(none)" bucket for attendees with no type set, and a "(not in catalog)" bucket for stored
 * ticket_type values whose catalog row no longer exists. */
function buildWalletTicketTypeBreakdown(
  catalog: TicketTypeInfo[],
  totalByType: Map<string | null, number>,
  gotPassByType: Map<string | null, number>,
): EventWalletReportsResponse["by_ticket_type"] {
  const by_ticket_type: EventWalletReportsResponse["by_ticket_type"] = catalog.map((t) => {
    const total = totalByType.get(t.key) ?? 0;
    const typeGotPass = gotPassByType.get(t.key) ?? 0;
    return { key: t.key, type: t.label, color: t.color, total, got_pass: typeGotPass, pct: oneDecimalPct(typeGotPass, total) };
  });

  const noneTotal = (totalByType.get(null) ?? 0) + (totalByType.get("") ?? 0);
  if (noneTotal > 0) {
    const noneGotPass = (gotPassByType.get(null) ?? 0) + (gotPassByType.get("") ?? 0);
    by_ticket_type.push({
      key: null,
      type: "(none)",
      color: "gray",
      total: noneTotal,
      got_pass: noneGotPass,
      pct: oneDecimalPct(noneGotPass, noneTotal),
    });
  }

  const catalogKeys = new Set(catalog.map((t) => t.key));
  for (const [key, total] of totalByType) {
    if (key === null || key === "" || catalogKeys.has(key)) continue;
    const typeGotPass = gotPassByType.get(key) ?? 0;
    by_ticket_type.push({
      key,
      type: "(not in catalog)",
      color: "gray",
      total,
      got_pass: typeGotPass,
      pct: oneDecimalPct(typeGotPass, total),
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
): Promise<EventWalletReportsResponse> {
  // "Confirmed" (active on at least one platform), not merely issued - see
  // EventWalletReportsResponse.admission_by_wallet's own doc comment for why. Built once and
  // spread/negated below so the with/without-wallet split can't drift out of sync with itself.
  const confirmedWalletFilter = {
    OR: [
      { wallet_pass: { apple_active_registrations: { gt: 0 } } },
      { wallet_pass: { google_active_registrations: { gt: 0 } } },
    ],
  };

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

  const { confirmed, cancelled, appleOnly, googleOnly, both, mostRecentSync, gotPassByType, bucketCounts, tapDaySum, tapDayCount } =
    aggregateWalletPasses(passes);

  const gotPass = passes.length;
  const totalByType = mergeTicketTypeCounts(byTypeTotalRaw);
  const by_ticket_type = buildWalletTicketTypeBreakdown(catalog, totalByType, gotPassByType);
  const issued_by_day = buildIssuedByDay(issuedByDayRaw, timeZone, eventDate);

  const bucketOrder: TimeToTapBucketKey[] = ["same_day", "1_3", "4_7", "8_plus"];
  const buckets = bucketOrder.map((key) => ({
    key,
    count: bucketCounts[key],
    pct: oneDecimalPct(bucketCounts[key], tapDayCount),
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
      cancelled,
    },
    platform: {
      apple_only: appleOnly,
      google_only: googleOnly,
      both,
      not_installed: Math.max(0, gotPass - confirmed),
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

  const event = await db.event.findUnique({ where: { id: eventId }, select: { timezone: true, date: true } });
  if (!event) return c.json({ error: "not_found" }, 404);

  const timeZone = resolvePreviewEventTimeZone(event.timezone);
  const body = await loadWalletReportsAggregates(db, eventId, timeZone, event.date);
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
    select: { id: true, title: true, date: true, slug: true, capacity: true, timezone: true },
  });
  if (!event) return c.json({ error: "not_found" }, 404);

  const timeZone = resolvePreviewEventTimeZone(event.timezone);
  const dateStamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");

  if (reportRaw === "wallets") {
    return formatRaw === "csv"
      ? exportWalletReportsCsv(db, c, eventId, event, timeZone, dateStamp)
      : exportWalletReportsPdf(db, c, eventId, event, timeZone);
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
  // See the identical comment on WALLET_PASS_AGGREGATE_SELECT above - earliest non-bounced send
  // across initial and resend attempts, not just "initial".
  email_deliveries: {
    where: { sent_at: { not: null }, status: { not: "bounced" } },
    orderBy: { sent_at: "asc" },
    take: 1,
    select: { sent_at: true },
  },
} as const;

type WalletExportAttendeeRow = Prisma.AttendeeGetPayload<{ select: typeof WALLET_EXPORT_ATTENDEE_SELECT }>;

/** One CSV row for exportWalletReportsCsv below - pulled out of the row-mapping callback since
 * its own branching (a wallet-pass-present/absent check per column, plus the confirmed-platform
 * lookup) pushed that callback's own cognitive complexity over the limit. */
function buildWalletExportCsvRow(
  row: WalletExportAttendeeRow,
  catalog: TicketTypeInfo[],
  timeZone: string,
  operatorDisplayMap: Record<string, UserDisplayRow>,
): string {
  const pass = row.wallet_pass;
  const appleActive = pass?.apple_active_registrations ?? 0;
  const googleActive = pass?.google_active_registrations ?? 0;
  const emailSentAt = row.email_deliveries[0]?.sent_at ?? null;

  return [
    row.name,
    row.email,
    resolveTicketTypeLabel(catalog, row.ticket_type),
    pass?.status ?? "No pass",
    pass?.issued_at ? formatAdmittedAtExport(pass.issued_at, timeZone) : "",
    pass ? String(appleActive) : "",
    pass ? String(pass.apple_inactive_registrations ?? 0) : "",
    pass ? String(googleActive) : "",
    pass ? String(pass.google_inactive_registrations ?? 0) : "",
    pass ? confirmedPlatformLabel(appleActive, googleActive) : "",
    pass?.voided_at ? formatAdmittedAtExport(pass.voided_at, timeZone) : "",
    pass?.registration_checked_at ? formatAdmittedAtExport(pass.registration_checked_at, timeZone) : "",
    emailSentAt ? formatAdmittedAtExport(emailSentAt, timeZone) : "",
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

  const dataRows = rows.map((row) => buildWalletExportCsvRow(row, catalog, timeZone, operatorDisplayMap));

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
): Promise<Response> {
  const aggregates = await loadWalletReportsAggregates(db, eventId, timeZone, event.date);
  const eventDate = event.date.toISOString().slice(0, 10);

  // Same buckets-always-populated issue as tapRows below: these 4 rows exist even with zero
  // passes issued (every count would just read 0), so the "No passes issued" fallback a few
  // lines down was unreachable dead code - branch on adoption.got_pass instead, matching the
  // Wallets tab's own whole-page EmptyState condition.
  const platformRows =
    aggregates.adoption.got_pass === 0
      ? ""
      : [
          { label: "Apple Wallet only", count: aggregates.platform.apple_only },
          { label: "Google Wallet only", count: aggregates.platform.google_only },
          { label: "More than one wallet", count: aggregates.platform.both },
          { label: "No wallet installed", count: aggregates.platform.not_installed },
        ]
          .map(
            (row) =>
              `<tr><td>${escapeHtml(row.label)}</td><td>${row.count}</td><td>${oneDecimalPct(row.count, aggregates.adoption.got_pass)}%</td></tr>`,
          )
          .join("");

  const typeRows = aggregates.by_ticket_type
    .map((t) => `<tr><td>${escapeHtml(t.type)}</td><td>${t.got_pass}</td><td>${t.total}</td><td>${t.pct}%</td></tr>`)
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
    { label: "Issued", value: `${aggregates.adoption.got_pass} (${aggregates.adoption.got_pass_pct}%)` },
    { label: "Installed", value: `${aggregates.adoption.confirmed} (${aggregates.adoption.confirmed_pct}% of issued)` },
    { label: "Voided", value: String(aggregates.adoption.cancelled) },
  ]
    .map((s) => `<div class="stat"><span>${s.label}</span><strong>${s.value}</strong></div>`)
    .join("");

  const sectionsHtml = `
  <h2>Wallet platform</h2>
  <table>
    <thead><tr><th>Platform</th><th>Passes</th><th>Share of issued</th></tr></thead>
    <tbody>${platformRows || '<tr><td colspan="3">No passes issued</td></tr>'}</tbody>
  </table>
  <h2>Adoption by ticket type</h2>
  <table>
    <thead><tr><th>Type</th><th>Got pass</th><th>Total</th><th>Rate</th></tr></thead>
    <tbody>${typeRows || '<tr><td colspan="4">No attendees</td></tr>'}</tbody>
  </table>
  <h2>Time to wallet tap</h2>
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
