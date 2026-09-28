import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@admitto/wallet", () => ({ applyProviderSnapshotToWalletPass: vi.fn() }));
vi.mock("../src/ops-audit.js", () => ({ writeActionLog: vi.fn() }));

import { applyProviderSnapshotToWalletPass } from "@admitto/wallet";
import { writeActionLog } from "../src/ops-audit.js";
import { removeOneWalletPassFromProvider } from "../src/remove-wallet-pass-from-provider.js";

const audit = { operator: "user-1", sessionId: "sess-1", timezone: "Europe/Warsaw" };

function makeDb() {
  // First updateMany is the conditional removal stamp, second is the "put an active row back to
  // voided" repair - both report one row by default, except the repair, which matches nothing
  // unless a test says a Restore raced in.
  const txUpdateMany = vi.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValue({ count: 0 });
  const txFindUnique = vi.fn().mockResolvedValue(null);
  const db = {
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ walletPass: { updateMany: txUpdateMany, findUnique: txFindUnique } }),
    ),
  };
  return { db, txUpdateMany, txFindUnique };
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
    const { db, txUpdateMany } = makeDb();
    const target = makeTarget({ userProvidedId: null });

    const result = await removeOneWalletPassFromProvider(db as never, "evt-1", target, provider as never, audit);

    expect(result).toBe("removed");
    expect(provider.getPassSnapshot).not.toHaveBeenCalled();
    expect(provider.deletePass).toHaveBeenCalledWith("pc-1");
    // Conditional on the exact pass and on it not being removed yet - two concurrent removals must
    // not both stamp and log.
    expect(txUpdateMany).toHaveBeenNthCalledWith(1, {
      where: { attendee_id: "att-1", provider_pass_id: "pc-1", provider_removed_at: null },
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
    await removeOneWalletPassFromProvider(makeDb().db as never, "evt-1", target, provider as never, audit);
    expect(writeActionLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ metadata: {} }));
  });

  it("writes event_wide:true metadata when called from the event-wide clean-up job", async () => {
    const { db } = makeDb();
    const target = makeTarget({ userProvidedId: null });

    await removeOneWalletPassFromProvider(db as never, "evt-1", target, provider as never, audit, {
      eventWide: true,
    });

    expect(writeActionLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ metadata: { event_wide: true } }),
    );
  });

  it("combines bulk and event_wide metadata when both are set", async () => {
    const { db } = makeDb();
    const target = makeTarget({ userProvidedId: null });

    await removeOneWalletPassFromProvider(db as never, "evt-1", target, provider as never, audit, {
      bulk: true,
      eventWide: true,
    });

    expect(writeActionLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ metadata: { bulk: true, event_wide: true } }),
    );
  });

  it("logs nothing and reports already_removed when a concurrent removal stamped the row first", async () => {
    const { db, txUpdateMany, txFindUnique } = makeDb();
    txUpdateMany.mockReset().mockResolvedValue({ count: 0 });
    txFindUnique.mockResolvedValue({ provider_removed_at: new Date("2026-09-20T10:00:00Z") });

    const result = await removeOneWalletPassFromProvider(
      db as never,
      "evt-1",
      makeTarget({ userProvidedId: null }),
      provider as never,
      audit,
    );

    expect(result).toBe("already_removed");
    expect(writeActionLog).not.toHaveBeenCalled();
  });

  it("reports not_found when the WalletPass row was erased while the provider call was in flight", async () => {
    const { db, txUpdateMany, txFindUnique } = makeDb();
    txUpdateMany.mockReset().mockResolvedValue({ count: 0 });
    txFindUnique.mockResolvedValue(null);

    const result = await removeOneWalletPassFromProvider(
      db as never,
      "evt-1",
      makeTarget({ userProvidedId: null }),
      provider as never,
      audit,
    );

    expect(result).toBe("not_found");
    expect(writeActionLog).not.toHaveBeenCalled();
  });

  it("reports changed when the row now holds a different provider pass than the one that was deleted", async () => {
    const { db, txUpdateMany, txFindUnique } = makeDb();
    txUpdateMany.mockReset().mockResolvedValue({ count: 0 });
    txFindUnique.mockResolvedValue({ provider_removed_at: null });

    const result = await removeOneWalletPassFromProvider(
      db as never,
      "evt-1",
      makeTarget({ userProvidedId: null }),
      provider as never,
      audit,
    );

    expect(result).toBe("changed");
    expect(writeActionLog).not.toHaveBeenCalled();
  });

  it("puts a row that a concurrent Restore left active back to voided, and says so in the log", async () => {
    const { db, txUpdateMany } = makeDb();
    txUpdateMany.mockReset().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 1 });

    const result = await removeOneWalletPassFromProvider(
      db as never,
      "evt-1",
      makeTarget({ userProvidedId: null }),
      provider as never,
      audit,
    );

    expect(result).toBe("removed");
    expect(txUpdateMany).toHaveBeenNthCalledWith(2, {
      where: { attendee_id: "att-1", status: { notIn: ["voided", "expired"] } },
      data: { status: "voided", voided_at: expect.any(Date) },
    });
    expect(writeActionLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ metadata: { status_reset: true } }),
    );
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
