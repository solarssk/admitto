import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@admitto/wallet", () => ({ applyProviderSnapshotToWalletPass: vi.fn() }));
vi.mock("../src/ops-audit.js", () => ({ writeActionLog: vi.fn() }));

import { applyProviderSnapshotToWalletPass } from "@admitto/wallet";
import { writeActionLog } from "../src/ops-audit.js";
import { removeOneWalletPassFromProvider } from "../src/remove-wallet-pass-from-provider.js";

const audit = { operator: "user-1", sessionId: "sess-1", timezone: "Europe/Warsaw" };

function makeDb() {
  const txWalletPassUpdate = vi.fn().mockResolvedValue({});
  const db = {
    walletPass: { update: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => {
      await fn({ walletPass: { update: txWalletPassUpdate } });
    }),
  };
  return { db, txWalletPassUpdate };
}

function makeTarget(overrides: Partial<Parameters<typeof removeOneWalletPassFromProvider>[2]> = {}) {
  return {
    attendeeId: "att-1",
    providerPassId: "pc-1",
    userProvidedId: "evt-1:att-1",
    status: "voided",
    providerCommandedAt: null,
    providerRemovedAt: null,
    ...overrides,
  };
}

describe("removeOneWalletPassFromProvider", () => {
  const provider = {
    getPassSnapshot: vi.fn(),
    deletePass: vi.fn(),
    consistencyPolicy: { observationStalenessWindowMs: 600_000 },
  };

  beforeEach(() => {
    vi.mocked(applyProviderSnapshotToWalletPass).mockReset();
    vi.mocked(writeActionLog).mockReset().mockResolvedValue(undefined);
    provider.getPassSnapshot.mockReset();
    provider.deletePass.mockReset().mockResolvedValue(undefined);
  });

  it("short-circuits as already_removed without calling the provider at all", async () => {
    const { db } = makeDb();
    const target = makeTarget({ providerRemovedAt: new Date("2026-09-20T00:00:00Z") });

    const result = await removeOneWalletPassFromProvider(db as never, "evt-1", target, provider as never, audit);

    expect(result).toBe("already_removed");
    expect(provider.getPassSnapshot).not.toHaveBeenCalled();
    expect(provider.deletePass).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("skips the snapshot read entirely when userProvidedId is unknown, but still deletes and marks removed", async () => {
    const { db, txWalletPassUpdate } = makeDb();
    const target = makeTarget({ userProvidedId: null });

    const result = await removeOneWalletPassFromProvider(db as never, "evt-1", target, provider as never, audit);

    expect(result).toBe("removed");
    expect(provider.getPassSnapshot).not.toHaveBeenCalled();
    expect(provider.deletePass).toHaveBeenCalledWith("pc-1");
    expect(txWalletPassUpdate).toHaveBeenCalledWith({
      where: { attendee_id: "att-1" },
      data: { provider_removed_at: expect.any(Date) },
    });
  });

  it("a null snapshot (no match) leaves existing data alone but still proceeds to delete", async () => {
    const { db } = makeDb();
    const target = makeTarget();
    provider.getPassSnapshot.mockResolvedValueOnce(null);

    const result = await removeOneWalletPassFromProvider(db as never, "evt-1", target, provider as never, audit);

    expect(result).toBe("removed");
    expect(applyProviderSnapshotToWalletPass).not.toHaveBeenCalled();
    expect(provider.deletePass).toHaveBeenCalledWith("pc-1");
  });

  it("applies a found snapshot through applyProviderSnapshotToWalletPass before deleting", async () => {
    const { db } = makeDb();
    const target = makeTarget({ providerCommandedAt: new Date("2026-09-01T00:00:00Z") });
    const snapshot = { observedAt: new Date(), validity: { voided: true, expirationRaw: null, expiresAt: null }, registrations: null, firstDownloadedAt: null };
    provider.getPassSnapshot.mockResolvedValueOnce(snapshot);
    vi.mocked(applyProviderSnapshotToWalletPass).mockResolvedValueOnce("applied");

    const result = await removeOneWalletPassFromProvider(db as never, "evt-1", target, provider as never, audit);

    expect(result).toBe("removed");
    expect(applyProviderSnapshotToWalletPass).toHaveBeenCalledWith(
      db,
      {
        attendeeId: "att-1",
        providerPassId: "pc-1",
        userProvidedId: "evt-1:att-1",
        status: "voided",
        provider_commanded_at: target.providerCommandedAt,
        provider_removed_at: null,
      },
      snapshot,
      { policy: provider.consistencyPolicy, providerTimeZone: null },
    );
    // deletePass must still run after the snapshot step, not be skipped by it.
    expect(provider.deletePass).toHaveBeenCalledWith("pc-1");
  });

  it("a provider error during the snapshot read aborts before deletePass is ever called", async () => {
    const { db } = makeDb();
    const target = makeTarget();
    provider.getPassSnapshot.mockRejectedValueOnce(new Error("provider down"));

    await expect(
      removeOneWalletPassFromProvider(db as never, "evt-1", target, provider as never, audit),
    ).rejects.toThrow("provider down");

    expect(provider.deletePass).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("a 404-shaped delete (provider's own idempotent contract) still counts as success", async () => {
    const { db } = makeDb();
    const target = makeTarget({ userProvidedId: null });
    provider.deletePass.mockResolvedValueOnce(undefined); // adapter itself swallows 404s as success

    const result = await removeOneWalletPassFromProvider(db as never, "evt-1", target, provider as never, audit);

    expect(result).toBe("removed");
  });

  it("writes the action log with bulk:true metadata when called from a bulk action, {} otherwise", async () => {
    const { db } = makeDb();
    const target = makeTarget({ userProvidedId: null });

    await removeOneWalletPassFromProvider(db as never, "evt-1", target, provider as never, audit, { bulk: true });
    expect(writeActionLog).toHaveBeenCalledWith(expect.anything(), {
      event_id: "evt-1",
      attendee_id: "att-1",
      action_type: "wallet_pass_removed",
      audit,
      metadata: { bulk: true },
    });

    vi.mocked(writeActionLog).mockClear();
    await removeOneWalletPassFromProvider(db as never, "evt-1", target, provider as never, audit);
    expect(writeActionLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ metadata: {} }));
  });

  it("deletePass throwing aborts before the transaction ever runs", async () => {
    const { db } = makeDb();
    const target = makeTarget({ userProvidedId: null });
    provider.deletePass.mockRejectedValueOnce(new Error("network timeout"));

    await expect(
      removeOneWalletPassFromProvider(db as never, "evt-1", target, provider as never, audit),
    ).rejects.toThrow("network timeout");

    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
