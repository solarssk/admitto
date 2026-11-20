import { describe, expect, it, vi } from "vitest";

// Proves runWorkerTick launches mail_delivery/import/export/wallet_push/wallet_refresh_status/
// bounce/wallet_sync concurrently (Promise.all) rather than sequentially, so one slow drain
// can't delay another's turn.

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
const drainWalletRefreshStatusJobs = deferredJob("wallet_refresh_status", 10, {
  claimed: 0,
  succeeded: 0,
  failed: 0,
  reclaimed: 0,
});
const drainWalletCleanupJobs = deferredJob("wallet_cleanup", 10, { claimed: 0, succeeded: 0, failed: 0, reclaimed: 0 });
const drainWalletMessageJobs = deferredJob("wallet_message", 10, {
  claimed: 0,
  succeeded: 0,
  failed: 0,
  reclaimed: 0,
});
const ingestBounces = deferredJob("bounce", 10);
const runWalletRegistrationSync = deferredJob("wallet_sync", 10);
const runWalletExpiry = deferredJob("wallet_expire", 10, { expired: 0, deferredEvents: 0 });

vi.mock("@admitto/auth", () => ({
  InstanceUrlRequiredError: class extends Error {},
  purgeAuthRetention: vi.fn(async () => ({ sessions: 0, trustedDevices: 0 })),
  purgeSecurityAuditLog: vi.fn(async () => ({ deleted: 0 })),
  resolveInstanceBaseUrl: vi.fn(async () => "https://example.test"),
  resolveSecurityAuditLogRetentionDays: vi.fn(() => 30),
}));

vi.mock("@admitto/mail-delivery", async () => ({
  ...(await import("./registration-mail-mock.js")).registrationMailMock,
  DEFAULT_MAIL_DRAIN_LIMIT: 50,
  assertValidBounceIngestTickSecondsEnv: vi.fn(),
  drainPendingDeliveries,
  ingestBounces,
  nullifyDeliverySnapshots: vi.fn(async () => ({ deliveries: 0 })),
  parseBounceIngestTickSeconds: vi.fn(() => 60),
  workerHeartbeatStaleMs: vi.fn(() => 120_000),
}));

vi.mock("@admitto/notifications", () => ({
  purgeNotifications: vi.fn(async () => ({ deleted: 0 })),
  resolveNotificationRetentionDays: vi.fn(() => 30),
}));

vi.mock("@admitto/import", () => ({ drainImportJobs }));
vi.mock("@admitto/storage", () => ({ getDefaultStorage: vi.fn(() => ({})) }));
vi.mock("../src/lib/retention-job-files.js", async () => (await import("./retention-job-files-mock.js")).mock);
vi.mock("../src/lib/retention-erased-wallet-passes.js", async () => (await import("./retention-job-files-mock.js")).sweepMock());
vi.mock("../src/lib/sse-publish.js", () => ({
  closeSsePublishClient: vi.fn(),
  publishActivityChanged: vi.fn(async () => undefined),
}));
vi.mock("../src/commands/export-jobs.js", () => ({ drainExportJobs }));
vi.mock("../src/commands/wallet-push-jobs.js", () => ({ drainWalletPushJobs }));
vi.mock("../src/commands/wallet-refresh-status-jobs.js", () => ({ drainWalletRefreshStatusJobs }));
vi.mock("../src/commands/wallet-cleanup-jobs.js", () => ({ drainWalletCleanupJobs }));
vi.mock("../src/commands/wallet-message-jobs.js", () => ({ drainWalletMessageJobs }));
vi.mock("../src/commands/wallet-sync.js", () => ({ runWalletRegistrationSync }));
vi.mock("../src/commands/wallet-expire.js", () => ({ runWalletExpiry }));
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

const { runWorker, runWorkerTick, WORKER_MIN_WAKE_INTERVAL_MS } = await import("../src/commands/worker.js");
const { createRetentionSchedule } = await import("../src/commands/worker-retention-schedule.js");
const { registrationMailMock } = await import("./registration-mail-mock.js");

describe("runWorkerTick", () => {
  it("runs mail_delivery, import, export, wallet_push, wallet_refresh_status, wallet_cleanup, wallet_message, bounce, wallet_sync, and wallet_expire concurrently", async () => {
    for (const key of Object.keys(starts)) delete starts[key];
    for (const key of Object.keys(finishes)) delete finishes[key];
    drainImportJobs.mockClear();
    drainWalletPushJobs.mockClear();
    drainWalletRefreshStatusJobs.mockClear();
    drainWalletCleanupJobs.mockClear();
    drainWalletMessageJobs.mockClear();

    await runWorkerTick({} as never, fakeLocks() as never, createRetentionSchedule());

    // The slow mail_delivery drain (60ms) must start before the fast ones (10ms) finish -
    // proof they're in flight together, not awaited one after another.
    expect(starts["mail_delivery"]).toBeLessThanOrEqual(finishes["export"]);
    expect(starts["export"]).toBeLessThan(finishes["mail_delivery"]);
    expect(starts["import"]).toBeLessThan(finishes["mail_delivery"]);
    expect(starts["wallet_push"]).toBeLessThan(finishes["mail_delivery"]);
    expect(starts["wallet_refresh_status"]).toBeLessThan(finishes["mail_delivery"]);
    expect(starts["wallet_cleanup"]).toBeLessThan(finishes["mail_delivery"]);
    expect(starts["wallet_message"]).toBeLessThan(finishes["mail_delivery"]);
    expect(starts["bounce"]).toBeLessThan(finishes["mail_delivery"]);
    expect(starts["wallet_sync"]).toBeLessThan(finishes["mail_delivery"]);
    expect(starts["wallet_expire"]).toBeLessThan(finishes["mail_delivery"]);
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

describe("runWorker - the wake of the registration mail job", () => {
  const { drainRegistrationMails } = registrationMailMock;

  /** A notify client that waits for `wake()` on its first waits, and stops the loop on the last. */
  function wakeableClient(wakesBeforeStop: number) {
    const resolvers: Array<() => void> = [];
    let waits = 0;
    return {
      client: {
        isAlive: vi.fn(() => true),
        waitForWakeOrTimeout: vi.fn(async (_ms: number, signal: { stopped: boolean }) => {
          waits += 1;
          if (waits > wakesBeforeStop) {
            signal.stopped = true;
            return;
          }
          await new Promise<void>((resolve) => resolvers.push(resolve));
        }),
        close: vi.fn(async () => undefined),
      },
      wake: () => resolvers.shift()?.(),
    };
  }

  it("is 2 seconds, the least that a wake may leave between two ticks", () => {
    expect(WORKER_MIN_WAKE_INTERVAL_MS).toBe(2000);
  });

  it("runs the job in the tick that a wake starts, as when a registration queued mail", async () => {
    process.env["DATABASE_URL"] = "postgresql://example/db";
    const { client, wake } = wakeableClient(1);
    openWorkerNotifyClient.mockReset();
    openWorkerNotifyClient.mockResolvedValue(client);
    drainRegistrationMails.mockClear();

    const running = runWorker({} as never, { minWakeIntervalMs: 0 });
    await vi.waitFor(() => expect(drainRegistrationMails).toHaveBeenCalledTimes(1));
    // The loop is asleep until a wake: no second tick comes by itself.
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(drainRegistrationMails).toHaveBeenCalledTimes(1);

    wake();
    await running;

    expect(drainRegistrationMails).toHaveBeenCalledTimes(2);
  });

  it("leaves the least interval between ticks when wakes follow one another", async () => {
    process.env["DATABASE_URL"] = "postgresql://example/db";
    // Every wait returns at once, as it does when a notification is latched: a stream of registrations.
    const client = {
      isAlive: vi.fn(() => true),
      waitForWakeOrTimeout: vi.fn(async (_ms: number, signal: { stopped: boolean }) => {
        if (client.waitForWakeOrTimeout.mock.calls.length > 2) signal.stopped = true;
      }),
      close: vi.fn(async () => undefined),
    };
    openWorkerNotifyClient.mockReset();
    openWorkerNotifyClient.mockResolvedValue(client);
    const tickStarts: number[] = [];
    drainRegistrationMails.mockClear();
    drainRegistrationMails.mockImplementation(async () => {
      tickStarts.push(Date.now());
      return { claimed: 0, sent: 0, failed: 0, cancelled: 0, skipped: 0, eventIds: [] };
    });

    await runWorker({} as never, { minWakeIntervalMs: 400 });

    expect(tickStarts).toHaveLength(3);
    // Not 400 exactly: the wait that cuts a sleep short has a 200 ms step, and a tick has its own duration.
    expect(tickStarts[1]! - tickStarts[0]!).toBeGreaterThanOrEqual(380);
    expect(tickStarts[2]! - tickStarts[1]!).toBeGreaterThanOrEqual(380);
  });

  it("does not wait at all when the interval is none, and does not hold back a backlog", async () => {
    process.env["DATABASE_URL"] = "postgresql://example/db";
    const client = {
      isAlive: vi.fn(() => true),
      waitForWakeOrTimeout: vi.fn(async (_ms: number, signal: { stopped: boolean }) => {
        signal.stopped = true;
      }),
      close: vi.fn(async () => undefined),
    };
    openWorkerNotifyClient.mockReset();
    openWorkerNotifyClient.mockResolvedValue(client);
    drainRegistrationMails.mockClear();
    // A full batch: more is waiting, so the loop goes on at once, however long the interval is.
    drainRegistrationMails.mockResolvedValueOnce({ claimed: 20, sent: 20, failed: 0, cancelled: 0, skipped: 0, eventIds: [] });

    const started = Date.now();
    await runWorker({} as never, { minWakeIntervalMs: 60_000 });

    expect(drainRegistrationMails).toHaveBeenCalledTimes(2);
    expect(Date.now() - started).toBeLessThan(10_000);
  });
});
