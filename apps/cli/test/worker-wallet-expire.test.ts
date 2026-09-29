import { describe, expect, it, vi } from "vitest";

// Covers runWalletExpireJob's own three log branches (idle / ok / lock-held-skip) - the
// concurrency test (worker-tick-concurrency.test.ts) only ever drives it through a fixed
// { expired: 0 } mock and a lock that's always free, so the "ok expired=N" and "skipped (lock
// held)" branches were otherwise untested (Codecov patch-coverage review, PR #1489).

const DEFAULT_MAIL_DRAIN_LIMIT = 50;

const runWalletExpiry = vi.fn(async () => ({ expired: 0 }));

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
  drainPendingDeliveries: vi.fn(async () => ({ claimed: 0, sent: 0, failed: 0, skipped: 0, eventIds: [] })),
  ingestBounces: vi.fn(async () => ({ eventsProcessed: 0, messagesSeen: 0, bouncesApplied: 0, errors: 0 })),
  nullifyDeliverySnapshots: vi.fn(async () => ({ deliveries: 0 })),
  parseBounceIngestTickSeconds: vi.fn(() => 60),
  workerHeartbeatStaleMs: vi.fn(() => 120_000),
}));

vi.mock("@admitto/notifications", () => ({
  purgeNotifications: vi.fn(async () => ({ deleted: 0 })),
  resolveNotificationRetentionDays: vi.fn(() => 30),
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
vi.mock("../src/commands/wallet-cleanup-jobs.js", () => ({
  drainWalletCleanupJobs: vi.fn(async () => ({ claimed: 0, succeeded: 0, failed: 0, reclaimed: 0 })),
}));
vi.mock("../src/commands/wallet-message-jobs.js", () => ({
  drainWalletMessageJobs: vi.fn(async () => ({ claimed: 0, succeeded: 0, failed: 0, reclaimed: 0 })),
}));
vi.mock("../src/commands/wallet-sync.js", () => ({
  runWalletRegistrationSync: vi.fn(async () => ({ checked: 0, updated: 0, skippedNoProvider: 0, failed: 0 })),
}));
vi.mock("../src/commands/wallet-expire.js", () => ({ runWalletExpiry }));
vi.mock("../src/commands/worker-heartbeat.js", () => ({ touchWorkerHeartbeat: vi.fn(async () => undefined) }));

const { runWorkerTick } = await import("../src/commands/worker.js");
const { createRetentionSchedule } = await import("../src/commands/worker-retention-schedule.js");

function fakeLocks(overrides: Partial<Record<string, boolean>> = {}) {
  return {
    tryAcquire: vi.fn(async (job: string) => overrides[job] ?? true),
    release: vi.fn(async () => undefined),
    releaseAll: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };
}

describe("runWorkerTick — wallet_expire job", () => {
  it("logs ok with the expired count when the sweep finds due passes", async () => {
    runWalletExpiry.mockResolvedValueOnce({ expired: 5 });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runWorkerTick({} as never, fakeLocks() as never, createRetentionSchedule());

    expect(logSpy.mock.calls.some((c) => String(c[0]).includes("wallet_expire") && String(c[0]).includes("expired=5"))).toBe(
      true,
    );
    logSpy.mockRestore();
  });

  it("skips the sweep and logs lock-held when another process already holds the wallet_expire lock", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runWorkerTick({} as never, fakeLocks({ wallet_expire: false }) as never, createRetentionSchedule());

    expect(runWalletExpiry).not.toHaveBeenCalled();
    expect(logSpy.mock.calls.some((c) => String(c[0]).includes("wallet_expire") && String(c[0]).includes("lock held"))).toBe(
      true,
    );
    logSpy.mockRestore();
  });
});
