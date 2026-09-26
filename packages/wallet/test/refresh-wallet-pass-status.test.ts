import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  refreshOneWalletPassStatus,
  WalletStatusCheckInconclusiveError,
} from "../src/refresh-wallet-pass-status.js";
import { walletSnapshot } from "./snapshot-fixture.js";

const target = { attendeeId: "att-1", providerPassId: "pc-1", userProvidedId: "admitto:evt-1:att-1" };

const SNAPSHOT = walletSnapshot({ appleActive: 1, googleActive: 2 }, { firstDownloadedAt: "2026-08-25 09:00" });
const VOIDED_SNAPSHOT = walletSnapshot(
  { appleActive: 1 },
  { validity: { voided: true, expirationRaw: null, expiresAt: null } },
);

const ACTIVE_ROW = { status: "active", provider_commanded_at: null, provider_removed_at: null };

/** `row` is what the pre-call read finds (null = no such row); `count` is what the conditional
 * write then matches. */
function makeDb(count = 1, row: Record<string, unknown> | null = ACTIVE_ROW) {
  return {
    walletPass: {
      findFirst: vi.fn().mockResolvedValue(row),
      updateMany: vi.fn().mockResolvedValue({ count }),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("refreshOneWalletPassStatus", () => {
  const provider = {
    getPassSnapshot: vi.fn(),
    consistencyPolicy: { observationStalenessWindowMs: 10 * 60 * 1000 },
  };

  beforeEach(() => {
    provider.getPassSnapshot.mockReset();
  });

  it("writes the fetched registration status and returns refreshed", async () => {
    const db = makeDb();
    provider.getPassSnapshot.mockResolvedValueOnce(SNAPSHOT);

    const result = await refreshOneWalletPassStatus(db, target, provider as never);

    expect(result).toBe("refreshed");
    expect(provider.getPassSnapshot).toHaveBeenCalledTimes(1);
    expect(provider.getPassSnapshot).toHaveBeenCalledWith({
      providerPassId: target.providerPassId,
      userProvidedId: target.userProvidedId,
    });
    expect(db.walletPass.updateMany).toHaveBeenCalledWith({
      where: {
        attendee_id: target.attendeeId,
        provider_pass_id: target.providerPassId,
        user_provided_id: target.userProvidedId,
        // The lifecycle state as read before the provider call: a Void, a Restore or a delete during
        // the call makes this write match nothing.
        status: "active",
        provider_commanded_at: null,
        provider_removed_at: null,
      },
      data: {
        apple_active_registrations: SNAPSHOT.registrations!.appleActive,
        apple_inactive_registrations: SNAPSHOT.registrations!.appleInactive,
        google_active_registrations: SNAPSHOT.registrations!.googleActive,
        google_inactive_registrations: SNAPSHOT.registrations!.googleInactive,
        samsung_active_registrations: SNAPSHOT.registrations!.samsungActive,
        samsung_inactive_registrations: SNAPSHOT.registrations!.samsungInactive,
        first_downloaded_at: SNAPSHOT.firstDownloadedAt,
        registration_checked_at: expect.any(Date),
        registration_sync_attempted_at: expect.any(Date),
      },
    });
  });

  describe("with fake timers (retry delay)", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("retries once after a delay and recovers when the first attempt reports no match", async () => {
      const db = makeDb();
      provider.getPassSnapshot.mockResolvedValueOnce(null).mockResolvedValueOnce(SNAPSHOT);

      const pending = refreshOneWalletPassStatus(db, target, provider as never);
      await vi.advanceTimersByTimeAsync(1000);
      const result = await pending;

      expect(result).toBe("refreshed");
      expect(provider.getPassSnapshot).toHaveBeenCalledTimes(2);
    });

    it("throws WalletStatusCheckInconclusiveError without writing when still no match after the retry", async () => {
      const db = makeDb();
      provider.getPassSnapshot.mockResolvedValue(null);

      const pending = refreshOneWalletPassStatus(db, target, provider as never);
      const assertion = expect(pending).rejects.toThrow(WalletStatusCheckInconclusiveError);
      await vi.advanceTimersByTimeAsync(1000);
      await assertion;

      expect(provider.getPassSnapshot).toHaveBeenCalledTimes(2);
      expect(db.walletPass.updateMany).not.toHaveBeenCalled();
    });
  });

  it("returns conflict without throwing when the pass identity no longer matches at write time", async () => {
    const db = makeDb(0);
    provider.getPassSnapshot.mockResolvedValueOnce(SNAPSHOT);

    const result = await refreshOneWalletPassStatus(db, target, provider as never);

    expect(result).toBe("conflict");
  });

  it("returns conflict without a provider call when the pass is no longer there to be read", async () => {
    const db = makeDb(1, null);

    const result = await refreshOneWalletPassStatus(db, target, provider as never);

    expect(result).toBe("conflict");
    expect(provider.getPassSnapshot).not.toHaveBeenCalled();
  });

  it.each([
    ["voided", { status: "voided", provider_commanded_at: null, provider_removed_at: null }],
    ["expired", { status: "expired", provider_commanded_at: null, provider_removed_at: null }],
    ["pending", { status: "pending", provider_commanded_at: null, provider_removed_at: null }],
    ["removed at the provider", { status: "voided", provider_commanded_at: null, provider_removed_at: new Date() }],
  ])("returns inactive for a %s pass without calling the provider or writing", async (_label, row) => {
    const db = makeDb(1, row);

    const result = await refreshOneWalletPassStatus(db, target, provider as never);

    expect(result).toBe("inactive");
    expect(provider.getPassSnapshot).not.toHaveBeenCalled();
    expect(db.walletPass.updateMany).not.toHaveBeenCalled();
  });

  it("records the transition when the provider reports the active pass voided", async () => {
    const db = makeDb();
    provider.getPassSnapshot.mockResolvedValueOnce(VOIDED_SNAPSHOT);

    const result = await refreshOneWalletPassStatus(db, target, provider as never);

    expect(result).toBe("refreshed");
    expect(db.walletPass.updateMany.mock.calls[0][0].data).toMatchObject({
      status: "voided",
      voided_at: expect.any(Date),
      apple_active_registrations: 1,
    });
  });

  it("reads a voided report as expired when the caller supplies the provider time zone and the provider's expiration is past", async () => {
    const db = makeDb();
    provider.getPassSnapshot.mockResolvedValueOnce(
      walletSnapshot({}, { validity: { voided: true, expirationRaw: "2026-09-01 11:00", expiresAt: null } }),
    );

    await refreshOneWalletPassStatus(db, target, provider as never, { providerTimeZone: "Europe/Warsaw" });

    // 11:00 in Warsaw (UTC+2) is 09:00Z, before the snapshot's own 10:00Z read.
    expect(db.walletPass.updateMany.mock.calls[0][0].data.status).toBe("expired");
  });

  it("leaves a naive provider expiration uninterpreted when no time zone is supplied: voided, not a guessed expired", async () => {
    const db = makeDb();
    provider.getPassSnapshot.mockResolvedValueOnce(
      walletSnapshot({}, { validity: { voided: true, expirationRaw: "2026-09-01 11:00", expiresAt: null } }),
    );

    await refreshOneWalletPassStatus(db, target, provider as never);

    expect(db.walletPass.updateMany.mock.calls[0][0].data.status).toBe("voided");
  });
});
