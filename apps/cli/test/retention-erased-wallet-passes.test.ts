import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@admitto/db";
import { querySystemLogs, resetSystemLogBufferForTest } from "@admitto/shared/system-log";
import type { WalletPassProvider } from "@admitto/wallet";
import {
  erasedWalletPassesLeft,
  sweepErasedWalletPasses,
  type ErasedWalletSweepDeps,
} from "../src/lib/retention-erased-wallet-passes.js";

type Pass = { attendee_id: string; event_id: string; removed: boolean };
type EventRow = { id: string; wallet_template_id: string | null; wallet_api_key_enc: string | null; wallet_field_mapping: unknown };

type Where = { attendee: { event_id: string }; attendee_id?: { gt?: string; lte?: string } };

const eventRow = (id: string, credentials = true): EventRow => ({
  id,
  wallet_template_id: credentials ? `tmpl-${id}` : null,
  wallet_api_key_enc: credentials ? `enc-${id}` : null,
  wallet_field_mapping: null,
});
const passesOf = (eventId: string, count: number, from = 0): Pass[] =>
  Array.from({ length: count }, (_, i) => ({
    attendee_id: `${eventId}-att-${String(from + i).padStart(4, "0")}`,
    event_id: eventId,
    removed: false,
  }));

/** Just enough of the database for the sweep's queries, over passes in memory (every pass here is of an erased attendee). */
function fakeDb(events: EventRow[], passes: Pass[], settings = new Map<string, string>()): PrismaClient {
  const pending = (eventId: string) => passes.filter((pass) => pass.event_id === eventId && !pass.removed);
  let reads = 0;
  return {
    // The place a sweep that ran out of time keeps (a SystemSettings row).
    systemSettings: {
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) =>
        settings.has(where.key) ? { key: where.key, value_json: settings.get(where.key)! } : null,
      ),
      upsert: vi.fn(async ({ where, update }: { where: { key: string }; update: { value_json: string } }) => {
        settings.set(where.key, update.value_json);
        return {};
      }),
      deleteMany: vi.fn(async ({ where }: { where: { key: string } }) => ({ count: settings.delete(where.key) ? 1 : 0 })),
    },
    event: {
      findMany: vi.fn(async () => events.filter((event) => pending(event.id).length > 0)),
    },
    walletPass: {
      count: vi.fn(async ({ where }: { where: Where }) => pending(where.attendee.event_id).length),
      findMany: vi.fn(async ({ where, take }: { where: Where; take: number }) => {
        // No honest walk reads this many pages: a loop that does not advance fails here instead of hanging the suite.
        if (++reads > 50) throw new Error("the walk does not advance");
        const after = where.attendee_id?.gt;
        const upTo = where.attendee_id?.lte;
        return pending(where.attendee.event_id)
          .filter((pass) => (after === undefined || pass.attendee_id > after) && (upTo === undefined || pass.attendee_id <= upTo))
          .sort((a, b) => a.attendee_id.localeCompare(b.attendee_id))
          .slice(0, take)
          .map((pass) => ({ attendee_id: pass.attendee_id }));
      }),
    },
  } as unknown as PrismaClient;
}

const provider = { name: "provider" } as unknown as WalletPassProvider;

describe("sweepErasedWalletPasses", () => {
  let passes: Pass[];
  let deletePasses: ReturnType<typeof vi.fn>;
  let resolveProvider: ReturnType<typeof vi.fn>;
  let clock: number;
  let deps: ErasedWalletSweepDeps;

  beforeEach(() => {
    resetSystemLogBufferForTest();
    passes = [];
    clock = 0;
    // Deletes every attendee it is given, and marks their passes as removed like the real one does.
    deletePasses = vi.fn(async (_db: unknown, _eventId: string, attendeeIds: string[]) => {
      for (const pass of passes) if (attendeeIds.includes(pass.attendee_id)) pass.removed = true;
      return { deleted: attendeeIds.length, failedAttendeeIds: [], failureCodes: [], notTried: 0 };
    });
    resolveProvider = vi.fn(() => provider);
    deps = {
      resolveProvider: resolveProvider as ErasedWalletSweepDeps["resolveProvider"],
      deletePasses: deletePasses as unknown as ErasedWalletSweepDeps["deletePasses"],
      nowMs: () => clock,
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does nothing when no erased attendee has a pass left at the provider", async () => {
    const db = fakeDb([eventRow("evt-1")], passes);

    const result = await sweepErasedWalletPasses(db, { dryRun: false }, deps);

    expect(result).toEqual({ pending: 0, deleted: 0, failed: 0, noProvider: 0, notTried: 0 });
    expect(resolveProvider).not.toHaveBeenCalled();
    expect(deletePasses).not.toHaveBeenCalled();
  });

  it("deletes the pending passes of each event with the provider of that event, and counts them", async () => {
    passes.push(...passesOf("evt-1", 3), ...passesOf("evt-2", 2));
    const events = [eventRow("evt-1"), eventRow("evt-2")];

    const result = await sweepErasedWalletPasses(fakeDb(events, passes), { dryRun: false }, deps);

    expect(result).toEqual({ pending: 5, deleted: 5, failed: 0, noProvider: 0, notTried: 0 });
    expect(resolveProvider).toHaveBeenNthCalledWith(1, events[0]);
    expect(resolveProvider).toHaveBeenNthCalledWith(2, events[1]);
    expect(deletePasses).toHaveBeenCalledTimes(2);
    expect(deletePasses).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      "evt-1",
      ["evt-1-att-0000", "evt-1-att-0001", "evt-1-att-0002"],
      provider,
      { budgetMs: 60_000 },
    );
    expect(deletePasses).toHaveBeenNthCalledWith(2, expect.anything(), "evt-2", ["evt-2-att-0000", "evt-2-att-0001"], provider, {
      budgetMs: 60_000,
    });
    expect(passes.every((pass) => pass.removed)).toBe(true);
  });

  it("asks only for passes that are still at the provider, of attendees who were erased, event by event", async () => {
    passes.push(...passesOf("evt-1", 2));
    const db = fakeDb([eventRow("evt-1")], passes);

    await sweepErasedWalletPasses(db, { dryRun: false }, deps);

    // What it asks for is what stands between a pass and its deletion: a live attendee's pass must never match.
    const pending = {
      provider_pass_id: { not: null },
      provider_removed_at: null,
      attendee: { event_id: "evt-1", erased_at: { not: null } },
    };
    expect(db.event.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          attendees: {
            some: {
              erased_at: { not: null },
              wallet_pass: { is: { provider_pass_id: { not: null }, provider_removed_at: null } },
            },
          },
        },
        orderBy: { id: "asc" },
      }),
    );
    expect(db.walletPass.count).toHaveBeenCalledWith({ where: pending });
    // By attendee id, a page at a time: the order is what lets the cursor move past passes that stay.
    expect(db.walletPass.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: pending, orderBy: { attendee_id: "asc" }, take: 100 }),
    );
  });

  it("counts, and leaves alone, the passes of an event it has no credentials for, and carries on with the others", async () => {
    passes.push(...passesOf("evt-1", 2), ...passesOf("evt-2", 1));
    resolveProvider.mockImplementation((event: EventRow) => (event.id === "evt-1" ? null : provider));

    const result = await sweepErasedWalletPasses(
      fakeDb([eventRow("evt-1", false), eventRow("evt-2")], passes),
      { dryRun: false },
      deps,
    );

    expect(result).toEqual({ pending: 3, deleted: 1, failed: 0, noProvider: 2, notTried: 0 });
    expect(deletePasses).toHaveBeenCalledTimes(1);
    expect(deletePasses).toHaveBeenCalledWith(expect.anything(), "evt-2", ["evt-2-att-0000"], provider, expect.anything());
    expect(erasedWalletPassesLeft(result)).toBe(2);
  });

  it("only counts what is pending in a dry run, and calls nothing", async () => {
    passes.push(...passesOf("evt-1", 4), ...passesOf("evt-2", 1));

    const result = await sweepErasedWalletPasses(
      fakeDb([eventRow("evt-1"), eventRow("evt-2")], passes),
      { dryRun: true },
      deps,
    );

    expect(result).toEqual({ pending: 5, deleted: 0, failed: 0, noProvider: 0, notTried: 0 });
    expect(resolveProvider).not.toHaveBeenCalled();
    expect(deletePasses).not.toHaveBeenCalled();
    expect(passes.some((pass) => pass.removed)).toBe(false);
  });

  it("counts the passes the provider could not delete, and logs each by attendee id with the failure codes", async () => {
    passes.push(...passesOf("evt-1", 3));
    deletePasses.mockResolvedValueOnce({
      deleted: 1,
      failedAttendeeIds: ["evt-1-att-0001", "evt-1-att-0002"],
      failureCodes: ["wallet_unauthorized", "unknown"],
      notTried: 0,
    });

    const result = await sweepErasedWalletPasses(fakeDb([eventRow("evt-1")], passes), { dryRun: false }, deps);

    expect(result).toEqual({ pending: 3, deleted: 1, failed: 2, noProvider: 0, notTried: 0 });
    expect(erasedWalletPassesLeft(result)).toBe(2);
    const logged = querySystemLogs({ search: "wallet_pass_erasure_delete_failed" });
    expect(logged.map((entry) => ({ level: entry.level, source: entry.source, fields: entry.fields }))).toEqual([
      {
        level: "error",
        source: "wallet",
        fields: { eventId: "evt-1", attendeeId: "evt-1-att-0001", codes: "wallet_unauthorized,unknown" },
      },
      {
        level: "error",
        source: "wallet",
        fields: { eventId: "evt-1", attendeeId: "evt-1-att-0002", codes: "wallet_unauthorized,unknown" },
      },
    ]);
  });

  it("reads the passes a page at a time, in attendee id order, and moves past passes that stay", async () => {
    passes.push(...passesOf("evt-1", 250));
    // Nothing is ever deleted: the passes stay pending, so only the cursor can end the walk.
    deletePasses.mockImplementation(async (_db: unknown, _eventId: string, attendeeIds: string[]) => ({
      deleted: 0,
      failedAttendeeIds: attendeeIds,
      failureCodes: ["unknown"],
      notTried: 0,
    }));

    const result = await sweepErasedWalletPasses(fakeDb([eventRow("evt-1")], passes), { dryRun: false }, deps);

    expect(result).toEqual({ pending: 250, deleted: 0, failed: 250, noProvider: 0, notTried: 0 });
    const pages = deletePasses.mock.calls.map((call) => (call[2] as string[]).length);
    expect(pages).toEqual([100, 100, 50]);
    const tried = deletePasses.mock.calls.flatMap((call) => call[2] as string[]);
    expect(tried).toEqual([...tried].sort());
    expect(new Set(tried).size).toBe(250);
  });

  it("gives each page what is left of the time budget, and stops, counting the rest, when it is gone", async () => {
    passes.push(...passesOf("evt-1", 250), ...passesOf("evt-2", 5));
    // The clock moves 45 s with every look: the first page still has 15 s of a 60 s budget, the second has none.
    deps.nowMs = () => {
      const now = clock;
      clock += 45_000;
      return now;
    };

    const result = await sweepErasedWalletPasses(
      fakeDb([eventRow("evt-1"), eventRow("evt-2")], passes),
      { dryRun: false },
      deps,
    );

    expect(deletePasses).toHaveBeenCalledTimes(1);
    expect(deletePasses.mock.calls[0]![4]).toEqual({ budgetMs: 15_000 });
    expect(result).toEqual({ pending: 255, deleted: 100, failed: 0, noProvider: 0, notTried: 155 });
    expect(erasedWalletPassesLeft(result)).toBe(155);
  });

  it("stops when a page reports passes it did not get to, and counts them as not tried", async () => {
    passes.push(...passesOf("evt-1", 4));
    deletePasses.mockResolvedValueOnce({ deleted: 1, failedAttendeeIds: ["evt-1-att-0001"], failureCodes: ["unknown"], notTried: 2 });

    const result = await sweepErasedWalletPasses(fakeDb([eventRow("evt-1")], passes), { dryRun: false }, deps);

    expect(deletePasses).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ pending: 4, deleted: 1, failed: 1, noProvider: 0, notTried: 2 });
  });

  it("stops at once when the budget is nothing", async () => {
    passes.push(...passesOf("evt-1", 2));

    const result = await sweepErasedWalletPasses(fakeDb([eventRow("evt-1")], passes), { dryRun: false, budgetMs: 0 }, deps);

    expect(deletePasses).not.toHaveBeenCalled();
    expect(result).toEqual({ pending: 2, deleted: 0, failed: 0, noProvider: 0, notTried: 2 });
  });

  it("lets a failure of the database reach the caller, so the retention job reports it", async () => {
    passes.push(...passesOf("evt-1", 1));
    deletePasses.mockRejectedValueOnce(new Error("db down"));

    await expect(sweepErasedWalletPasses(fakeDb([eventRow("evt-1")], passes), { dryRun: false }, deps)).rejects.toThrow("db down");
  });

  it("says which event has no wallet credentials, with its id and how many passes wait, since the summary only counts", async () => {
    passes.push(...passesOf("evt-1", 2), ...passesOf("evt-2", 1));
    resolveProvider.mockImplementation((event: EventRow) => (event.id === "evt-1" ? null : provider));

    await sweepErasedWalletPasses(fakeDb([eventRow("evt-1", false), eventRow("evt-2")], passes), { dryRun: false }, deps);

    const logged = querySystemLogs({ search: "wallet_pass_erasure_no_provider" });
    expect(logged.map((entry) => ({ level: entry.level, source: entry.source, fields: entry.fields }))).toEqual([
      { level: "warn", source: "wallet", fields: { eventId: "evt-1", pending: 2 } },
    ]);
  });

  describe("when the budget runs out", () => {
    const settings = () => new Map<string, string>();
    const cursorOf = (store: Map<string, string>) => JSON.parse(store.get("retention.erased_wallet_sweep_cursor") ?? "null");
    /**
     * A deleteErasedWalletPasses with a budget of `budget.left` passes for the whole sweep: it tries that many of a page
     * (in id order) and reports the rest as not tried, like the real one does when its time is up.
     */
    const budget = { left: 0 };
    const withBudget = (failing: boolean) =>
      vi.fn(async (_db: unknown, _eventId: string, attendeeIds: string[]) => {
        const tried = attendeeIds.slice(0, budget.left);
        budget.left -= tried.length;
        if (!failing) for (const pass of passes) if (tried.includes(pass.attendee_id)) pass.removed = true;
        return {
          deleted: failing ? 0 : tried.length,
          failedAttendeeIds: failing ? tried : [],
          failureCodes: failing ? ["unknown"] : [],
          notTried: attendeeIds.length - tried.length,
        };
      });
    const use = (fn: ReturnType<typeof vi.fn>) => {
      deps.deletePasses = fn as unknown as ErasedWalletSweepDeps["deletePasses"];
      return fn;
    };
    const triedBy = (fn: ReturnType<typeof vi.fn>) => fn.mock.results.length;

    it("keeps the place where it stopped, and the next sweep goes on after it, and wraps round to the start", async () => {
      passes.push(...passesOf("evt-1", 5), ...passesOf("evt-2", 3));
      const store = settings();
      const events = [eventRow("evt-1"), eventRow("evt-2")];
      budget.left = 2;
      use(withBudget(false));

      const first = await sweepErasedWalletPasses(fakeDb(events, passes, store), { dryRun: false }, deps);

      expect(first.notTried).toBe(6);
      expect(cursorOf(store)).toEqual({ eventId: "evt-1", attendeeId: "evt-1-att-0001" });

      // The second sweep has all the time it needs: it starts after the place, goes through the rest and then the start.
      budget.left = 100;
      const second = use(withBudget(false));
      const result = await sweepErasedWalletPasses(fakeDb(events, passes, store), { dryRun: false }, deps);

      expect(second.mock.calls.map((call) => [call[1], call[2]])).toEqual([
        ["evt-1", ["evt-1-att-0002", "evt-1-att-0003", "evt-1-att-0004"]],
        ["evt-2", ["evt-2-att-0000", "evt-2-att-0001", "evt-2-att-0002"]],
      ]);
      expect(result).toMatchObject({ deleted: 6, notTried: 0 });
      // Two passes of the start were done by the first sweep, so nothing is left there; the sweep got through everything.
      expect(store.has("retention.erased_wallet_sweep_cursor")).toBe(false);
    });

    it("reaches every pass in the end when the passes at the start keep failing, instead of trying the same few again", async () => {
      passes.push(...passesOf("evt-1", 6));
      const store = settings();
      const events = [eventRow("evt-1")];
      const fn = use(withBudget(true));

      const tried: string[] = [];
      for (let run = 0; run < 3; run += 1) {
        budget.left = 2;
        const before = triedBy(fn);
        await sweepErasedWalletPasses(fakeDb(events, passes, store), { dryRun: false }, deps);
        tried.push(...(await Promise.all(fn.mock.results.slice(before).map((r) => r.value as Promise<{ failedAttendeeIds: string[] }>))).flatMap((r) => r.failedAttendeeIds));
      }

      // Two a sweep, and every sweep starts after the last: six different passes in three sweeps, none of them twice.
      expect(tried).toEqual(["evt-1-att-0000", "evt-1-att-0001", "evt-1-att-0002", "evt-1-att-0003", "evt-1-att-0004", "evt-1-att-0005"]);
    });

    it("comes back to the start after the end, up to the place it began at, and no further", async () => {
      passes.push(...passesOf("evt-1", 4));
      const store = new Map([["retention.erased_wallet_sweep_cursor", JSON.stringify({ eventId: "evt-1", attendeeId: "evt-1-att-0001" })]]);
      budget.left = 100;
      const fn = use(withBudget(true));

      const result = await sweepErasedWalletPasses(fakeDb([eventRow("evt-1")], passes, store), { dryRun: false }, deps);

      expect(fn.mock.calls.map((call) => call[2])).toEqual([
        ["evt-1-att-0002", "evt-1-att-0003"],
        ["evt-1-att-0000", "evt-1-att-0001"],
      ]);
      expect(result).toMatchObject({ failed: 4, notTried: 0 });
    });

    it("gives the events after the one that used the time a turn, not only the first one", async () => {
      passes.push(...passesOf("evt-1", 4), ...passesOf("evt-2", 2));
      const store = settings();
      const events = [eventRow("evt-1"), eventRow("evt-2")];
      // The first event takes the whole budget: 4 passes tried, all failing, and nothing is left for the second.
      budget.left = 4;
      use(withBudget(true));
      await sweepErasedWalletPasses(fakeDb(events, passes, store), { dryRun: false }, deps);
      expect(cursorOf(store)).toEqual({ eventId: "evt-1", attendeeId: "evt-1-att-0003" });

      budget.left = 100;
      const seen = use(withBudget(false));
      await sweepErasedWalletPasses(fakeDb(events, passes, store), { dryRun: false }, deps);

      // The second sweep starts with the second event, which the first one never reached.
      expect(seen.mock.calls[0]!.slice(1, 3)).toEqual(["evt-2", ["evt-2-att-0000", "evt-2-att-0001"]]);
    });

    it("keeps the old place when it could not try anything, and does not touch it in a dry run", async () => {
      passes.push(...passesOf("evt-1", 3));
      const store = new Map([["retention.erased_wallet_sweep_cursor", JSON.stringify({ eventId: "evt-1", attendeeId: "evt-1-att-0000" })]]);

      await sweepErasedWalletPasses(fakeDb([eventRow("evt-1")], passes, store), { dryRun: false, budgetMs: 0 }, deps);
      expect(cursorOf(store)).toEqual({ eventId: "evt-1", attendeeId: "evt-1-att-0000" });

      const db = fakeDb([eventRow("evt-1")], passes, store);
      await sweepErasedWalletPasses(db, { dryRun: true }, deps);
      expect(db.systemSettings.findUnique).not.toHaveBeenCalled();
      expect(db.systemSettings.upsert).not.toHaveBeenCalled();
      expect(db.systemSettings.deleteMany).not.toHaveBeenCalled();
    });

    it("starts from the beginning when the place it kept is not readable, and carries on when it cannot keep one", async () => {
      passes.push(...passesOf("evt-1", 3));
      const db = fakeDb([eventRow("evt-1")], passes, new Map([["retention.erased_wallet_sweep_cursor", "not json"]]));
      budget.left = 1;
      const fn = use(withBudget(false));
      vi.mocked(db.systemSettings.upsert).mockRejectedValueOnce(new Error("db hiccup"));

      const result = await sweepErasedWalletPasses(db, { dryRun: false }, deps);

      expect(fn.mock.calls[0]![2]).toEqual(["evt-1-att-0000", "evt-1-att-0001", "evt-1-att-0002"]);
      expect(result.deleted).toBe(1);
      expect(querySystemLogs({ search: "wallet_pass_sweep_cursor_not_saved" })).toHaveLength(1);
    });
  });

  it("with its own provider lookup and clock, counts an event that has no wallet credentials", async () => {
    passes.push(...passesOf("evt-1", 2));

    const result = await sweepErasedWalletPasses(fakeDb([eventRow("evt-1", false)], passes), { dryRun: false });

    expect(result).toEqual({ pending: 2, deleted: 0, failed: 0, noProvider: 2, notTried: 0 });
  });
});
