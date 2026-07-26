import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { PrismaClient } from "@prisma/client";
import { hashPassword, createSession, SESSION_STAGE } from "@admitto/auth";
import { generateToken, hashToken } from "@admitto/tickets";
import * as ticketOperations from "@admitto/tickets";
import {
  createCheckinPreAuth,
  createCheckinSessionCsrfGuard,
  createCheckinEventScope,
  parseScanBodyMiddleware,
} from "../../src/checkin-gate.js";
import {
  handleCheckinLookup,
  handleCheckinScan,
  handleCheckinAdmit,
  handleCheckinNote,
  handleCheckinUndo,
  eventIdFromCheckinBody,
} from "../../src/admin/checkin-api-routes.js";
import { querySystemLogs, resetSystemLogBufferForTest } from "@admitto/shared/system-log";

const ORG_A = "org-op-routes-a";
const ORG_B = "org-op-routes-b";
const EVENT_A = "event-op-routes-a";
const EVENT_B = "event-op-routes-b";
const USER_OP_A = "user-op-routes-a";
const ATTENDEE_A = "attendee-op-routes-a";
const ATTENDEE_B = "attendee-op-routes-b";
const SESSION_DEVICE = "tablet-session-a";

let prisma: PrismaClient;
let attendeeId: string;
let attendeeIdB: string;
let sessionCookie = "";
let sessionId = "";

const sameOrigin = { Origin: "http://localhost" };

async function seedFixture(client: PrismaClient): Promise<void> {
  await client.attendeeActionLog.deleteMany({ where: { event_id: { in: [EVENT_A, EVENT_B] } } });
  await client.checkIn.deleteMany({ where: { event_id: { in: [EVENT_A, EVENT_B] } } });
  await client.attendee.deleteMany({ where: { event_id: { in: [EVENT_A, EVENT_B] } } });
  await client.roleAssignment.deleteMany({ where: { user_id: USER_OP_A } });
  await client.session.deleteMany({ where: { user_id: USER_OP_A } });
  await client.user.deleteMany({ where: { id: USER_OP_A } });
  await client.event.deleteMany({ where: { id: { in: [EVENT_A, EVENT_B] } } });
  await client.organization.deleteMany({ where: { id: { in: [ORG_A, ORG_B] } } });

  const password_hash = await hashPassword("x");

  await client.organization.createMany({
    data: [
      { id: ORG_A, name: "Op A", slug: "op-routes-a" },
      { id: ORG_B, name: "Op B", slug: "op-routes-b" },
    ],
  });
  await client.event.createMany({
    data: [
      {
        id: EVENT_A,
        title: "Event A",
        slug: "ev-op-routes-a",
        date: new Date("2026-09-01"),
        organization_id: ORG_A,
      },
      {
        id: EVENT_B,
        title: "Event B",
        slug: "ev-op-routes-b",
        date: new Date("2026-09-01"),
        organization_id: ORG_B,
      },
    ],
  });
  await client.user.create({
    data: { id: USER_OP_A, email: "op-routes@example.com", password_hash },
  });
  await client.roleAssignment.create({
    data: { user_id: USER_OP_A, role: "operator", scope_type: "event", scope_id: EVENT_A },
  });

  const token = generateToken();
  const att = await client.attendee.create({
    data: {
      id: ATTENDEE_A,
      event_id: EVENT_A,
      email: "jan@firma.pl",
      name: "Jan Kowalski",
      token_hash: hashToken(token),
      company: "Firma Sp. z o.o.",
    },
  });
  attendeeId = att.id;

  const tokenB = generateToken();
  const attB = await client.attendee.create({
    data: {
      id: ATTENDEE_B,
      event_id: EVENT_B,
      email: "anna@firma.pl",
      name: "Anna Nowak",
      token_hash: hashToken(tokenB),
    },
  });
  attendeeIdB = attB.id;
}

function buildMutatingApp(config = { allowBearer: false, operatorToken: null as string | null }) {
  const deps = {
    prisma,
    config,
  };
  const app = new Hono();
  const chain = [
    createCheckinPreAuth(deps),
    createCheckinSessionCsrfGuard(),
    parseScanBodyMiddleware,
    createCheckinEventScope(deps, eventIdFromCheckinBody),
  ] as const;

  app.post("/api/checkin/lookup", ...chain, (c) => handleCheckinLookup(c, prisma));
  app.post("/api/checkin/scan", ...chain, (c) => handleCheckinScan(c, prisma));
  app.post("/api/checkin/admit", ...chain, (c) => handleCheckinAdmit(c, prisma));
  app.post("/api/checkin/notes", ...chain, (c) => handleCheckinNote(c, prisma));
  app.post("/api/checkin/undo", ...chain, (c) => handleCheckinUndo(c, prisma));
  return app;
}

beforeAll(async () => {
  prisma = new PrismaClient();
  await seedFixture(prisma);
  const { rawToken, session } = await createSession(prisma, {
    userId: USER_OP_A,
    stage: SESSION_STAGE.FULL,
    deviceLabel: SESSION_DEVICE,
  });
  sessionCookie = `admitto_session=${rawToken}`;
  sessionId = session.id;
});

beforeEach(() => {
  resetSystemLogBufferForTest();
});

afterAll(async () => {
  await prisma?.$disconnect();
});

function post(path: string, body: Record<string, unknown>) {
  return buildMutatingApp().request(path, {
    method: "POST",
    headers: {
      Cookie: sessionCookie,
      "Content-Type": "application/json",
      ...sameOrigin,
    },
    body: JSON.stringify(body),
  });
}

function postBearer(path: string, body: Record<string, unknown>) {
  return buildMutatingApp({ allowBearer: true, operatorToken: "emergency-checkin-token" }).request(path, {
    method: "POST",
    headers: {
      Authorization: "Bearer emergency-checkin-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

/** Exercise the post-auth race where a session is no longer readable when the handler builds its
 * audit context. Authentication has already established the operator, so the bounded log must
 * retain the id but omit an unavailable email. */
function postWithMissingAuditSession(body: Record<string, unknown>) {
  const app = new Hono();
  app.post("/api/checkin/scan", (c) => {
    c.set("checkinAuth", "session");
    c.set("operatorUserId", USER_OP_A);
    (c as unknown as { set(key: string, value: unknown): void }).set(
      "checkinSessionId",
      "missing-session-after-auth",
    );
    c.set("parsedScanBody", body);
    return handleCheckinScan(c, prisma);
  });
  return app.request("/api/checkin/scan", { method: "POST" });
}

describe("POST /api/checkin/lookup (Lock #3)", () => {
  it("returns matches without email in response", async () => {
    const res = await post("/api/checkin/lookup", { eventId: EVENT_A, q: "jan@firma.pl" });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { results: Array<Record<string, unknown>> };
    expect(json.results.length).toBeGreaterThan(0);
    expect(json.results[0]?.name).toBe("Jan Kowalski");
    for (const row of json.results) {
      expect(row).not.toHaveProperty("email");
    }
    expect(JSON.stringify(json)).not.toContain("jan@firma.pl");
  });

  it("operator wrong event → 403", async () => {
    const res = await post("/api/checkin/lookup", { eventId: EVENT_B, q: "jan" });
    expect(res.status).toBe(403);
  });

  it("returns 403 when manual lookup is disabled for the event", async () => {
    await prisma.event.update({
      where: { id: EVENT_A },
      data: {
        ops_config: {
          allow_manual_lookup: false,
          badge_at_entry: true,
          require_confirm_on_scan: false,
        },
      },
    });
    try {
      const res = await post("/api/checkin/lookup", { eventId: EVENT_A, q: "jan" });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "manual_lookup_disabled" });
    } finally {
      await prisma.event.update({
        where: { id: EVENT_A },
        data: { ops_config: {} },
      });
    }
  });
});

describe("POST /api/checkin/admit — session_id audit (Lock #5)", () => {
  it("writes AttendeeActionLog.session_id on check-in", async () => {
    const res = await post("/api/checkin/admit", {
      eventId: EVENT_A,
      attendeeId,
      deviceId: "spoofed-tablet",
      method: "manual",
    });
    expect(res.status).toBe(200);

    const log = await prisma.attendeeActionLog.findFirst({
      where: { attendee_id: attendeeId, action_type: "check_in" },
      orderBy: { created_at: "desc" },
    });
    expect(log?.session_id).toBe(sessionId);

    const checkIn = await prisma.checkIn.findFirst({
      where: { attendee_id: attendeeId, status: "VALID" },
      orderBy: { checked_in_at: "desc" },
    });
    expect(checkIn?.device_id).toBe(SESSION_DEVICE);
  });

  it("records a rejected scan with the verified operator, without scan data or attendee PII", async () => {
    const res = await post("/api/checkin/scan", {
      eventId: EVENT_A,
      scanned: "unrecognized-test-ticket",
      deviceId: "spoofed-tablet",
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "INVALID" });

    const [entry] = querySystemLogs({ source: "security", search: "checkin_rejected" });
    expect(entry).toMatchObject({
      level: "warn",
      source: "security",
      message: "checkin_rejected",
      fields: {
        eventId: EVENT_A,
        status: "INVALID",
        deviceId: SESSION_DEVICE,
        actorUserId: USER_OP_A,
        actorEmail: "op-routes@example.com",
      },
    });
    expect(JSON.stringify(entry)).not.toContain("unrecognized-test-ticket");
    expect(JSON.stringify(entry)).not.toContain("jan@firma.pl");
  });

  it("records a rejected bearer scan with its device but no staff identity", async () => {
    const res = await postBearer("/api/checkin/scan", {
      eventId: EVENT_A,
      scanned: "unrecognized-bearer-ticket",
      deviceId: "emergency-kiosk-2",
    });

    expect(res.status).toBe(200);
    const withoutDevice = await postBearer("/api/checkin/scan", {
      eventId: EVENT_A,
      scanned: "unrecognized-bearer-ticket-without-device",
    });
    expect(withoutDevice.status).toBe(200);

    const entries = querySystemLogs({ source: "security", search: "checkin_rejected" });
    expect(entries).toEqual(expect.arrayContaining([expect.objectContaining({
      fields: { eventId: EVENT_A, status: "INVALID", deviceId: "emergency-kiosk-2" },
    }), expect.objectContaining({
      fields: { eventId: EVENT_A, status: "INVALID", deviceId: null },
    })]));
    for (const entry of entries) {
      expect(entry.fields).not.toHaveProperty("actorUserId");
      expect(entry.fields).not.toHaveProperty("actorEmail");
    }
    expect(JSON.stringify(entries)).not.toContain("unrecognized-bearer-ticket");
  });

  it("keeps an authenticated actor id but omits email when its session disappears before audit enrichment", async () => {
    const res = await postWithMissingAuditSession({
      eventId: EVENT_A,
      scanned: "unrecognized-missing-session-ticket",
      deviceId: "spoofed-tablet",
    });

    expect(res.status).toBe(200);
    const [entry] = querySystemLogs({ source: "security", search: "checkin_rejected" });
    expect(entry).toMatchObject({
      fields: { eventId: EVENT_A, status: "INVALID", deviceId: null, actorUserId: USER_OP_A },
    });
    expect(entry?.fields).not.toHaveProperty("actorEmail");
    expect(JSON.stringify(entry)).not.toContain("unrecognized-missing-session-ticket");
  });

  it("records every rejected status without the scanned ticket", async () => {
    const spy = vi.spyOn(ticketOperations, "checkInScan");
    try {
      for (const status of ["REVOKED", "ALREADY_CHECKED_IN"] as const) {
        spy.mockResolvedValueOnce({ status } as never);
        const res = await post("/api/checkin/scan", {
          eventId: EVENT_A,
          scanned: `private-${status}-ticket`,
          deviceId: "spoofed-tablet",
        });
        expect(res.status).toBe(200);
      }

      const entries = querySystemLogs({ source: "security", search: "checkin_rejected" });
      expect(entries).toEqual(expect.arrayContaining([
        expect.objectContaining({ fields: expect.objectContaining({ status: "REVOKED" }) }),
        expect.objectContaining({ fields: expect.objectContaining({ status: "ALREADY_CHECKED_IN" }) }),
      ]));
      expect(JSON.stringify(entries)).not.toContain("private-REVOKED-ticket");
      expect(JSON.stringify(entries)).not.toContain("private-ALREADY_CHECKED_IN-ticket");
    } finally {
      spy.mockRestore();
    }
  });

  it("records a session scan failure with the verified operator and no raw scan data", async () => {
    const userLookupSpy = vi.spyOn(prisma.user, "findUnique");
    const spy = vi.spyOn(ticketOperations, "checkInScan").mockRejectedValueOnce(
      new Error("database failed for jan@firma.pl"),
    );
    try {
      const res = await post("/api/checkin/scan", {
        eventId: EVENT_A,
        scanned: "private-session-ticket",
        deviceId: "spoofed-tablet",
      });

      expect(res.status).toBe(500);
      const [entry] = querySystemLogs({ source: "api", search: "checkin_scan_failed" });
      expect(entry).toMatchObject({
        level: "error",
        source: "api",
        message: "checkin_scan_failed",
        fields: { eventId: EVENT_A, actorUserId: USER_OP_A, actorEmail: "op-routes@example.com" },
      });
      expect(JSON.stringify(entry)).not.toContain("database failed");
      expect(JSON.stringify(entry)).not.toContain("private-session-ticket");
      expect(JSON.stringify(entry)).not.toContain("jan@firma.pl");
      expect(userLookupSpy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
      userLookupSpy.mockRestore();
    }
  });

  it("omits actorEmail from a session scan failure when audit enrichment cannot read the session", async () => {
    const spy = vi.spyOn(ticketOperations, "checkInScan").mockRejectedValueOnce(
      new Error("database failed for jan@firma.pl"),
    );
    try {
      const res = await postWithMissingAuditSession({
        eventId: EVENT_A,
        scanned: "private-missing-session-ticket",
        deviceId: "spoofed-tablet",
      });

      expect(res.status).toBe(500);
      const [entry] = querySystemLogs({ source: "api", search: "checkin_scan_failed" });
      expect(entry).toMatchObject({ fields: { eventId: EVENT_A, actorUserId: USER_OP_A } });
      expect(entry?.fields).not.toHaveProperty("actorEmail");
      expect(JSON.stringify(entry)).not.toContain("database failed");
      expect(JSON.stringify(entry)).not.toContain("private-missing-session-ticket");
    } finally {
      spy.mockRestore();
    }
  });

  it("records a bearer admit failure with only the safe device context", async () => {
    const spy = vi.spyOn(ticketOperations, "admitAttendee")
      .mockRejectedValueOnce(new Error("database failed for jan@firma.pl"))
      .mockRejectedValueOnce(new Error("database failed without a device id"));
    try {
      const res = await postBearer("/api/checkin/admit", {
        eventId: EVENT_A,
        attendeeId,
        deviceId: "emergency-kiosk-2",
        method: "manual",
      });

      expect(res.status).toBe(500);
      const [entry] = querySystemLogs({ source: "api", search: "checkin_admit_failed" });
      expect(entry).toMatchObject({
        fields: { eventId: EVENT_A, deviceId: "emergency-kiosk-2" },
      });
      expect(entry?.fields).not.toHaveProperty("actorUserId");
      expect(entry?.fields).not.toHaveProperty("actorEmail");
      expect(JSON.stringify(entry)).not.toContain("database failed");
      expect(JSON.stringify(entry)).not.toContain("jan@firma.pl");

      const withoutDevice = await postBearer("/api/checkin/admit", {
        eventId: EVENT_A,
        attendeeId,
        method: "manual",
      });
      expect(withoutDevice.status).toBe(500);
      expect(querySystemLogs({ source: "api", search: "checkin_admit_failed" })).toEqual(
        expect.arrayContaining([expect.objectContaining({ fields: { eventId: EVENT_A, deviceId: null } })]),
      );
    } finally {
      spy.mockRestore();
    }
  });
});

describe("POST /api/checkin/undo — session device binding", () => {
  it("ignores spoofed body deviceId and undoes this session device only", async () => {
    await prisma.attendee.update({
      where: { id: attendeeId },
      data: { admitted_at: null, admitted_by: null },
    });
    await prisma.checkIn.deleteMany({ where: { attendee_id: attendeeId } });

    const otherToken = generateToken();
    const otherAtt = await prisma.attendee.create({
      data: {
        event_id: EVENT_A,
        email: "other@example.com",
        name: "Other Guest",
        token_hash: hashToken(otherToken),
      },
    });

    await prisma.checkIn.create({
      data: {
        attendee_id: otherAtt.id,
        event_id: EVENT_A,
        status: "VALID",
        source: "manual",
        device_id: "other-tablet",
        checked_in_by: USER_OP_A,
      },
    });
    await prisma.attendee.update({
      where: { id: otherAtt.id },
      data: { admitted_at: new Date(), admitted_by: USER_OP_A },
    });

    const admitRes = await post("/api/checkin/admit", {
      eventId: EVENT_A,
      attendeeId,
      deviceId: "other-tablet",
      method: "manual",
    });
    expect(admitRes.status).toBe(200);

    const undoRes = await post("/api/checkin/undo", {
      eventId: EVENT_A,
      deviceId: "other-tablet",
    });
    expect(undoRes.status).toBe(200);

    const self = await prisma.attendee.findUnique({ where: { id: attendeeId } });
    expect(self?.admitted_at).toBeNull();

    const other = await prisma.attendee.findUnique({ where: { id: otherAtt.id } });
    expect(other?.admitted_at).not.toBeNull();
  });
});

describe("POST /api/checkin/notes (Lock #8)", () => {
  it("rejects body longer than 2000 characters", async () => {
    const res = await post("/api/checkin/notes", {
      eventId: EVENT_A,
      attendeeId,
      body: "x".repeat(2001),
      deviceId: "tablet-op",
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toMatch(/too long/i);
  });

  it("cross-event attendeeId with own eventId → 404, not 500", async () => {
    const res = await post("/api/checkin/notes", {
      eventId: EVENT_A,
      attendeeId: attendeeIdB,
      body: "hello",
      deviceId: "tablet-op",
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });

  it("records unexpected note failures without its content or attendee PII", async () => {
    const spy = vi.spyOn(ticketOperations, "addAttendeeNote").mockRejectedValueOnce(
      new Error("database failed for jan@firma.pl"),
    );
    try {
      const res = await post("/api/checkin/notes", {
        eventId: EVENT_A,
        attendeeId,
        body: "private note that must not reach System logs",
        deviceId: "spoofed-tablet",
      });

      expect(res.status).toBe(500);
      const [entry] = querySystemLogs({ source: "api", search: "checkin_note_failed" });
      expect(entry).toMatchObject({
        fields: { eventId: EVENT_A, actorUserId: USER_OP_A, actorEmail: "op-routes@example.com" },
      });
      expect(JSON.stringify(entry)).not.toContain("database failed");
      expect(JSON.stringify(entry)).not.toContain("private note");
      expect(JSON.stringify(entry)).not.toContain("jan@firma.pl");
    } finally {
      spy.mockRestore();
    }
  });

  it("records unexpected undo failures without raw exception data", async () => {
    const spy = vi.spyOn(ticketOperations, "undoLastCheckIn").mockRejectedValueOnce(
      new Error("database failed for jan@firma.pl"),
    );
    try {
      const res = await post("/api/checkin/undo", { eventId: EVENT_A, deviceId: "spoofed-tablet" });

      expect(res.status).toBe(500);
      const [entry] = querySystemLogs({ source: "api", search: "checkin_undo_failed" });
      expect(entry).toMatchObject({
        fields: { eventId: EVENT_A, actorUserId: USER_OP_A, actorEmail: "op-routes@example.com" },
      });
      expect(JSON.stringify(entry)).not.toContain("database failed");
      expect(JSON.stringify(entry)).not.toContain("jan@firma.pl");
    } finally {
      spy.mockRestore();
    }
  });
});
