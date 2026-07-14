import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { backfillAgencyPublicRefs } from "@admitto/db";
import { encryptToString } from "@admitto/crypto";
import { generateToken, hashToken } from "@admitto/tickets";
import { createApp } from "../../src/app.js";
import { createRateLimitStore } from "../../src/rate-limit/index.js";

const ORG_ID = "org-pubref";
const EVENT_ID = "evt-pubref";
const EVENT_SLUG = "summer-gala";
const PUBLIC_REF = generateToken();
const MODE_A_TOKEN = generateToken();
const ATTENDEE_ID = "attendee-cuid-legacy-id";
const MODE_A_ATTENDEE_ID = "attendee-mode-a-token";

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;

async function seedPublicRefFixture(client: PrismaClient): Promise<void> {
  await client.checkIn.deleteMany({ where: { event_id: EVENT_ID } });
  await client.attendee.deleteMany({ where: { event_id: EVENT_ID } });
  await client.roleAssignment.deleteMany({ where: { scope_id: EVENT_ID } });
  await client.event.deleteMany({ where: { id: EVENT_ID } });
  await client.organization.deleteMany({ where: { id: ORG_ID } });

  await client.organization.create({
    data: { id: ORG_ID, name: "Org", slug: "pubref-org" },
  });
  await client.event.create({
    data: {
      id: EVENT_ID,
      title: "Summer Gala",
      slug: EVENT_SLUG,
      date: new Date("2026-09-01"),
      organization_id: ORG_ID,
    },
  });
  await client.ticketType.createMany({
    data: [{ event_id: EVENT_ID, key: "vip", label: "VIP Guest", color: "purple" }],
  });
  await client.attendee.create({
    data: {
      id: ATTENDEE_ID,
      event_id: EVENT_ID,
      email: "guest@example.com",
      name: "Agency Guest",
      qr_payload: "AGENCY-QR-PAYLOAD-001",
      public_ref: PUBLIC_REF,
      ticket_type: "vip",
    },
  });
  await client.attendee.create({
    data: {
      id: MODE_A_ATTENDEE_ID,
      event_id: EVENT_ID,
      email: "modea@example.com",
      name: "Mode A Guest",
      token_hash: hashToken(MODE_A_TOKEN),
      token_enc: encryptToString(MODE_A_TOKEN),
      status: "registered",
    },
  });
}

beforeAll(async () => {
  prisma = new PrismaClient();
  await seedPublicRefFixture(prisma);

  app = createApp({
    prisma,
    baseUrl: "https://tickets.example.com",
    rateLimitStore: createRateLimitStore(),
    skipCheckinBootValidation: true,
  });
});

afterAll(async () => {
  await prisma?.$disconnect();
});

describe("Mode B public routes — public_ref", () => {
  it("GET /t/:slug/a/:public_ref returns ticket page", async () => {
    const res = await app.request(`/t/${EVENT_SLUG}/a/${PUBLIC_REF}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Agency Guest");
    expect(html).toContain("Summer Gala");
  });

  it("renders the catalog label, not the raw key, for ticket_type (Codex review, batch 04 / #351)", async () => {
    const res = await app.request(`/t/${EVENT_SLUG}/a/${PUBLIC_REF}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("VIP Guest");
    expect(html).not.toMatch(/>vip</);
  });

  it("GET /q/:slug/a/:public_ref.png returns PNG with short private cache", async () => {
    const res = await app.request(`/q/${EVENT_SLUG}/a/${PUBLIC_REF}.png`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/png");
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=300");
  });

  it("GET /q/:token.png returns PNG with short private cache (Mode A)", async () => {
    const res = await app.request(`/q/${MODE_A_TOKEN}.png`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/png");
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=300");
  });

  it("legacy Attendee.id in URL returns 404", async () => {
    const res = await app.request(`/t/${EVENT_SLUG}/a/${ATTENDEE_ID}`);
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).toContain("not found");
  });

  it("unknown public_ref returns 404", async () => {
    const res = await app.request(`/t/${EVENT_SLUG}/a/${generateToken()}`);
    expect(res.status).toBe(404);
  });

  it("renders the event's configured logo and widens the CSP img-src to match (#419)", async () => {
    const logoUrl = "https://cdn.example.com/summer-gala-logo.png";
    await prisma.event.update({ where: { id: EVENT_ID }, data: { logo_url: logoUrl } });
    try {
      const res = await app.request(`/t/${EVENT_SLUG}/a/${PUBLIC_REF}`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain(`<img class="ticket__brand-logo" src="${logoUrl}"`);
      expect(res.headers.get("Content-Security-Policy")).toContain(`img-src 'self' data: https://cdn.example.com`);
    } finally {
      await prisma.event.update({ where: { id: EVENT_ID }, data: { logo_url: null } });
    }
  });

  it("agency row without public_ref returns 404 after lookup switch", async () => {
    const noRef = await prisma.attendee.create({
      data: {
        event_id: EVENT_ID,
        email: "norefb@example.com",
        name: "No Ref",
        external_uuid: "agency-uuid-noref",
      },
    });
    expect(noRef.public_ref).toBeNull();
    const res = await app.request(`/t/${EVENT_SLUG}/a/${noRef.id}`);
    expect(res.status).toBe(404);
  });
});

describe("backfill before deploy", () => {
  it("backfill assigns ref so routes work", async () => {
    const row = await prisma.attendee.create({
      data: {
        event_id: EVENT_ID,
        email: "backfill@example.com",
        name: "Backfill Guest",
        qr_payload: "AGENCY-BACKFILL",
      },
    });
    const before = await app.request(`/t/${EVENT_SLUG}/a/${generateToken()}`);
    expect(before.status).toBe(404);

    await backfillAgencyPublicRefs(prisma);
    const updated = await prisma.attendee.findUniqueOrThrow({ where: { id: row.id } });
    expect(updated.public_ref).toBeTruthy();

    const after = await app.request(`/t/${EVENT_SLUG}/a/${updated.public_ref}`);
    expect(after.status).toBe(200);
  });
});
