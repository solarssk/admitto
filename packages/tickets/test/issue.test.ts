import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { issueTicket, issueTicketsForEvent } from "../src/issue.js";
import { hashToken } from "../src/hash.js";
import { looksLikeInternalToken } from "../src/url.js";
import { decryptFromString } from "@admitto/crypto";
import { assertTestDatabaseUrl } from "@admitto/db/test-db-guard";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_ROOT = path.resolve(__dirname, "../../db");

let prisma: PrismaClient;
const EVENT_ID = "test-event-issue-001";
let attendeeAId: string;
let attendeeBId: string;
let attendeeCancelledId: string;

beforeAll(async () => {
  assertTestDatabaseUrl(process.env.DATABASE_URL ?? "");
  execSync("npx prisma db push --force-reset --accept-data-loss", {
    cwd: DB_ROOT,
    env: { ...process.env },
    stdio: "pipe",
  });

  prisma = createTestPrismaClient();

  await prisma.organization.create({
    data: { id: "org_default", name: "Default", slug: "default" },
  });

  await prisma.event.upsert({
    where: { id: EVENT_ID },
    update: {},
    create: {
      id: EVENT_ID,
      title: "Issue Test Event",
      slug: "test-event-issue-001",
      date: new Date("2026-09-01T09:00:00Z"),
      organization_id: "org_default",
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

  const attCancelled = await prisma.attendee.create({
    data: {
      event_id: EVENT_ID,
      email: "cancelled@example.com",
      name: "Cancelled User",
      status: "cancelled",
    },
  });
  attendeeCancelledId = attCancelled.id;
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

  it("persists token_enc to DB and decrypts to raw token", async () => {
    const att = await prisma.attendee.findUnique({ where: { id: attendeeAId } });
    expect(att?.token_enc).not.toBeNull();
    expect(decryptFromString(att!.token_enc!)).toBe(rawToken);
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

  it("is safe under concurrent calls: one issues, the other sees already_issued", async () => {
    const att = await prisma.attendee.create({
      data: { event_id: EVENT_ID, email: "race@example.com", name: "Race User" },
    });

    const [first, second] = await Promise.all([
      issueTicket(att.id, prisma, BASE_URL),
      issueTicket(att.id, prisma, BASE_URL),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual(["already_issued", "issued"]);

    const after = await prisma.attendee.findUnique({ where: { id: att.id } });
    expect(after?.token_hash).not.toBeNull();
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

  it("does not write token_hash or token_enc for Mode B attendee", async () => {
    await issueTicket(attendeeBId, prisma, BASE_URL);
    const att = await prisma.attendee.findUnique({ where: { id: attendeeBId } });
    expect(att?.token_hash).toBeNull();
    expect(att?.token_enc).toBeNull();
  });

  it("uses external_uuid as the agency payload when qr_payload is absent", async () => {
    const attendee = await prisma.attendee.create({
      data: {
        event_id: EVENT_ID,
        email: "external-uuid-only@example.com",
        name: "External UUID Only",
        external_uuid: "AGENCY-UUID-ONLY",
      },
    });

    await expect(issueTicket(attendee.id, prisma, BASE_URL)).resolves.toEqual({
      status: "agency",
      mode: "agency",
      attendeeId: attendee.id,
      qrPayload: "AGENCY-UUID-ONLY",
    });
  });

  it("does not issue a cancelled agency attendee", async () => {
    const att = await prisma.attendee.create({
      data: {
        event_id: EVENT_ID,
        email: "cancelled-agency@example.com",
        name: "Cancelled Agency",
        status: "cancelled",
        external_uuid: "cancelled-agency-uuid",
        qr_payload: "CANCELLED-AGENCY-QR",
      },
    });

    const result = await issueTicket(att.id, prisma, BASE_URL);
    expect(result.status).toBe("not_issuable");
    if (result.status !== "not_issuable") return;
    expect(result.reason).toBe("cancelled");
  });
});

describe("issueTicket — not issuable statuses", () => {
  it("does not issue a cancelled attendee", async () => {
    const result = await issueTicket(attendeeCancelledId, prisma, BASE_URL);
    expect(result.status).toBe("not_issuable");
    if (result.status !== "not_issuable") return;
    expect(result.reason).toBe("cancelled");

    const att = await prisma.attendee.findUnique({ where: { id: attendeeCancelledId } });
    expect(att?.token_hash).toBeNull();
  });

  it("does not issue a revoked attendee", async () => {
    const attendee = await prisma.attendee.create({
      data: {
        event_id: EVENT_ID,
        email: "revoked-issue@example.com",
        name: "Revoked Issue",
        status: "revoked",
      },
    });

    await expect(issueTicket(attendee.id, prisma, BASE_URL)).resolves.toMatchObject({
      status: "not_issuable",
      reason: "revoked",
    });
  });
});

describe("issueTicket — not found", () => {
  it("throws for unknown attendee id", async () => {
    await expect(issueTicket("nonexistent-id", prisma, BASE_URL)).rejects.toThrow(
      "Attendee not found",
    );
  });
});

function casRacePrisma(afterRace: Record<string, unknown> | null): PrismaClient {
  const initial = {
    id: "cas-race-attendee",
    status: "confirmed",
    qr_payload: null,
    external_uuid: null,
    token_hash: null,
  };
  return {
    attendee: {
      findUnique: vi.fn().mockResolvedValueOnce(initial).mockResolvedValueOnce(afterRace),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  } as unknown as PrismaClient;
}

describe("issueTicket — compare-and-set race recovery", () => {
  it("returns an agency ticket when another writer assigned its agency identifier", async () => {
    const result = await issueTicket(
      "cas-race-attendee",
      casRacePrisma({
        status: "confirmed",
        qr_payload: null,
        external_uuid: "agency-after-race",
        token_hash: null,
      }),
      BASE_URL,
    );

    expect(result).toEqual({
      status: "agency",
      mode: "agency",
      attendeeId: "cas-race-attendee",
      qrPayload: "agency-after-race",
    });
  });

  it("returns not_issuable when another writer revokes the attendee", async () => {
    const result = await issueTicket(
      "cas-race-attendee",
      casRacePrisma({ status: "revoked", qr_payload: null, external_uuid: null, token_hash: null }),
      BASE_URL,
    );

    expect(result).toEqual({
      status: "not_issuable",
      mode: "internal",
      attendeeId: "cas-race-attendee",
      reason: "revoked",
    });
  });

  it("returns already_issued when another writer wins the race", async () => {
    const result = await issueTicket(
      "cas-race-attendee",
      casRacePrisma({
        status: "confirmed",
        qr_payload: null,
        external_uuid: null,
        token_hash: "already-issued-after-race",
      }),
      BASE_URL,
    );

    expect(result).toEqual({
      status: "already_issued",
      mode: "internal",
      attendeeId: "cas-race-attendee",
    });
  });

  it("fails explicitly when the attendee disappears after a failed update", async () => {
    await expect(issueTicket("cas-race-attendee", casRacePrisma(null), BASE_URL)).rejects.toThrow(
      "Attendee not found: cas-race-attendee",
    );
  });

  it("fails explicitly when a failed update has no explainable concurrent change", async () => {
    await expect(
      issueTicket(
        "cas-race-attendee",
        casRacePrisma({
          status: "confirmed",
          qr_payload: null,
          external_uuid: null,
          token_hash: null,
        }),
        BASE_URL,
      ),
    ).rejects.toThrow("Ticket issuance failed for attendee cas-race-attendee");
  });
});

describe("issueTicketsForEvent — compare-and-set race recovery", () => {
  it("recovers an agency result inside the batch transaction", async () => {
    const pending = {
      id: "batch-cas-race-attendee",
      status: "confirmed",
      qr_payload: null,
      external_uuid: null,
      token_hash: null,
    };
    const tx = {
      attendee: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findUnique: vi.fn().mockResolvedValue({
          status: "confirmed",
          qr_payload: "agency-qr-after-race",
          external_uuid: null,
          token_hash: null,
        }),
      },
    };
    const racePrisma = {
      event: { findUnique: vi.fn().mockResolvedValue({ id: "batch-cas-race-event" }) },
      attendee: { findMany: vi.fn().mockResolvedValue([pending]) },
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<void>) => callback(tx)),
    } as unknown as PrismaClient;

    await expect(issueTicketsForEvent("batch-cas-race-event", racePrisma, BASE_URL)).resolves.toMatchObject({
      issued: 0,
      agency: 1,
      results: [
        {
          status: "agency",
          attendeeId: "batch-cas-race-attendee",
          qrPayload: "agency-qr-after-race",
        },
      ],
    });
  });

  it("fails explicitly when a pending attendee disappears in the batch transaction", async () => {
    const pending = {
      id: "batch-cas-race-missing",
      status: "confirmed",
      qr_payload: null,
      external_uuid: null,
      token_hash: null,
    };
    const tx = {
      attendee: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };
    const racePrisma = {
      event: { findUnique: vi.fn().mockResolvedValue({ id: "batch-cas-race-event" }) },
      attendee: { findMany: vi.fn().mockResolvedValue([pending]) },
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<void>) => callback(tx)),
    } as unknown as PrismaClient;

    await expect(issueTicketsForEvent("batch-cas-race-event", racePrisma, BASE_URL)).rejects.toThrow(
      "Attendee not found: batch-cas-race-missing",
    );
  });

  it("fails explicitly when a batch compare-and-set has no explainable concurrent change", async () => {
    const pending = {
      id: "batch-cas-race-unexplained",
      status: "confirmed",
      qr_payload: null,
      external_uuid: null,
      token_hash: null,
    };
    const tx = {
      attendee: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findUnique: vi.fn().mockResolvedValue({
          status: "confirmed",
          qr_payload: null,
          external_uuid: null,
          token_hash: null,
        }),
      },
    };
    const racePrisma = {
      event: { findUnique: vi.fn().mockResolvedValue({ id: "batch-cas-race-event" }) },
      attendee: { findMany: vi.fn().mockResolvedValue([pending]) },
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<void>) => callback(tx)),
    } as unknown as PrismaClient;

    await expect(issueTicketsForEvent("batch-cas-race-event", racePrisma, BASE_URL)).rejects.toThrow(
      "Ticket issuance failed for attendee batch-cas-race-unexplained",
    );
  });
});

describe("issueTicketsForEvent", () => {
  it("issues fresh internal attendees in batch and persists token hashes", async () => {
    const scopedEventId = "test-event-issue-batch-internal-001";
    await prisma.event.create({
      data: {
        id: scopedEventId,
        title: "Issue Internal Batch Event",
        slug: "issue-internal-batch-event",
        date: new Date("2026-11-01T09:00:00Z"),
        organization_id: "org_default",
      },
    });

    const internalA = await prisma.attendee.create({
      data: {
        event_id: scopedEventId,
        email: "batch-internal-a@example.com",
        name: "Batch Internal A",
      },
    });
    const internalB = await prisma.attendee.create({
      data: {
        event_id: scopedEventId,
        email: "batch-internal-b@example.com",
        name: "Batch Internal B",
      },
    });

    const summary = await issueTicketsForEvent(scopedEventId, prisma, BASE_URL);

    expect(summary.issued).toBe(2);
    expect(summary.alreadyIssued).toBe(0);
    expect(summary.agency).toBe(0);
    expect(summary.notIssuable).toBe(0);

    const issuedResults = summary.results.filter(
      (result): result is Extract<typeof result, { status: "issued" }> => result.status === "issued",
    );
    expect(issuedResults).toHaveLength(2);
    expect(issuedResults.map((result) => result.attendeeId).sort()).toEqual(
      [internalA.id, internalB.id].sort(),
    );
    expect(issuedResults.every((result) => looksLikeInternalToken(result.token))).toBe(true);

    const persisted = await prisma.attendee.findMany({
      where: { event_id: scopedEventId },
      select: { id: true, token_hash: true },
    });
    expect(persisted.every((attendee) => attendee.token_hash?.length === 64)).toBe(true);

    await prisma.attendee.deleteMany({ where: { event_id: scopedEventId } });
    await prisma.event.delete({ where: { id: scopedEventId } });
  });

  it("issues remaining unissued and skips already-issued, returns correct counts", async () => {
    const scopedEventId = "test-event-issue-summary-001";
    await prisma.event.create({
      data: {
        id: scopedEventId,
        title: "Issue Summary Event",
        slug: "issue-summary-event",
        date: new Date("2026-10-01T09:00:00Z"),
        organization_id: "org_default",
      },
    });

    const issuedOne = await prisma.attendee.create({
      data: {
        event_id: scopedEventId,
        email: "already-issued-one@example.com",
        name: "Already Issued One",
        token_hash: hashToken("summary-issued-one"),
      },
    });
    const issuedTwo = await prisma.attendee.create({
      data: {
        event_id: scopedEventId,
        email: "already-issued-two@example.com",
        name: "Already Issued Two",
        token_hash: hashToken("summary-issued-two"),
      },
    });
    const agency = await prisma.attendee.create({
      data: {
        event_id: scopedEventId,
        email: "agency-summary@example.com",
        name: "Agency Summary",
        external_uuid: "agency-summary-uuid",
        qr_payload: "AGENCY-SUMMARY-QR",
      },
    });
    const cancelled = await prisma.attendee.create({
      data: {
        event_id: scopedEventId,
        email: "cancelled-summary@example.com",
        name: "Cancelled Summary",
        status: "cancelled",
      },
    });
    const cancelledAgency = await prisma.attendee.create({
      data: {
        event_id: scopedEventId,
        email: "cancelled-agency-summary@example.com",
        name: "Cancelled Agency Summary",
        status: "cancelled",
        external_uuid: "cancelled-agency-summary-uuid",
        qr_payload: "CANCELLED-AGENCY-SUMMARY-QR",
      },
    });

    const summary = await issueTicketsForEvent(scopedEventId, prisma, BASE_URL);

    expect(summary.issued).toBe(0);
    expect(summary.alreadyIssued).toBe(2);
    expect(summary.agency).toBe(1);
    expect(summary.notIssuable).toBe(2);
    expect(summary.results).toHaveLength(5);
    expect(summary.results.map((result) => result.attendeeId).sort()).toEqual(
      [issuedOne.id, issuedTwo.id, agency.id, cancelled.id, cancelledAgency.id].sort(),
    );

    await prisma.attendee.deleteMany({ where: { event_id: scopedEventId } });
    await prisma.event.delete({ where: { id: scopedEventId } });
  });

  it("throws for unknown event", async () => {
    await expect(issueTicketsForEvent("no-such-event", prisma, BASE_URL)).rejects.toThrow(
      "Event not found",
    );
  });
});
