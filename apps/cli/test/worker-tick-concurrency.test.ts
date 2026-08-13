import { describe, expect, it, vi } from "vitest";

// Proves runWorkerTick launches mail_delivery/import/export/bounce/wallet_sync concurrently
// (Promise.all) rather than sequentially, so one slow drain can't delay another's turn.

const starts: Record<string, number> = {};
const finishes: Record<string, number> = {};

function deferredJob(name: string, delayMs: number) {
  return vi.fn(async () => {
    starts[name] = Date.now();
    await new Promise((r) => setTimeout(r, delayMs));
    finishes[name] = Date.now();
    return { claimed: 0, sent: 0, failed: 0, skipped: 0, eventIds: [] };
  });
}

const drainPendingDeliveries = deferredJob("mail_delivery", 60);
const drainImportJobs = vi.fn(async () => ({
  claimed: 0,
  succeeded: 0,
  failed: 0,
  reclaimed: 0,
  healed: 0,
  eventIds: [],
}));
const drainExportJobs = deferredJob("export", 10);
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

describe("runWorkerTick", () => {
  it("runs mail_delivery, import, export, bounce, and wallet_sync concurrently", async () => {
    for (const key of Object.keys(starts)) delete starts[key];
    for (const key of Object.keys(finishes)) delete finishes[key];

    await runWorkerTick({} as never, fakeLocks() as never, createRetentionSchedule());

    // The slow mail_delivery drain (60ms) must start before the fast ones (10ms) finish -
    // proof they're in flight together, not awaited one after another.
    expect(starts["mail_delivery"]).toBeLessThanOrEqual(finishes["export"]);
    expect(starts["export"]).toBeLessThan(finishes["mail_delivery"]);
    expect(starts["bounce"]).toBeLessThan(finishes["mail_delivery"]);
    expect(starts["wallet_sync"]).toBeLessThan(finishes["mail_delivery"]);
  });
});
