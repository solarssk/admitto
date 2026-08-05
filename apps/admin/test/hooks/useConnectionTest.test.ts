// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useConnectionTest } from "../../src/hooks/useConnectionTest.js";

vi.mock("../../src/api/operator-api-error.js", () => ({
  operatorApiErrorMessage: (_err: unknown, fallback: string) => `mapped:${fallback}`,
}));

afterEach(() => {
  cleanup();
});

describe("useConnectionTest", () => {
  it("defaults success and failure messages when the API omits them", async () => {
    const { result } = renderHook(() => useConnectionTest("fallback"));

    await act(async () => {
      await result.current.run(async () => ({ ok: true }));
    });
    expect(result.current.result).toEqual({ ok: true, message: "Connected." });

    await act(async () => {
      await result.current.run(async () => ({ ok: false }));
    });
    expect(result.current.result).toEqual({ ok: false, message: "Could not connect." });
  });

  it("uses explicit API message/error text when present", async () => {
    const { result } = renderHook(() => useConnectionTest("fallback"));

    await act(async () => {
      await result.current.run(async () => ({ ok: true, message: "SMTP ok" }));
    });
    expect(result.current.result).toEqual({ ok: true, message: "SMTP ok" });

    await act(async () => {
      await result.current.run(async () => ({ ok: false, error: "bad creds" }));
    });
    expect(result.current.result).toEqual({ ok: false, message: "bad creds" });
  });

  it("maps thrown API errors through operatorApiErrorMessage", async () => {
    const { result } = renderHook(() => useConnectionTest("Could not test"));

    await act(async () => {
      await result.current.run(async () => {
        throw new Error("network");
      });
    });

    expect(result.current.testing).toBe(false);
    expect(result.current.result).toEqual({
      ok: false,
      message: "mapped:Could not test",
    });
  });

  it("clearResult resets the last outcome", async () => {
    const { result } = renderHook(() => useConnectionTest("fallback"));

    await act(async () => {
      await result.current.run(async () => ({ ok: true, message: "ok" }));
    });
    expect(result.current.result).not.toBeNull();

    act(() => {
      result.current.clearResult();
    });
    expect(result.current.result).toBeNull();
  });
});
