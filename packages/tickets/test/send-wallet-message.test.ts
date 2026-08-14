import { describe, expect, it, vi } from "vitest";
import {
  loadWalletMessageTargets,
  sendWalletMessage,
  WALLET_MESSAGE_BULK_BATCH_SIZE,
} from "../src/send-wallet-message.js";

describe("loadWalletMessageTargets", () => {
  it("queries only active passes with a provider id, scoped to the event, and maps rows", async () => {
    const db = {
      walletPass: {
        findMany: vi.fn().mockResolvedValue([
          { attendee_id: "att-1", provider_pass_id: "pc-1" },
          { attendee_id: "att-2", provider_pass_id: "pc-2" },
        ]),
      },
    };

    const result = await loadWalletMessageTargets(db as never, "evt-1", ["att-1", "att-2", "att-3"]);

    expect(db.walletPass.findMany).toHaveBeenCalledWith({
      where: {
        attendee_id: { in: ["att-1", "att-2", "att-3"] },
        provider_pass_id: { not: null },
        status: "active",
        attendee: { event_id: "evt-1" },
      },
      select: { attendee_id: true, provider_pass_id: true },
    });
    expect(result).toEqual([
      { attendeeId: "att-1", providerPassId: "pc-1" },
      { attendeeId: "att-2", providerPassId: "pc-2" },
    ]);
  });

  it("returns an empty list when nothing matches", async () => {
    const db = { walletPass: { findMany: vi.fn().mockResolvedValue([]) } };
    const result = await loadWalletMessageTargets(db as never, "evt-1", ["att-gone"]);
    expect(result).toEqual([]);
  });
});

describe("sendWalletMessage", () => {
  it("sends one bulk call with every target's providerPassId when under the batch size, and reports it all as sent", async () => {
    const provider = { sendPushMessage: vi.fn().mockResolvedValue(undefined) };
    const targets = [
      { attendeeId: "att-1", providerPassId: "pc-1" },
      { attendeeId: "att-2", providerPassId: "pc-2" },
    ];

    const result = await sendWalletMessage(provider as never, targets, "Welcome!");

    expect(provider.sendPushMessage).toHaveBeenCalledTimes(1);
    expect(provider.sendPushMessage).toHaveBeenCalledWith(["pc-1", "pc-2"], "Welcome!");
    expect(result).toEqual({ sent: 2, errored: 0 });
  });

  it("does nothing and reports zero/zero when there are no targets - never calls the provider", async () => {
    const provider = { sendPushMessage: vi.fn() };

    const result = await sendWalletMessage(provider as never, [], "Welcome!");

    expect(provider.sendPushMessage).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: 0, errored: 0 });
  });

  it("splits into multiple sequential bulk calls once past WALLET_MESSAGE_BULK_BATCH_SIZE", async () => {
    const targets = Array.from({ length: WALLET_MESSAGE_BULK_BATCH_SIZE + 1 }, (_, i) => ({
      attendeeId: `att-${i}`,
      providerPassId: `pc-${i}`,
    }));
    const calls: string[][] = [];
    const provider = {
      sendPushMessage: vi.fn(async (ids: string[]) => {
        calls.push(ids);
      }),
    };

    const result = await sendWalletMessage(provider as never, targets, "Welcome!");

    expect(provider.sendPushMessage).toHaveBeenCalledTimes(2);
    expect(calls[0]).toHaveLength(WALLET_MESSAGE_BULK_BATCH_SIZE);
    expect(calls[1]).toHaveLength(1);
    expect(result).toEqual({ sent: WALLET_MESSAGE_BULK_BATCH_SIZE + 1, errored: 0 });
  });

  it("counts a failed batch as errored and keeps sending the remaining batches, instead of aborting the whole send", async () => {
    const targets = Array.from({ length: WALLET_MESSAGE_BULK_BATCH_SIZE + 1 }, (_, i) => ({
      attendeeId: `att-${i}`,
      providerPassId: `pc-${i}`,
    }));
    const provider = {
      sendPushMessage: vi
        .fn()
        .mockRejectedValueOnce(new Error("provider down"))
        .mockResolvedValueOnce(undefined),
    };

    const result = await sendWalletMessage(provider as never, targets, "Welcome!");

    // First batch (WALLET_MESSAGE_BULK_BATCH_SIZE targets) failed, second (1 target) succeeded -
    // a retry limited to the errored subset would not re-message the already-reached second
    // batch, unlike the previous all-or-nothing behavior.
    expect(provider.sendPushMessage).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ sent: 1, errored: WALLET_MESSAGE_BULK_BATCH_SIZE });
  });

  it("reports progress after every batch, success or failure, with the cumulative done count", async () => {
    const targets = Array.from({ length: WALLET_MESSAGE_BULK_BATCH_SIZE + 1 }, (_, i) => ({
      attendeeId: `att-${i}`,
      providerPassId: `pc-${i}`,
    }));
    const provider = {
      sendPushMessage: vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce(undefined),
    };
    const progress: number[] = [];

    await sendWalletMessage(provider as never, targets, "Welcome!", async (doneCount) => {
      progress.push(doneCount);
    });

    expect(progress).toEqual([WALLET_MESSAGE_BULK_BATCH_SIZE, WALLET_MESSAGE_BULK_BATCH_SIZE + 1]);
  });

  it("never calls onProgress when there are no targets", async () => {
    const provider = { sendPushMessage: vi.fn() };
    const onProgress = vi.fn();

    await sendWalletMessage(provider as never, [], "Welcome!", onProgress);

    expect(onProgress).not.toHaveBeenCalled();
  });
});
