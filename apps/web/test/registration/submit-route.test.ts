import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { querySystemLogs, resetSystemLogBufferForTest } from "@admitto/shared/system-log";
import { ANSWER_FLOOR_MS, holdAnswer, noteEventBudgetSpent, type AnswerPace } from "../../src/registration/submit-route.js";

/** A clock the test moves and a wait that only records. */
function clock(floorMs: number) {
  let now = 5_000;
  const sleep = vi.fn(async (ms: number) => {
    now += ms;
  });
  const pace: AnswerPace = { floorMs, now: () => now, sleep };
  return { pace, sleep, advance: (ms: number) => (now += ms), at: () => now };
}

describe("holdAnswer", () => {
  it("is 250 ms by default, much more than the extra work of storing a new registration", () => {
    expect(ANSWER_FLOOR_MS).toBe(250);
  });

  it("waits for what is left of the floor, counted from where the clock started", async () => {
    const { pace, sleep, advance, at } = clock(250);
    const started = at();
    advance(40);

    await holdAnswer(pace, started);

    expect(sleep).toHaveBeenCalledOnce();
    expect(sleep).toHaveBeenCalledWith(210);
    expect(at() - started).toBe(250);
  });

  it("waits for the whole floor when no time has passed", async () => {
    const { pace, sleep, at } = clock(250);

    await holdAnswer(pace, at());

    expect(sleep).toHaveBeenCalledWith(250);
  });

  it("does not wait when the work took as long as the floor, or longer: a slow answer is not made slower", async () => {
    const exactly = clock(250);
    const started = exactly.at();
    exactly.advance(250);
    await holdAnswer(exactly.pace, started);
    expect(exactly.sleep).not.toHaveBeenCalled();

    const longer = clock(250);
    const begun = longer.at();
    longer.advance(900);
    await holdAnswer(longer.pace, begun);
    expect(longer.sleep).not.toHaveBeenCalled();
  });

  it("does not wait at all with a floor of 0", async () => {
    const { pace, sleep, at } = clock(0);

    await holdAnswer(pace, at());

    expect(sleep).not.toHaveBeenCalled();
  });
});

describe("noteEventBudgetSpent", () => {
  beforeEach(() => {
    resetSystemLogBufferForTest();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-23T10:00:00.000Z"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const lines = () => querySystemLogs({ search: "registration_mail_withheld" });

  it("writes one warning with the event id, and nothing else, however often the budget is found spent", () => {
    for (let i = 0; i < 20; i += 1) noteEventBudgetSpent("evt-note-a");

    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toMatchObject({ level: "warn", source: "api", fields: { event_id: "evt-note-a", reason: "event_budget" } });
  });

  it("writes it again an hour later, and keeps a count for each event apart", () => {
    noteEventBudgetSpent("evt-note-b");
    noteEventBudgetSpent("evt-note-c");
    vi.advanceTimersByTime(59 * 60_000);
    noteEventBudgetSpent("evt-note-b");
    expect(lines()).toHaveLength(2);

    vi.advanceTimersByTime(2 * 60_000);
    noteEventBudgetSpent("evt-note-b");
    expect(lines()).toHaveLength(3);
  });

  it("remembers at most 500 events, so that the memory it uses is bounded", async () => {
    // The memory is module state: a copy of the module of its own, so that the events above are not in it.
    vi.resetModules();
    const { noteEventBudgetSpent: fresh } = await import("../../src/registration/submit-route.js");
    const freshLog = await import("@admitto/shared/system-log");
    const freshLines = () => freshLog.querySystemLogs({ search: "registration_mail_withheld" });
    for (let i = 0; i < 500; i += 1) fresh(`evt-bound-${i}`);
    expect(freshLines()).toHaveLength(500);

    fresh("evt-bound-0");
    expect(freshLines()).toHaveLength(500);
    // A 501st event makes room by forgetting the others.
    fresh("evt-bound-500");
    fresh("evt-bound-0");
    expect(freshLines()).toHaveLength(502);
  });
});
