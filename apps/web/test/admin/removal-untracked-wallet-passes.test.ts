/**
 * The wallet passes of removed attendees whose rows hold no provider id (only the id reserved for the pass, or a failed
 * creation with no id): which rows are asked about, what the provider is asked, how many calls run at once, and what is
 * said, once, when passes are still at the provider. The provider is a stand-in: no call leaves the process.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { querySystemLogs, resetSystemLogBufferForTest } from "@admitto/shared/system-log";
import { PASS_ROW_STILL_AT_PROVIDER, type RemoveUntrackedWalletTarget } from "@admitto/tickets";
import { WalletProviderError, type WalletPassProvider } from "@admitto/wallet";

const resolveConfiguredWalletProvider = vi.fn();
vi.mock("@admitto/wallet", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@admitto/wallet")>();
  return {
    ...actual,
    resolveConfiguredWalletProvider: (...args: unknown[]) => resolveConfiguredWalletProvider(...args),
  };
});

import {
  deleteUntrackedPassesAfterRemoval,
  deleteUntrackedPassesAtProvider,
  deleteUntrackedProviderPassesBestEffort,
  deleteUntrackedWalletPassesBestEffort,
  type UntrackedDeleteOutcome,
} from "../../src/admin/attendees-api-routes.js";

const EVENT_ID = "evt-untracked";
const CREDENTIALS = { wallet_template_id: "tmpl-1", wallet_api_key_enc: "enc-key", wallet_field_mapping: null };
/** The number of calls one batch of deletes makes at once: BULK_CHECKIN_CONCURRENCY, which deleteProviderPassesBestEffort uses too. */
const BATCH = 10;

type StandIn = WalletPassProvider & { deletePass: ReturnType<typeof vi.fn>; deletePassByUserProvidedId: ReturnType<typeof vi.fn> };

/** A provider that answers a delete by id with whether it held a pass (true) or not (false). `answerOf` is told which call
 * of that id it is answering, from 0: by default the provider holds none, so each id costs one call. */
function standIn(answerOf: (id: string, call: number) => boolean | Promise<boolean> = () => false): StandIn {
  const calls = new Map<string, number>();
  return {
    deletePass: vi.fn(async () => undefined),
    deletePassByUserProvidedId: vi.fn(async (id: string) => {
      const call = calls.get(id) ?? 0;
      calls.set(id, call + 1);
      return answerOf(id, call);
    }),
  } as unknown as StandIn;
}

/** A provider that holds `count` passes under each of the ids given (it answers true that many times, then false). */
const holding = (count: number, ...ids: string[]) => (id: string, call: number) => ids.includes(id) && call < count;

/** How many times each id was asked about, whatever the order the calls ran in. */
const askedPerId = (provider: StandIn) => {
  const asked: Record<string, number> = {};
  for (const [id] of provider.deletePassByUserProvidedId.mock.calls) asked[String(id)] = (asked[String(id)] ?? 0) + 1;
  return asked;
};

function fakeDb(options: { event?: unknown; rows?: unknown[] } = {}) {
  return {
    event: { findUnique: vi.fn(async () => (options.event === undefined ? CREDENTIALS : options.event)) },
    walletPass: { findMany: vi.fn(async () => options.rows ?? []) },
  };
}

const targets = (count: number): RemoveUntrackedWalletTarget[] =>
  Array.from({ length: count }, (_, index) => ({ attendeeId: `att-${index}`, userProvidedId: `reserved-${index}` }));

/** Targets whose ids are the usual ones, `admitto:<event id>:<attendee id>`, which the attendee ids already give. */
const usualTargets = (count: number): RemoveUntrackedWalletTarget[] =>
  Array.from({ length: count }, (_, index) => ({ attendeeId: `att-${index}`, userProvidedId: `admitto:${EVENT_ID}:att-${index}` }));

const noOutcome = (): UntrackedDeleteOutcome => ({ answered: new Set(), failed: new Map() });
const lines = () => querySystemLogs({ search: "wallet_pass_erasure_delete_failed" });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  resetSystemLogBufferForTest();
  resolveConfiguredWalletProvider.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("deleteUntrackedPassesAtProvider", () => {
  it("asks for each pass by its own id and counts a pass deleted and none there alike as answered", async () => {
    // Reserved-0 and 2 are held (a delete, then the answer that none is left), reserved-1 is not.
    const provider = standIn(holding(1, "reserved-0", "reserved-2"));

    const outcome = await deleteUntrackedPassesAtProvider(provider, targets(3));

    expect(askedPerId(provider)).toEqual({ "reserved-0": 2, "reserved-1": 1, "reserved-2": 2 });
    expect(provider.deletePass).not.toHaveBeenCalled();
    expect([...outcome.answered].sort()).toEqual(["reserved-0", "reserved-1", "reserved-2"]);
    expect(outcome.failed.size).toBe(0);
  });

  it("keeps what the provider refused apart, by its failure code and never its message, and goes on with the rest", async () => {
    const provider = standIn((id) => {
      if (id === "reserved-1") throw new WalletProviderError("wallet_provider_timeout", "timed out for jane@example.com");
      if (id === "reserved-2") throw new Error("an internal detail that must not be logged");
      return false;
    });

    const outcome = await deleteUntrackedPassesAtProvider(provider, targets(4));

    expect([...outcome.answered].sort()).toEqual(["reserved-0", "reserved-3"]);
    expect([...outcome.failed.entries()]).toEqual([
      ["reserved-1", { attendeeId: "att-1", code: "wallet_provider_timeout" }],
      ["reserved-2", { attendeeId: "att-2", code: "unknown" }],
    ]);
  });

  it("makes no call and answers for nobody when there is nothing to delete", async () => {
    const provider = standIn();

    const outcome = await deleteUntrackedPassesAtProvider(provider, []);

    expect(provider.deletePassByUserProvidedId).not.toHaveBeenCalled();
    expect(outcome).toEqual(noOutcome());
  });

  it("runs ten calls at a time and starts the next ten only once those have all answered", async () => {
    const waiting: Array<{ id: string; answer: () => void }> = [];
    let inFlight = 0;
    let mostAtOnce = 0;
    const provider = standIn(
      (id) =>
        new Promise<boolean>((resolve) => {
          inFlight += 1;
          mostAtOnce = Math.max(mostAtOnce, inFlight);
          waiting.push({
            id,
            answer: () => {
              inFlight -= 1;
              resolve(false);
            },
          });
        }),
    );

    const run = deleteUntrackedPassesAtProvider(provider, targets(25));
    await flush();
    expect(waiting.map((call) => call.id)).toEqual(targets(25).slice(0, BATCH).map((target) => target.userProvidedId));

    // Nine of the ten answered: the next ten do not start while one is still out.
    waiting.slice(0, BATCH - 1).forEach((call) => call.answer());
    await flush();
    expect(provider.deletePassByUserProvidedId).toHaveBeenCalledTimes(BATCH);

    waiting[BATCH - 1]!.answer();
    await flush();
    expect(provider.deletePassByUserProvidedId).toHaveBeenCalledTimes(2 * BATCH);
    waiting.slice(BATCH, 2 * BATCH).forEach((call) => call.answer());
    await flush();
    expect(provider.deletePassByUserProvidedId).toHaveBeenCalledTimes(25);
    waiting.slice(2 * BATCH).forEach((call) => call.answer());

    const outcome = await run;
    expect(outcome.answered.size).toBe(25);
    expect(mostAtOnce).toBe(BATCH);
  });

  it("deletes every pass under an id, until the provider has none, before it counts the id as answered", async () => {
    // Two creations at once both succeeded under one reserved id.
    const provider = standIn(holding(2, "reserved-0"));

    const outcome = await deleteUntrackedPassesAtProvider(provider, targets(2));

    expect(askedPerId(provider)).toEqual({ "reserved-0": 3, "reserved-1": 1 });
    expect([...outcome.answered].sort()).toEqual(["reserved-0", "reserved-1"]);
    expect(outcome.failed.size).toBe(0);
  });

  it("does not count an id as answered while the provider still holds a pass under it after five deletions", async () => {
    const provider = standIn(() => true);

    const outcome = await deleteUntrackedPassesAtProvider(provider, targets(1));

    expect(provider.deletePassByUserProvidedId).toHaveBeenCalledTimes(6);
    expect(outcome.answered.size).toBe(0);
    expect([...outcome.failed.entries()]).toEqual([["reserved-0", { attendeeId: "att-0", code: "wallet_provider_rejected" }]]);
  });

  it("keeps an id apart that failed after it had deleted a pass, to be asked about again", async () => {
    const provider = standIn((_id, call) => {
      if (call === 1) throw new WalletProviderError("wallet_provider_timeout", "timed out");
      return call === 0;
    });

    const outcome = await deleteUntrackedPassesAtProvider(provider, targets(1));

    expect(outcome.answered.size).toBe(0);
    expect([...outcome.failed.keys()]).toEqual(["reserved-0"]);
  });
});

describe("deleteUntrackedProviderPassesBestEffort", () => {
  it("reads nothing and calls nobody when there is nothing to delete", async () => {
    const db = fakeDb();

    const outcome = await deleteUntrackedProviderPassesBestEffort(db as never, EVENT_ID, []);

    expect(outcome).toEqual(noOutcome());
    expect(db.event.findUnique).not.toHaveBeenCalled();
    expect(resolveConfiguredWalletProvider).not.toHaveBeenCalled();
  });

  it("calls nobody for an event that is gone", async () => {
    const db = fakeDb({ event: null });
    const provider = standIn();
    resolveConfiguredWalletProvider.mockReturnValue(provider);

    const outcome = await deleteUntrackedProviderPassesBestEffort(db as never, EVENT_ID, targets(2));

    expect(outcome).toEqual(noOutcome());
    expect(provider.deletePassByUserProvidedId).not.toHaveBeenCalled();
  });

  it("calls nobody, and fails nobody, for an event with no credentials it can use", async () => {
    const db = fakeDb();
    resolveConfiguredWalletProvider.mockReturnValue(null);

    const outcome = await deleteUntrackedProviderPassesBestEffort(db as never, EVENT_ID, targets(2));

    expect(outcome).toEqual(noOutcome());
    expect(lines()).toEqual([]);
  });

  it("deletes at the provider of the event's own credentials, whatever its Wallet switch says", async () => {
    const db = fakeDb();
    const provider = standIn();
    resolveConfiguredWalletProvider.mockReturnValue(provider);

    const outcome = await deleteUntrackedProviderPassesBestEffort(db as never, EVENT_ID, targets(2));

    expect(db.event.findUnique).toHaveBeenCalledWith({
      where: { id: EVENT_ID },
      select: { wallet_template_id: true, wallet_api_key_enc: true, wallet_field_mapping: true },
    });
    expect(resolveConfiguredWalletProvider).toHaveBeenCalledWith({
      walletTemplateId: "tmpl-1",
      walletApiKeyEnc: "enc-key",
      walletFieldMapping: null,
    });
    expect(provider.deletePassByUserProvidedId).toHaveBeenCalledTimes(2);
    expect([...outcome.answered].sort()).toEqual(["reserved-0", "reserved-1"]);
  });
});

describe("deleteUntrackedWalletPassesBestEffort", () => {
  it("reads the rows still at the provider that hold no provider id, of these attendees, in this event", async () => {
    const db = fakeDb();

    await deleteUntrackedWalletPassesBestEffort(db as never, EVENT_ID, ["a", "b"]);

    expect(db.walletPass.findMany).toHaveBeenCalledTimes(1);
    expect(db.walletPass.findMany).toHaveBeenCalledWith({
      where: {
        AND: [PASS_ROW_STILL_AT_PROVIDER, { provider_pass_id: null }],
        attendee_id: { in: ["a", "b"] },
        attendee: { event_id: EVENT_ID },
      },
      select: { attendee_id: true, user_provided_id: true },
    });
  });

  it("deletes by the id on the row, or by the one the creating request would have sent when the row has none", async () => {
    const db = fakeDb({
      rows: [
        { attendee_id: "a", user_provided_id: "reserved-on-the-row" },
        { attendee_id: "b", user_provided_id: null },
      ],
    });
    const provider = standIn();
    resolveConfiguredWalletProvider.mockReturnValue(provider);

    const outcome = await deleteUntrackedWalletPassesBestEffort(db as never, EVENT_ID, ["a", "b", "c"]);

    expect(provider.deletePassByUserProvidedId.mock.calls.map((call) => call[0])).toEqual([
      "reserved-on-the-row",
      `admitto:${EVENT_ID}:b`,
    ]);
    expect([...outcome.answered].sort()).toEqual([`admitto:${EVENT_ID}:b`, "reserved-on-the-row"]);
  });

  it("costs no provider call, and not even a read of the event, for attendees with no such row", async () => {
    const db = fakeDb({ rows: [] });
    const provider = standIn();
    resolveConfiguredWalletProvider.mockReturnValue(provider);

    const outcome = await deleteUntrackedWalletPassesBestEffort(db as never, EVENT_ID, ["a", "b", "c"]);

    expect(outcome).toEqual(noOutcome());
    expect(db.event.findUnique).not.toHaveBeenCalled();
    expect(provider.deletePassByUserProvidedId).not.toHaveBeenCalled();
  });

  it("answers what failed too, so that the caller can try it again after the commit", async () => {
    const db = fakeDb({ rows: [{ attendee_id: "a", user_provided_id: "reserved-a" }] });
    resolveConfiguredWalletProvider.mockReturnValue(
      standIn(() => {
        throw new WalletProviderError("wallet_provider_rate_limited", "slow down");
      }),
    );

    const outcome = await deleteUntrackedWalletPassesBestEffort(db as never, EVENT_ID, ["a"]);

    expect([...outcome.failed.entries()]).toEqual([["reserved-a", { attendeeId: "a", code: "wallet_provider_rate_limited" }]]);
    // Nothing is said yet: the second try may still delete it.
    expect(lines()).toEqual([]);
  });
});

describe("deleteUntrackedPassesAfterRemoval", () => {
  /** What the first delete answered for, by the ids it asked about. */
  const answered = (...ids: string[]): UntrackedDeleteOutcome => ({ answered: new Set(ids), failed: new Map() });
  /** What the first delete could not answer for: each id with its attendee. */
  const failedFirst = (...entries: Array<[id: string, attendeeId: string]>): UntrackedDeleteOutcome => ({
    answered: new Set(),
    failed: new Map(entries.map(([id, attendeeId]) => [id, { attendeeId, code: "wallet_provider_timeout" }])),
  });

  it("does nothing, and resolves no provider, when the first delete answered for every pass", async () => {
    const db = fakeDb();

    await deleteUntrackedPassesAfterRemoval(db as never, EVENT_ID, targets(3), answered("reserved-0", "reserved-1", "reserved-2"));

    expect(db.event.findUnique).not.toHaveBeenCalled();
    expect(resolveConfiguredWalletProvider).not.toHaveBeenCalled();
    expect(lines()).toEqual([]);
  });

  it("does nothing when no pass was left by the removed rows at all", async () => {
    const db = fakeDb();

    await deleteUntrackedPassesAfterRemoval(db as never, EVENT_ID, [], noOutcome());

    expect(db.event.findUnique).not.toHaveBeenCalled();
    expect(lines()).toEqual([]);
  });

  it("asks again only for the passes the first delete did not answer for, and says nothing when that works", async () => {
    const db = fakeDb();
    const provider = standIn();
    resolveConfiguredWalletProvider.mockReturnValue(provider);

    await deleteUntrackedPassesAfterRemoval(db as never, EVENT_ID, targets(3), answered("reserved-1"));

    expect(provider.deletePassByUserProvidedId.mock.calls.map((call) => call[0])).toEqual(["reserved-0", "reserved-2"]);
    expect(lines()).toEqual([]);
  });

  it("asks again about a pass whose reserved id changed after the first delete answered for the old one", async () => {
    const db = fakeDb();
    const provider = standIn();
    resolveConfiguredWalletProvider.mockReturnValue(provider);
    // The first delete answered for the id the row held then. A creating request has since written the current one.
    const rewritten: RemoveUntrackedWalletTarget[] = [{ attendeeId: "att-0", userProvidedId: `admitto:${EVENT_ID}:att-0` }];

    await deleteUntrackedPassesAfterRemoval(db as never, EVENT_ID, rewritten, answered("an-older-id-of-att-0"));

    expect(provider.deletePassByUserProvidedId.mock.calls.map((call) => call[0])).toEqual([`admitto:${EVENT_ID}:att-0`]);
  });

  it("says in one line which passes are still at the provider, however many, with ids and failure codes only", async () => {
    const db = fakeDb();
    resolveConfiguredWalletProvider.mockReturnValue(
      standIn((id) => {
        if (id.endsWith(":att-3")) throw new WalletProviderError("wallet_provider_timeout", "timed out");
        throw new WalletProviderError("wallet_provider_rate_limited", "slow down");
      }),
    );
    const all = usualTargets(30);

    await deleteUntrackedPassesAfterRemoval(db as never, EVENT_ID, all, noOutcome());

    const logged = lines();
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ level: "error", source: "admin", message: "wallet_pass_erasure_delete_failed" });
    expect(logged[0]!.fields).toEqual({
      eventId: EVENT_ID,
      failed: 30,
      codes: "wallet_provider_rate_limited,wallet_provider_timeout",
      attendeeIds: all.map((target) => target.attendeeId).join(","),
    });
  });

  it("also writes that line to the output, which is what outlives a restart", async () => {
    const db = fakeDb();
    resolveConfiguredWalletProvider.mockReturnValue(
      standIn(() => {
        throw new WalletProviderError("wallet_provider_timeout", "timed out");
      }),
    );

    await deleteUntrackedPassesAfterRemoval(db as never, EVENT_ID, targets(2), noOutcome());

    const written = vi.mocked(console.error).mock.calls.map((call) => String(call[0]));
    expect(written).toHaveLength(1);
    expect(JSON.parse(written[0]!)).toMatchObject({ level: "error", msg: "wallet_pass_erasure_delete_failed", eventId: EVENT_ID, failed: 2 });
  });

  it("names only the passes that are still there when the second try deleted some", async () => {
    const db = fakeDb();
    resolveConfiguredWalletProvider.mockReturnValue(
      standIn((id, call) => {
        if (id === "reserved-1") throw new WalletProviderError("wallet_provider_timeout", "timed out");
        return call === 0;
      }),
    );

    await deleteUntrackedPassesAfterRemoval(db as never, EVENT_ID, targets(3), noOutcome());

    expect(lines().map((line) => line.fields)).toEqual([
      { eventId: EVENT_ID, failed: 1, codes: "wallet_provider_timeout", attendeeIds: "att-1", reservedIds: "reserved-1" },
    ]);
  });

  it("does not say what failed the first time when the second try deletes that pass", async () => {
    const db = fakeDb();
    const provider = standIn();
    resolveConfiguredWalletProvider.mockReturnValue(provider);

    await deleteUntrackedPassesAfterRemoval(db as never, EVENT_ID, targets(1), failedFirst(["reserved-0", "att-0"]));

    expect(provider.deletePassByUserProvidedId).toHaveBeenCalledTimes(1);
    expect(lines()).toEqual([]);
  });

  it("asks again about the id the first delete failed for when a creating request has replaced it on the row", async () => {
    const db = fakeDb();
    const provider = standIn(holding(1, "an-older-id-of-att-0", `admitto:${EVENT_ID}:att-0`));
    resolveConfiguredWalletProvider.mockReturnValue(provider);
    const rewritten: RemoveUntrackedWalletTarget[] = [{ attendeeId: "att-0", userProvidedId: `admitto:${EVENT_ID}:att-0` }];

    await deleteUntrackedPassesAfterRemoval(db as never, EVENT_ID, rewritten, failedFirst(["an-older-id-of-att-0", "att-0"]));

    // Both ids are drained: the old one, which the removal's own rows no longer name, and the current one.
    expect(askedPerId(provider)).toEqual({ "an-older-id-of-att-0": 2, [`admitto:${EVENT_ID}:att-0`]: 2 });
    expect(lines()).toEqual([]);
  });

  it("names the attendee when the old id still fails after the retry, although the current id was deleted", async () => {
    const db = fakeDb();
    const provider = standIn((id, call) => {
      if (id === "an-older-id-of-att-0") throw new WalletProviderError("wallet_provider_rate_limited", "slow down");
      return call === 0;
    });
    resolveConfiguredWalletProvider.mockReturnValue(provider);
    const rewritten: RemoveUntrackedWalletTarget[] = [{ attendeeId: "att-0", userProvidedId: `admitto:${EVENT_ID}:att-0` }];

    await deleteUntrackedPassesAfterRemoval(db as never, EVENT_ID, rewritten, failedFirst(["an-older-id-of-att-0", "att-0"]));

    expect(lines().map((line) => line.fields)).toEqual([
      { eventId: EVENT_ID, failed: 1, codes: "wallet_provider_rate_limited", attendeeIds: "att-0", reservedIds: "an-older-id-of-att-0" },
    ]);
  });

  it("leaves an id alone that the first delete failed for when this removal did not delete that attendee", async () => {
    const db = fakeDb();
    const provider = standIn();
    resolveConfiguredWalletProvider.mockReturnValue(provider);

    // Another request removed att-9 at the same moment: it is that request's pass to deal with.
    await deleteUntrackedPassesAfterRemoval(db as never, EVENT_ID, targets(1), {
      answered: new Set(["reserved-0"]),
      failed: new Map([["reserved-9", { attendeeId: "att-9", code: "wallet_provider_timeout" }]]),
    });

    expect(provider.deletePassByUserProvidedId).not.toHaveBeenCalled();
    expect(lines()).toEqual([]);
  });

  it("asks only once about an id that failed first and is also on a removed row, and names its attendee once", async () => {
    const db = fakeDb();
    const provider = standIn(() => {
      throw new WalletProviderError("wallet_provider_timeout", "timed out");
    });
    resolveConfiguredWalletProvider.mockReturnValue(provider);
    const both: RemoveUntrackedWalletTarget[] = [{ attendeeId: "att-0", userProvidedId: "reserved-0" }];

    await deleteUntrackedPassesAfterRemoval(db as never, EVENT_ID, both, failedFirst(["reserved-0", "att-0"], ["an-older-id-of-att-0", "att-0"]));

    expect(askedPerId(provider)).toEqual({ "reserved-0": 1, "an-older-id-of-att-0": 1 });
    expect(lines().map((line) => line.fields)).toEqual([
      { eventId: EVENT_ID, failed: 1, codes: "wallet_provider_timeout", attendeeIds: "att-0", reservedIds: "reserved-0,an-older-id-of-att-0" },
    ]);
  });

  it("names a failed id that is not the usual one next to the attendee, and no id that the attendee id already gives", async () => {
    const db = fakeDb();
    resolveConfiguredWalletProvider.mockReturnValue(
      standIn(() => {
        throw new WalletProviderError("wallet_provider_timeout", "timed out");
      }),
    );
    const mixed: RemoveUntrackedWalletTarget[] = [
      { attendeeId: "att-0", userProvidedId: `admitto:${EVENT_ID}:att-0` },
      { attendeeId: "att-1", userProvidedId: "an-older-id-of-att-1" },
      // The usual id of another event is not the usual id of this one.
      { attendeeId: "att-2", userProvidedId: "admitto:another-event:att-2" },
    ];

    await deleteUntrackedPassesAfterRemoval(db as never, EVENT_ID, mixed, noOutcome());

    expect(lines().map((line) => line.fields)).toEqual([
      {
        eventId: EVENT_ID,
        failed: 3,
        codes: "wallet_provider_timeout",
        attendeeIds: "att-0,att-1,att-2",
        reservedIds: "an-older-id-of-att-1,admitto:another-event:att-2",
      },
    ]);
  });

  it("still answers, and says which passes are left, when the second try itself breaks, without the words of the error", async () => {
    const db = fakeDb();
    db.event.findUnique.mockRejectedValue(new Error("db hiccup for jane@example.com"));

    await expect(deleteUntrackedPassesAfterRemoval(db as never, EVENT_ID, targets(2), noOutcome())).resolves.toBeUndefined();

    expect(lines().map((line) => line.fields)).toEqual([
      { eventId: EVENT_ID, failed: 2, codes: "unknown", attendeeIds: "att-0,att-1", reservedIds: "reserved-0,reserved-1" },
    ]);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("jane@example.com");
  });

  it("says nothing when the event has no credentials the second time: nothing was tried", async () => {
    const db = fakeDb();
    resolveConfiguredWalletProvider.mockReturnValue(null);

    await deleteUntrackedPassesAfterRemoval(db as never, EVENT_ID, targets(2), noOutcome());

    expect(lines()).toEqual([]);
  });
});
