import type { Context } from "hono";
import type { PrismaClient } from "@prisma/client";
import { listCheckInEvents } from "@admitto/auth";
import {
  checkInScan,
  admitAttendee,
  lookupAttendees,
  getAttendeeCard,
  getRecentCheckIns,
  getCheckInStats,
  transitionItemState,
  addAttendeeNote,
  loadEventOpsConfig,
  undoLastCheckIn,
  NoteTooLongError,
  OperatorRequiredError,
  UndoNotAllowedError,
  parseCustomData,
  type CheckInScanResult,
  type OpsAuditContext,
} from "@admitto/tickets";
import { resolveClientIp } from "../rate-limit/client-ip.js";
import { publishCheckinIfValid } from "./checkin-sse-publish.js";
import { itemTransitionErrorResponse } from "./admin-helpers.js";

/** GET /api/checkin/events — session-only capability list (P4). */
export async function handleGetCheckinEvents(c: Context, db: PrismaClient): Promise<Response> {
  const auth = c.get("auth");
  const events = await listCheckInEvents(db, auth.userId);

  return c.json({
    events: events.map((e) => ({
      id: e.id,
      title: e.title,
      slug: e.slug,
      date: e.date.toISOString(),
      timezone: e.timezone,
      location: e.location,
      organization_id: e.organization_id,
    })),
  });
}

/** Build audit context for mutating check-in routes.
 *  Session auth: `deviceId` from `Session.device_label` (body value ignored).
 *  Bearer emergency: `deviceId` from request body. */
async function opsAuditFromBody(
  c: Context,
  db: PrismaClient,
  bodyDeviceId: unknown,
): Promise<OpsAuditContext> {
  const sessionId = c.get("checkinSessionId") as string | undefined;
  let deviceId: string | undefined;

  if (c.get("checkinAuth") === "bearer") {
    deviceId = typeof bodyDeviceId === "string" ? bodyDeviceId : undefined;
  } else if (sessionId) {
    const session = await db.session.findUnique({
      where: { id: sessionId },
      select: { device_label: true },
    });
    deviceId = session?.device_label ?? undefined;
  }

  return {
    operator: c.get("operatorUserId") as string | undefined,
    sessionId,
    deviceId,
    ip: resolveClientIp(c),
  };
}

/** Serialize admit/scan result for JSON (Date → ISO string). */
function serializeScanResult(result: CheckInScanResult): unknown {
  if ("admittedAt" in result && result.admittedAt instanceof Date) {
    return { ...result, admittedAt: result.admittedAt.toISOString() };
  }
  return result;
}

/** Resolve company/department for history rows (custom_data with legacy column fallback). */
function historyCompany(attendee: {
  custom_data?: unknown;
  company: string | null;
  department: string | null;
}): { company: string | null; department: string | null } {
  const cd = parseCustomData(attendee.custom_data);
  return {
    company: cd.company ?? attendee.company,
    department: cd.department ?? attendee.department,
  };
}

/** POST /api/checkin/scan */
export async function handleCheckinScan(c: Context, db: PrismaClient): Promise<Response> {
  const body = c.get("parsedScanBody") as Record<string, unknown>;
  const { scanned: rawScanned, eventId, deviceId } = body;
  const scanned = typeof rawScanned === "string" ? rawScanned.trim() : "";
  if (!scanned) return c.json({ error: "scanned required" }, 400);
  if (typeof eventId !== "string" || !eventId) return c.json({ error: "eventId required" }, 400);

  try {
    const audit = await opsAuditFromBody(c, db, deviceId);
    const result = await checkInScan(
      { scanned, eventId, operator: audit.operator, deviceId: audit.deviceId, sessionId: audit.sessionId, ip: audit.ip },
      db,
    );
    if (result.status === "VALID") {
      publishCheckinIfValid(c, eventId, result, audit.deviceId ?? null);
    }
    return c.json(serializeScanResult(result), 200);
  } catch (err) {
    console.error("checkInScan failed:", err);
    return c.json({ error: "server error" }, 500);
  }
}

/** POST /api/checkin/lookup — PII in body, not URL (Lock #3) */
export async function handleCheckinLookup(c: Context, db: PrismaClient): Promise<Response> {
  const body = c.get("parsedScanBody") as Record<string, unknown>;
  const eventId = body["eventId"];
  const q = body["q"];
  if (typeof eventId !== "string" || !eventId) return c.json({ error: "eventId required" }, 400);
  if (typeof q !== "string" || !q.trim()) return c.json({ error: "q required" }, 400);

  try {
    const ops = await loadEventOpsConfig(eventId, db);
    if (!ops.allow_manual_lookup) {
      return c.json({ error: "manual_lookup_disabled" }, 403);
    }
    const results = await lookupAttendees(eventId, q, db);
    return c.json({ results }, 200);
  } catch (err) {
    console.error("lookupAttendees failed:", err);
    return c.json({ error: "server error" }, 500);
  }
}

/** GET /api/checkin/attendees/:attendeeId */
export async function handleGetAttendeeCard(c: Context, db: PrismaClient): Promise<Response> {
  const attendeeId = c.req.param("attendeeId");
  const eventId = c.req.query("eventId");
  if (!attendeeId) return c.json({ error: "attendeeId required" }, 400);
  if (!eventId) return c.json({ error: "eventId required" }, 400);

  try {
    const card = await getAttendeeCard(eventId, attendeeId, db);
    if (!card) return c.json({ error: "not found" }, 404);
    return c.json({ card }, 200);
  } catch (err) {
    console.error("getAttendeeCard failed:", err);
    return c.json({ error: "server error" }, 500);
  }
}

/** POST /api/checkin/admit */
export async function handleCheckinAdmit(c: Context, db: PrismaClient): Promise<Response> {
  const body = c.get("parsedScanBody") as Record<string, unknown>;
  const eventId = body["eventId"];
  const attendeeId = body["attendeeId"];
  const deviceId = body["deviceId"];
  const notes = body["notes"];
  const method = body["method"];

  if (typeof eventId !== "string" || !eventId) return c.json({ error: "eventId required" }, 400);
  if (typeof attendeeId !== "string" || !attendeeId) return c.json({ error: "attendeeId required" }, 400);

  const admitMethod = method === "scan" ? "scan" : "manual";

  try {
    const audit = await opsAuditFromBody(c, db, deviceId);
    const result = await admitAttendee(
      {
        attendeeId,
        eventId,
        method: admitMethod,
        audit,
        notes: typeof notes === "string" ? notes : undefined,
      },
      db,
    );
    if (result.status === "VALID") {
      publishCheckinIfValid(c, eventId, result, audit.deviceId ?? null);
    }
    return c.json(serializeScanResult(result), 200);
  } catch (err) {
    console.error("admitAttendee failed:", err);
    return c.json({ error: "server error" }, 500);
  }
}

/** POST /api/checkin/items/:itemKey */
export async function handleCheckinItemAction(c: Context, db: PrismaClient): Promise<Response> {
  const body = c.get("parsedScanBody") as Record<string, unknown>;
  const itemKey = c.req.param("itemKey");
  if (!itemKey) return c.json({ error: "itemKey required" }, 400);
  const eventId = body["eventId"];
  const attendeeId = body["attendeeId"];
  const targetState = body["targetState"];
  const deviceId = body["deviceId"];

  if (typeof eventId !== "string" || !eventId) return c.json({ error: "eventId required" }, 400);
  if (typeof attendeeId !== "string" || !attendeeId) return c.json({ error: "attendeeId required" }, 400);
  if (typeof targetState !== "string" || !targetState) return c.json({ error: "targetState required" }, 400);

  try {
    const result = await transitionItemState(
      {
        attendeeId,
        eventId,
        itemKey,
        targetState,
        audit: await opsAuditFromBody(c, db, deviceId),
      },
      db,
    );
    const card = await getAttendeeCard(eventId, attendeeId, db);
    return c.json({ ...result, card }, 200);
  } catch (err) {
    return itemTransitionErrorResponse(c, err, "transitionItemState");
  }
}

/** POST /api/checkin/notes */
export async function handleCheckinNote(c: Context, db: PrismaClient): Promise<Response> {
  const body = c.get("parsedScanBody") as Record<string, unknown>;
  const eventId = body["eventId"];
  const attendeeId = body["attendeeId"];
  const noteBody = body["body"];
  const deviceId = body["deviceId"];

  if (typeof eventId !== "string" || !eventId) return c.json({ error: "eventId required" }, 400);
  if (typeof attendeeId !== "string" || !attendeeId) return c.json({ error: "attendeeId required" }, 400);
  if (typeof noteBody !== "string") return c.json({ error: "body required" }, 400);
  if (!noteBody.trim()) return c.json({ error: "body required" }, 400);

  try {
    const audit = await opsAuditFromBody(c, db, deviceId);
    if (!audit.operator) return c.json({ error: "unauthorized" }, 401);

    const note = await addAttendeeNote(
      { attendeeId, eventId, body: noteBody, audit },
      db,
    );
    const card = await getAttendeeCard(eventId, attendeeId, db);
    return c.json({ note: { ...note, created_at: note.created_at.toISOString() }, card }, 200);
  } catch (err) {
    if (err instanceof NoteTooLongError) {
      return c.json({ error: "Note too long" }, 400);
    }
    if (err instanceof OperatorRequiredError) {
      return c.json({ error: "unauthorized" }, 401);
    }
    console.error("addAttendeeNote failed:", err);
    return c.json({ error: "server error" }, 500);
  }
}

/** POST /api/checkin/undo */
export async function handleCheckinUndo(c: Context, db: PrismaClient): Promise<Response> {
  const body = c.get("parsedScanBody") as Record<string, unknown>;
  const eventId = body["eventId"];
  const deviceId = body["deviceId"];

  if (typeof eventId !== "string" || !eventId) return c.json({ error: "eventId required" }, 400);

  try {
    const audit = await opsAuditFromBody(c, db, deviceId);
    const result = await undoLastCheckIn(
      { eventId, audit },
      db,
    );
    return c.json(result, 200);
  } catch (err) {
    if (err instanceof UndoNotAllowedError) {
      return c.json({ error: err.message }, 409);
    }
    console.error("undoLastCheckIn failed:", err);
    return c.json({ error: "server error" }, 500);
  }
}

/** GET /api/checkin/ops-config */
export async function handleCheckinOpsConfig(c: Context, db: PrismaClient): Promise<Response> {
  const eventId = c.req.query("eventId");
  if (!eventId) return c.json({ error: "eventId required" }, 400);
  try {
    const ops = await loadEventOpsConfig(eventId, db);
    return c.json(ops, 200);
  } catch (err) {
    console.error("loadEventOpsConfig failed:", err);
    return c.json({ error: "server error" }, 500);
  }
}

/** GET /api/checkin/stats */
export async function handleCheckinStats(c: Context, db: PrismaClient): Promise<Response> {
  const eventId = c.req.query("eventId");
  if (!eventId) return c.json({ error: "eventId required" }, 400);
  try {
    const stats = await getCheckInStats(eventId, db);
    return c.json(stats, 200);
  } catch (err) {
    console.error("getCheckInStats failed:", err);
    return c.json({ error: "server error" }, 500);
  }
}

/** GET /api/checkin/history */
export async function handleCheckinHistory(c: Context, db: PrismaClient): Promise<Response> {
  const eventId = c.req.query("eventId");
  if (!eventId) return c.json({ error: "eventId required" }, 400);
  const limitParam = parseInt(c.req.query("limit") ?? "10", 10);
  const limit = Math.max(1, Math.min(Number.isFinite(limitParam) ? limitParam : 10, 100));

  try {
    const history = await getRecentCheckIns(eventId, db, limit);
    return c.json(
      history.map((row) => {
        const { company, department } = historyCompany({
          custom_data: (row.attendee as { custom_data?: unknown }).custom_data,
          company: row.attendee.company ?? null,
          department: row.attendee.department ?? null,
        });
        return {
          ...row,
          checked_in_at: row.checked_in_at.toISOString(),
          created_at: row.created_at.toISOString(),
          attendee: {
            name: row.attendee.name,
            ticket_type: row.attendee.ticket_type,
            company,
            department,
          },
        };
      }),
      200,
    );
  } catch (err) {
    console.error("getRecentCheckIns failed:", err);
    return c.json({ error: "server error" }, 500);
  }
}

/** Read eventId from parsed POST body. */
export function eventIdFromCheckinBody(c: Context): string | undefined {
  const body = c.get("parsedScanBody") as Record<string, unknown> | undefined;
  if (!body) return undefined;
  const eventId = body["eventId"];
  return typeof eventId === "string" && eventId.length > 0 ? eventId : undefined;
}
