import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { countSeatsInUse } from "@admitto/tickets";
import { buildTestApp } from "../helpers/build-test-app.js";
import { enrollConfirmedTotp } from "../helpers/enroll-confirmed-totp.js";
import { sessionCookieFor } from "../helpers/session-cookie.js";

/**
 * Restoring an attendee to an active status (PATCH status "registered") takes a seat for the attendee and one for each
 * companion (D-B3, D-E5), checked under the capacity lock, and refused in places, not in heads, when they do not all fit.
 * An attendee without a companion is checked exactly as before. A superadmin may force the restore over the limit.
 */
const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");
const sameOrigin = { Origin: "http://localhost" };

const ORG_ID = "org-companion-restore";
const EVENT_ID = "evt-companion-restore";
const EMAILS = { admin: "companion-restore-admin@example.com", superadmin: "companion-restore-super@example.com" };

let prisma: PrismaClient;
let app: ReturnType<typeof buildTestApp>;
const cookies = { admin: "", superadmin: "" };
let sequence = 0;

async function wipeAll(client: PrismaClient): Promise<void> {
  await client.attendee.deleteMany({ where: { event_id: EVENT_ID } });
  await client.adminAuditLog.deleteMany({ where: { organization_id: ORG_ID } });
  await client.roleAssignment.deleteMany({ where: { scope_id: { in: [ORG_ID, EVENT_ID] } } });
  await client.session.deleteMany({ where: { user: { email: { in: Object.values(EMAILS) } } } });
  await client.userMfaMethod.deleteMany({ where: { user: { email: { in: Object.values(EMAILS) } } } });
  await client.user.deleteMany({ where: { email: { in: Object.values(EMAILS) } } });
  await client.event.deleteMany({ where: { id: EVENT_ID } });
  await client.organization.deleteMany({ where: { id: ORG_ID } });
}

beforeAll(async () => {
  prisma = createTestPrismaClient();
  await wipeAll(prisma);
  await prisma.organization.create({ data: { id: ORG_ID, name: "Companion Restore Org", slug: "companion-restore-org" } });
  await prisma.event.create({
    data: { id: EVENT_ID, title: "Companion Restore", slug: "companion-restore", date: new Date("2030-10-01"), organization_id: ORG_ID, capacity: 3 },
  });
  const [admin, superadmin] = await Promise.all(Object.values(EMAILS).map((email) => prisma.user.create({ data: { email } })));
  await prisma.roleAssignment.createMany({
    data: [
      { user_id: admin!.id, role: "admin", scope_type: "organization", scope_id: ORG_ID },
      { user_id: superadmin!.id, role: "superadmin", scope_type: "instance", scope_id: null },
    ],
  });
  for (const user of [admin!, superadmin!]) await enrollConfirmedTotp(prisma, user.id);
  cookies.admin = await sessionCookieFor(prisma, admin!.id);
  cookies.superadmin = await sessionCookieFor(prisma, superadmin!.id);
});

beforeEach(async () => {
  await prisma.attendee.deleteMany({ where: { event_id: EVENT_ID } });
  await prisma.event.update({ where: { id: EVENT_ID }, data: { capacity: 3 } });
  app = buildTestApp({ prisma, checkinToken: "companion-restore-checkin-token-32!", adminDistRoot });
});

afterAll(async () => {
  if (prisma) await wipeAll(prisma);
  await prisma?.$disconnect();
});

/** An attendee of the event, with a companion when asked to. */
async function attendee(options: { status?: string; companion?: boolean } = {}) {
  sequence += 1;
  const row = await prisma.attendee.create({
    data: {
      event_id: EVENT_ID,
      email: `companion-restore-${sequence}@example.com`,
      name: `Attendee ${sequence}`,
      status: options.status ?? "registered",
      ...(options.companion ? { companions: { create: { slot: 1, name: "Companion Example" } } } : {}),
    },
  });
  return row;
}

/** Restores the attendee, as the staff member of the cookie, with the version of the row they were shown. */
async function restore(attendeeId: string, init: { cookie?: string; force?: boolean } = {}): Promise<Response> {
  const row = await prisma.attendee.findUniqueOrThrow({ where: { id: attendeeId }, select: { updated_at: true } });
  return await app.request(`/api/admin/events/${EVENT_ID}/attendees/${attendeeId}${init.force ? "?force=1" : ""}`, {
    method: "PATCH",
    headers: { Cookie: init.cookie ?? cookies.admin, ...sameOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({ status: "registered", expected_updated_at: row.updated_at.toISOString() }),
  });
}

const statusOf = async (id: string) => (await prisma.attendee.findUniqueOrThrow({ where: { id } })).status;
const seats = () => countSeatsInUse(prisma, EVENT_ID);

describe("restoring an attendee who has a companion", () => {
  it.each(["revoked", "cancelled"])("refuses a %s attendee when only one seat is free, in places, and changes nothing", async (status) => {
    await attendee();
    await attendee();
    const guest = await attendee({ status, companion: true });
    expect(await seats()).toBe(2);

    const res = await restore(guest.id);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      code: "event_full",
      error: "Not enough free places: restoring this attendee needs 2 (the attendee and 1 companion), and 1 is free.",
      capacity: 3,
      current: 2,
      incoming: 2,
      projected: 4,
    });
    expect(await statusOf(guest.id)).toBe(status);
    expect(await seats()).toBe(2);
  });

  it("restores the attendee when two seats are free, and the event is then full", async () => {
    await attendee();
    const guest = await attendee({ status: "revoked", companion: true });
    expect(await seats()).toBe(1);

    const res = await restore(guest.id);

    expect(res.status).toBe(200);
    expect(await statusOf(guest.id)).toBe("registered");
    expect(await seats()).toBe(3);
  });

  it("says the same in places when no seat is free at all", async () => {
    await attendee();
    await attendee();
    await attendee();
    const guest = await attendee({ status: "revoked", companion: true });

    const body = (await (await restore(guest.id)).json()) as { error: string; current: number; incoming: number };

    expect(body).toMatchObject({ current: 3, incoming: 2 });
    expect(body.error).toBe("Not enough free places: restoring this attendee needs 2 (the attendee and 1 companion), and 0 are free.");
  });

  it("lets a superadmin force the restore over the limit, and an administrator not", async () => {
    await attendee();
    await attendee();
    const guest = await attendee({ status: "revoked", companion: true });

    expect((await restore(guest.id, { force: true })).status).toBe(409);
    expect(await statusOf(guest.id)).toBe("revoked");

    const forced = await restore(guest.id, { cookie: cookies.superadmin, force: true });

    expect(forced.status).toBe(200);
    expect(await statusOf(guest.id)).toBe("registered");
    // Over the limit, as a forced add has always been allowed to be (D-B7): 4 seats on an event of 3.
    expect(await seats()).toBe(4);
  });

  it("keeps the seats of a companion the attendee had out of the check while they are revoked", async () => {
    const guest = await attendee({ companion: true });
    await attendee();
    expect(await seats()).toBe(3);

    const revoked = await app.request(`/api/admin/events/${EVENT_ID}/attendees/${guest.id}`, {
      method: "PATCH",
      headers: { Cookie: cookies.admin, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "revoked",
        expected_updated_at: (await prisma.attendee.findUniqueOrThrow({ where: { id: guest.id } })).updated_at.toISOString(),
      }),
    });

    expect(revoked.status).toBe(200);
    expect(await seats()).toBe(1);
    expect((await restore(guest.id)).status).toBe(200);
    expect(await seats()).toBe(3);
  });
});

describe("restoring an attendee who has no companion", () => {
  it("is checked as before: one seat, and the one-seat refusal when the event is full", async () => {
    await attendee();
    await attendee();
    await attendee();
    const guest = await attendee({ status: "revoked" });

    const res = await restore(guest.id);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      code: "event_full",
      error: "Event has reached its capacity limit.",
      capacity: 3,
      current: 3,
    });
    expect(await statusOf(guest.id)).toBe("revoked");
  });

  it("restores when one seat is free", async () => {
    await attendee();
    await attendee();
    const guest = await attendee({ status: "revoked" });
    expect((await restore(guest.id)).status).toBe(200);
    expect(await seats()).toBe(3);
  });
});
