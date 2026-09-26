import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  refreshOneWalletPassStatus,
  WalletStatusCheckInconclusiveError,
} from "../src/refresh-wallet-pass-status.js";
import { walletSnapshot } from "./snapshot-fixture.js";

const target = { attendeeId: "att-1", providerPassId: "pc-1", userProvidedId: "admitto:evt-1:att-1" };

const SNAPSHOT = walletSnapshot({ appleActive: 1, googleActive: 2 }, { firstDownloadedAt: "2026-08-25 09:00" });

function makeDb(count = 1) {
  return {
    walletPass: { updateMany: vi.fn().mockResolvedValue({ count }) },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("refreshOneWalletPassStatus", () => {
  const provider = { getPassSnapshot: vi.fn() };

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
});
