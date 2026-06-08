import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { generateToken } from "../src/token.js";
import { hashToken } from "../src/hash.js";
import { buildTicketUrl } from "../src/url.js";
import { resolveTicket } from "../src/resolve.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_ROOT = path.resolve(__dirname, "../../db");

let prisma: PrismaClient;
const EVENT_ID = "test-event-tickets-001";
let tokenA: string;

beforeAll(async () => {
  execSync("npx prisma db push --force-reset", {
    cwd: DB_ROOT,
    env: { ...process.env, DATABASE_URL: process.env["DATABASE_URL"] ?? "file:./tickets-test.db" },
    stdio: "pipe",
  });

  prisma = new PrismaClient();

  await prisma.event.upsert({
    where: { id: EVENT_ID },
    update: {},
    create: {
      id: EVENT_ID,
      title: "Test Event",
      slug: "test-event-tickets-001",
      date: new Date("2026-09-01T09:00:00Z"),
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
});

afterAll(async () => {
  await prisma.attendee.deleteMany({ where: { event_id: EVENT_ID } });
  await prisma.event.deleteMany({ where: { id: EVENT_ID } });
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
});

describe("resolveTicket — Mode B (agency)", () => {
  it("resolves by qr_payload", async () => {
    const result = await resolveTicket("AGENCY-QR-001", prisma);
    expect(result?.mode).toBe("agency");
    expect(result?.attendee.email).toBe("mode-b@example.com");
  });

  it("resolves by external_uuid", async () => {
    const result = await resolveTicket("agency-uuid-001", prisma);
    expect(result?.mode).toBe("agency");
    expect(result?.attendee.email).toBe("mode-b@example.com");
  });
});

describe("resolveTicket — not found", () => {
  it("returns null for unknown internal token", async () => {
    expect(await resolveTicket(generateToken(), prisma)).toBeNull();
  });

  it("returns null for unknown agency payload", async () => {
    expect(await resolveTicket("UNKNOWN-PAYLOAD", prisma)).toBeNull();
  });

  it("returns null for full URL with unknown token", async () => {
    const url = buildTicketUrl("https://example.com", generateToken());
    expect(await resolveTicket(url, prisma)).toBeNull();
  });
});
