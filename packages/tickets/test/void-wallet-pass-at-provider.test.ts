import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/ops-audit.js", () => ({ writeActionLog: vi.fn() }));

import { writeActionLog } from "../src/ops-audit.js";
import { voidOneWalletPassAtProvider } from "../src/void-wallet-pass-at-provider.js";

const audit = { operator: "user-1", sessionId: "sess-1" };
const target = { attendeeId: "att-1", providerPassId: "pc-1", status: "active", providerRemovedAt: null };

describe("voidOneWalletPassAtProvider", () => {
  const provider = { voidPass: vi.fn() };
  const txUpdateMany = vi.fn();
  const db = {
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({ walletPass: { updateMany: txUpdateMany } })),
  };

  beforeEach(() => {
    provider.voidPass.mockReset().mockResolvedValue(undefined);
    txUpdateMany.mockReset().mockResolvedValue({ count: 1 });
    vi.mocked(writeActionLog).mockReset().mockResolvedValue(undefined);
  });

  it("voids the pass at the provider, marks the row voided (only while not removed) and logs it", async () => {
    const result = await voidOneWalletPassAtProvider(db as never, "evt-1", target, provider as never, audit);

    expect(result).toBe("voided");
    expect(provider.voidPass).toHaveBeenCalledWith("pc-1");
    expect(txUpdateMany).toHaveBeenCalledWith({
      where: { attendee_id: "att-1", provider_removed_at: null },
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

  it("skips, logging nothing, when the pass was removed while the provider call was in flight", async () => {
    txUpdateMany.mockResolvedValue({ count: 0 });

    const result = await voidOneWalletPassAtProvider(db as never, "evt-1", target, provider as never, audit);

    expect(result).toBe("skipped");
    expect(writeActionLog).not.toHaveBeenCalled();
  });

  it("propagates a provider failure and writes nothing locally", async () => {
    provider.voidPass.mockRejectedValue(new Error("provider down"));

    await expect(
      voidOneWalletPassAtProvider(db as never, "evt-1", target, provider as never, audit),
    ).rejects.toThrow("provider down");
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
