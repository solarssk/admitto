import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@admitto/db";
import { querySystemLogs, resetSystemLogBufferForTest } from "@admitto/shared/system-log";
import { SETTLED_RECHECK_HORIZON_MS } from "@admitto/tickets";
import type { WalletPassProvider } from "@admitto/wallet";
import {
  RECHECK_CURSOR_KEY,
  recheckSettledWalletPassesOfEvents,
  type SettledRecheckDeps,
} from "../src/lib/retention-settled-wallet-passes.js";

type EventRow = { id: string; wallet_template_id: string | null; wallet_api_key_enc: string | null; wallet_field_mapping: unknown };

const eventRow = (id: string): EventRow => ({ id, wallet_template_id: `tmpl-${id}`, wallet_api_key_enc: `enc-${id}`, wallet_field_mapping: null });
const provider = { name: "provider" } as unknown as WalletPassProvider;
const NOW = 1_800_000_000_000;

/** What a second look answers when it got through the rows it was given, the last of which was `last`. */
const through = (last: string | null = "att-9") => ({ checked: 3, found: 0, failed: 0, incomplete: false, last });

describe("recheckSettledWalletPassesOfEvents", () => {
  let findMany: ReturnType<typeof vi.fn>;
  let countPasses: ReturnType<typeof vi.fn>;
  let db: PrismaClient;
  let recheck: ReturnType<typeof vi.fn>;
  let resolveProvider: ReturnType<typeof vi.fn>;
  let settings: { findUnique: ReturnType<typeof vi.fn>; upsert: ReturnType<typeof vi.fn>; deleteMany: ReturnType<typeof vi.fn> };
  let kept: { value_json: string } | null;
  let clock: number;
  let deps: SettledRecheckDeps;

  /** The place the previous run kept, as it is stored. */
  const keptPlace = (eventId: string, attendeeId: string) => {
    kept = { value_json: JSON.stringify({ eventId, attendeeId }) };
  };
  const placeWritten = (eventId: string, attendeeId: string) => ({
    where: { key: RECHECK_CURSOR_KEY },
    create: { key: RECHECK_CURSOR_KEY, value_json: JSON.stringify({ eventId, attendeeId }) },
    update: { value_json: JSON.stringify({ eventId, attendeeId }) },
  });

  beforeEach(() => {
    resetSystemLogBufferForTest();
    clock = NOW;
    kept = null;
    findMany = vi.fn(async () => [eventRow("evt-1"), eventRow("evt-2")]);
    settings = {
      findUnique: vi.fn(async () => kept),
      upsert: vi.fn(async () => undefined),
      deleteMany: vi.fn(async () => ({ count: 1 })),
    };
    countPasses = vi.fn(async () => 4);
    db = { event: { findMany }, systemSettings: settings, walletPass: { count: countPasses } } as unknown as PrismaClient;
    recheck = vi.fn(async () => through());
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
    recheck.mockResolvedValueOnce({ ...through(), checked: 5, found: 2 });

    await recheckSettledWalletPassesOfEvents(db, { budgetMs: 60_000 }, deps);

    const logs = querySystemLogs({ source: "wallet" });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ level: "warn", message: "wallet_pass_found_after_settling", fields: { eventId: "evt-1", deleted: 2 } });
  });

  it("warns once per event, with the event id and how many, when the provider could not answer", async () => {
    recheck.mockResolvedValueOnce({ ...through(), checked: 1, failed: 4 });

    await recheckSettledWalletPassesOfEvents(db, { budgetMs: 60_000 }, deps);

    const logs = querySystemLogs({ source: "wallet" });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ level: "warn", message: "wallet_pass_recheck_failed", fields: { eventId: "evt-1", failed: 4 } });
  });

  it("warns once per event, with the event id, when the run was cut short (a full page, or no time left)", async () => {
    recheck.mockResolvedValueOnce({ ...through(), checked: 1000, incomplete: true });

    await recheckSettledWalletPassesOfEvents(db, { budgetMs: 60_000 }, deps);

    const logs = querySystemLogs({ source: "wallet" });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ level: "warn", message: "wallet_pass_recheck_incomplete", fields: { eventId: "evt-1" } });
  });

  it("skips an event whose credentials give no provider, says so with the event id and how many settled rows it leaves unasked, and goes on with the next", async () => {
    resolveProvider.mockReturnValueOnce(null);

    await recheckSettledWalletPassesOfEvents(db, { budgetMs: 60_000 }, deps);

    expect(recheck).toHaveBeenCalledTimes(1);
    expect(recheck.mock.calls[0]![1]).toBe("evt-2");
    // Nothing else looks at these rows: the walk over pending passes reports only events that have pending passes.
    const logs = querySystemLogs({ source: "wallet" });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ level: "warn", message: "wallet_pass_recheck_no_provider", fields: { eventId: "evt-1", settled: 4 } });
    expect(countPasses).toHaveBeenCalledTimes(1);
    expect(countPasses).toHaveBeenCalledWith({
      where: {
        provider_pass_id: null,
        provider_removed_at: { gte: new Date(NOW - SETTLED_RECHECK_HORIZON_MS) },
        OR: [{ user_provided_id: { not: null } }, { status: "failed" }],
        attendee: { event_id: "evt-1", erased_at: { not: null } },
      },
    });
  });

  it("says it once per event, although the walk would have visited the event twice (the part after the kept place and the part before it)", async () => {
    resolveProvider.mockImplementation((event: EventRow) => (event.id === "evt-2" ? null : provider));
    keptPlace("evt-2", "att-5");

    await recheckSettledWalletPassesOfEvents(db, { budgetMs: 60_000 }, deps);

    expect(resolveProvider).toHaveBeenCalledTimes(2);
    expect(recheck.mock.calls.map((call) => call[1])).toEqual(["evt-1"]);
    expect(querySystemLogs({ search: "wallet_pass_recheck_no_provider" })).toHaveLength(1);
  });

  it("says it for every event without a provider, and asks about none", async () => {
    resolveProvider.mockReturnValue(null);

    await recheckSettledWalletPassesOfEvents(db, { budgetMs: 60_000 }, deps);

    expect(recheck).not.toHaveBeenCalled();
    const logs = querySystemLogs({ search: "wallet_pass_recheck_no_provider" });
    expect(logs.map((entry) => entry.fields?.eventId).sort()).toEqual(["evt-1", "evt-2"]);
    // Nothing was asked, so a place that was kept stays as it was.
    expect(settings.upsert).not.toHaveBeenCalled();
    expect(settings.deleteMany).not.toHaveBeenCalled();
  });

  it("says nothing about an event that has a provider", async () => {
    await recheckSettledWalletPassesOfEvents(db, { budgetMs: 60_000 }, deps);

    expect(countPasses).not.toHaveBeenCalled();
    expect(querySystemLogs({ search: "wallet_pass_recheck_no_provider" })).toEqual([]);
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
    // What it did get through is not asked about again first thing tomorrow.
    expect(settings.upsert).toHaveBeenCalledWith(placeWritten("evt-1", "att-9"));
  });

  it("does not even read the events when there is no time left", async () => {
    await recheckSettledWalletPassesOfEvents(db, { budgetMs: 0 }, deps);
    await recheckSettledWalletPassesOfEvents(db, { budgetMs: -5 }, deps);

    expect(findMany).not.toHaveBeenCalled();
    expect(recheck).not.toHaveBeenCalled();
  });

  it("starts where the last run that was cut short stopped, and wraps round to the part it had not reached", async () => {
    findMany.mockResolvedValue([eventRow("evt-1"), eventRow("evt-2"), eventRow("evt-3")]);
    keptPlace("evt-2", "att-5");

    await recheckSettledWalletPassesOfEvents(db, { budgetMs: 60_000 }, deps);

    expect(settings.findUnique).toHaveBeenCalledWith({ where: { key: RECHECK_CURSOR_KEY } });
    expect(recheck.mock.calls.map((call) => [call[1], call[3]])).toEqual([
      ["evt-2", { budgetMs: 60_000, after: "att-5" }],
      ["evt-3", { budgetMs: 60_000 }],
      ["evt-1", { budgetMs: 60_000 }],
      ["evt-2", { budgetMs: 60_000, upTo: "att-5" }],
    ]);
  });

  it("starts from the beginning when the kept place is not readable", async () => {
    kept = { value_json: "not json" };

    await recheckSettledWalletPassesOfEvents(db, { budgetMs: 60_000 }, deps);

    expect(recheck.mock.calls.map((call) => [call[1], call[3]])).toEqual([
      ["evt-1", { budgetMs: 60_000 }],
      ["evt-2", { budgetMs: 60_000 }],
    ]);
  });

  it("keeps the place of the last row it asked about, and asks no further, when an event has more rows than one page or the time ran out in it", async () => {
    findMany.mockResolvedValue([eventRow("evt-1"), eventRow("evt-2"), eventRow("evt-3")]);
    recheck.mockResolvedValueOnce(through("att-3"));
    recheck.mockResolvedValueOnce({ ...through("att-7"), incomplete: true });

    await recheckSettledWalletPassesOfEvents(db, { budgetMs: 60_000 }, deps);

    expect(recheck.mock.calls.map((call) => call[1])).toEqual(["evt-1", "evt-2"]);
    expect(settings.upsert).toHaveBeenCalledTimes(1);
    expect(settings.upsert).toHaveBeenCalledWith(placeWritten("evt-2", "att-7"));
    expect(settings.deleteMany).not.toHaveBeenCalled();
  });

  it("forgets the place when a run got through every event, so the next one starts from the beginning", async () => {
    keptPlace("evt-1", "att-2");

    await recheckSettledWalletPassesOfEvents(db, { budgetMs: 60_000 }, deps);

    expect(settings.deleteMany).toHaveBeenCalledWith({ where: { key: RECHECK_CURSOR_KEY } });
    expect(settings.upsert).not.toHaveBeenCalled();
  });

  it("writes nothing when a run that kept no place got through everything", async () => {
    await recheckSettledWalletPassesOfEvents(db, { budgetMs: 60_000 }, deps);

    expect(settings.upsert).not.toHaveBeenCalled();
    expect(settings.deleteMany).not.toHaveBeenCalled();
  });

  it("leaves the kept place as it was when the time was gone before it asked about anything", async () => {
    keptPlace("evt-1", "att-2");
    deps.nowMs = () => {
      const now = clock;
      clock += 30_000;
      return now;
    };

    await recheckSettledWalletPassesOfEvents(db, { budgetMs: 20_000 }, deps);

    expect(recheck).not.toHaveBeenCalled();
    expect(settings.upsert).not.toHaveBeenCalled();
    expect(settings.deleteMany).not.toHaveBeenCalled();
  });

  it("does not move the place for an event it skipped, and finishes when the place cannot be saved, saying so", async () => {
    findMany.mockResolvedValue([eventRow("evt-1"), eventRow("evt-2"), eventRow("evt-3")]);
    resolveProvider.mockReturnValueOnce(null);
    recheck.mockResolvedValueOnce(through("att-4"));
    recheck.mockResolvedValueOnce({ ...through("att-8"), incomplete: true });
    settings.upsert.mockRejectedValue(new Error("settings table is locked"));

    await recheckSettledWalletPassesOfEvents(db, { budgetMs: 60_000 }, deps);

    expect(recheck.mock.calls.map((call) => call[1])).toEqual(["evt-2", "evt-3"]);
    expect(settings.upsert).toHaveBeenCalledWith(placeWritten("evt-3", "att-8"));
    expect(querySystemLogs({ search: "wallet_pass_sweep_cursor_not_saved" })).toHaveLength(1);
  });
});
