/**
 * TOCTOU regression — exercises the CAS re-read branch in checkInScan.
 *
 * The race: resolveTicket sees "registered" attendee, but by the time the CAS
 * updateMany runs (WHERE status IN admittable), the status has changed to "cancelled".
 * The CAS returns count=0 and the re-read branch must return REVOKED, not ALREADY_CHECKED_IN.
 *
 * This branch cannot be tested without mocking because the database serialises transactions
 * within a single connection — a real concurrent status change cannot interleave inside a
 * single $transaction. We mock resolveTicket to return the pre-TOCTOU "registered" snapshot
 * while the DB already holds the post-TOCTOU "cancelled" state, making count=0 deterministic.
 */
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { hashToken } from "../src/hash.js";
import { generateToken } from "../src/token.js";

// vi.mock is hoisted — resolveTicket is replaced before checkInScan imports it.
vi.mock("../src/resolve.js", () => ({
  resolveTicket: vi.fn(),
}));

import { checkInScan } from "../src/checkin.js";
import { resolveTicket } from "../src/resolve.js";
import { assertTestDatabaseUrl } from "@admitto/db/test-db-guard";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_ROOT = path.resolve(__dirname, "../../db");
const EVENT_ID = "test-event-toctou-cas-001";
const TEST_DATABASE_URL = process.env["DATABASE_URL"] ?? "postgresql://admitto:admitto@localhost:5432/admitto_tickets_test";

let prisma: PrismaClient;

beforeAll(async () => {
  process.env["DATABASE_URL"] = TEST_DATABASE_URL;
  assertTestDatabaseUrl(TEST_DATABASE_URL);
  execSync("npx prisma db push --force-reset --accept-data-loss", {
    cwd: DB_ROOT,
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: "pipe",
  });
  prisma = createTestPrismaClient(TEST_DATABASE_URL);
  await prisma.organization.create({
    data: { id: "org_default", name: "Default", slug: "default" },
  });
  await prisma.event.create({
    data: {
      id: EVENT_ID,
      title: "TOCTOU Test Event",
      slug: "toctou-test-event",
      date: new Date("2026-09-01T09:00:00Z"),
      organization_id: "org_default",
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
  it("returns REVOKED, keeps admitted_at null, and logs REVOKED when status changes to cancelled between resolve and CAS", async () => {
    const token = generateToken();
    const att = await prisma.attendee.create({
      data: {
        event_id: EVENT_ID,
        email: "toctou-cas@example.com",
        name: "TOCTOU CAS User",
        token_hash: hashToken(token),
        status: "cancelled",
      },
    });

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
        logoUrl: null,
        formattedAddress: null,
        addressComponents: null,
        latitude: null,
        longitude: null,
        mapZoom: null,
        directionsText: null,
        accessibilityText: null,
      },
    });

    const result = await checkInScan({ scanned: token, eventId: EVENT_ID }, prisma);

    expect(vi.mocked(resolveTicket)).toHaveBeenCalledOnce();
    expect(vi.mocked(resolveTicket)).toHaveBeenCalledWith(
      token,
      expect.anything(),
      { eventId: EVENT_ID },
    );
    expect(result.status).toBe("REVOKED");

    const requeried = await prisma.attendee.findUnique({ where: { id: att.id } });
    expect(requeried?.admitted_at).toBeNull();

    const revokedLog = await prisma.checkIn.findFirst({
      where: { attendee_id: att.id, status: "REVOKED" },
    });
    expect(revokedLog).not.toBeNull();

    const wrongLog = await prisma.checkIn.findFirst({
      where: { attendee_id: att.id, status: "ALREADY_CHECKED_IN" },
    });
    expect(wrongLog).toBeNull();
  });
});
