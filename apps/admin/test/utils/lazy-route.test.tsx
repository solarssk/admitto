// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { Suspense } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { lazyRoute, trackChunk, useChunkLoading } from "../../src/utils/lazy-route.js";

afterEach(() => {
  cleanup();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useChunkLoading / trackChunk", () => {
  it("is true while a tracked chunk is downloading and false once it resolves", async () => {
    const { result } = renderHook(() => useChunkLoading());
    expect(result.current).toBe(false);

    const chunk = deferred<string>();
    act(() => {
      void trackChunk(chunk.promise);
    });
    expect(result.current).toBe(true);

    await act(async () => {
      chunk.resolve("done");
      await chunk.promise;
    });
    expect(result.current).toBe(false);
  });

  it("also clears when the download fails (offline), so the bar never sticks", async () => {
    const { result } = renderHook(() => useChunkLoading());
    const chunk = deferred<string>();
    act(() => {
      void trackChunk(chunk.promise).catch(() => undefined);
    });
    expect(result.current).toBe(true);

    await act(async () => {
      chunk.reject(new Error("Failed to fetch dynamically imported module"));
      await chunk.promise.catch(() => undefined);
    });
    expect(result.current).toBe(false);
  });

  it("counts overlapping downloads and stays true until the last one settles", async () => {
    const { result } = renderHook(() => useChunkLoading());
    const a = deferred<string>();
    const b = deferred<string>();
    act(() => {
      void trackChunk(a.promise);
      void trackChunk(b.promise);
    });
    await act(async () => {
      a.resolve("a");
      await a.promise;
    });
    expect(result.current).toBe(true);
    await act(async () => {
      b.resolve("b");
      await b.promise;
    });
    expect(result.current).toBe(false);
  });
});

describe("lazyRoute", () => {
  it("tracks the download of a page the user opened, and renders it once loaded", async () => {
    const chunk = deferred<{ default: () => JSX.Element }>();
    const Page = lazyRoute(() => chunk.promise);
    const { result } = renderHook(() => useChunkLoading());

    render(
      <Suspense fallback={<p>fallback</p>}>
        <Page />
      </Suspense>,
    );
    expect(screen.getByText("fallback")).toBeTruthy();
    expect(result.current).toBe(true);

    await act(async () => {
      chunk.resolve({ default: () => <p>the page</p> });
      await chunk.promise;
    });
    expect(await screen.findByText("the page")).toBeTruthy();
    expect(result.current).toBe(false);
  });
});
