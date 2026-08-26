/**
 * Branch coverage for drainPendingDeliveries failure/skip paths.
 * Uses vi.mock so spies intercept the bindings drain.ts imports.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestPrismaClient } from "@admitto/db/testing";
import { MailConfigError, resolveMailConfig, setMailSettings } from "@admitto/mailer-config";
import { generateToken } from "@admitto/tickets";
import { createMailer, sendBatch } from "@admitto/mailer";
import { resolveAttendeeMailLinks } from "../src/links.js";
import { cancelBulkSendBatch, drainPendingDeliveries, sendTicketEmails } from "../src/index.js";
import { resetDb } from "./resetDb.js";

vi.mock("@admitto/mailer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@admitto/mailer")>();
  return {
    ...actual,
    sendBatch: vi.fn(actual.sendBatch),
    createMailer: vi.fn(actual.createMailer),
  };
});

vi.mock("@admitto/mailer-config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@admitto/mailer-config")>();
  return {
    ...actual,
    resolveMailConfig: vi.fn(actual.resolveMailConfig),
  };
});

vi.mock("../src/links.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/links.js")>();
  return {
    ...actual,
    resolveAttendeeMailLinks: vi.fn(actual.resolveAttendeeMailLinks),
  };
});

const prisma = createTestPrismaClient();
const EVENT_ID = "evt-mail-drain-branches";

beforeAll(async () => {
  await resetDb();
  await prisma.organization.create({
    data: { id: "org-drain-b", name: "Drain Branches Org", slug: "drain-branches-org" },
  });
  await prisma.event.create({
    data: {
      id: EVENT_ID,
      organization_id: "org-drain-b",
      title: "Drain Branches",
      slug: "drain-branches",
      date: new Date("2026-09-01"),
    },
  });
  await setMailSettings(
    { scopeType: "organization", scopeId: "org-drain-b" },
    { provider: "export_only", fromAddress: "events@example.com" },
    prisma,
  );
  await prisma.attendee.create({
    data: {
      id: "att-drain-branch",
      event_id: EVENT_ID,
      email: "branch@example.com",
      name: "Branch",
      public_ref: generateToken(),
    },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(() => {
  vi.mocked(sendBatch).mockReset();
  vi.mocked(sendBatch).mockImplementation(
    async (...args) => {
      const actual = await vi.importActual<typeof import("@admitto/mailer")>("@admitto/mailer");
      return actual.sendBatch(...args);
    },
  );
  vi.mocked(createMailer).mockReset();
  vi.mocked(createMailer).mockImplementation(
    async (...args) => {
      const actual = await vi.importActual<typeof import("@admitto/mailer")>("@admitto/mailer");
      return actual.createMailer(...args);
    },
  );
  vi.mocked(resolveMailConfig).mockReset();
  vi.mocked(resolveMailConfig).mockImplementation(
    async (...args) => {
      const actual = await vi.importActual<typeof import("@admitto/mailer-config")>(
        "@admitto/mailer-config",
      );
      return actual.resolveMailConfig(...args);
    },
  );
  vi.mocked(resolveAttendeeMailLinks).mockReset();
  vi.mocked(resolveAttendeeMailLinks).mockImplementation(
    async (...args) => {
      const actual = await vi.importActual<typeof import("../src/links.js")>("../src/links.js");
      return actual.resolveAttendeeMailLinks(...args);
    },
  );
});

async function enqueueOne() {
  await prisma.emailDelivery.deleteMany({ where: { event_id: EVENT_ID } });
  await sendTicketEmails(
    EVENT_ID,
    { attendeeIds: ["att-drain-branch"] },
    prisma,
    { NODE_ENV: "test", BASE_URL: "https://tickets.example.com" },
    { exportSink: () => undefined },
  );
}

describe("drainPendingDeliveries branch coverage", () => {
  it("marks failed when resolveAttendeeMailLinks throws", async () => {
    await enqueueOne();
    vi.mocked(resolveAttendeeMailLinks).mockRejectedValueOnce(new Error("gone"));

    const drain = await drainPendingDeliveries(
      prisma,
      { NODE_ENV: "test", BASE_URL: "https://tickets.example.com" },
      { exportSink: () => undefined },
      { eventId: EVENT_ID, baseUrl: "https://tickets.example.com" },
    );
    expect(drain).toEqual({ claimed: 1, sent: 0, failed: 1, skipped: 0, eventIds: [EVENT_ID] });
    const row = await prisma.emailDelivery.findFirstOrThrow({ where: { event_id: EVENT_ID } });
    expect(row.status).toBe("failed");
  });

  it("marks failed when sendBatch throws an Error", async () => {
    await enqueueOne();
    vi.mocked(sendBatch).mockRejectedValueOnce(new Error("transport down"));

    const drain = await drainPendingDeliveries(
      prisma,
      { NODE_ENV: "test", BASE_URL: "https://tickets.example.com" },
      { exportSink: () => undefined },
      { eventId: EVENT_ID, baseUrl: "https://tickets.example.com" },
    );
    expect(drain.failed).toBe(1);
  });

  it("marks failed when sendBatch throws a non-Error", async () => {
    await enqueueOne();
    vi.mocked(sendBatch).mockRejectedValueOnce("raw-string-failure");

    const drain = await drainPendingDeliveries(
      prisma,
      { NODE_ENV: "test", BASE_URL: "https://tickets.example.com" },
      { exportSink: () => undefined },
      { eventId: EVENT_ID, baseUrl: "https://tickets.example.com" },
    );
    expect(drain.failed).toBe(1);
    const row = await prisma.emailDelivery.findFirstOrThrow({ where: { event_id: EVENT_ID } });
    expect(row.error).toContain("raw-string-failure");
  });

  it("marks failed when sendBatch returns an empty results array", async () => {
    await enqueueOne();
    vi.mocked(sendBatch).mockResolvedValueOnce({
      total: 1,
      sent: 0,
      failed: 1,
      results: [],
    });

    const drain = await drainPendingDeliveries(
      prisma,
      { NODE_ENV: "test", BASE_URL: "https://tickets.example.com" },
      { exportSink: () => undefined },
      { eventId: EVENT_ID, baseUrl: "https://tickets.example.com" },
    );
    expect(drain).toEqual({ claimed: 1, sent: 0, failed: 1, skipped: 0, eventIds: [EVENT_ID] });
  });

  it("counts an empty provider result as skipped, not failed, when the row was cancelled during the send call", async () => {
    await enqueueOne();
    const row = await prisma.emailDelivery.findFirstOrThrow({ where: { event_id: EVENT_ID } });
    const batchId = "batch-cancel-empty-result-race";
    await prisma.emailDelivery.update({ where: { id: row.id }, data: { batch_id: batchId } });

    vi.mocked(sendBatch).mockImplementationOnce(async () => {
      await cancelBulkSendBatch(prisma, EVENT_ID, batchId);
      return { total: 1, sent: 0, failed: 1, results: [] };
    });

    const drain = await drainPendingDeliveries(
      prisma,
      { NODE_ENV: "test", BASE_URL: "https://tickets.example.com" },
      { exportSink: () => undefined },
      { eventId: EVENT_ID, baseUrl: "https://tickets.example.com" },
    );
    expect(drain).toEqual({ claimed: 1, sent: 0, failed: 0, skipped: 1, eventIds: [EVENT_ID] });
    const after = await prisma.emailDelivery.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe("cancelled");
  });

  it("counts rejected provider results as failed", async () => {
    await enqueueOne();
    vi.mocked(sendBatch).mockResolvedValueOnce({
      total: 1,
      sent: 0,
      failed: 1,
      results: [{ status: "rejected", provider: "export_only", error: "bounce" }],
    });

    const drain = await drainPendingDeliveries(
      prisma,
      { NODE_ENV: "test", BASE_URL: "https://tickets.example.com" },
      { exportSink: () => undefined },
      { eventId: EVENT_ID, baseUrl: "https://tickets.example.com" },
    );
    expect(drain).toEqual({ claimed: 1, sent: 0, failed: 1, skipped: 0, eventIds: [EVENT_ID] });
  });

  it("marks retryable false when the final attempt still fails", async () => {
    await enqueueOne();
    const row = await prisma.emailDelivery.findFirstOrThrow({ where: { event_id: EVENT_ID } });
    await prisma.emailDelivery.update({
      where: { id: row.id },
      data: {
        status: "failed",
        retryable: true,
        attempts: 7,
        attempted_at: new Date("2020-01-01T00:00:00.000Z"),
        error: "soft fail",
      },
    });
    vi.mocked(sendBatch).mockRejectedValueOnce(new Error("still down"));

    const drain = await drainPendingDeliveries(
      prisma,
      { NODE_ENV: "test", BASE_URL: "https://tickets.example.com" },
      { exportSink: () => undefined },
      { eventId: EVENT_ID, baseUrl: "https://tickets.example.com" },
    );
    expect(drain).toEqual({ claimed: 1, sent: 0, failed: 1, skipped: 0, eventIds: [EVENT_ID] });
    const after = await prisma.emailDelivery.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.attempts).toBe(8);
    expect(after.retryable).toBe(false);
    expect(after.status).toBe("failed");
  });

  it("sets retryable false when a rejected provider result exhausts attempts", async () => {
    await enqueueOne();
    const row = await prisma.emailDelivery.findFirstOrThrow({ where: { event_id: EVENT_ID } });
    await prisma.emailDelivery.update({
      where: { id: row.id },
      data: {
        status: "failed",
        retryable: true,
        attempts: 7,
        attempted_at: new Date("2020-01-01T00:00:00.000Z"),
        error: "soft fail",
      },
    });
    vi.mocked(sendBatch).mockResolvedValueOnce({
      total: 1,
      sent: 0,
      failed: 1,
      results: [{ status: "rejected", provider: "export_only", error: "bounce" }],
    });

    const drain = await drainPendingDeliveries(
      prisma,
      { NODE_ENV: "test", BASE_URL: "https://tickets.example.com" },
      { exportSink: () => undefined },
      { eventId: EVENT_ID, baseUrl: "https://tickets.example.com" },
    );
    expect(drain).toEqual({ claimed: 1, sent: 0, failed: 1, skipped: 0, eventIds: [EVENT_ID] });
    const after = await prisma.emailDelivery.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.attempts).toBe(8);
    expect(after.retryable).toBe(false);
  });

  it("skips when claim returns a row with a null snapshot field", async () => {
    await enqueueOne();
    const findMany = vi.spyOn(prisma.emailDelivery, "findMany").mockResolvedValueOnce([
      {
        id: "del-null-snap",
        event_id: EVENT_ID,
        attendee_id: "att-drain-branch",
        purpose: "ticket",
        status: "queued",
        recipient_email: null,
        rendered_subject: "Hello",
        rendered_html: "<p>Hi</p>",
      },
    ] as never);

    try {
      const drain = await drainPendingDeliveries(
        prisma,
        { NODE_ENV: "test", BASE_URL: "https://tickets.example.com" },
        { exportSink: () => undefined },
        { eventId: EVENT_ID, baseUrl: "https://tickets.example.com" },
      );
      expect(drain).toEqual({ claimed: 1, sent: 0, failed: 0, skipped: 1, eventIds: [EVENT_ID] });
    } finally {
      findMany.mockRestore();
    }
  });

  it("skips a row cancelled between claim and send, without overwriting its cancelled status", async () => {
    // Reproduces the exact race the cancel feature depends on: claimDrainCandidates() reads
    // this row via a plain SELECT while it's still "queued", so it stays in this tick's
    // in-memory candidate list even if a concurrent cancelBulkSendBatch() call flips its DB row
    // to "cancelled" afterward - resolveAttendeeMailLinks is the one async gap between that
    // claim-time read and drain.ts's own fresh status re-check right before the mailer call.
    await enqueueOne();
    const row = await prisma.emailDelivery.findFirstOrThrow({ where: { event_id: EVENT_ID } });
    const batchId = "batch-cancel-race";
    await prisma.emailDelivery.update({ where: { id: row.id }, data: { batch_id: batchId } });

    vi.mocked(resolveAttendeeMailLinks).mockImplementationOnce(async (...args) => {
      await cancelBulkSendBatch(prisma, EVENT_ID, batchId);
      const actual = await vi.importActual<typeof import("../src/links.js")>("../src/links.js");
      return actual.resolveAttendeeMailLinks(...args);
    });

    const drain = await drainPendingDeliveries(
      prisma,
      { NODE_ENV: "test", BASE_URL: "https://tickets.example.com" },
      { exportSink: () => undefined },
      { eventId: EVENT_ID, baseUrl: "https://tickets.example.com" },
    );

    expect(drain).toEqual({ claimed: 1, sent: 0, failed: 0, skipped: 1, eventIds: [EVENT_ID] });
    expect(sendBatch).not.toHaveBeenCalled();
    const after = await prisma.emailDelivery.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe("cancelled");
  });

  it("does not resurrect a cancelled row into the retry pool when the link resolution that raced the cancel then fails", async () => {
    // The failure-path counterpart of the test above: markClaimedRowFailed used to write
    // status:"failed", retryable:true by id with no guard, silently undoing a cancellation
    // that landed while resolveAttendeeMailLinks was in flight - a later tick would then pick
    // the "failed"+retryable row back up via the retryable-failed candidate query and actually
    // send the email the admin had stopped. Asserts across two ticks that this cannot happen.
    await enqueueOne();
    const row = await prisma.emailDelivery.findFirstOrThrow({ where: { event_id: EVENT_ID } });
    const batchId = "batch-cancel-race-failure";
    await prisma.emailDelivery.update({ where: { id: row.id }, data: { batch_id: batchId } });

    vi.mocked(resolveAttendeeMailLinks).mockImplementationOnce(async () => {
      await cancelBulkSendBatch(prisma, EVENT_ID, batchId);
      throw new Error("link resolution blew up after the cancel landed");
    });

    const firstTick = await drainPendingDeliveries(
      prisma,
      { NODE_ENV: "test", BASE_URL: "https://tickets.example.com" },
      { exportSink: () => undefined },
      { eventId: EVENT_ID, baseUrl: "https://tickets.example.com" },
    );
    expect(firstTick).toEqual({ claimed: 1, sent: 0, failed: 0, skipped: 1, eventIds: [EVENT_ID] });
    expect(sendBatch).not.toHaveBeenCalled();

    const afterFirstTick = await prisma.emailDelivery.findUniqueOrThrow({ where: { id: row.id } });
    expect(afterFirstTick.status).toBe("cancelled");
    expect(afterFirstTick.retryable).not.toBe(true);

    // A later tick must not find anything to retry - the row is "cancelled", not the
    // "failed"+retryable state the old unconditional update would have left it in.
    const secondTick = await drainPendingDeliveries(
      prisma,
      { NODE_ENV: "test", BASE_URL: "https://tickets.example.com" },
      { exportSink: () => undefined },
      { eventId: EVENT_ID, baseUrl: "https://tickets.example.com" },
    );
    expect(secondTick).toEqual({ claimed: 0, sent: 0, failed: 0, skipped: 0, eventIds: [] });
    expect(sendBatch).not.toHaveBeenCalled();
    const finalRow = await prisma.emailDelivery.findUniqueOrThrow({ where: { id: row.id } });
    expect(finalRow.status).toBe("cancelled");
  });

  it("does not resurrect a cancelled row when sendBatch itself throws after the cancel landed", async () => {
    await enqueueOne();
    const row = await prisma.emailDelivery.findFirstOrThrow({ where: { event_id: EVENT_ID } });
    const batchId = "batch-cancel-race-sendbatch-throw";
    await prisma.emailDelivery.update({ where: { id: row.id }, data: { batch_id: batchId } });

    // The fresh pre-send status re-check (drain.ts) only runs right before sendBatch - it
    // cannot see a cancel that lands during resolveAttendeeMailLinks and then again during
    // sendBatch itself, so the guard on the failure write is what actually protects this case.
    vi.mocked(resolveAttendeeMailLinks).mockImplementationOnce(async (...args) => {
      const actual = await vi.importActual<typeof import("../src/links.js")>("../src/links.js");
      return actual.resolveAttendeeMailLinks(...args);
    });
    vi.mocked(sendBatch).mockImplementationOnce(async () => {
      await cancelBulkSendBatch(prisma, EVENT_ID, batchId);
      throw new Error("transport timeout right as the cancel landed");
    });

    const drain = await drainPendingDeliveries(
      prisma,
      { NODE_ENV: "test", BASE_URL: "https://tickets.example.com" },
      { exportSink: () => undefined },
      { eventId: EVENT_ID, baseUrl: "https://tickets.example.com" },
    );
    expect(drain).toEqual({ claimed: 1, sent: 0, failed: 0, skipped: 1, eventIds: [EVENT_ID] });
    const after = await prisma.emailDelivery.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe("cancelled");
    expect(after.retryable).not.toBe(true);
  });

  it("marks claimed rows failed when mailer setup throws and continues other events", async () => {
    const EVENT_B = "evt-mail-drain-branches-b";
    await prisma.event.upsert({
      where: { id: EVENT_B },
      create: {
        id: EVENT_B,
        organization_id: "org-drain-b",
        title: "Drain Branches B",
        slug: "drain-branches-b",
        date: new Date("2026-09-02"),
      },
      update: {},
    });
    await prisma.attendee.upsert({
      where: { id: "att-drain-branch-b" },
      create: {
        id: "att-drain-branch-b",
        event_id: EVENT_B,
        email: "branch-b@example.com",
        name: "Branch B",
        public_ref: generateToken(),
      },
      update: {},
    });

    await prisma.emailDelivery.deleteMany({ where: { event_id: { in: [EVENT_ID, EVENT_B] } } });
    await sendTicketEmails(
      EVENT_ID,
      { attendeeIds: ["att-drain-branch"] },
      prisma,
      { NODE_ENV: "test", BASE_URL: "https://tickets.example.com" },
      { exportSink: () => undefined },
    );
    await sendTicketEmails(
      EVENT_B,
      { attendeeIds: ["att-drain-branch-b"] },
      prisma,
      { NODE_ENV: "test", BASE_URL: "https://tickets.example.com" },
      { exportSink: () => undefined },
    );

    vi.mocked(resolveMailConfig).mockImplementation(async (eventId, ...rest) => {
      if (eventId === EVENT_ID) throw new Error("bad transport config");
      const actual = await vi.importActual<typeof import("@admitto/mailer-config")>(
        "@admitto/mailer-config",
      );
      return actual.resolveMailConfig(eventId, ...rest);
    });

    const drain = await drainPendingDeliveries(
      prisma,
      { NODE_ENV: "test", BASE_URL: "https://tickets.example.com" },
      { exportSink: () => undefined },
      { baseUrl: "https://tickets.example.com" },
    );
    expect(drain.claimed).toBe(2);
    expect(drain.failed).toBe(1);
    expect(drain.sent).toBe(1);

    const bad = await prisma.emailDelivery.findFirstOrThrow({ where: { event_id: EVENT_ID } });
    expect(bad.status).toBe("failed");
    expect(bad.attempts).toBeGreaterThanOrEqual(1);
    const ok = await prisma.emailDelivery.findFirstOrThrow({ where: { event_id: EVENT_B } });
    expect(ok.status).toBe("accepted");
  });

  it("counts a row cancelled while mailer setup was failing as skipped, not failed", async () => {
    // The per-event mailer-setup-failure loop shares markClaimedRowFailed's cancelled-row guard
    // with the per-row send path - this exercises that guard from the other call site.
    await enqueueOne();
    const row = await prisma.emailDelivery.findFirstOrThrow({ where: { event_id: EVENT_ID } });
    const batchId = "batch-cancel-mailer-setup-race";
    await prisma.emailDelivery.update({ where: { id: row.id }, data: { batch_id: batchId } });

    vi.mocked(resolveMailConfig).mockImplementationOnce(async () => {
      await cancelBulkSendBatch(prisma, EVENT_ID, batchId);
      throw new Error("bad transport config");
    });

    const drain = await drainPendingDeliveries(
      prisma,
      { NODE_ENV: "test", BASE_URL: "https://tickets.example.com" },
      { exportSink: () => undefined },
      { eventId: EVENT_ID, baseUrl: "https://tickets.example.com" },
    );
    expect(drain).toEqual({ claimed: 1, sent: 0, failed: 0, skipped: 1, eventIds: [EVENT_ID] });
    const after = await prisma.emailDelivery.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe("cancelled");
  });

  it("marks claimed rows failed when createMailer throws", async () => {
    await enqueueOne();
    vi.mocked(createMailer).mockRejectedValueOnce(new Error("mailer boom"));

    const drain = await drainPendingDeliveries(
      prisma,
      { NODE_ENV: "test", BASE_URL: "https://tickets.example.com" },
      { exportSink: () => undefined },
      { eventId: EVENT_ID, baseUrl: "https://tickets.example.com" },
    );
    expect(drain).toEqual({ claimed: 1, sent: 0, failed: 1, skipped: 0, eventIds: [EVENT_ID] });
    const row = await prisma.emailDelivery.findFirstOrThrow({ where: { event_id: EVENT_ID } });
    expect(row.status).toBe("failed");
    expect(row.error).toContain("mailer boom");
  });

  it("marks claimed rows failed with a clear message when the stored mail secret cannot be decrypted", async () => {
    await enqueueOne();
    vi.mocked(resolveMailConfig).mockRejectedValueOnce(
      new MailConfigError(
        "mail_secret_decryption_failed",
        "A stored mail secret could not be decrypted. The encryption key may have changed, or the stored value is corrupted.",
      ),
    );

    const drain = await drainPendingDeliveries(
      prisma,
      { NODE_ENV: "test", BASE_URL: "https://tickets.example.com" },
      { exportSink: () => undefined },
      { eventId: EVENT_ID, baseUrl: "https://tickets.example.com" },
    );
    expect(drain).toEqual({ claimed: 1, sent: 0, failed: 1, skipped: 0, eventIds: [EVENT_ID] });
    const row = await prisma.emailDelivery.findFirstOrThrow({ where: { event_id: EVENT_ID } });
    expect(row.status).toBe("failed");
    expect(row.error).toContain("could not be decrypted");
  });
});
