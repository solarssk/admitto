import { beforeEach, describe, expect, it, vi } from "vitest";
import { querySystemLogs, resetSystemLogBufferForTest } from "@admitto/shared/system-log";

vi.mock("../src/ops-audit.js", () => ({ writeActionLog: vi.fn() }));

import { writeActionLog } from "../src/ops-audit.js";
import { voidOneWalletPassAtProvider } from "../src/void-wallet-pass-at-provider.js";

const audit = { operator: "user-1", sessionId: "sess-1" };
const target = {
  attendeeId: "att-1",
  providerPassId: "pc-1",
  status: "active",
  providerRemovedAt: null,
  providerCommandedAt: null,
};
const ACTIVE_ROW = { status: "active", provider_removed_at: null, provider_commanded_at: null };

describe("voidOneWalletPassAtProvider", () => {
  const provider = { voidPass: vi.fn(), restorePass: vi.fn() };
  const txUpdateMany = vi.fn();
  const findFirst = vi.fn();
  const walletUpdateMany = vi.fn();
  const db = {
    walletPass: { findFirst, updateMany: walletUpdateMany },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({ walletPass: { updateMany: txUpdateMany } })),
  };

  beforeEach(() => {
    provider.voidPass.mockReset().mockResolvedValue(undefined);
    provider.restorePass.mockReset().mockResolvedValue(undefined);
    walletUpdateMany.mockReset().mockResolvedValue({ count: 1 });
    resetSystemLogBufferForTest();
    findFirst.mockReset().mockResolvedValue(ACTIVE_ROW);
    txUpdateMany.mockReset().mockResolvedValue({ count: 1 });
    vi.mocked(writeActionLog).mockReset().mockResolvedValue(undefined);
  });

  it("voids the pass at the provider, marks the row voided (only while not removed) and logs it", async () => {
    const result = await voidOneWalletPassAtProvider(db as never, "evt-1", target, provider as never, audit);

    expect(result).toBe("voided");
    expect(provider.voidPass).toHaveBeenCalledWith("pc-1");
    expect(txUpdateMany).toHaveBeenCalledWith({
      where: {
        attendee_id: "att-1",
        provider_pass_id: "pc-1",
        provider_removed_at: null,
        status: "active",
        provider_commanded_at: null,
      },
      data: {
        status: "voided",
        voided_at: expect.any(Date),
        provider_commanded_at: expect.any(Date),
        last_error_code: null,
      },
    });
    expect(writeActionLog).toHaveBeenCalledWith(expect.anything(), {
      event_id: "evt-1",
      attendee_id: "att-1",
      action_type: "wallet_pass_voided",
      audit,
      metadata: { bulk: true },
    });
  });

  it("marks an event-wide run in the log entry", async () => {
    await voidOneWalletPassAtProvider(db as never, "evt-1", target, provider as never, audit, { eventWide: true });

    expect(vi.mocked(writeActionLog).mock.calls[0]![1].metadata).toEqual({ bulk: true, event_wide: true });
  });

  it.each([
    ["already voided", { status: "voided" }],
    ["expired", { status: "expired" }],
    ["removed at the provider", { providerRemovedAt: new Date("2026-09-20T10:00:00Z") }],
  ])("skips a pass that is %s, without calling the provider", async (_label, overrides) => {
    const result = await voidOneWalletPassAtProvider(
      db as never,
      "evt-1",
      { ...target, ...overrides },
      provider as never,
      audit,
    );

    expect(result).toBe("skipped");
    expect(provider.voidPass).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  /** The write finds the pass changed; `nowRow` is what the follow-up read then sees. */
  async function loseTheRace(nowRow: unknown) {
    txUpdateMany.mockResolvedValue({ count: 0 });
    findFirst.mockResolvedValueOnce(ACTIVE_ROW).mockResolvedValueOnce(nowRow);
    return voidOneWalletPassAtProvider(db as never, "evt-1", target, provider as never, audit);
  }

  it.each([
    ["removed at the provider", { status: "voided", provider_removed_at: new Date("2026-09-20T10:00:00Z") }],
    ["expired", { status: "expired", provider_removed_at: null }],
    ["voided by someone else", { status: "voided", provider_removed_at: null }],
    ["deleted and issued again (the row now holds another pass, so it is not found by this pass's identity)", null],
  ])("skips, logging nothing and leaving the provider alone, when the pass was %s while the void was in flight", async (_label, nowRow) => {
    const result = await loseTheRace(nowRow);

    expect(result).toBe("skipped");
    expect(txUpdateMany.mock.calls[0]![0].where).toMatchObject({ provider_pass_id: "pc-1" });
    expect(writeActionLog).not.toHaveBeenCalled();
    expect(provider.restorePass).not.toHaveBeenCalled();
    expect(walletUpdateMany).not.toHaveBeenCalled();
  });

  it("puts a Restore that landed in the gap back at the provider (a Restore is the newer decision), and refreshes the command stamp", async () => {
    const result = await loseTheRace({ status: "active", provider_removed_at: null });

    expect(result).toBe("skipped");
    expect(provider.restorePass).toHaveBeenCalledWith("pc-1");
    expect(walletUpdateMany).toHaveBeenCalledWith({
      where: { attendee_id: "att-1", provider_pass_id: "pc-1", provider_removed_at: null, status: "active" },
      data: { provider_commanded_at: expect.any(Date) },
    });
    expect(writeActionLog).not.toHaveBeenCalled();
    // The follow-up read is scoped to this pass's own identity.
    expect(findFirst.mock.calls[1]![0].where).toEqual({ attendee_id: "att-1", provider_pass_id: "pc-1" });
  });

  it("does not turn a failed realignment into an error of the pass: it is logged and left to the periodic check", async () => {
    provider.restorePass.mockRejectedValue(new Error("provider down"));

    const result = await loseTheRace({ status: "active", provider_removed_at: null });

    expect(result).toBe("skipped");
    expect(walletUpdateMany).not.toHaveBeenCalled();
    const [entry] = querySystemLogs({ source: "wallet", search: "wallet_void_realign_failed" });
    expect(entry?.fields).toMatchObject({ event_id: "evt-1", error: "provider down" });
  });

  it("logs a non-Error failure of the realignment by its value", async () => {
    provider.restorePass.mockRejectedValue("plain string");

    await loseTheRace({ status: "active", provider_removed_at: null });

    const [entry] = querySystemLogs({ source: "wallet", search: "wallet_void_realign_failed" });
    expect(entry?.fields).toMatchObject({ error: "plain string" });
  });

  it("reads the row again before the provider call and matches the state it read in the write", async () => {
    const stamp = new Date("2026-09-28T10:00:00Z");
    findFirst.mockResolvedValue({ ...ACTIVE_ROW, provider_commanded_at: stamp });

    const result = await voidOneWalletPassAtProvider(
      db as never,
      "evt-1",
      { ...target, providerCommandedAt: stamp },
      provider as never,
      audit,
    );

    expect(result).toBe("voided");
    expect(findFirst).toHaveBeenCalledWith({
      where: { attendee_id: "att-1", provider_pass_id: "pc-1" },
      select: { status: true, provider_removed_at: true, provider_commanded_at: true },
    });
    expect(txUpdateMany.mock.calls[0]![0].where).toMatchObject({ status: "active", provider_commanded_at: stamp });
  });

  it.each([
    ["expired since the snapshot", { ...ACTIVE_ROW, status: "expired" }],
    ["voided since the snapshot", { ...ACTIVE_ROW, status: "voided" }],
    ["removed since the snapshot", { ...ACTIVE_ROW, provider_removed_at: new Date("2026-09-20T10:00:00Z") }],
    ["gone since the snapshot", null],
  ])("skips a pass that is %s, without calling the provider", async (_label, row) => {
    findFirst.mockResolvedValue(row);

    const result = await voidOneWalletPassAtProvider(db as never, "evt-1", target, provider as never, audit);

    expect(result).toBe("skipped");
    expect(provider.voidPass).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("skips a pass that another operator voided and restored since the snapshot (its command stamp moved)", async () => {
    findFirst.mockResolvedValue({ ...ACTIVE_ROW, provider_commanded_at: new Date("2026-09-28T10:05:00Z") });

    const result = await voidOneWalletPassAtProvider(db as never, "evt-1", target, provider as never, audit);

    expect(result).toBe("skipped");
    expect(provider.voidPass).not.toHaveBeenCalled();
  });

  it("skips a pass whose command stamp was set when the snapshot had none, and one whose stamp was cleared", async () => {
    findFirst.mockResolvedValue({ ...ACTIVE_ROW, provider_commanded_at: new Date("2026-09-28T10:05:00Z") });
    expect(await voidOneWalletPassAtProvider(db as never, "evt-1", target, provider as never, audit)).toBe("skipped");

    findFirst.mockResolvedValue(ACTIVE_ROW);
    const stamped = { ...target, providerCommandedAt: new Date("2026-09-28T10:00:00Z") };
    expect(await voidOneWalletPassAtProvider(db as never, "evt-1", stamped, provider as never, audit)).toBe("skipped");
  });

  it("does not compare command stamps when the caller's snapshot has none to offer", async () => {
    findFirst.mockResolvedValue({ ...ACTIVE_ROW, provider_commanded_at: new Date("2026-09-28T10:05:00Z") });
    const { providerCommandedAt: _omitted, ...withoutStamp } = target;

    const result = await voidOneWalletPassAtProvider(db as never, "evt-1", withoutStamp, provider as never, audit);

    expect(result).toBe("voided");
  });

  it("propagates a provider failure and writes nothing locally", async () => {
    provider.voidPass.mockRejectedValue(new Error("provider down"));

    await expect(
      voidOneWalletPassAtProvider(db as never, "evt-1", target, provider as never, audit),
    ).rejects.toThrow("provider down");
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
