import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SNAPSHOT_ENV_CASES,
  SNAPSHOT_RETENTION_ENV,
  fakeEmailDeliveryDb,
  seedAgedDeliveries,
} from "./fake-email-delivery-db.js";

// Regression test for a real gap a bot review caught on PR #1320: purgeNotifications was wired
// into the manually-invoked `admitto retention run` CLI command (retention.ts) but never into
// this worker's own scheduled retention job - the one Docker Compose actually runs automatically
// on boot and every ~24h. Proves the worker's own retention pass purges all four retention
// targets, not just the three that predate the notifications feature.
//
// A second regression: the pass called nullifyDeliverySnapshots without retentionDays, so
// EMAIL_DELIVERY_SNAPSHOT_RETENTION_DAYS was ignored and the 60-day default always applied. The
// snapshot retention and its env resolver run for real here, against an in-memory delivery table.

const DEFAULT_MAIL_DRAIN_LIMIT = 50;

const purgeAuthRetention = vi.fn(async () => ({ sessions: 0, trustedDevices: 0 }));
const purgeSecurityAuditLog = vi.fn(async () => ({ deleted: 0 }));
const nullifyDeliverySnapshots = vi.fn();
const purgeNotifications = vi.fn(async () => ({ deleted: 0 }));
const resolveNotificationRetentionDays = vi.fn(() => 30);
const purgeJobFilesForRetention = vi.fn(async () => ({ exportFiles: 0, stagedImportFiles: 0, failures: 0 }));
const touchWorkerHeartbeat = vi.fn(async () => undefined);
const sweepErasedWalletPasses = vi.fn(async (..._args: unknown[]) => ({
  pending: 0,
  deleted: 0,
  failed: 0,
  noProvider: 0,
  notTried: 0,
}));

vi.mock("@admitto/auth", () => ({
  InstanceUrlRequiredError: class extends Error {},
  purgeAuthRetention,
  purgeSecurityAuditLog,
  resolveInstanceBaseUrl: vi.fn(async () => "https://example.test"),
  resolveSecurityAuditLogRetentionDays: vi.fn(() => 30),
}));

vi.mock("@admitto/mail-delivery", async (importActual) => {
  const actual = await importActual<typeof import("@admitto/mail-delivery")>();
  nullifyDeliverySnapshots.mockImplementation(actual.nullifyDeliverySnapshots);
  return {
    DEFAULT_MAIL_DRAIN_LIMIT,
    assertValidBounceIngestTickSecondsEnv: vi.fn(),
    drainPendingDeliveries: vi.fn(async () => ({ claimed: 0, sent: 0, failed: 0, skipped: 0, eventIds: [] })),
    ingestBounces: vi.fn(async () => ({ eventsProcessed: 0, messagesSeen: 0, bouncesApplied: 0, errors: 0 })),
    nullifyDeliverySnapshots,
    parseBounceIngestTickSeconds: vi.fn(() => 60),
    resolveDeliverySnapshotRetentionDays: actual.resolveDeliverySnapshotRetentionDays,
    workerHeartbeatStaleMs: vi.fn(() => 120_000),
  };
});

vi.mock("@admitto/notifications", () => ({
  purgeNotifications,
  resolveNotificationRetentionDays,
}));

vi.mock("@admitto/import", () => ({
  drainImportJobs: vi.fn(async () => ({ claimed: 0, succeeded: 0, failed: 0, reclaimed: 0, healed: 0, eventIds: [] })),
}));
vi.mock("@admitto/storage", () => ({ getDefaultStorage: vi.fn(() => ({})) }));
vi.mock("../src/lib/retention-job-files.js", () => ({ purgeJobFilesForRetention }));
vi.mock("../src/lib/retention-erased-wallet-passes.js", async (importActual) => ({
  ...(await importActual<typeof import("../src/lib/retention-erased-wallet-passes.js")>()),
  sweepErasedWalletPasses,
}));
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
vi.mock("../src/commands/wallet-expire.js", () => ({
  runWalletExpiry: vi.fn(async () => ({ expired: 0, deferredEvents: 0 })),
}));
vi.mock("../src/commands/worker-heartbeat.js", () => ({ touchWorkerHeartbeat }));

const { logLevel, runWorkerTick } = await import("../src/commands/worker.js");
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
  beforeEach(() => {
    nullifyDeliverySnapshots.mockClear();
    purgeJobFilesForRetention.mockClear();
    sweepErasedWalletPasses.mockClear();
    touchWorkerHeartbeat.mockClear();
    vi.stubEnv(SNAPSHOT_RETENTION_ENV, undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("purges notifications alongside auth/mail/security-audit-log retention on a fresh (never-run) schedule", async () => {
    const db = fakeEmailDeliveryDb([]) as never;
    await runWorkerTick(db, fakeLocks() as never, createRetentionSchedule());

    expect(purgeAuthRetention).toHaveBeenCalledWith(db, { dryRun: false });
    expect(nullifyDeliverySnapshots).toHaveBeenCalledWith(db, { dryRun: false, retentionDays: 60 });
    expect(purgeSecurityAuditLog).toHaveBeenCalledWith(db, { dryRun: false, retentionDays: 30 });
    expect(purgeNotifications).toHaveBeenCalledWith(db, { dryRun: false, retentionDays: 30 });
    expect(purgeJobFilesForRetention).toHaveBeenCalledWith(db, false);
    expect(sweepErasedWalletPasses).toHaveBeenCalledWith(db, { dryRun: false });
  });

  it("says how many export files and staged import CSVs it deleted, and warns when one could not be", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    purgeJobFilesForRetention.mockResolvedValueOnce({ exportFiles: 3, stagedImportFiles: 2, failures: 1 });

    await runWorkerTick(fakeEmailDeliveryDb([]) as never, fakeLocks() as never, createRetentionSchedule());

    const line = log.mock.calls.map((call) => String(call[0])).find((text) => text.includes("[worker:retention]") && text.includes("export_files="));
    expect(line).toContain("export_files=3 staged_import_files=2 erased_wallet_passes=0 failed=1");
    expect(logLevel(line!)).toBe("warn");
    log.mockRestore();
  });

  it("stays quiet about files when there was nothing to delete", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runWorkerTick(fakeEmailDeliveryDb([]) as never, fakeLocks() as never, createRetentionSchedule());

    const line = log.mock.calls.map((call) => String(call[0])).find((text) => text.includes("[worker:retention]") && text.includes("export_files="));
    expect(line).toContain("export_files=0 staged_import_files=0 erased_wallet_passes=0 failed=0");
    expect(logLevel(line!)).toBe("info");
    log.mockRestore();
  });

  it("says how many wallet passes of erased attendees it deleted at the provider, and warns for each that stays", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    sweepErasedWalletPasses.mockResolvedValueOnce({ pending: 8, deleted: 4, failed: 1, noProvider: 2, notTried: 1 });
    purgeJobFilesForRetention.mockResolvedValueOnce({ exportFiles: 0, stagedImportFiles: 0, failures: 1 });

    await runWorkerTick(fakeEmailDeliveryDb([]) as never, fakeLocks() as never, createRetentionSchedule());

    const line = log.mock.calls.map((call) => String(call[0])).find((text) => text.includes("[worker:retention]") && text.includes("export_files="));
    // One counter for everything that stays: 1 file + 1 refused + 2 without credentials + 1 not tried.
    expect(line).toContain("erased_wallet_passes=4 failed=5");
    expect(logLevel(line!)).toBe("warn");
    log.mockRestore();
  });

  it("keeps the worker heartbeat fresh while the sweep is still at the wallet provider", async () => {
    vi.useFakeTimers();
    let finishSweep!: (result: { pending: number; deleted: number; failed: number; noProvider: number; notTried: number }) => void;
    sweepErasedWalletPasses.mockReturnValueOnce(
      new Promise((resolve) => {
        finishSweep = resolve;
      }),
    );

    const tick = runWorkerTick(fakeEmailDeliveryDb([]) as never, fakeLocks() as never, createRetentionSchedule());
    await vi.waitFor(() => expect(sweepErasedWalletPasses).toHaveBeenCalled());
    touchWorkerHeartbeat.mockClear();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(touchWorkerHeartbeat).toHaveBeenCalledTimes(1);

    finishSweep({ pending: 0, deleted: 0, failed: 0, noProvider: 0, notTried: 0 });
    await tick;
    // Stopped with the sweep: no more refreshes once it is over.
    touchWorkerHeartbeat.mockClear();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(touchWorkerHeartbeat).not.toHaveBeenCalled();
  });

  it("reports a sweep that breaks as a failed retention run, and tries again after the failure backoff", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    sweepErasedWalletPasses.mockRejectedValueOnce(new Error("db down"));

    await runWorkerTick(fakeEmailDeliveryDb([]) as never, fakeLocks() as never, createRetentionSchedule());

    const lines = log.mock.calls.map((call) => String(call[0])).filter((text) => text.includes("[worker:retention]"));
    expect(lines.some((text) => text.includes("FAILED db down"))).toBe(true);
    expect(lines.some((text) => text.includes("retry after failure backoff (15m)"))).toBe(true);
    log.mockRestore();
  });

  it.each(SNAPSHOT_ENV_CASES)(
    "with the email snapshot override $label, clears snapshots older than $days days only",
    async ({ env, days, keepsBetween }) => {
      vi.stubEnv(SNAPSHOT_RETENTION_ENV, env);
      const { recent, between, old } = seedAgedDeliveries();
      const db = fakeEmailDeliveryDb([recent, between, old]) as never;

      await runWorkerTick(db, fakeLocks() as never, createRetentionSchedule());

      expect(recent.rendered_html).not.toBeNull();
      expect(between.rendered_html === null).toBe(!keepsBetween);
      expect(old.rendered_html).toBeNull();
      expect(nullifyDeliverySnapshots).toHaveBeenCalledWith(db, { dryRun: false, retentionDays: days });
    },
  );

  it("hands the snapshot cleanup a date-safe window when the override is absurdly large", async () => {
    vi.stubEnv(SNAPSHOT_RETENTION_ENV, "1000000000");
    const db = fakeEmailDeliveryDb([]) as never;

    await runWorkerTick(db, fakeLocks() as never, createRetentionSchedule());

    expect(nullifyDeliverySnapshots).toHaveBeenCalledWith(db, { dryRun: false, retentionDays: 36_500 });
  });
});
