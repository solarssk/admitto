import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient, type Prisma, type RegistrationMailTemplateName, type RegistrationStatus } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { MAX_REGISTRATION_BULK_IDS } from "@admitto/tickets";
import type {
  RegistrationCountsDto,
  RegistrationDetailDto,
  RegistrationListDto,
} from "../../src/admin/registrations-api-routes.js";
import { buildTestApp } from "../helpers/build-test-app.js";
import { enrollConfirmedTotp } from "../helpers/enroll-confirmed-totp.js";
import { sessionCookieFor } from "../helpers/session-cookie.js";

const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");

const ORG_A = "org-regs-a";
const ORG_B = "org-regs-b";
const EVENT_A = "evt-regs-a";
const EVENT_A2 = "evt-regs-a2";
const EVENT_B = "evt-regs-b";
const EVENT_ARCHIVED = "evt-regs-archived";
const EVENT_IDS = [EVENT_A, EVENT_A2, EVENT_B, EVENT_ARCHIVED];

const EMAILS = {
  adminA: "regs-admin-a@example.com",
  adminB: "regs-admin-b@example.com",
  operator: "regs-operator@example.com",
  superadmin: "regs-super@example.com",
  decider: "regs-decider@example.com",
  deciderNoName: "regs-decider-noname@example.com",
};

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
/** A fixed moment for the tests that only care about the order of the rows. */
const BASE_TIME = Date.UTC(2026, 9, 1, 10, 0, 0);
const at = (minutes: number) => new Date(BASE_TIME + minutes * MINUTE_MS);

let prisma: PrismaClient;
let app: ReturnType<typeof buildTestApp>;
const cookies = { adminA: "", adminB: "", operator: "", superadmin: "" };
const staff = { decider: "", deciderNoName: "" };

/** A fresh app has a fresh rate limit store, so a group of tests never spends another group's search budget. */
function freshApp(): ReturnType<typeof buildTestApp> {
  return buildTestApp({ prisma, checkinToken: "regs-checkin-token-32-characters!!", adminDistRoot });
}

async function wipe(client: PrismaClient): Promise<void> {
  await client.registration.deleteMany({ where: { event_id: { in: EVENT_IDS } } });
  await client.attendee.deleteMany({ where: { event_id: { in: EVENT_IDS } } });
  await client.eventRegistrationSettings.deleteMany({ where: { event_id: { in: EVENT_IDS } } });
  await client.adminAuditLog.deleteMany({ where: { organization_id: { in: [ORG_A, ORG_B] } } });
  await client.roleAssignment.deleteMany({ where: { scope_id: { in: [ORG_A, ORG_B, ...EVENT_IDS] } } });
  await client.session.deleteMany({ where: { user: { email: { in: Object.values(EMAILS) } } } });
  await client.userMfaMethod.deleteMany({ where: { user: { email: { in: Object.values(EMAILS) } } } });
  await client.user.deleteMany({ where: { email: { in: Object.values(EMAILS) } } });
  await client.event.deleteMany({ where: { id: { in: EVENT_IDS } } });
  await client.organization.deleteMany({ where: { id: { in: [ORG_A, ORG_B] } } });
}

async function seed(client: PrismaClient): Promise<Record<keyof typeof cookies, string>> {
  await wipe(client);
  await client.organization.createMany({
    data: [
      { id: ORG_A, name: "Regs Org A", slug: "regs-org-a" },
      { id: ORG_B, name: "Regs Org B", slug: "regs-org-b" },
    ],
  });
  await client.event.createMany({
    data: [
      { id: EVENT_A, title: "Regs A", slug: "regs-a", date: new Date("2026-10-01"), organization_id: ORG_A },
      { id: EVENT_A2, title: "Regs A2", slug: "regs-a2", date: new Date("2026-10-02"), organization_id: ORG_A },
      { id: EVENT_B, title: "Regs B", slug: "regs-b", date: new Date("2026-10-03"), organization_id: ORG_B },
      {
        id: EVENT_ARCHIVED,
        title: "Regs Archived",
        slug: "regs-archived",
        date: new Date("2026-09-01"),
        organization_id: ORG_A,
        archived_at: new Date(),
      },
    ],
  });
  const [adminA, adminB, operator, superadmin, decider, deciderNoName] = await Promise.all([
    client.user.create({ data: { email: EMAILS.adminA } }),
    client.user.create({ data: { email: EMAILS.adminB } }),
    client.user.create({ data: { email: EMAILS.operator } }),
    client.user.create({ data: { email: EMAILS.superadmin } }),
    client.user.create({ data: { email: EMAILS.decider, display_name: "Dana Decider" } }),
    client.user.create({ data: { email: EMAILS.deciderNoName } }),
  ]);
  await client.roleAssignment.createMany({
    data: [
      { user_id: adminA.id, role: "admin", scope_type: "organization", scope_id: ORG_A },
      { user_id: adminB.id, role: "admin", scope_type: "organization", scope_id: ORG_B },
      { user_id: operator.id, role: "operator", scope_type: "event", scope_id: EVENT_A },
      { user_id: superadmin.id, role: "superadmin", scope_type: "instance", scope_id: null },
    ],
  });
  for (const user of [adminA, adminB, superadmin]) await enrollConfirmedTotp(client, user.id);
  staff.decider = decider.id;
  staff.deciderNoName = deciderNoName.id;
  return {
    adminA: await sessionCookieFor(client, adminA.id),
    adminB: await sessionCookieFor(client, adminB.id),
    operator: await sessionCookieFor(client, operator.id),
    superadmin: await sessionCookieFor(client, superadmin.id),
  };
}

type SeedRegistration = {
  id?: string;
  eventId?: string;
  email: string;
  firstName?: string;
  lastName?: string;
  status?: RegistrationStatus;
  createdAt?: Date;
  company?: string | null;
  department?: string | null;
  customData?: Prisma.InputJsonValue;
  companions?: Prisma.InputJsonValue;
  consents?: Prisma.InputJsonValue;
  acceptedAt?: Date | null;
  emailVerifiedAt?: Date | null;
  decidedAt?: Date | null;
  decidedBy?: string | null;
  locale?: string | null;
};

/** Writes one registration that satisfies the table's constraints: an accepted one gets its attendee, one
 * that waits for the address gets its expiry. */
async function addRegistration(seedRow: SeedRegistration): Promise<string> {
  const eventId = seedRow.eventId ?? EVENT_A;
  const status = seedRow.status ?? "pending";
  const createdAt = seedRow.createdAt ?? new Date();
  const firstName = seedRow.firstName ?? "Test";
  const lastName = seedRow.lastName ?? "Guest";
  const attendee =
    status === "accepted"
      ? await prisma.attendee.create({
          data: { event_id: eventId, email: seedRow.email, name: `${firstName} ${lastName}` },
          select: { id: true },
        })
      : null;
  const row = await prisma.registration.create({
    data: {
      ...(seedRow.id === undefined ? {} : { id: seedRow.id }),
      event_id: eventId,
      email: seedRow.email,
      first_name: firstName,
      last_name: lastName,
      name: `${firstName} ${lastName}`,
      company: seedRow.company ?? null,
      department: seedRow.department ?? null,
      ...(seedRow.customData === undefined ? {} : { custom_data: seedRow.customData }),
      ...(seedRow.companions === undefined ? {} : { companions: seedRow.companions }),
      ...(seedRow.consents === undefined ? {} : { consents: seedRow.consents }),
      status,
      confirm_expires_at: status === "awaiting_email" ? new Date(createdAt.getTime() + DAY_MS) : null,
      email_verified_at: seedRow.emailVerifiedAt ?? null,
      accepted_at: seedRow.acceptedAt ?? null,
      decided_at: seedRow.decidedAt ?? null,
      decided_by: seedRow.decidedBy ?? null,
      locale: seedRow.locale ?? null,
      attendee_id: attendee?.id ?? null,
      created_at: createdAt,
    },
    select: { id: true },
  });
  return row.id;
}

async function addMail(
  registrationId: string,
  template: RegistrationMailTemplateName,
  extra: Partial<Prisma.RegistrationMailUncheckedCreateInput> = {},
  eventId = EVENT_A,
): Promise<string> {
  const mail = await prisma.registrationMail.create({
    data: { registration_id: registrationId, event_id: eventId, template_name: template, status: "sent", ...extra },
    select: { id: true },
  });
  return mail.id;
}

const regsUrl = (eventId: string, tail = "") => `/api/admin/events/${eventId}/registrations${tail}`;

async function get(path: string, cookie: string = cookies.adminA): Promise<Response> {
  return await app.request(path, { headers: cookie ? { Cookie: cookie } : {} });
}

async function list(query = "", eventId = EVENT_A, cookie?: string): Promise<RegistrationListDto> {
  const res = await get(regsUrl(eventId) + (query ? `?${query}` : ""), cookie);
  expect(res.status).toBe(200);
  return (await res.json()) as RegistrationListDto;
}

const ids = (body: RegistrationListDto) => body.items.map((item) => item.id);

beforeAll(async () => {
  prisma = createTestPrismaClient();
  Object.assign(cookies, await seed(prisma));
  app = freshApp();
});

beforeEach(async () => {
  await prisma.registration.deleteMany({ where: { event_id: { in: EVENT_IDS } } });
  await prisma.attendee.deleteMany({ where: { event_id: { in: EVENT_IDS } } });
  await prisma.eventRegistrationSettings.deleteMany({ where: { event_id: { in: EVENT_IDS } } });
  await prisma.adminAuditLog.deleteMany({ where: { organization_id: { in: [ORG_A, ORG_B] } } });
});

afterAll(async () => {
  if (prisma) {
    await wipe(prisma);
    await prisma.$disconnect();
  }
});

describe("who may read", () => {
  const routes = (id: string): [string, string][] => [
    ["list", regsUrl(EVENT_A)],
    ["counts", regsUrl(EVENT_A, "/counts")],
    ["detail", regsUrl(EVENT_A, `/${id}`)],
  ];

  it.each(["list", "counts", "detail"])("%s: an unauthenticated caller gets 401", async (name) => {
    const id = await addRegistration({ email: "known@example.com" });
    const path = routes(id).find(([route]) => route === name)![1];
    expect((await get(path, "")).status).toBe(401);
  });

  it.each(["list", "counts", "detail"])("%s: an operator of the event gets 403", async (name) => {
    const id = await addRegistration({ email: "known@example.com" });
    const path = routes(id).find(([route]) => route === name)![1];
    const res = await get(path, cookies.operator);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
  });

  it.each(["list", "counts", "detail"])("%s: an admin of another organisation gets 403", async (name) => {
    const id = await addRegistration({ email: "known@example.com" });
    const path = routes(id).find(([route]) => route === name)![1];
    expect((await get(path, cookies.adminB)).status).toBe(403);
  });

  it.each(["list", "counts", "detail"])("%s: an admin of the organisation and a superadmin may read", async (name) => {
    const id = await addRegistration({ email: "known@example.com" });
    const path = routes(id).find(([route]) => route === name)![1];
    expect((await get(path, cookies.adminA)).status).toBe(200);
    expect((await get(path, cookies.superadmin)).status).toBe(200);
  });

  it("answers 404 for an event that does not exist to a superadmin, and 403 to anyone else", async () => {
    for (const tail of ["", "/counts", "/some-id"]) {
      expect((await get(regsUrl("evt-regs-nope", tail), cookies.superadmin)).status).toBe(404);
      expect((await get(regsUrl("evt-regs-nope", tail), cookies.adminA)).status).toBe(403);
    }
  });

  it("reads an archived event", async () => {
    const id = await addRegistration({ eventId: EVENT_ARCHIVED, email: "old@example.com" });
    expect((await list("", EVENT_ARCHIVED)).total).toBe(1);
    expect((await get(regsUrl(EVENT_ARCHIVED, "/counts"))).status).toBe(200);
    expect((await get(regsUrl(EVENT_ARCHIVED, `/${id}`))).status).toBe(200);
  });

  it("writes no audit entry and no activity entry when it reads", async () => {
    const id = await addRegistration({ email: "known@example.com", status: "accepted" });
    const before = {
      audit: await prisma.adminAuditLog.count({ where: { organization_id: { in: [ORG_A, ORG_B] } } }),
      activity: await prisma.attendeeActionLog.count({ where: { event_id: EVENT_A } }),
    };
    await list("q=known");
    await get(regsUrl(EVENT_A, "/counts"));
    await get(regsUrl(EVENT_A, `/${id}`));
    expect({
      audit: await prisma.adminAuditLog.count({ where: { organization_id: { in: [ORG_A, ORG_B] } } }),
      activity: await prisma.attendeeActionLog.count({ where: { event_id: EVENT_A } }),
    }).toEqual(before);
  });
});

describe("the list", () => {
  beforeAll(() => {
    app = freshApp();
  });

  it("is empty for an event without registrations", async () => {
    expect(await list()).toEqual({ items: [], total: 0, page: 1, pageSize: 25 });
  });

  it("answers with no more than the screen needs", async () => {
    const id = await addRegistration({
      id: "reg-shape",
      email: "anna@example.com",
      firstName: "Anna",
      lastName: "Kowalska",
      company: "Example Co",
      department: "Sales",
      status: "pending",
      createdAt: new Date("2026-10-01T10:00:00.000Z"),
      customData: { diet: "vegan", parking: "yes" },
      companions: [{ name: "Plus One", custom_data: { shirt: "M" } }],
      consents: { newsletter: "2026-10-01T10:00:00.000Z" },
      acceptedAt: new Date("2026-10-01T10:00:00.000Z"),
      locale: "en",
    });
    const body = await list();
    expect(body.items).toEqual([
      {
        id,
        first_name: "Anna",
        last_name: "Kowalska",
        email: "anna@example.com",
        company: "Example Co",
        department: "Sales",
        status: "pending",
        created_at: "2026-10-01T10:00:00.000Z",
        companions_count: 1,
        last_mail: null,
      },
    ]);
    const raw = JSON.stringify(body);
    for (const leaked of ["vegan", "Plus One", "newsletter", "locale", "consents", "custom_data", "decided"]) {
      expect(raw).not.toContain(leaked);
    }
  });

  it("sends no cache header that would let a shared cache keep a guest's data", async () => {
    const res = await get(regsUrl(EVENT_A));
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("puts the oldest first, and a tie by id, whatever order the rows were written in or sort by address", async () => {
    // Six rows tie. They are written, and sort by address and by state (the order of the index of the
    // table), in orders that are not the order of their ids. Only the id can put them right.
    const tied: [string, string, RegistrationStatus][] = [
      ["d", "e", "awaiting_email"],
      ["b", "a", "rejected"],
      ["f", "d", "pending"],
      ["a", "f", "waitlist"],
      ["e", "c", "accepted"],
      ["c", "b", "pending"],
    ];
    await addRegistration({ id: "reg-order-late", email: "m@example.com", createdAt: at(120) });
    for (const [idPart, emailPart, status] of tied) {
      await addRegistration({ id: `reg-order-${idPart}`, email: `${emailPart}@example.com`, status, createdAt: at(60) });
    }
    await addRegistration({ id: "reg-order-early", email: "k@example.com", createdAt: at(0) });

    const expected = ["early", "a", "b", "c", "d", "e", "f", "late"].map((part) => `reg-order-${part}`);
    expect(ids(await list())).toEqual(expected);
    // Read two at a time, the pages cut the tie in the middle, and still give each row once.
    const pages = await Promise.all([1, 2, 3, 4].map((page) => list(`pageSize=2&page=${page}`)));
    expect(pages.flatMap(ids)).toEqual(expected);
  });

  it("counts the companions of a row, and none for an empty list", async () => {
    await addRegistration({ id: "reg-comp-1", email: "one@example.com", companions: [{ name: "Plus One", custom_data: {} }] });
    await addRegistration({
      id: "reg-comp-0",
      email: "none@example.com",
      createdAt: new Date(Date.now() + MINUTE_MS),
    });
    const byId = new Map((await list()).items.map((item) => [item.id, item.companions_count]));
    expect(byId.get("reg-comp-1")).toBe(1);
    expect(byId.get("reg-comp-0")).toBe(0);
  });

  it("never shows a registration of another event", async () => {
    await addRegistration({ id: "reg-mine", email: "mine@example.com" });
    await addRegistration({ id: "reg-other-event", email: "other@example.com", eventId: EVENT_A2 });
    await addRegistration({ id: "reg-other-org", email: "third@example.com", eventId: EVENT_B });
    expect(ids(await list())).toEqual(["reg-mine"]);
    expect(ids(await list("", EVENT_B, cookies.superadmin))).toEqual(["reg-other-org"]);
  });

  describe("pages", () => {
    beforeAll(() => {
      app = freshApp();
    });

    beforeEach(async () => {
      // Seven rows; the third and the fourth share their time. They are written in the wrong order for their
      // ids, and their addresses sort the wrong way round too, so only the id can put them in order.
      const rows: [string, number][] = [
        ["reg-page-01", 0],
        ["reg-page-02", 1],
        ["reg-page-04", 2],
        ["reg-page-03", 2],
        ["reg-page-05", 4],
        ["reg-page-06", 5],
        ["reg-page-07", 6],
      ];
      for (const [id, minutes] of rows) {
        const number = Number(id.slice(-2));
        await addRegistration({ id, email: `n${10 - number}@example.com`, createdAt: at(minutes) });
      }
    });

    const ORDER = ["reg-page-01", "reg-page-02", "reg-page-03", "reg-page-04", "reg-page-05", "reg-page-06", "reg-page-07"];

    it("reads the pages one after the other, and the last one is short", async () => {
      const first = await list("pageSize=3");
      const second = await list("pageSize=3&page=2");
      const third = await list("pageSize=3&page=3");
      expect([first, second, third].map((page) => [page.page, page.pageSize, page.total])).toEqual([
        [1, 3, 7],
        [2, 3, 7],
        [3, 3, 7],
      ]);
      expect(ids(first)).toEqual(ORDER.slice(0, 3));
      expect(ids(second)).toEqual(ORDER.slice(3, 6));
      expect(ids(third)).toEqual(ORDER.slice(6));
    });

    it("gives the same rows page by page as in one read", async () => {
      const pages = [1, 2, 3, 4].map((page) => list(`pageSize=2&page=${page}`));
      const rows = (await Promise.all(pages)).flatMap(ids);
      expect(rows).toEqual(ids(await list()));
      expect(rows).toEqual(ORDER);
    });

    it("fills a page exactly, and the next one is empty", async () => {
      expect(ids(await list("pageSize=7"))).toEqual(ORDER);
      expect(await list("pageSize=7&page=2")).toEqual({ items: [], total: 7, page: 2, pageSize: 7 });
    });

    it("answers an empty page, with the total, past the last one", async () => {
      expect(await list("pageSize=3&page=4")).toEqual({ items: [], total: 7, page: 4, pageSize: 3 });
      expect((await list("page=999999999999")).items).toEqual([]);
      expect(await list(`page=${Number.MAX_SAFE_INTEGER}&pageSize=100`)).toMatchObject({ items: [], total: 7 });
    });

    it("holds the page size to 100, and reads a size that is not a positive whole number as 25", async () => {
      expect((await list("pageSize=1000")).pageSize).toBe(100);
      for (const size of ["0", "-5", "abc", "1.5", ""]) {
        expect((await list(`pageSize=${size}`)).pageSize).toBe(25);
      }
    });

    it("reads a page that is not a positive whole number as the first", async () => {
      for (const page of ["0", "-1", "abc", "2.5", ""]) {
        const body = await list(`pageSize=2&page=${page}`);
        expect(body.page).toBe(1);
        expect(ids(body)).toEqual(ORDER.slice(0, 2));
      }
    });
  });

  describe("the state filter", () => {
    beforeAll(() => {
      app = freshApp();
    });

    beforeEach(async () => {
      await addRegistration({ id: "reg-st-await", email: "await@example.com", status: "awaiting_email", createdAt: at(0) });
      await addRegistration({ id: "reg-st-pend-1", email: "pend1@example.com", status: "pending", createdAt: at(1) });
      await addRegistration({ id: "reg-st-pend-2", email: "pend2@example.com", status: "pending", createdAt: at(2) });
      await addRegistration({ id: "reg-st-wait", email: "wait@example.com", status: "waitlist", createdAt: at(3) });
      await addRegistration({ id: "reg-st-acc", email: "acc@example.com", status: "accepted", createdAt: at(4) });
      await addRegistration({ id: "reg-st-rej", email: "rej@example.com", status: "rejected", createdAt: at(5) });
    });

    it.each([
      ["awaiting_email", ["reg-st-await"]],
      ["pending", ["reg-st-pend-1", "reg-st-pend-2"]],
      ["waitlist", ["reg-st-wait"]],
      ["accepted", ["reg-st-acc"]],
      ["rejected", ["reg-st-rej"]],
    ])("selects %s", async (status, expected) => {
      const body = await list(`status=${status}`);
      expect(ids(body)).toEqual(expected);
      expect(body.total).toBe(expected.length);
      expect(body.items.every((item) => item.status === status)).toBe(true);
    });

    it("selects every state when none is named, or the name is blank", async () => {
      expect((await list()).total).toBe(6);
      expect((await list("status=")).total).toBe(6);
      expect((await list("status=%20")).total).toBe(6);
    });

    it.each(["approved", "PENDING", "pending,waitlist", "deleted", "1", "__proto__"])(
      "refuses %j, and names the parameter",
      async (status) => {
        const res = await get(`${regsUrl(EVENT_A)}?status=${encodeURIComponent(status)}`);
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: "validation_failed", fields: ["status"] });
      },
    );
  });

  describe("the age filter", () => {
    beforeAll(() => {
      app = freshApp();
    });

    beforeEach(async () => {
      const ago = (ms: number) => new Date(Date.now() - ms);
      await addRegistration({ id: "reg-age-10m", email: "a1@example.com", createdAt: ago(10 * MINUTE_MS) });
      await addRegistration({ id: "reg-age-59m", email: "a2@example.com", createdAt: ago(59 * MINUTE_MS) });
      await addRegistration({ id: "reg-age-61m", email: "a3@example.com", createdAt: ago(61 * MINUTE_MS) });
      await addRegistration({ id: "reg-age-25h", email: "a4@example.com", createdAt: ago(25 * HOUR_MS) });
      await addRegistration({ id: "reg-age-8d", email: "a5@example.com", createdAt: ago(8 * DAY_MS), status: "rejected" });
      await addRegistration({ id: "reg-age-40d", email: "a6@example.com", createdAt: ago(40 * DAY_MS), status: "rejected" });
    });

    it.each([
      ["1h", ["reg-age-40d", "reg-age-8d", "reg-age-25h", "reg-age-61m"]],
      ["24h", ["reg-age-40d", "reg-age-8d", "reg-age-25h"]],
      ["3d", ["reg-age-40d", "reg-age-8d"]],
      ["7d", ["reg-age-40d", "reg-age-8d"]],
      ["14d", ["reg-age-40d"]],
      ["30d", ["reg-age-40d"]],
      ["90d", []],
    ])("older_than=%s selects the registrations made before that", async (age, expected) => {
      const body = await list(`older_than=${age}`);
      expect(ids(body)).toEqual(expected);
      expect(body.total).toBe(expected.length);
    });

    it("selects nothing older than a year when the oldest is 40 days old", async () => {
      expect((await list("older_than=365d")).items).toEqual([]);
    });

    it("combines with the state", async () => {
      expect(ids(await list("status=rejected&older_than=30d"))).toEqual(["reg-age-40d"]);
      expect(ids(await list("status=pending&older_than=30d"))).toEqual([]);
    });

    it("reads a blank value as no filter", async () => {
      expect((await list("older_than=")).total).toBe(6);
    });

    it.each(["7", "7D", "7days", "0d", "-1d", "2d", "1e9", "NaN", "7d;DROP", "__proto__"])(
      "refuses %j, and names the parameter",
      async (age) => {
        const res = await get(`${regsUrl(EVENT_A)}?older_than=${encodeURIComponent(age)}`);
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: "validation_failed", fields: ["older_than"] });
      },
    );
  });

  describe("the search", () => {
    beforeAll(() => {
      app = freshApp();
    });

    beforeEach(async () => {
      // Made within the last hour, so that the age filter can be combined with the search.
      const at = (minutes: number) => new Date(Date.now() - HOUR_MS + minutes * MINUTE_MS);
      await addRegistration({ id: "reg-q-anna", email: "anna.kowalska@example.com", firstName: "Anna", lastName: "Kowalska", createdAt: at(0) });
      await addRegistration({ id: "reg-q-jan", email: "jan.nowak@example.org", firstName: "Jan", lastName: "Nowak", createdAt: at(1) });
      await addRegistration({ id: "reg-q-maria", email: "maria@example.com", firstName: "Maria Anna", lastName: "Zielinska", createdAt: at(2) });
      await addRegistration({ id: "reg-q-pct", email: "pct@example.com", firstName: "Fifty", lastName: "Off%Sale", createdAt: at(3) });
      await addRegistration({ id: "reg-q-under", email: "under@example.com", firstName: "Under_score", lastName: "Case", createdAt: at(4) });
      await addRegistration({ id: "reg-q-abc", email: "abc@example.com", firstName: "Abc", lastName: "Plain", createdAt: at(5) });
      await addRegistration({ id: "reg-q-zoe", email: "zoe@example.com", firstName: "Zo\u00e9", lastName: "Accent", createdAt: at(6) });
    });

    const found = async (q: string) => ids(await list(`q=${encodeURIComponent(q)}`));

    it("finds a first name, a last name and an address, in any case", async () => {
      expect(await found("anna")).toEqual(["reg-q-anna", "reg-q-maria"]);
      expect(await found("KOWALSKA")).toEqual(["reg-q-anna"]);
      expect(await found("Jan.Nowak@Example.ORG")).toEqual(["reg-q-jan"]);
      expect(await found("example.org")).toEqual(["reg-q-jan"]);
    });

    it("finds part of a word", async () => {
      expect(await found("kowal")).toEqual(["reg-q-anna"]);
      expect(await found("owa")).toEqual(["reg-q-anna", "reg-q-jan"]);
    });

    it("needs every word, in any order, and does not mind the spacing", async () => {
      expect(await found("anna kowalska")).toEqual(["reg-q-anna"]);
      expect(await found("kowalska anna")).toEqual(["reg-q-anna"]);
      expect(await found("  anna     kowalska ")).toEqual(["reg-q-anna"]);
      expect(await found("anna\u00a0kowalska")).toEqual(["reg-q-anna"]);
      expect(await found("maria anna")).toEqual(["reg-q-maria"]);
      expect(await found("anna nowak")).toEqual([]);
    });

    it("reads a blank text as no search", async () => {
      expect((await list("q=")).total).toBe(7);
      expect((await list("q=%20%20")).total).toBe(7);
    });

    it("composes the text, so a letter with a separate accent finds the composed one", async () => {
      expect(await found("Zoe\u0301")).toEqual(["reg-q-zoe"]);
    });

    it("takes the characters of a pattern literally", async () => {
      expect(await found("%")).toEqual(["reg-q-pct"]);
      expect(await found("off%sale")).toEqual(["reg-q-pct"]);
      expect(await found("_")).toEqual(["reg-q-under"]);
      expect(await found("a_c")).toEqual([]);
      expect(await found("a%c")).toEqual([]);
      expect(await found("\\")).toEqual([]);
    });

    it("treats text that looks like SQL as text", async () => {
      expect(await found("'; DROP TABLE \"Registration\"; --")).toEqual([]);
      expect((await list()).total).toBe(7);
    });

    it("looks only at the names and the address", async () => {
      await prisma.registration.update({
        where: { id: "reg-q-abc" },
        data: {
          company: "Secretive Industries",
          department: "Hidden Dept",
          custom_data: { diet: "Quokka stew" },
          companions: [{ name: "Wombat Plusone", custom_data: {} }],
        },
      });
      for (const text of ["secretive", "hidden", "quokka", "wombat"]) {
        expect(await found(text)).toEqual([]);
      }
    });

    it("combines with the state and the age", async () => {
      await prisma.registration.update({ where: { id: "reg-q-anna" }, data: { created_at: new Date(Date.now() - 10 * DAY_MS) } });
      expect(ids(await list("q=anna&older_than=7d"))).toEqual(["reg-q-anna"]);
      expect(ids(await list("q=anna&status=rejected"))).toEqual([]);
      expect(ids(await list("q=anna&status=pending"))).toEqual(["reg-q-anna", "reg-q-maria"]);
    });

    it("counts what it found, over all pages", async () => {
      const body = await list(`q=${encodeURIComponent("example")}&pageSize=2&page=2`);
      expect(body.total).toBe(7);
      expect(body.items).toHaveLength(2);
    });

    it("accepts a text of 254 characters and refuses one of 255", async () => {
      expect(await found("a".repeat(254))).toEqual([]);
      const res = await get(`${regsUrl(EVENT_A)}?q=${"a".repeat(255)}`);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "validation_failed", fields: ["q"] });
    });

    it.each([
      ["a very long text", "x".repeat(20_000)],
      ["a line break", "anna\nkowalska"],
      ["a tab", "anna\tkowalska"],
      ["a zero-width space", "an\u200bna"],
      ["nine words", "a b c d e f g h i"],
    ])("refuses %s, and names the parameter", async (_name, text) => {
      const res = await get(`${regsUrl(EVENT_A)}?q=${encodeURIComponent(text)}`);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "validation_failed", fields: ["q"] });
    });

    it("refuses a NUL before the route is reached, as every route does", async () => {
      const res = await get(`${regsUrl(EVENT_A)}?q=anna%00`);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_request" });
    });

    it("names every parameter that is refused, and nothing it was sent", async () => {
      const res = await get(`${regsUrl(EVENT_A)}?status=secret-one&older_than=secret-two&q=${"y".repeat(300)}`);
      expect(res.status).toBe(400);
      const text = await res.text();
      expect(JSON.parse(text)).toEqual({ error: "validation_failed", fields: ["status", "older_than", "q"] });
      expect(text).not.toMatch(/secret-one|secret-two|yyyy/);
    });
  });

  describe("the last mail", () => {
    beforeAll(() => {
      app = freshApp();
    });

    const lastMailOf = async (id: string) => (await list()).items.find((item) => item.id === id)?.last_mail;

    it("is null for a registration without a queued mail", async () => {
      const id = await addRegistration({ email: "nomail@example.com" });
      expect(await lastMailOf(id)).toBeNull();
    });

    it("is the mail queued last", async () => {
      const id = await addRegistration({ email: "several@example.com" });
      await addMail(id, "registration-confirm", { queued_at: new Date("2026-10-01T10:00:00.000Z") });
      await addMail(id, "registration-waitlist", { queued_at: new Date("2026-10-02T10:00:00.000Z"), status: "queued" });
      await addMail(id, "registration-received", { queued_at: new Date("2026-10-01T18:00:00.000Z") });
      expect(await lastMailOf(id)).toEqual({
        template_name: "registration-waitlist",
        status: "queued",
        retryable: null,
        can_retry: false,
      });
    });

    it("follows a retry, which queues the row again", async () => {
      const id = await addRegistration({ email: "retried@example.com" });
      await addMail(id, "registration-confirm", { queued_at: new Date("2026-10-03T10:00:00.000Z"), status: "queued" });
      await addMail(id, "ticket", { queued_at: new Date("2026-10-01T10:00:00.000Z"), status: "failed", retryable: false });
      expect((await lastMailOf(id))?.template_name).toBe("registration-confirm");
    });

    it("breaks a tie of the time by id, the larger id being the last", async () => {
      const id = await addRegistration({ email: "tie@example.com" });
      const queued = new Date("2026-10-01T10:00:00.000Z");
      await addMail(id, "registration-received", { id: "mail-tie-2", queued_at: queued });
      await addMail(id, "registration-confirm", { id: "mail-tie-1", queued_at: queued });
      expect((await lastMailOf(id))?.template_name).toBe("registration-received");
    });

    it("tells apart the mails that staff may send again", async () => {
      const rows: [string, RegistrationMailTemplateName, Partial<Prisma.RegistrationMailUncheckedCreateInput>, boolean][] = [
        ["failed-for-good", "registration-received", { status: "failed", retryable: false }, true],
        ["failed-unknown", "registration-received", { status: "failed", retryable: null }, true],
        ["failed-retrying", "registration-received", { status: "failed", retryable: true }, false],
        ["queued", "registration-received", { status: "queued" }, false],
        ["sent", "registration-received", { status: "sent" }, false],
        ["accepted", "registration-received", { status: "accepted" }, false],
        ["cancelled", "registration-received", { status: "cancelled", retryable: false }, false],
      ];
      for (const [slug, template, extra] of rows) {
        const id = await addRegistration({ id: `reg-mail-${slug}`, email: `${slug}@example.com` });
        await addMail(id, template, extra);
      }
      for (const [slug, , extra, canRetry] of rows) {
        expect(await lastMailOf(`reg-mail-${slug}`)).toMatchObject({
          status: extra.status,
          retryable: extra.retryable ?? null,
          can_retry: canRetry,
        });
      }
    });

    it("does not offer the retry of a failed ticket row: the ticket is sent again from the attendee", async () => {
      const id = await addRegistration({ email: "ticket-failed@example.com", status: "accepted" });
      await addMail(id, "ticket", { status: "failed", retryable: false });
      expect(await lastMailOf(id)).toMatchObject({ template_name: "ticket", status: "failed", can_retry: false });
    });

    it("does not offer the retry of a mail its registration no longer fits: the worker would cancel it", async () => {
      // Turned down with no notice, the failed "received" mail stays the last; and a confirmation link can run out.
      const rejected = await addRegistration({ email: "moved-on@example.com", status: "rejected" });
      await addMail(rejected, "registration-received", { status: "failed", retryable: false });
      const expired = await addRegistration({
        email: "expired-link@example.com",
        status: "awaiting_email",
        createdAt: new Date(Date.now() - 3 * DAY_MS),
      });
      await addMail(expired, "registration-confirm", { status: "failed", retryable: false });
      const waiting = await addRegistration({ email: "valid-link@example.com", status: "awaiting_email" });
      await addMail(waiting, "registration-confirm", { status: "failed", retryable: false });

      expect(await lastMailOf(rejected)).toMatchObject({ status: "failed", can_retry: false });
      expect(await lastMailOf(expired)).toMatchObject({ status: "failed", can_retry: false });
      expect(await lastMailOf(waiting)).toMatchObject({ status: "failed", can_retry: true });
    });

    it("never takes the mail of a registration that is not on the page", async () => {
      const mine = await addRegistration({ email: "mine@example.com" });
      const other = await addRegistration({ email: "other@example.com", eventId: EVENT_A2 });
      await addMail(other, "ticket", { status: "failed" }, EVENT_A2);
      expect(await lastMailOf(mine)).toBeNull();
    });
  });

  describe("the budget", () => {
    it("shares the search budget of the attendee list: 120 reads a minute for one user and event", async () => {
      app = freshApp();
      const statuses: number[] = [];
      for (let read = 0; read < 121; read += 1) {
        statuses.push((await get(regsUrl(EVENT_B), cookies.superadmin)).status);
      }
      expect(statuses.slice(0, 120).every((status) => status === 200)).toBe(true);
      expect(statuses[120]).toBe(429);
      // The counts and the detail are not searches, and are not held back.
      expect((await get(regsUrl(EVENT_B, "/counts"), cookies.superadmin)).status).toBe(200);
    }, 60_000);
  });
});

describe("the counts", () => {
  beforeAll(() => {
    app = freshApp();
  });

  const counts = async (eventId = EVENT_A, cookie?: string): Promise<RegistrationCountsDto> => {
    const res = await get(regsUrl(eventId, "/counts"), cookie);
    expect(res.status).toBe(200);
    return (await res.json()) as RegistrationCountsDto;
  };

  it("are zero for an event without registrations, and registration is off", async () => {
    expect(await counts()).toEqual({
      mode: null,
      by_status: { awaiting_email: 0, pending: 0, waitlist: 0, accepted: 0, rejected: 0 },
      needs_decision: 0,
    });
  });

  it("count every state, and the tab counts only those that wait for a decision", async () => {
    const plan: [RegistrationStatus, number][] = [
      ["awaiting_email", 2],
      ["pending", 3],
      ["waitlist", 1],
      ["accepted", 2],
      ["rejected", 4],
    ];
    for (const [status, count] of plan) {
      for (let n = 0; n < count; n += 1) {
        await addRegistration({ email: `${status}-${n}@example.com`, status });
      }
    }
    expect(await counts()).toEqual({
      mode: null,
      by_status: { awaiting_email: 2, pending: 3, waitlist: 1, accepted: 2, rejected: 4 },
      needs_decision: 3,
    });
  });

  it("agree with the list, state by state", async () => {
    const statuses = ["pending", "pending", "waitlist", "rejected"] as const;
    for (const [index, status] of statuses.entries()) {
      await addRegistration({ email: `${status}-${index}@example.com`, status });
    }
    const { by_status } = await counts();
    for (const [status, count] of Object.entries(by_status)) {
      expect((await list(`status=${status}`)).total).toBe(count);
    }
  });

  it("do not count the registrations of another event", async () => {
    await addRegistration({ email: "mine@example.com", status: "pending" });
    await addRegistration({ email: "other@example.com", status: "pending", eventId: EVENT_A2 });
    await addRegistration({ email: "third@example.com", status: "pending", eventId: EVENT_B });
    expect((await counts()).by_status.pending).toBe(1);
    expect((await counts(EVENT_B, cookies.superadmin)).by_status.pending).toBe(1);
  });

  it.each(["automatic", "approval"] as const)("tell that the event is in %s mode", async (mode) => {
    await prisma.eventRegistrationSettings.create({ data: { event_id: EVENT_A, mode } });
    expect((await counts()).mode).toBe(mode);
  });

  it("read a registration that is switched off as null", async () => {
    await prisma.eventRegistrationSettings.create({ data: { event_id: EVENT_A, mode: null } });
    expect((await counts()).mode).toBeNull();
  });

  it("are not taken for the id of a registration", async () => {
    const body = (await (await get(regsUrl(EVENT_A, "/counts"))).json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["by_status", "mode", "needs_decision"]);
  });
});

describe("one registration", () => {
  beforeAll(() => {
    app = freshApp();
  });

  const detail = async (id: string, eventId = EVENT_A, cookie?: string): Promise<RegistrationDetailDto> => {
    const res = await get(regsUrl(eventId, `/${id}`), cookie);
    expect(res.status).toBe(200);
    return (await res.json()) as RegistrationDetailDto;
  };

  it("answers with everything staff need to decide, in one place", async () => {
    const id = await addRegistration({
      id: "reg-detail-full",
      email: "full@example.com",
      firstName: "Fiona",
      lastName: "Full",
      status: "accepted",
      company: "Example Co",
      department: "Sales",
      createdAt: new Date("2026-10-01T09:00:00.000Z"),
      customData: { diet: "vegan", parking: "yes" },
      companions: [{ name: "Plus One", custom_data: { shirt: "M" } }],
      consents: { newsletter: "2026-10-01T09:00:00.000Z" },
      acceptedAt: new Date("2026-10-01T09:00:00.000Z"),
      emailVerifiedAt: new Date("2026-10-01T09:05:00.000Z"),
      decidedAt: new Date("2026-10-02T08:00:00.000Z"),
      decidedBy: staff.decider,
      locale: "en",
    });
    const attendee = await prisma.attendee.findFirstOrThrow({ where: { event_id: EVENT_A, email: "full@example.com" } });
    await addMail(id, "registration-received", { status: "sent", attempts: 1, queued_at: new Date("2026-10-01T09:00:10.000Z"), sent_at: new Date("2026-10-01T09:00:20.000Z"), attempted_at: new Date("2026-10-01T09:00:20.000Z") });
    await addMail(id, "ticket", { status: "failed", attempts: 3, retryable: false, queued_at: new Date("2026-10-02T08:00:10.000Z"), attempted_at: new Date("2026-10-02T08:10:00.000Z"), error_code: "ticket_failed", error: "The ticket mail could not be queued." });

    expect(await detail(id)).toEqual({
      id,
      status: "accepted",
      email: "full@example.com",
      first_name: "Fiona",
      last_name: "Full",
      company: "Example Co",
      department: "Sales",
      custom_data: { diet: "vegan", parking: "yes" },
      companions: [{ name: "Plus One", custom_data: { shirt: "M" } }],
      created_at: "2026-10-01T09:00:00.000Z",
      email_verified_at: "2026-10-01T09:05:00.000Z",
      confirm_expires_at: null,
      accepted_at: "2026-10-01T09:00:00.000Z",
      consents: { newsletter: "2026-10-01T09:00:00.000Z" },
      decided_at: "2026-10-02T08:00:00.000Z",
      decided_by: { id: staff.decider, name: "Dana Decider" },
      locale: "en",
      attendee_id: attendee.id,
      mails: [
        {
          id: expect.any(String),
          template_name: "registration-received",
          status: "sent",
          retryable: null,
          can_retry: false,
          attempts: 1,
          queued_at: "2026-10-01T09:00:10.000Z",
          attempted_at: "2026-10-01T09:00:20.000Z",
          sent_at: "2026-10-01T09:00:20.000Z",
          error_code: null,
          error: null,
        },
        {
          id: expect.any(String),
          template_name: "ticket",
          status: "failed",
          retryable: false,
          // A ticket row is sent again from the attendee, not from here.
          can_retry: false,
          attempts: 3,
          queued_at: "2026-10-02T08:00:10.000Z",
          attempted_at: "2026-10-02T08:10:00.000Z",
          sent_at: null,
          error_code: "ticket_failed",
          error: "The ticket mail could not be queued.",
        },
      ],
    });
  });

  it("lists the queued mails oldest first, whatever order they were written in", async () => {
    const id = await addRegistration({ email: "order@example.com" });
    await addMail(id, "registration-waitlist", { queued_at: new Date("2026-10-03T10:00:00.000Z") });
    await addMail(id, "registration-confirm", { queued_at: new Date("2026-10-01T10:00:00.000Z") });
    await addMail(id, "registration-received", { queued_at: new Date("2026-10-02T10:00:00.000Z") });
    expect((await detail(id)).mails.map((mail) => mail.template_name)).toEqual([
      "registration-confirm",
      "registration-received",
      "registration-waitlist",
    ]);
  });

  it("shows a registration that waits for the address with the time it expires", async () => {
    const createdAt = new Date("2026-10-01T09:00:00.000Z");
    const id = await addRegistration({ email: "wait@example.com", status: "awaiting_email", createdAt });
    expect(await detail(id)).toMatchObject({
      status: "awaiting_email",
      email_verified_at: null,
      confirm_expires_at: "2026-10-02T09:00:00.000Z",
      attendee_id: null,
      decided_at: null,
      decided_by: null,
      mails: [],
      companions: [],
      consents: {},
      custom_data: null,
    });
  });

  it("names the staff member who decided, by display name, else by address, else as staff", async () => {
    const named = await addRegistration({ email: "n1@example.com", status: "rejected", decidedAt: new Date(), decidedBy: staff.decider });
    const unnamed = await addRegistration({ email: "n2@example.com", status: "rejected", decidedAt: new Date(), decidedBy: staff.deciderNoName });
    const gone = await addRegistration({ email: "n3@example.com", status: "rejected", decidedAt: new Date(), decidedBy: "user-that-was-deleted" });
    expect((await detail(named)).decided_by).toEqual({ id: staff.decider, name: "Dana Decider" });
    expect((await detail(unnamed)).decided_by).toEqual({ id: staff.deciderNoName, name: EMAILS.deciderNoName });
    expect((await detail(gone)).decided_by).toEqual({ id: "user-that-was-deleted", name: "Staff member" });
  });

  it("has no one who decided for an automatic decision, which still has its time", async () => {
    const id = await addRegistration({ email: "auto@example.com", status: "accepted", decidedAt: new Date("2026-10-01T09:00:00.000Z") });
    expect(await detail(id)).toMatchObject({ decided_at: "2026-10-01T09:00:00.000Z", decided_by: null });
  });

  it("keeps only what is shaped like a companion, a consent and an answer", async () => {
    const id = await addRegistration({
      email: "odd@example.com",
      customData: ["not", "an", "object"],
      companions: [{ name: "Fine", custom_data: { shirt: "L" } }, 5, null, { name: 7 }, { custom_data: {} }, { name: "No answers" }],
      consents: { newsletter: "2026-10-01T09:00:00.000Z", broken: 5, nothing: null },
    });
    expect(await detail(id)).toMatchObject({
      custom_data: null,
      companions: [
        { name: "Fine", custom_data: { shirt: "L" } },
        { name: "No answers", custom_data: null },
      ],
      consents: { newsletter: "2026-10-01T09:00:00.000Z" },
    });
  });

  it("answers 404 for the id of a registration of another event, as for an id that does not exist", async () => {
    const otherEvent = await addRegistration({ email: "elsewhere@example.com", eventId: EVENT_A2 });
    const otherOrg = await addRegistration({ email: "faraway@example.com", eventId: EVENT_B });
    const missing = await get(regsUrl(EVENT_A, "/reg-does-not-exist"));
    expect(missing.status).toBe(404);
    const missingText = await missing.text();
    expect(JSON.parse(missingText)).toEqual({ error: "not_found" });

    for (const [id, cookie] of [
      [otherEvent, cookies.adminA],
      [otherEvent, cookies.superadmin],
      [otherOrg, cookies.superadmin],
    ] as const) {
      const res = await get(regsUrl(EVENT_A, `/${id}`), cookie);
      expect(res.status).toBe(404);
      expect(await res.text()).toBe(missingText);
    }
  });

  it("reads each registration only through its own event", async () => {
    const id = await addRegistration({ email: "home@example.com", eventId: EVENT_A2 });
    expect((await detail(id, EVENT_A2)).email).toBe("home@example.com");
    expect((await get(regsUrl(EVENT_A, `/${id}`))).status).toBe(404);
  });

  it("answers 404, not an error, for an id that is very long or has odd characters", async () => {
    for (const id of ["x".repeat(5_000), "%E2%80%AE", "a%20b", "..%2F..", "%27%3B--"]) {
      const res = await get(regsUrl(EVENT_A, `/${id}`));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
    }
  });

  it("does not take the id of a registration for the counts, nor the counts for an id", async () => {
    await addRegistration({ id: "counts-like", email: "like@example.com" });
    expect((await get(regsUrl(EVENT_A, "/counts-like"))).status).toBe(200);
    expect(((await (await get(regsUrl(EVENT_A, "/counts"))).json()) as Record<string, unknown>).by_status).toBeDefined();
  });
});

describe("the limit of a bulk request", () => {
  it("is 500 ids, one number for admitting, rejecting and deleting", () => {
    expect(MAX_REGISTRATION_BULK_IDS).toBe(500);
  });
});
