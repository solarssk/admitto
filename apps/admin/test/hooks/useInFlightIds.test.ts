// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useInFlightIds } from "../../src/hooks/useInFlightIds.js";

afterEach(() => {
  cleanup();
});

describe("useInFlightIds (double-submit guard)", () => {
  it("start returns true the first time and false while the same id is still in flight", () => {
    const { result } = renderHook(() => useInFlightIds());

    let first = false;
    let second = false;
    // Both calls in one act() = same tick, before any re-render commits — the
    // ref half is what makes the second call see the first synchronously.
    act(() => {
      first = result.current.start("a");
      second = result.current.start("a");
    });

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(result.current.ids.has("a")).toBe(true);
  });

  it("finish clears both halves so a later start proceeds again", () => {
    const { result } = renderHook(() => useInFlightIds());

    act(() => {
      result.current.start("a");
    });
    expect(result.current.ids.has("a")).toBe(true);

    act(() => {
      result.current.finish("a");
    });
    expect(result.current.ids.has("a")).toBe(false);

    let again = false;
    act(() => {
      again = result.current.start("a");
    });
    expect(again).toBe(true);
  });

  it("tracks distinct ids independently", () => {
    const { result } = renderHook(() => useInFlightIds());

    act(() => {
      result.current.start("a");
      result.current.start("b");
    });
    expect(result.current.ids.has("a")).toBe(true);
    expect(result.current.ids.has("b")).toBe(true);

    act(() => {
      result.current.finish("a");
    });
    expect(result.current.ids.has("a")).toBe(false);
    expect(result.current.ids.has("b")).toBe(true);
  });

  it("finishing an id that was never started is a harmless no-op", () => {
    const { result } = renderHook(() => useInFlightIds());
    act(() => {
      result.current.finish("never");
    });
    expect(result.current.ids.size).toBe(0);
  });
});
