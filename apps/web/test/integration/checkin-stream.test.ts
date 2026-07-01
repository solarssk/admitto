import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { PrismaClient } from "@prisma/client";
import { hashPassword, createSession, SESSION_STAGE } from "@admitto/auth";
import {
  createCheckinPreAuth,
  createCheckinEventScope,
} from "../../src/checkin-gate.js";
import { handleEventStream, HEARTBEAT_MS } from "../../src/admin/checkin-stream-routes.js";
import { publish, resetSseChannelsForTests, subscriberCount } from "../../src/admin/sse-channel.js";

const ORG_A = "org-stream-a";
const EVENT_A = "event-stream-a";
const USER_OP_A = "user-stream-op-a";

let prisma: PrismaClient;
let opCookie = "";

async function seed(client: PrismaClient) {
  await client.roleAssignment.deleteMany({ where: { user_id: USER_OP_A } });
  await client.session.deleteMany({ where: { user_id: USER_OP_A } });
  await client.user.deleteMany({ where: { id: USER_OP_A } });
  await client.event.deleteMany({ where: { id: EVENT_A } });
  await client.organization.deleteMany({ where: { id: ORG_A } });

  const password_hash = await hashPassword("stream-pass-123");

  await client.organization.create({
    data: { id: ORG_A, name: "Stream Org", slug: "stream-org" },
  });
  await client.event.create({
    data: {
      id: EVENT_A,
      title: "Stream Event",
      slug: "stream-event",
      date: new Date("2026-09-01"),
      organization_id: ORG_A,
    },
  });
  await client.user.create({
    data: { id: USER_OP_A, email: "stream-op@example.com", password_hash },
  });
  await client.roleAssignment.create({
    data: { user_id: USER_OP_A, role: "operator", scope_type: "event", scope_id: EVENT_A },
  });

  const { rawToken } = await createSession(prisma, { userId: USER_OP_A, stage: SESSION_STAGE.FULL });
  opCookie = `admitto_session=${rawToken}`;
}

function buildStreamApp() {
  const deps = { prisma, config: { allowBearer: false, operatorToken: null } };
  const app = new Hono();
  app.get(
    "/api/checkin/events/:eventId/stream",
    createCheckinPreAuth(deps),
    createCheckinEventScope(deps, (c) => c.req.param("eventId")),
    (c) => handleEventStream(c),
  );
  return app;
}

describe("GET /api/checkin/events/:eventId/stream", () => {
  beforeAll(async () => {
    prisma = new PrismaClient();
    await seed(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  afterEach(() => {
    resetSseChannelsForTests();
  });

  it("returns text/event-stream for authorized operator", async () => {
    const app = buildStreamApp();
    const res = await app.request(`/api/checkin/events/${EVENT_A}/stream`, {
      headers: { Cookie: opCookie },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    await res.body?.cancel();
  });

  it("emits ping events on heartbeat interval", async () => {
    vi.useFakeTimers();
    try {
      const app = buildStreamApp();

      const res = await app.request(`/api/checkin/events/${EVENT_A}/stream`, {
        headers: { Cookie: opCookie },
      });
      expect(res.status).toBe(200);

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const readChunk = async () => {
        const { value, done } = await reader.read();
        if (done) return false;
        buffer += decoder.decode(value, { stream: true });
        return true;
      };

      await readChunk();
      expect(buffer).toContain('"type":"ping"');

      buffer = "";
      await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
      await readChunk();
      expect(buffer).toContain('"type":"ping"');

      await reader.cancel();
    } finally {
      vi.useRealTimers();
    }
  });

  it("delivers published checkin events and cleans up subscribers on disconnect", async () => {
    const app = buildStreamApp();
    const res = await app.request(`/api/checkin/events/${EVENT_A}/stream`, {
      headers: { Cookie: opCookie },
    });
    expect(res.status).toBe(200);
    expect(subscriberCount(EVENT_A)).toBe(1);

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const readChunk = async () => {
      const { value, done } = await reader.read();
      if (done) return false;
      buffer += decoder.decode(value, { stream: true });
      return true;
    };

    await readChunk();
    buffer = "";

    publish(EVENT_A, {
      type: "checkin",
      attendeeId: "att-stream-1",
      attendeeName: "Stream Guest",
      ticketType: "GA",
      admittedAt: "2026-07-01T12:00:00.000Z",
      operatorId: USER_OP_A,
      deviceLabel: null,
    });

    await readChunk();
    expect(buffer).toContain('"type":"checkin"');
    expect(buffer).toContain("att-stream-1");

    await reader.cancel();
    expect(subscriberCount(EVENT_A)).toBe(0);
  });
});
