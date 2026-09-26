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
    });
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

  it("does not undo an Admitto command with a stale read: a 'voided' snapshot taken right after a Restore only refreshes the counts", async () => {
    const db = makeDb();
    const justRestored = target({ provider_commanded_at: new Date(NOW.getTime() - 60_000) });
    const stale = snapshotAtNow({ appleActive: 1 }, { validity: { voided: true, expirationRaw: null, expiresAt: null } });

    await applyProviderSnapshotToWalletPass(db, justRestored, stale, options);

    const { data } = db.walletPass.updateMany.mock.calls[0][0];
    expect(data).not.toHaveProperty("status");
    expect(data.apple_active_registrations).toBe(1);
  });

  it("defaults the stamp to the current time when none is given", async () => {
    const db = makeDb();
    const before = Date.now();
    await applyProviderSnapshotToWalletPass(db, target(), walletSnapshot(), { policy: POLICY, providerTimeZone: null });
    const stamped = db.walletPass.updateMany.mock.calls[0][0].data.registration_checked_at as Date;
    expect(stamped.getTime()).toBeGreaterThanOrEqual(before);
  });
});
