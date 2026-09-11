import { describe, expect, it, vi } from "vitest";

// Regression test for a real gap a bot review caught on PR #1320: purgeNotifications was wired
// into the manually-invoked `admitto retention run` CLI command (retention.ts) but never into
// this worker's own scheduled retention job - the one Docker Compose actually runs automatically
// on boot and every ~24h. Proves the worker's own retention pass purges all four retention
// targets, not just the three that predate the notifications feature.

const DEFAULT_MAIL_DRAIN_LIMIT = 50;

const purgeAuthRetention = vi.fn(async () => ({ sessions: 0, trustedDevices: 0 }));
const purgeSecurityAuditLog = vi.fn(async () => ({ deleted: 0 }));
const nullifyDeliverySnapshots = vi.fn(async () => ({ deliveries: 0 }));
const purgeNotifications = vi.fn(async () => ({ deleted: 0 }));
const resolveNotificationRetentionDays = vi.fn(() => 30);

vi.mock("@admitto/auth", () => ({
  InstanceUrlRequiredError: class extends Error {},
  purgeAuthRetention,
  purgeSecurityAuditLog,
  resolveInstanceBaseUrl: vi.fn(async () => "https://example.test"),
  resolveSecurityAuditLogRetentionDays: vi.fn(() => 30),
}));

vi.mock("@admitto/mail-delivery", () => ({
  DEFAULT_MAIL_DRAIN_LIMIT,
  assertValidBounceIngestTickSecondsEnv: vi.fn(),
  drainPendingDeliveries: vi.fn(async () => ({ claimed: 0, sent: 0, failed: 0, skipped: 0, eventIds: [] })),
  ingestBounces: vi.fn(async () => ({ eventsProcessed: 0, messagesSeen: 0, bouncesApplied: 0, errors: 0 })),
  nullifyDeliverySnapshots,
  parseBounceIngestTickSeconds: vi.fn(() => 60),
  workerHeartbeatStaleMs: vi.fn(() => 120_000),
}));

vi.mock("@admitto/notifications", () => ({
  purgeNotifications,
  resolveNotificationRetentionDays,
}));

vi.mock("@admitto/import", () => ({
  drainImportJobs: vi.fn(async () => ({ claimed: 0, succeeded: 0, failed: 0, reclaimed: 0, healed: 0, eventIds: [] })),
}));
vi.mock("@admitto/storage", () => ({ getDefaultStorage: vi.fn(() => ({})) }));
vi.mock("../src/lib/sse-publish.js", () => ({
  closeSsePublishClient: vi.fn(),
  publishActivityChanged: vi.fn(async () => undefined),
}));
vi.mock("../src/commands/export-jobs.js", () => ({
  drainExportJobs: vi.fn(async () => ({ claimed: 0, succeeded: 0, failed: 0, reclaimed: 0 })),
}));
vi.mock("../src/commands/wallet-push-jobs.js", () => ({ drainWalletPushJobs: vi.fn() }));
vi.mock("../src/commands/wallet-refresh-status-jobs.js", () => ({
  drainWalletRefreshStatusJobs: vi.fn(async () => ({ claimed: 0, succeeded: 0, failed: 0, reclaimed: 0 })),
}));
vi.mock("../src/commands/wallet-message-jobs.js", () => ({
  drainWalletMessageJobs: vi.fn(async () => ({ claimed: 0, succeeded: 0, failed: 0, reclaimed: 0 })),
}));
vi.mock("../src/commands/wallet-sync.js", () => ({
  runWalletRegistrationSync: vi.fn(async () => ({ checked: 0, updated: 0, skippedNoProvider: 0, failed: 0 })),
}));
vi.mock("../src/commands/worker-heartbeat.js", () => ({ touchWorkerHeartbeat: vi.fn(async () => undefined) }));

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

describe("runWorkerTick — scheduled retention pass", () => {
  it("purges notifications alongside auth/mail/security-audit-log retention on a fresh (never-run) schedule", async () => {
    const db = {} as never;
    await runWorkerTick(db, fakeLocks() as never, createRetentionSchedule());

    expect(purgeAuthRetention).toHaveBeenCalledWith(db, { dryRun: false });
    expect(nullifyDeliverySnapshots).toHaveBeenCalledWith(db, { dryRun: false });
    expect(purgeSecurityAuditLog).toHaveBeenCalledWith(db, { dryRun: false, retentionDays: 30 });
    expect(purgeNotifications).toHaveBeenCalledWith(db, { dryRun: false, retentionDays: 30 });
  });
});
