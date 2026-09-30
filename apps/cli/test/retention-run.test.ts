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

const { runRetention } = await import("../src/commands/retention.js");

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
