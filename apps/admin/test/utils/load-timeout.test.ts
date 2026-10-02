import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadWithTimeout, rejectOnAbort } from "../../src/utils/load-timeout.js";
import { LOAD_TIMEOUT_MS } from "../../src/utils/loading-timing.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("loadWithTimeout", () => {
  it("aborts the request after 30 seconds, and says it was the wait that ran out", () => {
    const load = loadWithTimeout();
    vi.advanceTimersByTime(LOAD_TIMEOUT_MS - 1);
    expect(load.signal.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(load.signal.aborted).toBe(true);
    expect(load.timedOut()).toBe(true);
  });

  it("follows the parent: its abort aborts the request, and is not a timeout", () => {
    const parent = new AbortController();
    const load = loadWithTimeout(parent.signal);
    parent.abort();
    expect(load.signal.aborted).toBe(true);
    expect(load.timedOut()).toBe(false);
  });

  it("is already aborted when the parent was", () => {
    const parent = new AbortController();
    parent.abort();
    expect(loadWithTimeout(parent.signal).signal.aborted).toBe(true);
  });

  it("done() clears the timer and the link, so a settled request is never aborted later", () => {
    const parent = new AbortController();
    const load = loadWithTimeout(parent.signal);
    load.done();
    expect(vi.getTimerCount()).toBe(0);
    parent.abort();
    vi.advanceTimersByTime(LOAD_TIMEOUT_MS * 2);
    expect(load.signal.aborted).toBe(false);
    expect(load.timedOut()).toBe(false);
  });

  it("takes its own limit", () => {
    const load = loadWithTimeout(undefined, 1000);
    vi.advanceTimersByTime(1000);
    expect(load.timedOut()).toBe(true);
  });
});

describe("rejectOnAbort", () => {
  it("is the promise's own answer when it comes first, and lets go of the signal", async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    await expect(rejectOnAbort(Promise.resolve("answer"), controller.signal)).resolves.toBe("answer");
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it("is the promise's own failure when it comes first", async () => {
    const controller = new AbortController();
    await expect(rejectOnAbort(Promise.reject(new Error("boom")), controller.signal)).rejects.toThrow("boom");
  });

  it("is an abort the moment the signal aborts, for a promise that never answers", async () => {
    const controller = new AbortController();
    const waiting = rejectOnAbort(new Promise<string>(() => {}), controller.signal);
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
  });

  it("is an abort at once for a signal that has already aborted, and ignores a late answer", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(rejectOnAbort(Promise.resolve("late"), controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});

