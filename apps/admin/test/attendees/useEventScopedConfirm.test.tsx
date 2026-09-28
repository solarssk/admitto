// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useEventScopedConfirm } from "../../src/attendees/useEventScopedConfirm.js";

describe("useEventScopedConfirm", () => {
  /** `null` stands for "no event in the route" (a default parameter would swallow `undefined`). */
  function setup(initialEventId: string | null = "evt-1") {
    return renderHook(({ eventId }: { eventId: string | undefined }) => useEventScopedConfirm(eventId), {
      initialProps: { eventId: initialEventId ?? undefined },
    });
  }

  it("opens for the event the page is on and hands exactly that event to the confirm handler", () => {
    const { result } = setup("evt-1");
    expect(result.current.open).toBe(false);
    expect(result.current.target()).toBeNull();

    act(() => result.current.request());

    expect(result.current.open).toBe(true);
    expect(result.current.target()).toBe("evt-1");
  });

  it("does nothing without a route event", () => {
    const { result } = setup(null);

    act(() => result.current.request());

    expect(result.current.open).toBe(false);
    expect(result.current.target()).toBeNull();
  });

  it("closes when the route moves to another event, so nothing can be confirmed for it", () => {
    const { result, rerender } = setup("evt-1");
    act(() => result.current.request());
    expect(result.current.open).toBe(true);

    rerender({ eventId: "evt-2" });

    expect(result.current.open).toBe(false);
    expect(result.current.target()).toBeNull();
  });

  it("gives a handler captured before the navigation nothing to act on", () => {
    const { result, rerender } = setup("evt-1");
    act(() => result.current.request());
    const capturedBeforeNavigation = result.current;
    expect(capturedBeforeNavigation.target()).toBe("evt-1");

    rerender({ eventId: "evt-2" });

    expect(capturedBeforeNavigation.target()).toBeNull();
  });

  it("does not come back when the route returns to the event it was opened on", () => {
    const { result, rerender } = setup("evt-1");
    act(() => result.current.request());

    rerender({ eventId: "evt-2" });
    rerender({ eventId: "evt-1" });

    expect(result.current.open).toBe(false);
    expect(result.current.target()).toBeNull();
  });

  it("shows an error on the open confirmation until it is cleared, closed or requested again", () => {
    const { result } = setup("evt-1");
    act(() => result.current.request());

    act(() => result.current.setError("Push failed."));
    expect(result.current.error).toBe("Push failed.");

    act(() => result.current.setError(null));
    expect(result.current.error).toBeNull();

    act(() => result.current.setError("Push failed."));
    act(() => result.current.close());
    expect(result.current.open).toBe(false);
    expect(result.current.error).toBeNull();

    act(() => result.current.request());
    act(() => result.current.setError("Push failed."));
    act(() => result.current.request());
    expect(result.current.error).toBeNull();
  });

  it("ignores an error when there is no open confirmation, and drops it with the confirmation on navigation", () => {
    const { result, rerender } = setup("evt-1");
    act(() => result.current.setError("Push failed."));
    expect(result.current.error).toBeNull();
    expect(result.current.open).toBe(false);

    act(() => result.current.request());
    act(() => result.current.setError("Push failed."));
    rerender({ eventId: "evt-2" });

    expect(result.current.error).toBeNull();
    rerender({ eventId: "evt-1" });
    expect(result.current.error).toBeNull();
  });
});
