import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { PrismaClient } from "@prisma/client";
import { hashPassword, createSession, SESSION_STAGE } from "@admitto/auth";
import { generateToken, hashToken } from "@admitto/tickets";
import {
  createCheckinPreAuth,
  createCheckinSessionCsrfGuard,
  createCheckinEventScope,
  parseScanBodyMiddleware,
} from "../../src/checkin-gate.js";
import {
  handleCheckinLookup,
  handleCheckinAdmit,
  handleCheckinNote,
  handleCheckinUndo,
  eventIdFromCheckinBody,
} from "../../src/admin/checkin-api-routes.js";

const ORG_A = "org-op-routes-a";
const ORG_B = "org-op-routes-b";
const EVENT_A = "event-op-routes-a";
const EVENT_B = "event-op-routes-b";
const USER_OP_A = "user-op-routes-a";
const ATTENDEE_A = "attendee-op-routes-a";
const SESSION_DEVICE = "tablet-session-a";

let prisma: PrismaClient;
let attendeeId: string;
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
}

function buildMutatingApp() {
  const deps = {
    prisma,
    config: { allowBearer: false, operatorToken: null },
  };
  const app = new Hono();
  const chain = [
    createCheckinPreAuth(deps),
    createCheckinSessionCsrfGuard(),
    parseScanBodyMiddleware,
    createCheckinEventScope(deps, eventIdFromCheckinBody),
  ] as const;

  app.post("/api/checkin/lookup", ...chain, (c) => handleCheckinLookup(c, prisma));
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
});
