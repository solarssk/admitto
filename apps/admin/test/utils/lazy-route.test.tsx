// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { Component, Suspense, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lazyRoute, trackChunk, useChunkLoading } from "../../src/utils/lazy-route.js";
import { LOAD_TIMEOUT_MS } from "../../src/utils/loading-timing.js";

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

  describe("a download that stalls", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.spyOn(console, "error").mockImplementation(() => undefined); // React logs the error it hands to the boundary
    });
    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    class Boundary extends Component<{ children: ReactNode }, { message: string | null }> {
      state = { message: null as string | null };
      static getDerivedStateFromError(error: Error) {
        return { message: error.message };
      }
      render() {
        return this.state.message ? <p role="alert">{this.state.message}</p> : this.props.children;
      }
    }

    it("is abandoned after 30s: the top bar clears and the page fails into the error boundary instead of waiting forever", async () => {
      const Page = lazyRoute(() => new Promise<{ default: () => JSX.Element }>(() => undefined));
      const { result } = renderHook(() => useChunkLoading());
      render(
        <Boundary>
          <Suspense fallback={<p>fallback</p>}>
            <Page />
          </Suspense>
        </Boundary>,
      );
      expect(result.current).toBe(true);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS - 1);
      });
      expect(result.current).toBe(true);
      expect(screen.queryByRole("alert")).toBeNull();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(result.current).toBe(false);
      expect(screen.getByRole("alert").textContent).toContain("timed out");
    });

    it("a download that fails outright (offline) reaches the error boundary with its own message and clears the bar", async () => {
      const Page = lazyRoute(() => Promise.reject(new Error("Failed to fetch dynamically imported module")));
      const { result } = renderHook(() => useChunkLoading());
      render(
        <Boundary>
          <Suspense fallback={<p>fallback</p>}>
            <Page />
          </Suspense>
        </Boundary>,
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByRole("alert").textContent).toBe("Failed to fetch dynamically imported module");
      expect(result.current).toBe(false);
    });

    it("wraps a rejection that is not an Error, so the boundary always gets a real one", async () => {
      const Page = lazyRoute(() => Promise.reject("boom" as unknown as Error));
      render(
        <Boundary>
          <Suspense fallback={<p>fallback</p>}>
            <Page />
          </Suspense>
        </Boundary>,
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByRole("alert").textContent).toBe("boom");
    });

    it("does not fire the timeout once the download has finished", async () => {
      const chunk = deferred<{ default: () => JSX.Element }>();
      const Page = lazyRoute(() => chunk.promise);
      render(
        <Boundary>
          <Suspense fallback={<p>fallback</p>}>
            <Page />
          </Suspense>
        </Boundary>,
      );
      await act(async () => {
        chunk.resolve({ default: () => <p>the page</p> });
        await chunk.promise;
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS * 2);
      });
      expect(screen.getByText("the page")).toBeTruthy();
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });
});
