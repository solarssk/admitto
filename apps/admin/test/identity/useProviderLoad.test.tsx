// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useProviderLoad } from "../../src/identity/useProviderLoad.js";

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return { ...actual, fetchIdentityProvider: vi.fn() };
});

import { fetchIdentityProvider } from "../../src/api/client.js";

afterEach(() => {
  vi.clearAllMocks();
});

describe("useProviderLoad", () => {
  it("reads nothing for an edit that has no provider id, and does not touch the editor", () => {
    const apply = vi.fn();
    const onStart = vi.fn();
    const { result } = renderHook(() => useProviderLoad({ mode: "edit", providerId: undefined, apply, onStart }));

    expect(fetchIdentityProvider).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    expect(onStart).not.toHaveBeenCalled();
    expect(result.current.loadState).toBe("loading");
  });

  it("reads nothing for a new provider: the form is ready at once", () => {
    const { result } = renderHook(() => useProviderLoad({ mode: "create", providerId: undefined, apply: vi.fn(), onStart: vi.fn() }));

    expect(fetchIdentityProvider).not.toHaveBeenCalled();
    expect(result.current.loadState).toBe("ready");
  });
});
