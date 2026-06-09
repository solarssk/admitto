import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { issueTicket, issueTicketsForEvent } from "../src/issue.js";
import { hashToken } from "../src/hash.js";
import { looksLikeInternalToken } from "../src/url.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_ROOT = path.resolve(__dirname, "../../db");

let prisma: PrismaClient;
const EVENT_ID = "test-event-issue-001";
let attendeeAId: string;
let attendeeBId: string;

beforeAll(async () => {
  execSync("npx prisma db push --force-reset", {
    cwd: DB_ROOT,
    env: { ...process.env, DATABASE_URL: process.env["DATABASE_URL"] ?? "file:./issue-test.db" },
    stdio: "pipe",
  });

  prisma = new PrismaClient();

  await prisma.event.upsert({
    where: { id: EVENT_ID },
    update: {},
    create: {
      id: EVENT_ID,
      title: "Issue Test Event",
      slug: "test-event-issue-001",
      date: new Date("2026-09-01T09:00:00Z"),
    },
  });

  // Mode A — no token yet
  const attA = await prisma.attendee.create({
    data: { event_id: EVENT_ID, email: "mode-a-issue@example.com", name: "Mode A" },
  });
  attendeeAId = attA.id;

  // Mode B — agency
  const attB = await prisma.attendee.create({
    data: {
      event_id: EVENT_ID,
      email: "mode-b-issue@example.com",
      name: "Mode B",
      external_uuid: "agency-uuid-issue-001",
      qr_payload: "AGENCY-QR-ISSUE-001",
    },
  });
  attendeeBId = attB.id;
});

afterAll(async () => {
  await prisma.attendee.deleteMany({ where: { event_id: EVENT_ID } });
  await prisma.event.deleteMany({ where: { id: EVENT_ID } });
  await prisma.$disconnect();
});

const BASE_URL = "https://admitto.example.com";

describe("issueTicket — Mode A first issuance", () => {
  let rawToken: string;

  it("returns status=issued with raw token and ticket URL", async () => {
    const result = await issueTicket(attendeeAId, prisma, BASE_URL);
    expect(result.status).toBe("issued");
    expect(result.mode).toBe("internal");
    if (result.status !== "issued") return;
    expect(looksLikeInternalToken(result.token)).toBe(true);
    expect(result.tokenHash).toHaveLength(64); // sha256 hex
    expect(result.ticketUrl).toMatch(/^https:\/\/admitto\.example\.com\/t\//);
    rawToken = result.token;
  });

  it("persists token_hash to DB", async () => {
    const att = await prisma.attendee.findUnique({ where: { id: attendeeAId } });
    expect(att?.token_hash).not.toBeNull();
    expect(att?.token_hash).toHaveLength(64);
  });

  it("token_hash matches sha256 of returned raw token", async () => {
    const att = await prisma.attendee.findUnique({ where: { id: attendeeAId } });
    expect(att?.token_hash).toBe(hashToken(rawToken));
  });
});

describe("issueTicket — Mode A idempotency (second call)", () => {
  it("returns status=already_issued, not a new token", async () => {
    const result = await issueTicket(attendeeAId, prisma, BASE_URL);
    expect(result.status).toBe("already_issued");
    expect(result.mode).toBe("internal");
    // No raw token in already_issued result
    expect("token" in result).toBe(false);
  });

  it("does not overwrite token_hash in DB", async () => {
    const before = await prisma.attendee.findUnique({ where: { id: attendeeAId } });
    await issueTicket(attendeeAId, prisma, BASE_URL);
    const after = await prisma.attendee.findUnique({ where: { id: attendeeAId } });
    expect(after?.token_hash).toBe(before?.token_hash);
  });
});

describe("issueTicket — Mode B (agency)", () => {
  it("returns status=agency with qr_payload, does not mint a token", async () => {
    const result = await issueTicket(attendeeBId, prisma, BASE_URL);
    expect(result.status).toBe("agency");
    expect(result.mode).toBe("agency");
    if (result.status !== "agency") return;
    expect(result.qrPayload).toBe("AGENCY-QR-ISSUE-001");
  });

  it("does not write token_hash for Mode B attendee", async () => {
    await issueTicket(attendeeBId, prisma, BASE_URL);
    const att = await prisma.attendee.findUnique({ where: { id: attendeeBId } });
    expect(att?.token_hash).toBeNull();
  });
});

describe("issueTicket — not found", () => {
  it("throws for unknown attendee id", async () => {
    await expect(issueTicket("nonexistent-id", prisma, BASE_URL)).rejects.toThrow(
      "Attendee not found",
    );
  });
});

describe("issueTicketsForEvent", () => {
  it("issues remaining unissued and skips already-issued, returns correct counts", async () => {
    // attendeeA already issued in previous describe blocks; attendeeB is agency
    const summary = await issueTicketsForEvent(EVENT_ID, prisma, BASE_URL);
    // attendeeA: already_issued; attendeeB: agency
    expect(summary.issued).toBe(0);
    expect(summary.alreadyIssued).toBe(1);
    expect(summary.agency).toBe(1);
    expect(summary.results).toHaveLength(2);
  });

  it("throws for unknown event", async () => {
    await expect(issueTicketsForEvent("no-such-event", prisma, BASE_URL)).rejects.toThrow(
      "Event not found",
    );
  });
});
