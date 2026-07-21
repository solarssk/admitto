// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useScrollFade } from "../../src/hooks/useScrollFade.js";

afterEach(() => {
  cleanup();
});

describe("useScrollFade", () => {
  it("does nothing when scrollRef is never attached to an element (no listeners, defaults kept)", () => {
    const { result } = renderHook(() => useScrollFade());

    expect(result.current.scrollRef.current).toBeNull();
    expect(result.current.atStart).toBe(true);
    expect(result.current.atEnd).toBe(true);
  });
});
