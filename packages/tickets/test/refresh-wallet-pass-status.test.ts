import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@admitto/wallet", () => ({ refreshOneWalletPassStatus: vi.fn() }));
vi.mock("../src/lock-check.js", () => ({ attendeeIsLive: vi.fn() }));

import { refreshOneWalletPassStatus } from "@admitto/wallet";
import { attendeeIsLive } from "../src/lock-check.js";
import { refreshWalletPassStatusUnlessErased } from "../src/refresh-wallet-pass-status.js";

const db = { tag: "db" } as never;
const provider = { getPassSnapshot: vi.fn() } as never;
const target = { attendeeId: "att-1", providerPassId: "pc-1", userProvidedId: "admitto:evt-1:att-1" };

describe("refreshWalletPassStatusUnlessErased", () => {
  beforeEach(() => {
    vi.mocked(attendeeIsLive).mockReset().mockResolvedValue(true);
    vi.mocked(refreshOneWalletPassStatus).mockReset().mockResolvedValue("refreshed");
  });

  it("reads nothing from the provider for an attendee who is erased or being erased", async () => {
    vi.mocked(attendeeIsLive).mockResolvedValue(false);

    expect(await refreshWalletPassStatusUnlessErased(db, target, provider)).toBe("erased");

    expect(attendeeIsLive).toHaveBeenCalledWith(db, "att-1");
    expect(refreshOneWalletPassStatus).not.toHaveBeenCalled();
  });

  it.each(["refreshed", "suppressed", "inactive", "conflict"] as const)(
    "hands a live attendee to refreshOneWalletPassStatus and answers %s as it does",
    async (outcome) => {
      vi.mocked(refreshOneWalletPassStatus).mockResolvedValue(outcome);

      const result = await refreshWalletPassStatusUnlessErased(db, target, provider);

      expect(result).toBe(outcome);
      expect(refreshOneWalletPassStatus).toHaveBeenCalledWith(db, target, provider);
    },
  );

  it("makes the check before the provider is read", async () => {
    const order: string[] = [];
    vi.mocked(attendeeIsLive).mockImplementation(async () => (order.push("last check"), true));
    vi.mocked(refreshOneWalletPassStatus).mockImplementation(async () => (order.push("provider read"), "refreshed"));

    await refreshWalletPassStatusUnlessErased(db, target, provider);

    expect(order).toEqual(["last check", "provider read"]);
  });

  it("does not refresh when the check itself fails, and passes the failure on", async () => {
    vi.mocked(attendeeIsLive).mockRejectedValue(new Error("lock wait timed out"));

    await expect(refreshWalletPassStatusUnlessErased(db, target, provider)).rejects.toThrow("lock wait timed out");
    expect(refreshOneWalletPassStatus).not.toHaveBeenCalled();
  });
});
