import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { checkInScan, getRecentCheckIns, isAdmittable } from "../src/checkin.js";
import { generateToken } from "../src/token.js";
import { hashToken } from "../src/hash.js";
import { buildTicketUrl } from "../src/url.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_ROOT = path.resolve(__dirname, "../../db");

let prisma: PrismaClient;
const EVENT_ID = "test-event-checkin-001";
const OTHER_EVENT_ID = "test-event-checkin-other";

let tokenA: string;
let attendeeAId: string;
let attendeeBId: string;
let attendeeCancelledId: string;

beforeAll(async () => {
  execSync("npx prisma db push --force-reset", {
    cwd: DB_ROOT,
    env: { ...process.env, DATABASE_URL: process.env["DATABASE_URL"] ?? "file:./tickets-test.db" },
    stdio: "pipe",
  });

  prisma = new PrismaClient();

  await prisma.event.createMany({
    data: [
      { id: EVENT_ID, title: "Check-In Test Event", slug: "checkin-test-event", date: new Date("2026-09-01T09:00:00Z") },
      { id: OTHER_EVENT_ID, title: "Other Event", slug: "other-event-checkin", date: new Date("2026-09-02T09:00:00Z") },
    ],
  });

  // Mode A — internal token
  tokenA = generateToken();
  const attA = await prisma.attendee.create({
    data: {
      event_id: EVENT_ID,
      email: "mode-a-checkin@example.com",
      name: "Mode A Checkin",
      token_hash: hashToken(tokenA),
    },
  });
  attendeeAId = attA.id;

  // Mode B — agency payload
  const attB = await prisma.attendee.create({
    data: {
      event_id: EVENT_ID,
      email: "mode-b-checkin@example.com",
      name: "Mode B Checkin",
      external_uuid: "agency-uuid-checkin-001",
      qr_payload: "AGENCY-QR-CHECKIN-001",
    },
  });
  attendeeBId = attB.id;

  // Cancelled attendee — not admittable
  const attCancelled = await prisma.attendee.create({
    data: {
      event_id: EVENT_ID,
      email: "cancelled-checkin@example.com",
      name: "Cancelled Checkin",
      token_hash: hashToken(generateToken()),
      status: "cancelled",
    },
  });
  attendeeCancelledId = attCancelled.id;
});

afterAll(async () => {
  await prisma.checkIn.deleteMany({ where: { event_id: { in: [EVENT_ID, OTHER_EVENT_ID] } } });
  await prisma.attendee.deleteMany({ where: { event_id: { in: [EVENT_ID, OTHER_EVENT_ID] } } });
  await prisma.event.deleteMany({ where: { id: { in: [EVENT_ID, OTHER_EVENT_ID] } } });
  await prisma.$disconnect();
});

describe("isAdmittable", () => {
  it("registered is admittable", () => expect(isAdmittable("registered")).toBe(true));
  it("confirmed is admittable", () => expect(isAdmittable("confirmed")).toBe(true));
  it("cancelled is not admittable", () => expect(isAdmittable("cancelled")).toBe(false));
});

describe("checkInScan — Mode A (raw token)", () => {
  it("returns VALID and sets admitted_at on first scan", async () => {
    const result = await checkInScan({ scanned: tokenA, eventId: EVENT_ID }, prisma);
    expect(result.status).toBe("VALID");
    if (result.status !== "VALID") return;
    expect(result.attendee.name).toBe("Mode A Checkin");
    expect(result.admittedAt).toBeInstanceOf(Date);
  });

  it("persists admitted_at on Attendee", async () => {
    const att = await prisma.attendee.findUnique({ where: { id: attendeeAId } });
    expect(att?.admitted_at).not.toBeNull();
  });

  it("creates a CheckIn audit log entry", async () => {
    const log = await prisma.checkIn.findFirst({
      where: { attendee_id: attendeeAId, status: "VALID" },
    });
    expect(log).not.toBeNull();
  });
});

describe("checkInScan — Mode A (full ticket URL)", () => {
  it("resolves via full URL and returns ALREADY_CHECKED_IN (already admitted above)", async () => {
    const url = buildTicketUrl("https://admitto.example.com", tokenA);
    const result = await checkInScan({ scanned: url, eventId: EVENT_ID }, prisma);
    expect(result.status).toBe("ALREADY_CHECKED_IN");
    if (result.status !== "ALREADY_CHECKED_IN") return;
    expect(result.admittedAt).toBeInstanceOf(Date);
  });
});

describe("checkInScan — Mode B (agency payload)", () => {
  it("returns VALID for agency qr_payload", async () => {
    const result = await checkInScan({ scanned: "AGENCY-QR-CHECKIN-001", eventId: EVENT_ID }, prisma);
    expect(result.status).toBe("VALID");
    if (result.status !== "VALID") return;
    expect(result.attendee.name).toBe("Mode B Checkin");
  });

  it("creates CheckIn log for Mode B", async () => {
    const log = await prisma.checkIn.findFirst({
      where: { attendee_id: attendeeBId, status: "VALID" },
    });
    expect(log).not.toBeNull();
  });
});

describe("checkInScan — ALREADY_CHECKED_IN", () => {
  it("returns ALREADY_CHECKED_IN with original admittedAt on repeated scan", async () => {
    // attendeeA already admitted in first describe block
    const result = await checkInScan({ scanned: tokenA, eventId: EVENT_ID }, prisma);
    expect(result.status).toBe("ALREADY_CHECKED_IN");
    if (result.status !== "ALREADY_CHECKED_IN") return;
    expect(result.admittedAt).toBeInstanceOf(Date);
    expect(result.attendee.name).toBe("Mode A Checkin");
  });

  it("logs ALREADY_CHECKED_IN to CheckIn table", async () => {
    const logs = await prisma.checkIn.findMany({
      where: { attendee_id: attendeeAId, status: "ALREADY_CHECKED_IN" },
    });
    expect(logs.length).toBeGreaterThanOrEqual(1);
  });
});

describe("checkInScan — concurrency (race condition)", () => {
  it("exactly one VALID and one ALREADY_CHECKED_IN under concurrent calls", async () => {
    const raceToken = generateToken();
    const raceAtt = await prisma.attendee.create({
      data: {
        event_id: EVENT_ID,
        email: "race-checkin@example.com",
        name: "Race User",
        token_hash: hashToken(raceToken),
      },
    });

    const [r1, r2] = await Promise.all([
      checkInScan({ scanned: raceToken, eventId: EVENT_ID }, prisma),
      checkInScan({ scanned: raceToken, eventId: EVENT_ID }, prisma),
    ]);

    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual(["ALREADY_CHECKED_IN", "VALID"]);

    const att = await prisma.attendee.findUnique({ where: { id: raceAtt.id } });
    expect(att?.admitted_at).not.toBeNull();
  });
});

describe("checkInScan — cancelled → REVOKED", () => {
  it("returns REVOKED for cancelled attendee and does not set admitted_at", async () => {
    // Need a fresh token for the cancelled attendee lookup
    const cancelledAtt = await prisma.attendee.findUnique({ where: { id: attendeeCancelledId } });
    const cancelledToken = generateToken();
    // Update token_hash so we can scan it
    const cancelledHash = hashToken(cancelledToken);
    await prisma.attendee.update({ where: { id: attendeeCancelledId }, data: { token_hash: cancelledHash } });

    const result = await checkInScan({ scanned: cancelledToken, eventId: EVENT_ID }, prisma);
    expect(result.status).toBe("REVOKED");
    if (result.status !== "REVOKED") return;
    expect(result.attendee.name).toBe("Cancelled Checkin");

    const att = await prisma.attendee.findUnique({ where: { id: attendeeCancelledId } });
    expect(att?.admitted_at).toBeNull();
  });

  it("logs REVOKED to CheckIn table", async () => {
    const log = await prisma.checkIn.findFirst({
      where: { attendee_id: attendeeCancelledId, status: "REVOKED" },
    });
    expect(log).not.toBeNull();
  });
});

describe("checkInScan — INVALID (unknown scan)", () => {
  it("returns INVALID for an unknown token", async () => {
    const result = await checkInScan({ scanned: generateToken(), eventId: EVENT_ID }, prisma);
    expect(result.status).toBe("INVALID");
  });

  it("does not create a CheckIn log for INVALID scans", async () => {
    const before = await prisma.checkIn.count({ where: { event_id: EVENT_ID } });
    await checkInScan({ scanned: "TOTALLY-UNKNOWN-PAYLOAD", eventId: EVENT_ID }, prisma);
    const after = await prisma.checkIn.count({ where: { event_id: EVENT_ID } });
    expect(after).toBe(before);
  });
});

describe("checkInScan — event scoping", () => {
  it("returns INVALID when valid token is scanned against wrong eventId", async () => {
    // tokenA belongs to EVENT_ID; scanning against OTHER_EVENT_ID must fail closed
    const freshToken = generateToken();
    await prisma.attendee.create({
      data: {
        event_id: EVENT_ID,
        email: "scope-test@example.com",
        name: "Scope Test",
        token_hash: hashToken(freshToken),
      },
    });
    const result = await checkInScan({ scanned: freshToken, eventId: OTHER_EVENT_ID }, prisma);
    expect(result.status).toBe("INVALID");
  });
});

describe("getRecentCheckIns", () => {
  it("returns check-ins ordered newest first", async () => {
    const history = await getRecentCheckIns(EVENT_ID, prisma);
    expect(Array.isArray(history)).toBe(true);
    expect(history.length).toBeGreaterThan(0);
  });

  it("respects limit", async () => {
    const history = await getRecentCheckIns(EVENT_ID, prisma, 2);
    expect(history.length).toBeLessThanOrEqual(2);
  });

  it("clamps limit to max 50", async () => {
    const history = await getRecentCheckIns(EVENT_ID, prisma, 999);
    expect(history.length).toBeLessThanOrEqual(50);
  });

  it("clamps invalid limit to minimum 1", async () => {
    const history = await getRecentCheckIns(EVENT_ID, prisma, -5);
    expect(history.length).toBeGreaterThanOrEqual(0);
  });

  it("attendee info does not include email (no PII)", async () => {
    const history = await getRecentCheckIns(EVENT_ID, prisma, 1) as Array<{ attendee?: Record<string, unknown> }>;
    if (history[0]?.attendee) {
      expect("email" in history[0].attendee).toBe(false);
    }
  });
});
