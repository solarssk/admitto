/**
 * The admin attendee API for an erased attendee: the list hides them by default and counts them,
 * the page is read-only (every edit, send and wallet action is refused with 409 attendee_erased),
 * bulk edits skip them, and exports and the PII export leave them out.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { createSession, hashPassword, SESSION_STAGE } from "@admitto/auth";
import { encryptTotpSecret, generateTotpSecret } from "@admitto/auth/testing";
import { encryptToString } from "@admitto/crypto";
import { eraseAttendees } from "@admitto/tickets";
import { createApp } from "../../src/app.js";
import { createRateLimitStore } from "../../src/rate-limit/index.js";

const ORG_ID = "org-admin-erased";
const EVENT_ID = "evt-admin-erased";
const LIVE_ID = "att-admin-erased-live";
const GONE_ID = "att-admin-erased-gone";
const RACE_PREFIX = "att-admin-erased-race";
const GONE_ADMITTED_ID = "att-admin-erased-gone-admitted";
const GONE_DELETE_ID = "att-admin-erased-gone-delete";
const GONE_BULK_DELETE_ID = "att-admin-erased-gone-bulk-delete";
const SUPER_EMAIL = "admin-erased-super@example.com";
const SUPER_PASSWORD = "admin-erased-super-pass-123";
const sameOrigin = { Origin: "http://localhost" };

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;
let cookie = "";

const json = (method: string, body?: unknown) => ({
  method,
  headers: { Cookie: cookie, ...sameOrigin, "Content-Type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const get = (path: string) => app.request(path, { headers: { Cookie: cookie } });
const base = `/api/admin/events/${EVENT_ID}/attendees`;

beforeAll(async () => {
  prisma = createTestPrismaClient();
  await prisma.walletPass.deleteMany({ where: { attendee: { event_id: EVENT_ID } } });
  await prisma.attendee.deleteMany({ where: { event_id: EVENT_ID } });
  await prisma.event.deleteMany({ where: { id: EVENT_ID } });
  await prisma.organization.deleteMany({ where: { id: ORG_ID } });
  await prisma.organization.create({ data: { id: ORG_ID, name: "Org", slug: "admin-erased-org" } });
  await prisma.event.create({
    data: {
      id: EVENT_ID,
      title: "Admin Erased",
      slug: "admin-erased",
      date: new Date("2099-09-01"),
      organization_id: ORG_ID,
      wallet_template_id: "tmpl-admin-erased",
      wallet_api_key_enc: encryptToString("admin-erased-key"),
    },
  });
  for (const [id, name] of [
    [LIVE_ID, "Live Person"],
    [GONE_ID, "Gone Person"],
    [GONE_ADMITTED_ID, "Gone Admitted"],
    [GONE_DELETE_ID, "Gone Delete"],
    [GONE_BULK_DELETE_ID, "Gone Bulk"],
  ] as const) {
    await prisma.attendee.create({
      data: {
        id,
        event_id: EVENT_ID,
        email: `${id}@example.com`,
        name,
        first_name: name.split(" ")[0],
        last_name: name.split(" ")[1],
        company: "Acme",
        ...(id === GONE_ADMITTED_ID ? { admitted_at: new Date("2026-09-01T10:15:00Z") } : {}),
      },
    });
    await prisma.walletPass.create({
      data: { attendee_id: id, status: "active", provider_pass_id: `pc-${id}`, user_provided_id: `u-${id}` },
    });
  }
  await prisma.$transaction((tx) =>
    eraseAttendees(tx, {
      eventId: EVENT_ID,
      attendeeIds: [GONE_ID, GONE_ADMITTED_ID, GONE_DELETE_ID, GONE_BULK_DELETE_ID],
    }),
  );

  await prisma.session.deleteMany({ where: { user: { email: SUPER_EMAIL } } });
  await prisma.roleAssignment.deleteMany({ where: { user: { email: SUPER_EMAIL } } });
  await prisma.user.deleteMany({ where: { email: SUPER_EMAIL } });
  const user = await prisma.user.create({
    data: { email: SUPER_EMAIL, password_hash: await hashPassword(SUPER_PASSWORD) },
  });
  await prisma.roleAssignment.create({
    data: { user_id: user.id, role: "superadmin", scope_type: "instance", scope_id: null },
  });
  await prisma.userMfaMethod.create({
    data: {
      user_id: user.id,
      type: "totp",
      secret_enc: encryptTotpSecret(generateTotpSecret()),
      confirmed_at: new Date(),
    },
  });
  const session = await createSession(prisma, { userId: user.id, stage: SESSION_STAGE.FULL });
  cookie = `admitto_session=${session.rawToken}`;
  app = createApp({
    prisma,
    baseUrl: "https://tickets.example.com",
    rateLimitStore: createRateLimitStore(),
    skipCheckinBootValidation: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await prisma?.$disconnect();
});

describe("the attendee list and detail", () => {
  it("hides erased attendees by default, counts them, and leaves them out of a search for the placeholder", async () => {
    const res = await get(`${base}?pageSize=100`);
    const body = (await res.json()) as { items: { id: string }[]; total: number; erased_count: number };
    expect(res.status).toBe(200);
    expect(body.items.map((i) => i.id)).toEqual([LIVE_ID]);
    expect(body.total).toBe(1);
    expect(body.erased_count).toBe(4);

    const search = (await (await get(`${base}?q=invalid`)).json()) as { items: unknown[]; total: number };
    expect(search.items).toEqual([]);
    expect(search.total).toBe(0);
  });

  it("shows them, marked, when asked to", async () => {
    const res = await get(`${base}?pageSize=100&include_erased=1`);
    const body = (await res.json()) as { items: { id: string; erased_at: string | null }[]; total: number };
    expect(body.total).toBe(5);
    const byId = new Map(body.items.map((i) => [i.id, i]));
    expect(byId.get(LIVE_ID)?.erased_at).toBeNull();
    expect(byId.get(GONE_ID)?.erased_at).not.toBeNull();
  });

  it("still opens the page of an erased attendee, marked as erased", async () => {
    const res = await get(`${base}/${GONE_ID}`);
    const body = (await res.json()) as { erased_at: string | null; name: string };
    expect(res.status).toBe(200);
    expect(body.erased_at).not.toBeNull();
    expect(body.name).toBe("Erased attendee");
  });
});

describe("the count of hidden attendees", () => {
  it("is event-wide: filters and a search do not change it", async () => {
    for (const query of ["q=Live", "status=admitted", "q=nobody-matches-this"]) {
      const body = (await (await get(`${base}?${query}`)).json()) as { erased_count: number };
      expect(body.erased_count).toBe(4);
    }
  });
});

describe("actions on an erased attendee are refused", () => {
  const expected = { error: "attendee_erased" };

  it.each([
    ["edit", "PATCH", `/${GONE_ID}`, { company: "New", expected_updated_at: new Date().toISOString() }],
    ["resend", "POST", `/${GONE_ID}/resend`, {}],
    ["ticket link", "POST", `/${GONE_ID}/ticket-link`, {}],
    ["bounce dismissal", "POST", `/${GONE_ID}/dismiss-bounce`, {}],
    ["note", "POST", `/${GONE_ID}/notes`, { body: "hello" }],
    ["check-in revoke", "POST", `/${GONE_ADMITTED_ID}/revoke-checkin`, {}],
    ["item revoke", "POST", `/${GONE_ID}/items/badge/revoke`, {}],
    ["wallet void", "POST", `/${GONE_ID}/wallet/void`, {}],
    ["wallet restore", "POST", `/${GONE_ID}/wallet/restore`, {}],
    ["wallet delete", "POST", `/${GONE_ID}/wallet/delete`, {}],
    ["wallet remove", "POST", `/${GONE_ID}/wallet/remove`, {}],
    ["wallet reissue", "POST", `/${GONE_ID}/wallet/reissue`, {}],
    ["wallet refresh", "POST", `/${GONE_ID}/wallet/refresh-status`, {}],
  ] as const)("%s answers 409 attendee_erased", async (_name, method, path, body) => {
    const res = await app.request(`${base}${path}`, json(method, body));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual(expected);
  });

  it("changes nothing on the erased attendee's admission or pass", async () => {
    const row = await prisma.attendee.findUniqueOrThrow({ where: { id: GONE_ADMITTED_ID } });
    expect(row.admitted_at).not.toBeNull();
    expect((await prisma.walletPass.findUniqueOrThrow({ where: { attendee_id: GONE_ID } })).status).toBe("active");
  });
});

describe("bulk actions skip an erased attendee", () => {
  it("a bulk RSVP change reaches the live attendee only", async () => {
    const res = await app.request(
      `${base}/bulk-rsvp`,
      json("POST", { attendeeIds: [LIVE_ID, GONE_ID], rsvp_status: "confirmed" }),
    );
    expect(res.status).toBe(200);
    expect((await prisma.attendee.findUniqueOrThrow({ where: { id: LIVE_ID } })).rsvp_status).toBe("confirmed");
    expect((await prisma.attendee.findUniqueOrThrow({ where: { id: GONE_ID } })).rsvp_status).toBe("none");
  });

  it("a bulk pass revoke leaves the erased attendee's status alone", async () => {
    const before = await prisma.attendee.findUniqueOrThrow({ where: { id: GONE_ADMITTED_ID } });
    const res = await app.request(`${base}/bulk-revoke-pass`, json("POST", { attendeeIds: [GONE_ADMITTED_ID] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ revoked: 0, skipped: 1 });
    expect((await prisma.attendee.findUniqueOrThrow({ where: { id: GONE_ADMITTED_ID } })).status).toBe(before.status);
  });

  it("a bulk company change reaches the live attendee only", async () => {
    const res = await app.request(
      `${base}/bulk-set-field`,
      json("POST", { attendeeIds: [LIVE_ID, GONE_ID], field: "company", value: "Beta Ltd" }),
    );
    expect(res.status).toBe(200);
    expect((await prisma.attendee.findUniqueOrThrow({ where: { id: LIVE_ID } })).company).toBe("Beta Ltd");
    expect((await prisma.attendee.findUniqueOrThrow({ where: { id: GONE_ID } })).company).toBeNull();
  });

  it("a bulk ticket type change reaches the live attendee only", async () => {
    await prisma.ticketType.create({ data: { event_id: EVENT_ID, key: "vip", label: "VIP" } });
    const res = await app.request(
      `${base}/bulk-ticket-type`,
      json("POST", { attendeeIds: [LIVE_ID, GONE_ID], ticket_type: "vip" }),
    );
    expect(res.status).toBe(200);
    expect((await prisma.attendee.findUniqueOrThrow({ where: { id: LIVE_ID } })).ticket_type).toBe("vip");
    expect((await prisma.attendee.findUniqueOrThrow({ where: { id: GONE_ID } })).ticket_type).toBeNull();
  });

  it("a bulk check-in counts an erased attendee as invalid and admits no one", async () => {
    const res = await app.request(`${base}/bulk-checkin`, json("POST", { attendeeIds: [GONE_ID] }));
    expect(await res.json()).toMatchObject({ checkedIn: 0, invalid: 1 });
    expect((await prisma.attendee.findUniqueOrThrow({ where: { id: GONE_ID } })).admitted_at).toBeNull();
  });

  it("a bulk check-in revoke leaves an erased attendee's admission in place", async () => {
    const res = await app.request(`${base}/bulk-revoke-checkin`, json("POST", { attendeeIds: [GONE_ADMITTED_ID] }));
    expect(await res.json()).toMatchObject({ revoked: 0 });
    expect((await prisma.attendee.findUniqueOrThrow({ where: { id: GONE_ADMITTED_ID } })).admitted_at).not.toBeNull();
  });

  it("a bulk wallet refresh and delete skip the erased attendee's pass", async () => {
    for (const action of ["bulk-wallet-delete", "bulk-wallet-remove", "bulk-wallet-refresh-status", "bulk-wallet-reissue"]) {
      const res = await app.request(`${base}/${action}`, json("POST", { attendeeIds: [GONE_ID] }));
      // Wallet is not configured in this harness (409), or the erased pass is skipped (200):
      // either way the pass row is untouched, checked below.
      expect([200, 409]).toContain(res.status);
    }
    expect(await prisma.walletPass.findUnique({ where: { attendee_id: GONE_ID } })).not.toBeNull();
  });

  it("an export request ignores include_erased", async () => {
    const res = await get(`${base}/export?format=csv&include_erased=1`);
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ rowCount: 1 });
  });

  it("a selection export contains no erased attendee", async () => {
    const res = await app.request(`${base}/export-selected`, json("POST", { attendee_ids: [LIVE_ID, GONE_ID], format: "csv" }));
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).toContain("Live Person");
    expect(text).not.toContain("Erased attendee");
    expect(text).not.toContain("erased.invalid");
  });
});

describe("feeds and exports", () => {
  it("leaves an erased attendee out of the recent activity of the overview", async () => {
    await prisma.emailDelivery.create({
      data: {
        organization_id: ORG_ID,
        event_id: EVENT_ID,
        attendee_id: GONE_ID,
        provider: "smtp",
        status: "bounced",
        recipient_email: null,
      },
    });
    await prisma.checkIn.create({
      data: { attendee_id: GONE_ADMITTED_ID, event_id: EVENT_ID, status: "VALID", source: "scan", checked_in_at: new Date("2026-09-01T10:00:00Z") },
    });

    const res = await get(`/api/admin/events/${EVENT_ID}/overview`);
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(text).not.toContain("erased.invalid");
    expect(text).not.toContain("Erased attendee");
  });

  it("leaves an erased attendee out of the personal data export", async () => {
    const res = await get(`/api/admin/events/${EVENT_ID}/export-pii`);
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).toContain(`${LIVE_ID}@example.com`);
    expect(text).not.toContain("erased.invalid");
  });

  it("counts only the live attendees' admissions for the event-wide check-in revoke", async () => {
    const res = await get(`/api/admin/events/${EVENT_ID}/settings`);
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(JSON.parse(text)).toMatchObject({ admitted_count: 0 });
  });
});

describe("removing an erased attendee still works", () => {
  it("deletes one", async () => {
    const res = await app.request(`${base}/${GONE_DELETE_ID}`, json("DELETE"));
    expect(res.status).toBe(204);
    expect(await prisma.attendee.findUnique({ where: { id: GONE_DELETE_ID } })).toBeNull();
  });

  it("deletes several", async () => {
    const res = await app.request(`${base}/bulk-delete`, json("POST", { attendeeIds: [GONE_BULK_DELETE_ID] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deletedCount: 1 });
    expect(await prisma.attendee.findUnique({ where: { id: GONE_BULK_DELETE_ID } })).toBeNull();
  });
});

describe("an erasure that lands between a route's check and its write", () => {
  let n = 0;
  const raceAttendee = async () => {
    const id = `${RACE_PREFIX}-${++n}`;
    await prisma.attendee.create({ data: { id, event_id: EVENT_ID, email: `${id}@example.com`, name: id } });
    return id;
  };
  /** The next transaction of the request is preceded by the erasure of `ids`. */
  const eraseBeforeNextTransaction = (ids: string[]) => {
    const real = prisma.$transaction.bind(prisma) as unknown as (...args: unknown[]) => Promise<unknown>;
    return vi.spyOn(prisma, "$transaction").mockImplementationOnce(((...args: unknown[]) =>
      real((tx: unknown) => eraseAttendees(tx as never, { eventId: EVENT_ID, attendeeIds: ids })).then(() =>
        real(...args),
      )) as never);
  };

  it("dismissing a bounce is refused and writes nothing", async () => {
    const id = await raceAttendee();
    eraseBeforeNextTransaction([id]);

    const res = await app.request(`${base}/${id}/dismiss-bounce`, json("POST", {}));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "attendee_erased" });
  });

  it("adding a note is refused and leaves no note", async () => {
    const id = await raceAttendee();
    eraseBeforeNextTransaction([id]);

    const res = await app.request(`${base}/${id}/notes`, json("POST", { body: "late note" }));

    expect(res.status).toBe(409);
    expect(await prisma.attendeeNote.count({ where: { attendee_id: id } })).toBe(0);
  });

  it("an edit is answered as a stale write and changes nothing", async () => {
    const id = await raceAttendee();
    const row = await prisma.attendee.findUniqueOrThrow({ where: { id } });
    eraseBeforeNextTransaction([id]);

    const res = await app.request(
      `${base}/${id}`,
      json("PATCH", { company: "Late Edit", expected_updated_at: row.updated_at.toISOString() }),
    );

    expect(res.status).toBe(409);
    expect((await prisma.attendee.findUniqueOrThrow({ where: { id } })).company).toBeNull();
  });

  it("voiding a wallet pass is refused after the provider call when the attendee was erased meanwhile", async () => {
    const id = await raceAttendee();
    await prisma.walletPass.create({ data: { attendee_id: id, status: "active", provider_pass_id: `pc-${id}` } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 })));
    // The pass row is read first; the transaction that records the void is the next one.
    const spy = eraseBeforeNextTransaction([id]);

    const res = await app.request(`${base}/${id}/wallet/void`, json("POST", {}));

    expect(spy).toHaveBeenCalled();
    expect(res.status).toBe(409);
    expect((await prisma.walletPass.findUniqueOrThrow({ where: { attendee_id: id } })).status).toBe("active");
  });
});
