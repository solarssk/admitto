import { describe, expect, it, vi } from "vitest";

// Proves runWorkerTick launches mail_delivery/import/export/wallet_push/bounce/wallet_sync
// concurrently (Promise.all) rather than sequentially, so one slow drain can't delay another's
// turn.

const starts: Record<string, number> = {};
const finishes: Record<string, number> = {};

const DEFAULT_RESULT = { claimed: 0, sent: 0, failed: 0, skipped: 0, eventIds: [] };

function deferredJob(name: string, delayMs: number, returnValue: Record<string, unknown> = DEFAULT_RESULT) {
  return vi.fn(async () => {
    starts[name] = Date.now();
    await new Promise((r) => setTimeout(r, delayMs));
    finishes[name] = Date.now();
    return returnValue;
  });
}

const drainPendingDeliveries = deferredJob("mail_delivery", 60);
// import/wallet_push get a small delay too (bot review) - previously called with no delay at
// all, which only proved the mock was invoked, not that it ran concurrently with the others.
const drainImportJobs = deferredJob("import", 10, {
  claimed: 0,
  succeeded: 0,
  failed: 0,
  reclaimed: 0,
  healed: 0,
  eventIds: [],
});
const drainExportJobs = deferredJob("export", 10);
const drainWalletPushJobs = deferredJob("wallet_push", 10, { claimed: 0, succeeded: 0, failed: 0, reclaimed: 0 });
const ingestBounces = deferredJob("bounce", 10);
const runWalletRegistrationSync = deferredJob("wallet_sync", 10);

vi.mock("@admitto/auth", () => ({
  InstanceUrlRequiredError: class extends Error {},
  purgeAuthRetention: vi.fn(async () => ({ sessions: 0, trustedDevices: 0 })),
  purgeSecurityAuditLog: vi.fn(async () => ({ deleted: 0 })),
  resolveInstanceBaseUrl: vi.fn(async () => "https://example.test"),
  resolveSecurityAuditLogRetentionDays: vi.fn(() => 30),
}));

vi.mock("@admitto/mail-delivery", () => ({
  DEFAULT_MAIL_DRAIN_LIMIT: 50,
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
vi.mock("../src/commands/wallet-sync.js", () => ({ runWalletRegistrationSync }));
vi.mock("../src/commands/worker-heartbeat.js", () => ({ touchWorkerHeartbeat: vi.fn() }));

function fakeLocks() {
  return {
    tryAcquire: vi.fn(async () => true),
    release: vi.fn(async () => undefined),
    releaseAll: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };
}

const openWorkerLockClient = vi.fn(async () => fakeLocks());
vi.mock("../src/commands/worker-locks.js", () => ({ openWorkerLockClient }));

const openWorkerNotifyClient = vi.fn();
vi.mock("../src/commands/worker-notify.js", () => ({ openWorkerNotifyClient }));

const { runWorker, runWorkerTick } = await import("../src/commands/worker.js");
const { createRetentionSchedule } = await import("../src/commands/worker-retention-schedule.js");

describe("runWorkerTick", () => {
  it("runs mail_delivery, import, export, wallet_push, bounce, and wallet_sync concurrently", async () => {
    for (const key of Object.keys(starts)) delete starts[key];
    for (const key of Object.keys(finishes)) delete finishes[key];
    drainImportJobs.mockClear();
    drainWalletPushJobs.mockClear();

    await runWorkerTick({} as never, fakeLocks() as never, createRetentionSchedule());

    // The slow mail_delivery drain (60ms) must start before the fast ones (10ms) finish -
    // proof they're in flight together, not awaited one after another.
    expect(starts["mail_delivery"]).toBeLessThanOrEqual(finishes["export"]);
    expect(starts["export"]).toBeLessThan(finishes["mail_delivery"]);
    expect(starts["import"]).toBeLessThan(finishes["mail_delivery"]);
    expect(starts["wallet_push"]).toBeLessThan(finishes["mail_delivery"]);
    expect(starts["bounce"]).toBeLessThan(finishes["mail_delivery"]);
    expect(starts["wallet_sync"]).toBeLessThan(finishes["mail_delivery"]);
  });
});

describe("runWorker", () => {
  it("wakes via the notify client each tick and closes it on shutdown", async () => {
    process.env["DATABASE_URL"] = "postgresql://example/db";

    const notifyClient = {
      isAlive: vi.fn(() => true),
      waitForWakeOrTimeout: vi.fn(async (_ms: number, signal: { stopped: boolean }) => {
        signal.stopped = true; // one tick is enough to prove the wiring, then stop the loop
      }),
      close: vi.fn(async () => undefined),
    };
    openWorkerNotifyClient.mockReset();
    openWorkerNotifyClient.mockResolvedValue(notifyClient);
    openWorkerLockClient.mockClear();

    await runWorker({} as never);

    // Connected once up front and reused on the loop's reconnect check - never re-dialed
    // while still alive.
    expect(openWorkerNotifyClient).toHaveBeenCalledOnce();
    expect(notifyClient.waitForWakeOrTimeout).toHaveBeenCalledOnce();
    expect(notifyClient.close).toHaveBeenCalledOnce();
  });

  it("logs notify=off and falls back to plain polling when the notify client never connects", async () => {
    process.env["DATABASE_URL"] = "postgresql://example/db";
    openWorkerNotifyClient.mockReset();
    openWorkerNotifyClient.mockRejectedValue(new Error("connection refused"));
    openWorkerLockClient.mockClear();

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    // SIGTERM lands while the mocked mail_delivery drain (60ms) is still in flight, so this
    // also exercises the mid-tick "signal.stopped flipped during runWorkerTick" break path.
    const stopTimer = setTimeout(() => process.emit("SIGTERM"), 20);
    await runWorker({} as never);
    clearTimeout(stopTimer);

    expect(logSpy.mock.calls.some((c) => String(c[0]).includes("notify=off"))).toBe(true);
    logSpy.mockRestore();
  });

  it("skips the wait and drains again immediately when a tick reports a backlog", async () => {
    process.env["DATABASE_URL"] = "postgresql://example/db";

    const notifyClient = {
      isAlive: vi.fn(() => true),
      waitForWakeOrTimeout: vi.fn(async (_ms: number, signal: { stopped: boolean }) => {
        signal.stopped = true;
      }),
      close: vi.fn(async () => undefined),
    };
    openWorkerNotifyClient.mockReset();
    openWorkerNotifyClient.mockResolvedValue(notifyClient);
    openWorkerLockClient.mockClear();
    drainPendingDeliveries.mockClear();

    // First tick claims a full batch (mail_delivery's limit) - the loop must go straight into
    // a second tick without waiting. The second tick's base mock (claimed: 0) is idle, so it
    // falls through to waitForWakeOrTimeout, which stops the loop.
    drainPendingDeliveries.mockResolvedValueOnce({
      claimed: 50,
      sent: 50,
      failed: 0,
      skipped: 0,
      eventIds: ["evt1"],
    });

    await runWorker({} as never);

    expect(drainPendingDeliveries).toHaveBeenCalledTimes(2);
    expect(notifyClient.waitForWakeOrTimeout).toHaveBeenCalledOnce();
  });

  it("falls back to the plain sleep poll once a tick completes with no notify client", async () => {
    process.env["DATABASE_URL"] = "postgresql://example/db";
    openWorkerNotifyClient.mockReset();
    openWorkerNotifyClient.mockRejectedValue(new Error("connection refused"));
    openWorkerLockClient.mockClear();

    // Let the first tick finish normally (mail_delivery's mocked drain takes ~60ms), then stop
    // while the loop is inside the sleep(tickMs, signal) fallback, not mid-tick this time.
    const stopTimer = setTimeout(() => process.emit("SIGTERM"), 150);
    const started = Date.now();
    await runWorker({} as never);
    clearTimeout(stopTimer);

    expect(Date.now() - started).toBeGreaterThanOrEqual(100);
  });
});
