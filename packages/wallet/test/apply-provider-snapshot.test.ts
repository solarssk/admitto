import { beforeEach, describe, expect, it, vi } from "vitest";

const emitSystemLog = vi.fn();
vi.mock("@admitto/shared/system-log", () => ({
  emitSystemLog: (...args: unknown[]) => emitSystemLog(...args),
}));

import { applyProviderSnapshotToWalletPass } from "../src/apply-provider-snapshot.js";
import { walletSnapshot } from "./snapshot-fixture.js";

const POLICY = { observationStalenessWindowMs: 10 * 60 * 1000 };
const NOW = new Date("2026-09-24T18:05:00.000Z");
const COMMANDED_AT = new Date("2026-09-24T12:00:00.000Z");

function target(overrides: Record<string, unknown> = {}) {
  return {
    attendeeId: "att-1",
    providerPassId: "pc-1",
    userProvidedId: "admitto:evt-1:att-1",
    status: "active",
    provider_commanded_at: null,
    provider_removed_at: null,
    ...overrides,
  };
}

/** A snapshot read at NOW, unless told otherwise (walletSnapshot's own default is far earlier). */
function snapshotAtNow(
  registrations: Parameters<typeof walletSnapshot>[0] = {},
  overrides: Parameters<typeof walletSnapshot>[1] = {},
) {
  return walletSnapshot(registrations, { observedAt: NOW, ...overrides });
}

function makeDb(count = 1) {
  return {
    walletPass: { updateMany: vi.fn().mockResolvedValue({ count }) },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const options = { policy: POLICY, providerTimeZone: null, now: NOW };

describe("applyProviderSnapshotToWalletPass", () => {
  beforeEach(() => emitSystemLog.mockReset());

  it("writes the registration counts and stamps the read, without touching status, for a still-active pass", async () => {
    const db = makeDb();
    const snapshot = snapshotAtNow({ appleActive: 1 }, { firstDownloadedAt: "2026-08-01 10:00:00" });

    expect(await applyProviderSnapshotToWalletPass(db, target(), snapshot, options)).toBe("applied");

    const { data } = db.walletPass.updateMany.mock.calls[0][0];
    expect(data).toMatchObject({
      apple_active_registrations: 1,
      first_downloaded_at: "2026-08-01 10:00:00",
      registration_checked_at: NOW,
      registration_sync_attempted_at: NOW,
      lifecycle_observed_at: NOW,
    });
    expect(data).not.toHaveProperty("status");
    expect(data).not.toHaveProperty("voided_at");
    expect(emitSystemLog).not.toHaveBeenCalled();
  });

  it("conditions the write on the pass exactly as it was read, so a change during the provider call makes it a no-op", async () => {
    const db = makeDb();
    await applyProviderSnapshotToWalletPass(db, target({ provider_commanded_at: COMMANDED_AT }), snapshotAtNow(), options);

    expect(db.walletPass.updateMany.mock.calls[0][0].where).toEqual({
      attendee_id: "att-1",
      provider_pass_id: "pc-1",
      user_provided_id: "admitto:evt-1:att-1",
      status: "active",
      provider_commanded_at: COMMANDED_AT,
      provider_removed_at: null,
      // Ordering: an older observation must never overwrite a newer one already stored. Keyed on
      // lifecycle_observed_at, a column with exactly one writer (this function) - neither
      // registration_checked_at nor registration_sync_attempted_at qualifies, since both are also
      // written by code paths that carry no observation at all (a plain registration webhook, a
      // per-pass no-match/failure, a whole-event "wallet not configured" skip). Strictly `lt`, not
      // `lte`: Date/TIMESTAMP(3) both truncate to milliseconds, so two independent reads can
      // genuinely tie - `lte` would let whichever one simply finishes writing last win regardless of
      // which one is actually fresher (Codex review, 2026-09-27; see the real-Postgres tie test in
      // wallet-webhook-routes.test.ts, since a mocked updateMany can't exercise SQL `<` vs `<=`).
      OR: [{ lifecycle_observed_at: null }, { lifecycle_observed_at: { lt: NOW } }],
    });
  });

  it("stamps lifecycle_observed_at with when the snapshot was observed (registration_checked_at and registration_sync_attempted_at stay the write time), so overlapping reads order by observation", async () => {
    const db = makeDb();
    const observedAt = new Date(NOW.getTime() - 30_000);

    await applyProviderSnapshotToWalletPass(db, target(), snapshotAtNow({}, { observedAt }), options);

    const call = db.walletPass.updateMany.mock.calls[0][0];
    expect(call.data.lifecycle_observed_at).toBe(observedAt);
    expect(call.data.registration_checked_at).toBe(NOW);
    expect(call.data.registration_sync_attempted_at).toBe(NOW);
    expect(call.where.OR).toEqual([
      { lifecycle_observed_at: null },
      { lifecycle_observed_at: { lt: observedAt } },
    ]);
  });

  it("writes nothing and reports conflict when a newer observation is already stored (the guard makes the conditional write match no row)", async () => {
    // The stored lifecycle_observed_at is newer than this snapshot's observation, so the OR guard
    // excludes the row and updateMany matches nothing.
    const db = makeDb(0);
    const stale = snapshotAtNow({}, { observedAt: new Date(NOW.getTime() - 60_000), validity: { voided: true, expirationRaw: null, expiresAt: null } });

    expect(await applyProviderSnapshotToWalletPass(db, target(), stale, options)).toBe("conflict");
    expect(emitSystemLog).not.toHaveBeenCalled();
  });

  it("is not blocked by a no-data write racing in on registration_checked_at or registration_sync_attempted_at while the read was in flight - the ordering guard only ever looks at lifecycle_observed_at", async () => {
    const db = makeDb();
    const voided = snapshotAtNow({ appleActive: 1 }, { validity: { voided: true, expirationRaw: null, expiresAt: null } });

    expect(await applyProviderSnapshotToWalletPass(db, target(), voided, options)).toBe("applied");
    const call = db.walletPass.updateMany.mock.calls[0][0];
    expect(call.where.OR).toEqual([{ lifecycle_observed_at: null }, { lifecycle_observed_at: { lt: NOW } }]);
    expect(call.where).not.toHaveProperty("registration_checked_at");
    expect(call.where).not.toHaveProperty("registration_sync_attempted_at");
  });

  it("returns conflict, and logs nothing, when the row no longer matches", async () => {
    const db = makeDb(0);
    const voided = snapshotAtNow({}, { validity: { voided: true, expirationRaw: null, expiresAt: null } });

    expect(await applyProviderSnapshotToWalletPass(db, target(), voided, options)).toBe("conflict");
    expect(emitSystemLog).not.toHaveBeenCalled();
  });

  it("moves an active pass the provider reports voided to voided, in the SAME write as its newest registration counts", async () => {
    const db = makeDb();
    const snapshot = snapshotAtNow(
      { appleActive: 2, googleInactive: 1 },
      { validity: { voided: true, expirationRaw: null, expiresAt: null } },
    );

    expect(await applyProviderSnapshotToWalletPass(db, target(), snapshot, options)).toBe("applied");

    expect(db.walletPass.updateMany).toHaveBeenCalledTimes(1);
    expect(db.walletPass.updateMany.mock.calls[0][0].data).toMatchObject({
      status: "voided",
      voided_at: NOW,
      apple_active_registrations: 2,
      google_inactive_registrations: 1,
    });
    expect(emitSystemLog).toHaveBeenCalledWith("wallet", "info", "wallet_pass_lifecycle_observed", {
      attendeeId: "att-1",
      from: "active",
      to: "voided",
    });
  });

  it("moves a pass whose provider expiration is already past to expired, and does not stamp voided_at (nobody voided it)", async () => {
    const db = makeDb();
    const snapshot = snapshotAtNow(
      {},
      {
        validity: {
          voided: true,
          expirationRaw: "2026-09-24 19:00",
          expiresAt: null,
        },
      },
    );

    await applyProviderSnapshotToWalletPass(db, target(), snapshot, { ...options, providerTimeZone: "Europe/Warsaw" });

    const { data } = db.walletPass.updateMany.mock.calls[0][0];
    expect(data.status).toBe("expired");
    expect(data).not.toHaveProperty("voided_at");
  });

  it("does not undo an Admitto command with a stale read: a 'voided' snapshot taken right after a Restore only refreshes the counts, and reports suppressed", async () => {
    const db = makeDb();
    const justRestored = target({ provider_commanded_at: new Date(NOW.getTime() - 60_000) });
    const stale = snapshotAtNow({ appleActive: 1 }, { validity: { voided: true, expirationRaw: null, expiresAt: null } });

    expect(await applyProviderSnapshotToWalletPass(db, justRestored, stale, options)).toBe("suppressed");

    const { data } = db.walletPass.updateMany.mock.calls[0][0];
    expect(data).not.toHaveProperty("status");
    expect(data).not.toHaveProperty("voided_at");
    expect(data.apple_active_registrations).toBe(1);
    // Suppressed is not a lifecycle transition - nothing was actually observed to change.
    expect(emitSystemLog).not.toHaveBeenCalled();
  });

  it("reports suppressed (not applied) for a voided read taken before Admitto's command it would otherwise contradict", async () => {
    const db = makeDb();
    const commandedSoonAfter = target({ provider_commanded_at: new Date(NOW.getTime() + 5_000) });
    const voided = snapshotAtNow({}, { validity: { voided: true, expirationRaw: null, expiresAt: null } });

    expect(await applyProviderSnapshotToWalletPass(db, commandedSoonAfter, voided, options)).toBe("suppressed");
  });

  it("does not report suppressed for a genuinely clean read (not voided) taken inside the command window - there is nothing to suppress", async () => {
    const db = makeDb();
    const justRestored = target({ provider_commanded_at: new Date(NOW.getTime() - 60_000) });
    const clean = snapshotAtNow();

    expect(await applyProviderSnapshotToWalletPass(db, justRestored, clean, options)).toBe("applied");
  });

  it("returns conflict (not suppressed) when a suppressible read also fails the identity/ordering guard", async () => {
    const db = makeDb(0);
    const justRestored = target({ provider_commanded_at: new Date(NOW.getTime() - 60_000) });
    const stale = snapshotAtNow({}, { validity: { voided: true, expirationRaw: null, expiresAt: null } });

    expect(await applyProviderSnapshotToWalletPass(db, justRestored, stale, options)).toBe("conflict");
  });

  it("defaults the write-time stamps (registration_checked_at, registration_sync_attempted_at) to the current time when none is given", async () => {
    const db = makeDb();
    const before = Date.now();
    await applyProviderSnapshotToWalletPass(db, target(), snapshotAtNow(), { policy: POLICY, providerTimeZone: null });
    const { data } = db.walletPass.updateMany.mock.calls[0][0];
    expect((data.registration_checked_at as Date).getTime()).toBeGreaterThanOrEqual(before);
    expect((data.registration_sync_attempted_at as Date).getTime()).toBeGreaterThanOrEqual(before);
  });
});
