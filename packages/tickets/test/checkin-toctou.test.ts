/**
 * TOCTOU regression — exercises the CAS re-read branch in checkInScan.
 *
 * The race: resolveTicket sees "registered" attendee, but by the time the CAS
 * updateMany runs (WHERE status IN admittable), the status has changed to "cancelled".
 * The CAS returns count=0 and the re-read branch must return REVOKED, not ALREADY_CHECKED_IN.
 *
 * This branch cannot be tested without mocking because SQLite serialises transactions
 * — a real concurrent status change cannot interleave inside a single $transaction.
 * We mock resolveTicket to return the pre-TOCTOU "registered" snapshot while the DB
 * already holds the post-TOCTOU "cancelled" state, making count=0 deterministic.
 */
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { hashToken } from "../src/hash.js";
import { generateToken } from "../src/token.js";

// vi.mock is hoisted — resolveTicket is replaced before checkInScan imports it.
vi.mock("../src/resolve.js", () => ({
  resolveTicket: vi.fn(),
}));

import { checkInScan } from "../src/checkin.js";
import { resolveTicket } from "../src/resolve.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_ROOT = path.resolve(__dirname, "../../db");
const EVENT_ID = "test-event-toctou-cas-001";

let prisma: PrismaClient;

beforeAll(async () => {
  execSync("npx prisma db push --force-reset", {
    cwd: DB_ROOT,
    env: { ...process.env, DATABASE_URL: process.env["DATABASE_URL"] ?? "file:./tickets-test.db" },
    stdio: "pipe",
  });
  prisma = new PrismaClient();
  await prisma.event.create({
    data: {
      id: EVENT_ID,
      title: "TOCTOU Test Event",
      slug: "toctou-test-event",
      date: new Date("2026-09-01T09:00:00Z"),
    },
  });
});

afterAll(async () => {
  await prisma.checkIn.deleteMany({ where: { event_id: EVENT_ID } });
  await prisma.attendee.deleteMany({ where: { event_id: EVENT_ID } });
  await prisma.event.deleteMany({ where: { id: EVENT_ID } });
  await prisma.$disconnect();
  vi.restoreAllMocks();
});

describe("checkInScan TOCTOU — CAS re-read branch (count=0 due to status change)", () => {
  let attendeeId: string;

  it("returns REVOKED (not ALREADY_CHECKED_IN) when status changes to cancelled between resolve and CAS", async () => {
    const token = generateToken();
    const att = await prisma.attendee.create({
      data: {
        event_id: EVENT_ID,
        email: "toctou-cas@example.com",
        name: "TOCTOU CAS User",
        token_hash: hashToken(token),
        // DB state AFTER TOCTOU: status is cancelled, admitted_at is still null.
        // CAS predicate (status IN admittable) will return count=0.
        status: "cancelled",
      },
    });
    attendeeId = att.id;

    // Mock resolveTicket to return the PRE-TOCTOU snapshot (status=registered).
    // This bypasses the early isAdmittable() check and drives execution into the CAS path.
    vi.mocked(resolveTicket).mockResolvedValueOnce({
      mode: "internal",
      attendee: {
        id: att.id,
        event_id: EVENT_ID,
        email: "toctou-cas@example.com",
        name: "TOCTOU CAS User",
        status: "registered",
        token_hash: hashToken(token),
        qr_payload: null,
        external_uuid: null,
        ticket_type: null,
      },
      event: {
        id: EVENT_ID,
        title: "TOCTOU Test Event",
        date: new Date("2026-09-01T09:00:00Z"),
        location: null,
      },
    });

    const result = await checkInScan({ scanned: token, eventId: EVENT_ID }, prisma);

    // CAS: count=0 because DB status is "cancelled" (not in ADMITTABLE_STATUSES).
    // Re-read: status="cancelled" → !isAdmittable → REVOKED.
    expect(result.status).toBe("REVOKED");
  });

  it("admitted_at stays null after TOCTOU-path REVOKED", async () => {
    const att = await prisma.attendee.findUnique({ where: { id: attendeeId } });
    expect(att?.admitted_at).toBeNull();
  });

  it("logs REVOKED to CheckIn — not ALREADY_CHECKED_IN", async () => {
    const revokedLog = await prisma.checkIn.findFirst({
      where: { attendee_id: attendeeId, status: "REVOKED" },
    });
    expect(revokedLog).not.toBeNull();

    const wrongLog = await prisma.checkIn.findFirst({
      where: { attendee_id: attendeeId, status: "ALREADY_CHECKED_IN" },
    });
    expect(wrongLog).toBeNull();
  });
});
