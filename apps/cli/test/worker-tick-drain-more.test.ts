import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
const drainWalletRefreshStatusJobs = vi.fn();
const drainWalletCleanupJobs = vi.fn();
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
const runWalletExpiry = vi.fn(async () => ({ expired: 0, deferredEvents: 0 }));

vi.mock("@admitto/auth", () => ({
  InstanceUrlRequiredError: class extends Error {},
  purgeAuthRetention: vi.fn(async () => ({ sessions: 0, trustedDevices: 0 })),
  purgeSecurityAuditLog: vi.fn(async () => ({ deleted: 0 })),
  resolveInstanceBaseUrl: vi.fn(async () => "https://example.test"),
  resolveSecurityAuditLogRetentionDays: vi.fn(() => 30),
}));

vi.mock("@admitto/mail-delivery", async () => ({
  ...(await import("./registration-mail-mock.js")).registrationMailMock,
  DEFAULT_MAIL_DRAIN_LIMIT,
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

const { logLevel, runWorkerTick } = await import("../src/commands/worker.js");
const { createRetentionSchedule } = await import("../src/commands/worker-retention-schedule.js");
const { registrationMailMock } = await import("./registration-mail-mock.js");
const { publishActivityChanged } = await import("../src/lib/sse-publish.js");
const { InstanceUrlRequiredError, resolveInstanceBaseUrl } = await import("@admitto/auth");

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
    drainWalletRefreshStatusJobs.mockReset();
    drainWalletCleanupJobs.mockReset();
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
    drainWalletRefreshStatusJobs.mockResolvedValue({ claimed: 0, succeeded: 0, failed: 0, reclaimed: 0 });
    drainWalletCleanupJobs.mockResolvedValue({ claimed: 0, succeeded: 0, failed: 0, reclaimed: 0 });
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

  it("signals more when wallet_refresh_status claims a job, even though it only ever takes one", async () => {
    drainWalletRefreshStatusJobs.mockResolvedValue({ claimed: 1, succeeded: 1, failed: 0, reclaimed: 0 });
    await expect(tick()).resolves.toBe(true);
  });

  it("skips draining wallet_refresh_status when its advisory lock is already held elsewhere", async () => {
    const locks = {
      tryAcquire: vi.fn(async (job: string) => job !== "wallet_refresh_status"),
      release: vi.fn(async () => undefined),
      releaseAll: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    };

    await runWorkerTick({} as never, locks as never, createRetentionSchedule());

    expect(drainWalletRefreshStatusJobs).not.toHaveBeenCalled();
    // The lock is only ever released by the job that successfully acquired it.
    expect(locks.release).not.toHaveBeenCalledWith("wallet_refresh_status");
  });

  it("signals more when wallet_cleanup claims a job, even though it only ever takes one", async () => {
    drainWalletCleanupJobs.mockResolvedValue({ claimed: 1, succeeded: 1, failed: 0, reclaimed: 0 });
    await expect(tick()).resolves.toBe(true);
  });

  it("does not signal more when wallet_cleanup only reclaimed a stale job", async () => {
    drainWalletCleanupJobs.mockResolvedValue({ claimed: 0, succeeded: 0, failed: 0, reclaimed: 1 });
    await expect(tick()).resolves.toBe(false);
  });

  it("skips draining wallet_cleanup when its advisory lock is already held elsewhere", async () => {
    const locks = {
      tryAcquire: vi.fn(async (job: string) => job !== "wallet_cleanup"),
      release: vi.fn(async () => undefined),
      releaseAll: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    };

    await runWorkerTick({} as never, locks as never, createRetentionSchedule());

    expect(drainWalletCleanupJobs).not.toHaveBeenCalled();
    expect(locks.release).not.toHaveBeenCalledWith("wallet_cleanup");
  });

  it("signals more when wallet_message claims a job, even though it only ever takes one", async () => {
    drainWalletMessageJobs.mockResolvedValue({ claimed: 1, succeeded: 1, failed: 0, reclaimed: 0 });
    await expect(tick()).resolves.toBe(true);
  });

  it("signals nothing pending when every drain is idle", async () => {
    await expect(tick()).resolves.toBe(false);
  });
});

describe("runWorkerTick - the registration mail job", () => {
  const { drainRegistrationMails, sweepExpiredRegistrations } = registrationMailMock;
  const idleDrain = { claimed: 0, sent: 0, failed: 0, cancelled: 0, skipped: 0, eventIds: [] as string[] };
  const idleSweep = { deleted: 0, eventIds: [] as string[], more: false };
  let logLines: string[];

  beforeEach(() => {
    drainPendingDeliveries.mockReset();
    drainPendingDeliveries.mockResolvedValue({ claimed: 0, sent: 0, failed: 0, skipped: 0, eventIds: [] });
    for (const drain of [drainImportJobs, drainExportJobs, drainWalletPushJobs, drainWalletRefreshStatusJobs, drainWalletCleanupJobs, drainWalletMessageJobs]) {
      drain.mockReset();
      drain.mockResolvedValue({ claimed: 0, succeeded: 0, failed: 0, reclaimed: 0, healed: 0, eventIds: [] });
    }
    drainRegistrationMails.mockReset();
    drainRegistrationMails.mockResolvedValue(idleDrain);
    sweepExpiredRegistrations.mockReset();
    sweepExpiredRegistrations.mockResolvedValue(idleSweep);
    vi.mocked(publishActivityChanged).mockClear();
    vi.mocked(resolveInstanceBaseUrl).mockReset();
    vi.mocked(resolveInstanceBaseUrl).mockResolvedValue("https://example.test");
    logLines = [];
    vi.spyOn(console, "log").mockImplementation((line: unknown) => {
      logLines.push(String(line));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const registrationLines = () => logLines.filter((line) => line.includes("[worker:registration_mail]"));

  it("runs after the ticket drain has finished, so that only one mailer sends at a time", async () => {
    const order: string[] = [];
    drainPendingDeliveries.mockImplementation(async () => {
      order.push("tickets start");
      await new Promise((resolve) => setTimeout(resolve, 30));
      order.push("tickets end");
      return { claimed: 0, sent: 0, failed: 0, skipped: 0, eventIds: [] };
    });
    drainRegistrationMails.mockImplementation(async () => {
      order.push("registrations");
      return idleDrain;
    });

    await tick();

    expect(order).toEqual(["tickets start", "tickets end", "registrations"]);
  });

  it("is not skipped for a backlog of tickets: it runs after a ticket drain that filled its batch", async () => {
    drainPendingDeliveries.mockResolvedValue({
      claimed: DEFAULT_MAIL_DRAIN_LIMIT,
      sent: DEFAULT_MAIL_DRAIN_LIMIT,
      failed: 0,
      skipped: 0,
      eventIds: ["evt1"],
    });

    await expect(tick()).resolves.toBe(true);

    expect(drainRegistrationMails).toHaveBeenCalledOnce();
  });

  it("is given the instance URL, the limit of 20 a tick and the worker's own lock", async () => {
    const locks = fakeLocks();

    await runWorkerTick({} as never, locks as never, createRetentionSchedule());

    expect(locks.tryAcquire).toHaveBeenCalledWith("registration_mail");
    expect(drainRegistrationMails).toHaveBeenCalledWith({}, process.env, {}, { baseUrl: "https://example.test", limit: 20 });
    expect(locks.release).toHaveBeenCalledWith("registration_mail");
  });

  it("sends only while no other worker sends ticket mail: it holds the ticket mail lock for the drain and lets go of it", async () => {
    const held: string[] = [];
    const locks = {
      ...fakeLocks(),
      tryAcquire: vi.fn(async (job: string) => {
        held.push(`+${job}`);
        return true;
      }),
      release: vi.fn(async (job: string) => {
        held.push(`-${job}`);
      }),
    };
    drainRegistrationMails.mockImplementation(async () => {
      held.push("drain");
      return idleDrain;
    });

    await runWorkerTick({} as never, locks as never, createRetentionSchedule());

    // The registration job takes its own lock, then the ticket mail lock for the drain only, and lets both go.
    const registration = held.slice(held.indexOf("+registration_mail"), held.indexOf("-registration_mail") + 1);
    expect(registration).toEqual(["+registration_mail", "+mail_delivery", "drain", "-mail_delivery", "-registration_mail"]);
  });

  it("does not send, and cleans up all the same, while another worker holds the ticket mail lock", async () => {
    const locks = {
      ...fakeLocks(),
      // The ticket job and the registration job both ask for it; another worker has it for the whole tick.
      tryAcquire: vi.fn(async (job: string) => job !== "mail_delivery"),
    };
    sweepExpiredRegistrations.mockResolvedValue({ deleted: 2, eventIds: ["evt1"], more: false });

    await runWorkerTick({} as never, locks as never, createRetentionSchedule());

    expect(drainRegistrationMails).not.toHaveBeenCalled();
    expect(sweepExpiredRegistrations).toHaveBeenCalledOnce();
    expect(registrationLines().some((line) => line.includes("skipped (lock held)"))).toBe(true);
    expect(registrationLines().some((line) => line.includes("ok claimed=0") && line.includes("expired=2"))).toBe(true);
    // A lock it never got is not released, and its own lock is.
    expect(locks.release).not.toHaveBeenCalledWith("mail_delivery");
    expect(locks.release).toHaveBeenCalledWith("registration_mail");
  });

  it("is skipped, with nothing read or deleted, while another worker holds its lock, and never releases a lock it did not get", async () => {
    const locks = { ...fakeLocks(), tryAcquire: vi.fn(async (job: string) => job !== "registration_mail") };

    await runWorkerTick({} as never, locks as never, createRetentionSchedule());

    expect(drainRegistrationMails).not.toHaveBeenCalled();
    expect(sweepExpiredRegistrations).not.toHaveBeenCalled();
    expect(locks.release).not.toHaveBeenCalledWith("registration_mail");
    expect(registrationLines().some((line) => line.includes("skipped (lock held)"))).toBe(true);
  });

  it("logs only counts, and says nothing when there was nothing to do", async () => {
    await tick();
    expect(registrationLines()).toEqual([expect.stringMatching(/idle$/)]);

    logLines = [];
    drainRegistrationMails.mockResolvedValue({ claimed: 3, sent: 1, failed: 1, cancelled: 1, skipped: 0, eventIds: ["evt1"] });
    sweepExpiredRegistrations.mockResolvedValue({ deleted: 4, eventIds: ["evt2"], more: false });

    await tick();

    expect(registrationLines()).toEqual([
      expect.stringMatching(/ok claimed=3 sent=1 failed=1 cancelled=1 skipped=0 expired=4$/),
    ]);
    expect(vi.mocked(publishActivityChanged)).toHaveBeenCalledWith(["evt1", "evt2"]);
  });

  it("still deletes the registrations that expired when the instance URL is not set, and sends nothing", async () => {
    vi.mocked(resolveInstanceBaseUrl).mockRejectedValue(new InstanceUrlRequiredError());
    sweepExpiredRegistrations.mockResolvedValue({ deleted: 2, eventIds: ["evt1"], more: false });

    await tick();

    expect(sweepExpiredRegistrations).toHaveBeenCalledOnce();
    expect(drainRegistrationMails).not.toHaveBeenCalled();
    expect(registrationLines().some((line) => line.includes("skip drain: instance URL not configured"))).toBe(true);
    expect(registrationLines().some((line) => line.includes("expired=2"))).toBe(true);
  });

  it.each([
    ["the drain filled its batch", { claimed: 20 }, idleSweep],
    ["the clean-up stopped at its limit", {}, { deleted: 1, eventIds: ["evt1"], more: true }],
  ])("signals more to do when %s", async (_what, drained, swept) => {
    drainRegistrationMails.mockResolvedValue({ ...idleDrain, ...drained });
    sweepExpiredRegistrations.mockResolvedValue(swept);

    await expect(tick()).resolves.toBe(true);
  });

  it("signals nothing more to do for a part of a batch", async () => {
    drainRegistrationMails.mockResolvedValue({ ...idleDrain, claimed: 19, sent: 19 });

    await expect(tick()).resolves.toBe(false);
  });

  it("logs a failure as its class alone, never the text that can hold a guest's address, and still lets the tick finish", async () => {
    drainRegistrationMails.mockRejectedValue(Object.assign(new Error("could not connect for gina@example.com"), { name: "ConnectionError" }));
    const locks = fakeLocks();

    await expect(runWorkerTick({} as never, locks as never, createRetentionSchedule())).resolves.toBe(false);

    expect(registrationLines()).toEqual([expect.stringMatching(/FAILED error_class=ConnectionError$/)]);
    expect(logLines.join("\n")).not.toContain("example.com");
    expect(locks.release).toHaveBeenCalledWith("registration_mail");
  });

  it("logs an error that is no Error as unknown", async () => {
    drainRegistrationMails.mockRejectedValue("gina@example.com");

    await tick();

    expect(registrationLines()).toEqual([expect.stringMatching(/FAILED error_class=unknown$/)]);
  });

  it("does not let a failed clean-up stop the mail: it logs the class of the failure and the drain still runs", async () => {
    sweepExpiredRegistrations.mockRejectedValue(Object.assign(new Error("lock wait for gina@example.com"), { name: "TransactionTimeout" }));
    drainRegistrationMails.mockResolvedValue({ claimed: 2, sent: 2, failed: 0, cancelled: 0, skipped: 0, eventIds: ["evt1"] });

    await expect(tick()).resolves.toBe(false);

    expect(drainRegistrationMails).toHaveBeenCalledOnce();
    expect(registrationLines()).toEqual([
      expect.stringMatching(/FAILED sweep error_class=TransactionTimeout$/),
      expect.stringMatching(/ok claimed=2 sent=2 failed=0 cancelled=0 skipped=0 expired=0$/),
    ]);
    expect(logLines.join("\n")).not.toContain("example.com");
    expect(vi.mocked(publishActivityChanged)).toHaveBeenCalledWith(["evt1"]);
    // A clean-up that keeps failing leaves personal data undeleted: the System logs must show an error, not an info line.
    expect(logLevel("FAILED sweep error_class=TransactionTimeout")).toBe("error");
  });

  it("logs a clean-up failure that is no Error as unknown, and goes on", async () => {
    sweepExpiredRegistrations.mockRejectedValue("gina@example.com");

    await tick();

    expect(drainRegistrationMails).toHaveBeenCalledOnce();
    expect(registrationLines()).toEqual([expect.stringMatching(/FAILED sweep error_class=unknown$/), expect.stringMatching(/idle$/)]);
    expect(logLines.join("\n")).not.toContain("example.com");
  });
});
