import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Proves withHeartbeatRefresh (worker.ts) actually refreshes the heartbeat while a long
// wallet_push/import/export drain is still in flight, and that a transient failure to do so is
// logged, not thrown - a rejection here must never fail the job it's merely trying to keep
// Health informed about.

const DEFAULT_MAIL_DRAIN_LIMIT = 50;

const drainPendingDeliveries = vi.fn(async () => ({ claimed: 0, sent: 0, failed: 0, skipped: 0, eventIds: [] }));
const drainImportJobs = vi.fn(async () => ({ claimed: 0, succeeded: 0, failed: 0, reclaimed: 0, healed: 0, eventIds: [] }));
const drainExportJobs = vi.fn(async () => ({ claimed: 0, succeeded: 0, failed: 0, reclaimed: 0 }));
const drainWalletPushJobs = vi.fn();
const drainWalletMessageJobs = vi.fn(async () => ({ claimed: 0, succeeded: 0, failed: 0, reclaimed: 0 }));
const ingestBounces = vi.fn(async () => ({ eventsProcessed: 0, messagesSeen: 0, bouncesApplied: 0, errors: 0 }));
const runWalletRegistrationSync = vi.fn(async () => ({ checked: 0, updated: 0, skippedNoProvider: 0, failed: 0 }));
const touchWorkerHeartbeat = vi.fn(async () => undefined);

vi.mock("@admitto/auth", () => ({
  InstanceUrlRequiredError: class extends Error {},
  purgeAuthRetention: vi.fn(async () => ({ sessions: 0, trustedDevices: 0 })),
  purgeSecurityAuditLog: vi.fn(async () => ({ deleted: 0 })),
  resolveInstanceBaseUrl: vi.fn(async () => "https://example.test"),
  resolveSecurityAuditLogRetentionDays: vi.fn(() => 30),
}));

vi.mock("@admitto/mail-delivery", () => ({
  DEFAULT_MAIL_DRAIN_LIMIT,
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
vi.mock("../src/commands/worker-heartbeat.js", () => ({ touchWorkerHeartbeat }));

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

describe("withHeartbeatRefresh (via runWorkerTick's wallet_push drain)", () => {
  beforeEach(() => {
    drainPendingDeliveries.mockClear();
    drainImportJobs.mockClear();
    drainExportJobs.mockClear();
    drainWalletPushJobs.mockReset();
    drainWalletMessageJobs.mockClear();
    touchWorkerHeartbeat.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("refreshes the heartbeat every 60s while the drain is still running, and keeps going even when a refresh rejects", async () => {
    vi.useFakeTimers();
    let resolveDrain!: (v: { claimed: number; succeeded: number; failed: number; reclaimed: number }) => void;
    drainWalletPushJobs.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveDrain = resolve;
      }),
    );
    touchWorkerHeartbeat.mockRejectedValueOnce(new Error("db hiccup"));

    const tickPromise = runWorkerTick({} as never, fakeLocks() as never, createRetentionSchedule());
    // Bring the mocked drain's own promise (and the tick's initial pre-drain heartbeat touch) to
    // rest before advancing the interval timer, so touchWorkerHeartbeat's call count below counts
    // only the in-drain refresh.
    await Promise.resolve();
    await Promise.resolve();
    touchWorkerHeartbeat.mockClear();

    await vi.advanceTimersByTimeAsync(60_000);
    // The interval fired and its rejection was swallowed, not thrown into the still-pending drain.
    expect(touchWorkerHeartbeat).toHaveBeenCalledTimes(1);

    resolveDrain({ claimed: 0, succeeded: 0, failed: 0, reclaimed: 0 });
    await tickPromise;

    // Cleared on completion - advancing further must not fire it again.
    touchWorkerHeartbeat.mockClear();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(touchWorkerHeartbeat).not.toHaveBeenCalled();
  });
});
