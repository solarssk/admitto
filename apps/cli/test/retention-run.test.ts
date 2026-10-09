import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SNAPSHOT_ENV_CASES,
  SNAPSHOT_RETENTION_ENV,
  fakeEmailDeliveryDb,
  seedAgedDeliveries,
} from "./fake-email-delivery-db.js";

// Regression test: `admitto retention run` (and its --dry-run preview) called
// nullifyDeliverySnapshots without retentionDays, so EMAIL_DELIVERY_SNAPSHOT_RETENTION_DAYS was
// ignored and the 60-day default always applied. Runs the real snapshot retention and the real
// env resolver; only the other retention targets and the audit log are stubbed.

vi.mock("@admitto/auth", () => ({
  purgeAuthRetention: vi.fn(async () => ({ sessions: 0, trustedDevices: 0 })),
  purgeSecurityAuditLog: vi.fn(async () => ({ deleted: 0 })),
  resolveSecurityAuditLogRetentionDays: vi.fn(() => 30),
}));
vi.mock("@admitto/notifications", () => ({
  purgeNotifications: vi.fn(async () => ({ deleted: 0 })),
  resolveNotificationRetentionDays: vi.fn(() => 30),
}));
vi.mock("@admitto/tickets", async (importActual) => ({
  ...(await importActual<typeof import("@admitto/tickets")>()),
  writeAdminAuditLog: vi.fn(async () => undefined),
}));
vi.mock("../src/lib/audit.js", () => ({ requireOperatorUserId: vi.fn(async () => "user-1") }));
const purgeJobFilesForRetention = vi.fn(async (_db: unknown, _dryRun: boolean) => ({
  exportFiles: 0,
  stagedImportFiles: 0,
  failures: 0,
}));
vi.mock("../src/lib/retention-job-files.js", () => ({ purgeJobFilesForRetention }));
const sweepErasedWalletPasses = vi.fn(async (_db: unknown, _options: { dryRun: boolean }) => ({
  pending: 0,
  deleted: 0,
  failed: 0,
  noProvider: 0,
  notTried: 0,
}));
vi.mock("../src/lib/retention-erased-wallet-passes.js", async (importActual) => ({
  ...(await importActual<typeof import("../src/lib/retention-erased-wallet-passes.js")>()),
  sweepErasedWalletPasses,
}));

const { runRetention } = await import("../src/commands/retention.js");
const { writeAdminAuditLog } = await import("@admitto/tickets");

const originalArgv = process.argv;

afterEach(() => {
  process.argv = originalArgv;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("admitto retention run - email snapshot retention", () => {
  it.each(
    SNAPSHOT_ENV_CASES.flatMap((envCase) => [
      { ...envCase, dryRun: true },
      { ...envCase, dryRun: false },
    ]),
  )(
    "with the email snapshot override $label and dryRun=$dryRun, uses a $days day window",
    async ({ env, keepsBetween, dryRun }) => {
      vi.stubEnv(SNAPSHOT_RETENTION_ENV, env);
      process.argv = ["node", "admitto", ...(dryRun ? ["--dry-run"] : [])];
      const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
      const { recent, between, old } = seedAgedDeliveries();

      await runRetention(fakeEmailDeliveryDb([recent, between, old]) as never);

      const selected = keepsBetween ? 1 : 2;
      expect(log).toHaveBeenCalledWith(expect.stringContaining(`mail: ${selected} delivery snapshot(s)`));
      if (dryRun) {
        expect([recent, between, old].map((row) => row.rendered_html)).not.toContain(null);
        return;
      }
      expect(recent.rendered_html).not.toBeNull();
      expect(between.rendered_html === null).toBe(!keepsBetween);
      expect(old.rendered_html).toBeNull();
    },
  );
});

describe("admitto retention run - files left by export and import jobs", () => {
  it("purges them and records the counts in the audit entry and in the summary", async () => {
    process.argv = ["node", "admitto"];
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    purgeJobFilesForRetention.mockResolvedValueOnce({ exportFiles: 2, stagedImportFiles: 1, failures: 0 });
    const db = fakeEmailDeliveryDb([]) as never;

    await runRetention(db);

    expect(purgeJobFilesForRetention).toHaveBeenCalledWith(db, false);
    expect(writeAdminAuditLog).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        actionType: "retention_run",
        metadata: expect.objectContaining({ exportFiles: 2, stagedImportFiles: 1 }),
      }),
    );
    expect(log).toHaveBeenCalledWith(expect.stringContaining("job files: 2 export file(s), 1 staged import CSV(s);"));
  });

  it("says how many files could not be deleted", async () => {
    process.argv = ["node", "admitto"];
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    purgeJobFilesForRetention.mockResolvedValueOnce({ exportFiles: 1, stagedImportFiles: 0, failures: 2 });

    await runRetention(fakeEmailDeliveryDb([]) as never);

    expect(log).toHaveBeenCalledWith(expect.stringContaining("(2 could not be deleted);"));
  });

  it("only counts them with --dry-run, and writes no audit entry", async () => {
    process.argv = ["node", "admitto", "--dry-run"];
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    purgeJobFilesForRetention.mockResolvedValueOnce({ exportFiles: 4, stagedImportFiles: 3, failures: 0 });
    vi.mocked(writeAdminAuditLog).mockClear();
    const db = fakeEmailDeliveryDb([]) as never;

    await runRetention(db);

    expect(purgeJobFilesForRetention).toHaveBeenCalledWith(db, true);
    expect(writeAdminAuditLog).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("job files: 4 export file(s), 3 staged import CSV(s);"));
  });
});

describe("admitto retention run - wallet passes of erased attendees", () => {
  it("deletes the ones still at the provider, and records how many went and how many are left", async () => {
    process.argv = ["node", "admitto"];
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    sweepErasedWalletPasses.mockResolvedValueOnce({ pending: 9, deleted: 5, failed: 2, noProvider: 1, notTried: 1 });
    vi.mocked(writeAdminAuditLog).mockClear();
    const db = fakeEmailDeliveryDb([]) as never;

    await runRetention(db);

    expect(sweepErasedWalletPasses).toHaveBeenCalledWith(db, { dryRun: false });
    expect(writeAdminAuditLog).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        metadata: expect.objectContaining({ erasedWalletPassesDeleted: 5, erasedWalletPassesLeft: 4 }),
      }),
    );
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("erased wallet passes: 5 deleted at the provider (4 still to delete, see the System logs)."),
    );
  });

  it("says nothing is left when every one was deleted", async () => {
    process.argv = ["node", "admitto"];
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    sweepErasedWalletPasses.mockResolvedValueOnce({ pending: 3, deleted: 3, failed: 0, noProvider: 0, notTried: 0 });

    await runRetention(fakeEmailDeliveryDb([]) as never);

    expect(log).toHaveBeenCalledWith(expect.stringContaining("erased wallet passes: 3 deleted at the provider."));
  });

  it("only counts them with --dry-run", async () => {
    process.argv = ["node", "admitto", "--dry-run"];
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    sweepErasedWalletPasses.mockResolvedValueOnce({ pending: 6, deleted: 0, failed: 0, noProvider: 0, notTried: 0 });
    const db = fakeEmailDeliveryDb([]) as never;

    await runRetention(db);

    expect(sweepErasedWalletPasses).toHaveBeenCalledWith(db, { dryRun: true });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("erased wallet passes: 6 still to delete at the provider."));
  });
});
