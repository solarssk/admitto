import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { generateToken } from "../src/token.js";
import { hashToken } from "../src/hash.js";
import { buildTicketUrl } from "../src/url.js";
import { resolveTicket } from "../src/resolve.js";
import { assertTestDatabaseUrl } from "@admitto/db/test-db-guard";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_ROOT = path.resolve(__dirname, "../../db");

let prisma: PrismaClient;
const EVENT_ID = "test-event-tickets-001";
const EVENT_ID_2 = "test-event-tickets-002";
const ORG_ID_LOGO = "org-tickets-logo";
const EVENT_ID_ORG_LOGO = "test-event-tickets-org-logo";
const EVENT_ID_EVENT_LOGO = "test-event-tickets-event-logo";
let tokenA: string;
let tokenB: string;
let tokenOrgLogo: string;
let tokenEventLogo: string;

beforeAll(async () => {
  assertTestDatabaseUrl(process.env.DATABASE_URL ?? "");
  execSync("npx prisma db push --force-reset --accept-data-loss", {
    cwd: DB_ROOT,
    env: { ...process.env },
    stdio: "pipe",
  });

  prisma = new PrismaClient();

  await prisma.organization.create({
    data: { id: "org_default", name: "Default", slug: "default" },
  });

  await prisma.event.upsert({
    where: { id: EVENT_ID },
    update: {},
    create: {
      id: EVENT_ID,
      title: "Test Event",
      slug: "test-event-tickets-001",
      date: new Date("2026-09-01T09:00:00Z"),
      organization_id: "org_default",
    },
  });

  await prisma.event.upsert({
    where: { id: EVENT_ID_2 },
    update: {},
    create: {
      id: EVENT_ID_2,
      title: "Second Test Event",
      slug: "test-event-tickets-002",
      date: new Date("2026-09-02T09:00:00Z"),
      organization_id: "org_default",
    },
  });

  // Mode A attendee — internal token
  tokenA = generateToken();
  await prisma.attendee.create({
    data: {
      event_id: EVENT_ID,
      email: "mode-a@example.com",
      name: "Mode A User",
      token_hash: hashToken(tokenA),
    },
  });

  tokenB = generateToken();
  await prisma.attendee.create({
    data: {
      event_id: EVENT_ID_2,
      email: "mode-a-event-2@example.com",
      name: "Mode A Event 2 User",
      token_hash: hashToken(tokenB),
    },
  });

  // Mode B attendee — agency-provided
  await prisma.attendee.create({
    data: {
      event_id: EVENT_ID,
      email: "mode-b@example.com",
      name: "Mode B User",
      external_uuid: "agency-uuid-001",
      qr_payload: "AGENCY-QR-001",
    },
  });

  // Same agency identifiers in a different event — should require event context.
  await prisma.attendee.create({
    data: {
      event_id: EVENT_ID_2,
      email: "mode-b-duplicate@example.com",
      name: "Mode B Duplicate",
      external_uuid: "agency-uuid-001",
      qr_payload: "AGENCY-QR-001",
    },
  });

  // Logo resolution fixtures (#419): a dedicated org with its own logo, plus one event that
  // relies on the org's logo and one that sets its own (should win over the org's).
  await prisma.organization.create({
    data: { id: ORG_ID_LOGO, name: "Logo Org", slug: "logo-org", logo_url: "https://cdn.example.com/org-logo.png" },
  });

  await prisma.event.create({
    data: {
      id: EVENT_ID_ORG_LOGO,
      title: "Org Logo Event",
      slug: EVENT_ID_ORG_LOGO,
      date: new Date("2026-09-03T09:00:00Z"),
      organization_id: ORG_ID_LOGO,
    },
  });
  tokenOrgLogo = generateToken();
  await prisma.attendee.create({
    data: {
      event_id: EVENT_ID_ORG_LOGO,
      email: "org-logo@example.com",
      name: "Org Logo User",
      token_hash: hashToken(tokenOrgLogo),
    },
  });

  await prisma.event.create({
    data: {
      id: EVENT_ID_EVENT_LOGO,
      title: "Event Logo Event",
      slug: EVENT_ID_EVENT_LOGO,
      date: new Date("2026-09-04T09:00:00Z"),
      organization_id: ORG_ID_LOGO,
      logo_url: "https://cdn.example.com/event-logo.png",
    },
  });
  tokenEventLogo = generateToken();
  await prisma.attendee.create({
    data: {
      event_id: EVENT_ID_EVENT_LOGO,
      email: "event-logo@example.com",
      name: "Event Logo User",
      token_hash: hashToken(tokenEventLogo),
    },
  });
});

afterAll(async () => {
  await prisma.attendee.deleteMany({
    where: { event_id: { in: [EVENT_ID, EVENT_ID_2, EVENT_ID_ORG_LOGO, EVENT_ID_EVENT_LOGO] } },
  });
  await prisma.event.deleteMany({
    where: { id: { in: [EVENT_ID, EVENT_ID_2, EVENT_ID_ORG_LOGO, EVENT_ID_EVENT_LOGO] } },
  });
  await prisma.organization.deleteMany({ where: { id: ORG_ID_LOGO } });
  await prisma.$disconnect();
});

describe("resolveTicket — Mode A (internal token)", () => {
  it("resolves by raw internal token", async () => {
    const result = await resolveTicket(tokenA, prisma);
    expect(result?.mode).toBe("internal");
    expect(result?.attendee.email).toBe("mode-a@example.com");
    expect(result?.event.title).toBe("Test Event");
  });

  it("resolves by full ticket URL", async () => {
    const url = buildTicketUrl("https://example.com", tokenA);
    const result = await resolveTicket(url, prisma);
    expect(result?.mode).toBe("internal");
    expect(result?.attendee.email).toBe("mode-a@example.com");
  });

  it("respects event context for internal tokens", async () => {
    const correctEvent = await resolveTicket(tokenA, prisma, { eventId: EVENT_ID });
    const wrongEvent = await resolveTicket(tokenA, prisma, { eventId: EVENT_ID_2 });
    const secondEvent = await resolveTicket(tokenB, prisma, { eventId: EVENT_ID_2 });

    expect(correctEvent?.attendee.email).toBe("mode-a@example.com");
    expect(wrongEvent).toBeNull();
    expect(secondEvent?.attendee.email).toBe("mode-a-event-2@example.com");
  });
});

describe("resolveTicket — Mode B (agency)", () => {
  it("resolves by qr_payload when event context is provided", async () => {
    const result = await resolveTicket("AGENCY-QR-001", prisma, { eventId: EVENT_ID });
    expect(result?.mode).toBe("agency");
    expect(result?.attendee.email).toBe("mode-b@example.com");
  });

  it("rejects duplicate qr_payload values for the same event", async () => {
    await expect(
      prisma.attendee.create({
        data: {
          event_id: EVENT_ID,
          email: "mode-b-same-event-duplicate@example.com",
          name: "Mode B Same Event Duplicate",
          qr_payload: "AGENCY-QR-001",
        },
      }),
    ).rejects.toThrow();
  });

  it("resolves by external_uuid when event context is provided", async () => {
    const result = await resolveTicket("agency-uuid-001", prisma, { eventId: EVENT_ID });
    expect(result?.mode).toBe("agency");
    expect(result?.attendee.email).toBe("mode-b@example.com");
  });

  it("returns null when qr_payload and external_uuid collide across different attendees", async () => {
    try {
      await prisma.attendee.create({
        data: {
          event_id: EVENT_ID,
          email: "mode-b-cross-field@example.com",
          name: "Mode B Cross Field",
          external_uuid: "AGENCY-QR-001",
          qr_payload: "AGENCY-QR-002",
        },
      });

      const result = await resolveTicket("AGENCY-QR-001", prisma, { eventId: EVENT_ID });
      expect(result).toBeNull();
    } finally {
      await prisma.attendee.deleteMany({
        where: {
          event_id: EVENT_ID,
          email: "mode-b-cross-field@example.com",
        },
      });
    }
  });

  it("does not resolve agency identifiers without event context", async () => {
    expect(await resolveTicket("AGENCY-QR-001", prisma)).toBeNull();
    expect(await resolveTicket("agency-uuid-001", prisma)).toBeNull();
  });
});

describe("resolveTicket — not found", () => {
  it("returns null for unknown internal token", async () => {
    expect(await resolveTicket(generateToken(), prisma)).toBeNull();
  });

  it("returns null for unknown agency payload", async () => {
    expect(await resolveTicket("UNKNOWN-PAYLOAD", prisma, { eventId: EVENT_ID })).toBeNull();
  });

  it("returns null for full URL with unknown token", async () => {
    const url = buildTicketUrl("https://example.com", generateToken());
    expect(await resolveTicket(url, prisma)).toBeNull();
  });
});

describe("resolveTicket — logo resolution (#419)", () => {
  it("resolves null when neither the event nor its organization has a logo configured", async () => {
    const result = await resolveTicket(tokenA, prisma);
    expect(result?.event.logoUrl).toBeNull();
  });

  it("falls back to the organization's logo when the event has none of its own", async () => {
    const result = await resolveTicket(tokenOrgLogo, prisma);
    expect(result?.event.logoUrl).toBe("https://cdn.example.com/org-logo.png");
  });

  it("prefers the event's own logo over the organization's", async () => {
    const result = await resolveTicket(tokenEventLogo, prisma);
    expect(result?.event.logoUrl).toBe("https://cdn.example.com/event-logo.png");
  });
});
