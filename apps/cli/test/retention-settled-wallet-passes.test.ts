import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@admitto/db";
import { querySystemLogs, resetSystemLogBufferForTest } from "@admitto/shared/system-log";
import { SETTLED_RECHECK_HORIZON_MS } from "@admitto/tickets";
import type { WalletPassProvider } from "@admitto/wallet";
import { recheckSettledWalletPassesOfEvents, type SettledRecheckDeps } from "../src/lib/retention-settled-wallet-passes.js";

type EventRow = { id: string; wallet_template_id: string | null; wallet_api_key_enc: string | null; wallet_field_mapping: unknown };

const eventRow = (id: string): EventRow => ({ id, wallet_template_id: `tmpl-${id}`, wallet_api_key_enc: `enc-${id}`, wallet_field_mapping: null });
const provider = { name: "provider" } as unknown as WalletPassProvider;
const NOW = 1_800_000_000_000;

describe("recheckSettledWalletPassesOfEvents", () => {
  let findMany: ReturnType<typeof vi.fn>;
  let db: PrismaClient;
  let recheck: ReturnType<typeof vi.fn>;
  let resolveProvider: ReturnType<typeof vi.fn>;
  let clock: number;
  let deps: SettledRecheckDeps;

  beforeEach(() => {
    resetSystemLogBufferForTest();
    clock = NOW;
    findMany = vi.fn(async () => [eventRow("evt-1"), eventRow("evt-2")]);
    db = { event: { findMany } } as unknown as PrismaClient;
    recheck = vi.fn(async () => ({ checked: 3, found: 0, failed: 0 }));
    resolveProvider = vi.fn(() => provider);
    deps = {
      resolveProvider: resolveProvider as SettledRecheckDeps["resolveProvider"],
      recheck: recheck as unknown as SettledRecheckDeps["recheck"],
      nowMs: () => clock,
    };
  });

  it("asks for the events that have an unrecorded pass of an erased attendee marked removed within the horizon", async () => {
    await recheckSettledWalletPassesOfEvents(db, { budgetMs: 60_000 }, deps);

    expect(findMany).toHaveBeenCalledWith({
      where: {
        attendees: {
          some: {
            erased_at: { not: null },
            wallet_pass: {
              is: {
                provider_pass_id: null,
                provider_removed_at: { gte: new Date(NOW - SETTLED_RECHECK_HORIZON_MS) },
                OR: [{ user_provided_id: { not: null } }, { status: "failed" }],
              },
            },
          },
        },
      },
      select: { id: true, wallet_template_id: true, wallet_api_key_enc: true, wallet_field_mapping: true },
      orderBy: { id: "asc" },
    });
  });

  it("looks again at each event with the provider of that event and what is left of the budget, and says nothing when all is well", async () => {
    deps.nowMs = () => {
      const now = clock;
      clock += 10_000;
      return now;
    };

    await recheckSettledWalletPassesOfEvents(db, { budgetMs: 60_000 }, deps);

    expect(resolveProvider).toHaveBeenNthCalledWith(1, eventRow("evt-1"));
    expect(resolveProvider).toHaveBeenNthCalledWith(2, eventRow("evt-2"));
    expect(recheck).toHaveBeenNthCalledWith(1, db, "evt-1", provider, { budgetMs: 50_000 });
    expect(recheck).toHaveBeenNthCalledWith(2, db, "evt-2", provider, { budgetMs: 40_000 });
    expect(querySystemLogs({ source: "wallet" })).toEqual([]);
  });

  it("warns once per event, with the event id and how many, when a pass turned up after the row was settled", async () => {
    recheck.mockResolvedValueOnce({ checked: 5, found: 2, failed: 0 });

    await recheckSettledWalletPassesOfEvents(db, { budgetMs: 60_000 }, deps);

    const logs = querySystemLogs({ source: "wallet" });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ level: "warn", message: "wallet_pass_found_after_settling", fields: { eventId: "evt-1", deleted: 2 } });
  });

  it("warns once per event, with the event id and how many, when the provider could not answer", async () => {
    recheck.mockResolvedValueOnce({ checked: 1, found: 0, failed: 4 });

    await recheckSettledWalletPassesOfEvents(db, { budgetMs: 60_000 }, deps);

    const logs = querySystemLogs({ source: "wallet" });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ level: "warn", message: "wallet_pass_recheck_failed", fields: { eventId: "evt-1", failed: 4 } });
  });

  it("skips an event whose credentials give no provider, and goes on with the next", async () => {
    resolveProvider.mockReturnValueOnce(null);

    await recheckSettledWalletPassesOfEvents(db, { budgetMs: 60_000 }, deps);

    expect(recheck).toHaveBeenCalledTimes(1);
    expect(recheck.mock.calls[0]![1]).toBe("evt-2");
  });

  it("stops before the next event once the time is used up", async () => {
    deps.nowMs = () => {
      const now = clock;
      clock += 45_000;
      return now;
    };

    await recheckSettledWalletPassesOfEvents(db, { budgetMs: 60_000 }, deps);

    expect(recheck).toHaveBeenCalledTimes(1);
    expect(recheck.mock.calls[0]![1]).toBe("evt-1");
  });

  it("does not even read the events when there is no time left", async () => {
    await recheckSettledWalletPassesOfEvents(db, { budgetMs: 0 }, deps);
    await recheckSettledWalletPassesOfEvents(db, { budgetMs: -5 }, deps);

    expect(findMany).not.toHaveBeenCalled();
    expect(recheck).not.toHaveBeenCalled();
  });
});
