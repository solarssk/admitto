import { beforeEach, describe, expect, it, vi } from "vitest";

// Proves runWorkerTick signals "keep draining immediately" whenever a backlog is bigger than
// one tick's per-type capacity - mail_delivery's batch limit, or import/export claiming a job
// at all (they only ever take one at a time). Without this, a burst of enqueued work (e.g. mail
// sent to hundreds of attendees, or several exports requested close together) would only get
// one bonus tick out of the notify wake-up latch, then silently fall back to the fixed 60s poll
// for the remainder of the backlog.

const DEFAULT_MAIL_DRAIN_LIMIT = 50;

const drainPendingDeliveries = vi.fn();
const drainImportJobs = vi.fn();
const drainExportJobs = vi.fn();
const drainWalletPushJobs = vi.fn();
const drainWalletMessageJobs = vi.fn();
const ingestBounces = vi.fn(async () => ({
  eventsProcessed: 0,
  messagesSeen: 0,
  bouncesApplied: 0,
  errors: 0,
}));
const runWalletRegistrationSync = vi.fn(async () => ({
  checked: 0,
  updated: 0,
  skippedNoProvider: 0,
  failed: 0,
}));

vi.mock("@admitto/auth", () => ({
  InstanceUrlRequiredError: class extends Error {},
  purgeAuthRetention: vi.fn(async () => ({ sessions: 0, trustedDevices: 0 })),
  purgeSecurityAuditLog: vi.fn(async () => ({ deleted: 0 })),
  resolveInstanceBaseUrl: vi.fn(async () => "https://example.test"),
  resolveSecurityAuditLogRetentionDays: vi.fn(() => 30),
}));

vi.mock("@admitto/mail-delivery", () => ({
  DEFAULT_MAIL_DRAIN_LIMIT,
  assertValidBounceIngestTickSecondsEnv: vi.fn(),
  drainPendingDeliveries,
  ingestBounces,
  nullifyDeliverySnapshots: vi.fn(async () => ({ deliveries: 0 })),
  parseBounceIngestTickSeconds: vi.fn(() => 60),
  workerHeartbeatStaleMs: vi.fn(() => 120_000),
}));

vi.mock("@admitto/import", () => ({ drainImportJobs }));
vi.mock("@admitto/storage", () => ({ getDefaultStorage: vi.fn(() => ({})) }));
vi.mock("../src/lib/sse-publish.js", () => ({
  closeSsePublishClient: vi.fn(),
  publishActivityChanged: vi.fn(async () => undefined),
}));
vi.mock("../src/commands/export-jobs.js", () => ({ drainExportJobs }));
vi.mock("../src/commands/wallet-push-jobs.js", () => ({ drainWalletPushJobs }));
vi.mock("../src/commands/wallet-message-jobs.js", () => ({ drainWalletMessageJobs }));
vi.mock("../src/commands/wallet-sync.js", () => ({ runWalletRegistrationSync }));
vi.mock("../src/commands/worker-heartbeat.js", () => ({ touchWorkerHeartbeat: vi.fn() }));

const { runWorkerTick } = await import("../src/commands/worker.js");
const { createRetentionSchedule } = await import("../src/commands/worker-retention-schedule.js");

function fakeLocks() {
  return {
    tryAcquire: vi.fn(async () => true),
    release: vi.fn(async () => undefined),
    releaseAll: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };
}

async function tick() {
  return runWorkerTick({} as never, fakeLocks() as never, createRetentionSchedule());
}

describe("runWorkerTick — signalling a backlog beyond one tick's capacity", () => {
  beforeEach(() => {
    drainPendingDeliveries.mockReset();
    drainImportJobs.mockReset();
    drainExportJobs.mockReset();
    drainWalletPushJobs.mockReset();
    drainWalletMessageJobs.mockReset();
    drainPendingDeliveries.mockResolvedValue({
      claimed: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
      eventIds: [],
    });
    drainImportJobs.mockResolvedValue({
      claimed: 0,
      succeeded: 0,
      failed: 0,
      reclaimed: 0,
      healed: 0,
      eventIds: [],
    });
    drainExportJobs.mockResolvedValue({ claimed: 0, succeeded: 0, failed: 0, reclaimed: 0 });
    drainWalletPushJobs.mockResolvedValue({ claimed: 0, succeeded: 0, failed: 0, reclaimed: 0 });
    drainWalletMessageJobs.mockResolvedValue({ claimed: 0, succeeded: 0, failed: 0, reclaimed: 0 });
  });

  it("signals more when mail_delivery fills its batch limit", async () => {
    drainPendingDeliveries.mockResolvedValue({
      claimed: DEFAULT_MAIL_DRAIN_LIMIT,
      sent: DEFAULT_MAIL_DRAIN_LIMIT,
      failed: 0,
      skipped: 0,
      eventIds: ["evt1"],
    });
    await expect(tick()).resolves.toBe(true);
  });

  it("does not signal more when mail_delivery claims fewer than the limit", async () => {
    drainPendingDeliveries.mockResolvedValue({
      claimed: DEFAULT_MAIL_DRAIN_LIMIT - 1,
      sent: DEFAULT_MAIL_DRAIN_LIMIT - 1,
      failed: 0,
      skipped: 0,
      eventIds: ["evt1"],
    });
    await expect(tick()).resolves.toBe(false);
  });

  it("signals more when import claims a job, even though it only ever takes one", async () => {
    drainImportJobs.mockResolvedValue({
      claimed: 1,
      succeeded: 1,
      failed: 0,
      reclaimed: 0,
      healed: 0,
      eventIds: ["evt1"],
    });
    await expect(tick()).resolves.toBe(true);
  });

  it("signals more when export claims a job, even though it only ever takes one", async () => {
    drainExportJobs.mockResolvedValue({ claimed: 1, succeeded: 1, failed: 0, reclaimed: 0 });
    await expect(tick()).resolves.toBe(true);
  });

  it("signals more when wallet_push claims a job, even though it only ever takes one", async () => {
    drainWalletPushJobs.mockResolvedValue({ claimed: 1, succeeded: 1, failed: 0, reclaimed: 0 });
    await expect(tick()).resolves.toBe(true);
  });

  it("signals more when wallet_message claims a job, even though it only ever takes one", async () => {
    drainWalletMessageJobs.mockResolvedValue({ claimed: 1, succeeded: 1, failed: 0, reclaimed: 0 });
    await expect(tick()).resolves.toBe(true);
  });

  it("signals nothing pending when every drain is idle", async () => {
    await expect(tick()).resolves.toBe(false);
  });
});
