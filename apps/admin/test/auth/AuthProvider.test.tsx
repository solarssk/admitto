// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/api/client.js";
import { resetLoaderClockForTests, syncLoaderClockToSplash } from "@admitto/ui";
import { AuthProvider, useAuth } from "../../src/auth/AuthProvider.js";
import {
  BOOT_FADE_FALLBACK_MS,
  BOOT_FADE_MS,
  LOAD_TIMEOUT_MESSAGE,
  LOAD_TIMEOUT_MS,
  SLOW_NOTICE_MS,
  SLOW_NOTICE_TEXT,
} from "../../src/utils/loading-timing.js";

// jsdom has no AnimationEvent, and React then never listens for animation events at all (it only does
// so in browsers that have one), so `onAnimationEnd` could not fire. Give jsdom a minimal one before
// React loads (vi.hoisted runs ahead of the imports).
vi.hoisted(() => {
  class TestAnimationEvent extends Event {
    animationName: string;
    constructor(type: string, init: EventInit & { animationName?: string } = {}) {
      super(type, init);
      this.animationName = init.animationName ?? "";
    }
  }
  Object.assign(globalThis, { AnimationEvent: TestAnimationEvent });
});

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    fetchMe: vi.fn(),
    fetchStaffTheme: vi.fn(),
  };
});

vi.mock("@admitto/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@admitto/ui")>();
  return {
    ...actual,
    applyThemeVars: vi.fn(),
  };
});

import { fetchMe, fetchStaffTheme } from "../../src/api/client.js";

const mockFetchMe = vi.mocked(fetchMe);
const mockFetchStaffTheme = vi.mocked(fetchStaffTheme);

beforeEach(() => {
  mockFetchStaffTheme.mockResolvedValue({ theme: {} });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const sessionResponse = {
  user: {
    id: "u1",
    email: "a@example.com",
    display_name: "A",
    preferred_locale: "en",
    is_active: true,
    created_at: "2026-01-01T00:00:00.000Z",
  },
  assignments: [],
  device_label: null,
  session_active: true,
  setup_complete: true,
  mailer_status: null,
};

describe("AuthProvider", () => {
  it("starts session and theme loading together, while a failed theme stays non-blocking", async () => {
    let resolveSession: ((value: typeof sessionResponse) => void) | undefined;
    mockFetchMe.mockImplementationOnce(
      () => new Promise<typeof sessionResponse>((resolve) => {
        resolveSession = resolve;
      }),
    );
    mockFetchStaffTheme.mockRejectedValueOnce(new Error("theme unavailable"));

    render(
      <AuthProvider>
        <div data-testid="child">ok</div>
      </AuthProvider>,
    );

    await waitFor(() => expect(mockFetchMe).toHaveBeenCalledTimes(1));
    expect(mockFetchStaffTheme).toHaveBeenCalledTimes(1);

    resolveSession!(sessionResponse);
    await screen.findByTestId("child");
  });

  it("shows EmptyState with Retry when session load fails", async () => {
    mockFetchMe.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    render(
      <AuthProvider>
        <div data-testid="child">should not render</div>
      </AuthProvider>,
    );
    await waitFor(() => {
      expect(screen.getByText("Could not load session")).toBeTruthy();
    });
    expect(screen.getByText("Could not load session.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.queryByTestId("child")).toBeNull();
  });

  it("retries session load when Retry is clicked", async () => {
    mockFetchMe
      .mockRejectedValueOnce(new ApiError(500, "secret_internal"))
      .mockResolvedValueOnce(sessionResponse);
    mockFetchStaffTheme.mockResolvedValue({ theme: {} });

    render(
      <AuthProvider>
        <div data-testid="child">ok</div>
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("Could not load session")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(screen.getByTestId("child").textContent).toBe("ok");
    });
    expect(mockFetchMe).toHaveBeenCalledTimes(2);
  });
});

describe("AuthProvider loading experience", () => {
  /** A fetchMe that only ever settles by being aborted, like a request to a stalled server. */
  function stalledFetchMe() {
    mockFetchMe.mockImplementation(
      (signal?: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        }),
    );
  }

  it("shows the Admitto loader (not bare text) while the session loads", async () => {
    let resolveSession: ((value: typeof sessionResponse) => void) | undefined;
    mockFetchMe.mockImplementationOnce(
      () => new Promise<typeof sessionResponse>((resolve) => {
        resolveSession = resolve;
      }),
    );
    const { container } = render(
      <AuthProvider>
        <div data-testid="child">ok</div>
      </AuthProvider>,
    );
    expect(screen.getByRole("status", { name: "Loading Admitto" })).toBeTruthy();
    expect(container.querySelector(".shell-loading .at-loader--page")).not.toBeNull();
    expect(screen.queryByText("Loading…")).toBeNull();

    resolveSession!(sessionResponse);
    await screen.findByTestId("child");
    expect(screen.queryByRole("status", { name: "Loading Admitto" })).toBeNull();
  });

  describe("with a stalled server", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("says nothing extra at first, then tells the user after the slow-notice delay", async () => {
      stalledFetchMe();
      render(
        <AuthProvider>
          <div data-testid="child">ok</div>
        </AuthProvider>,
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(SLOW_NOTICE_MS - 1);
      });
      expect(screen.queryByText(SLOW_NOTICE_TEXT)).toBeNull();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(screen.getByText(SLOW_NOTICE_TEXT)).toBeTruthy();
    });

    it("gives up after the timeout with a Retry instead of spinning forever", async () => {
      stalledFetchMe();
      render(
        <AuthProvider>
          <div data-testid="child">should not render</div>
        </AuthProvider>,
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS);
      });
      expect(screen.getByText("Could not load session")).toBeTruthy();
      expect(screen.getByText(LOAD_TIMEOUT_MESSAGE)).toBeTruthy();
      expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
      expect(screen.queryByTestId("child")).toBeNull();
      // Both requests were abandoned, not just the session one.
      expect(mockFetchMe.mock.calls[0]?.[0]?.aborted).toBe(true);
      expect(mockFetchStaffTheme.mock.calls[0]?.[0]?.aborted).toBe(true);
    });
  });

  it("refreshes the session in place: the app stays mounted and no loader replaces it", async () => {
    mockFetchMe.mockResolvedValueOnce(sessionResponse);
    let resolveRefresh: ((value: typeof sessionResponse) => void) | undefined;

    function Probe() {
      const { refresh, user } = useAuth();
      return (
        <button type="button" data-testid="probe" onClick={() => void refresh()}>
          {user.display_name}
        </button>
      );
    }

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    const probe = await screen.findByTestId("probe");

    mockFetchMe.mockImplementationOnce(
      () => new Promise<typeof sessionResponse>((resolve) => {
        resolveRefresh = resolve;
      }),
    );
    fireEvent.click(probe);
    await waitFor(() => expect(mockFetchMe).toHaveBeenCalledTimes(2));

    // Mid-refresh: same DOM node (not remounted), and no loader in front of it.
    expect(screen.getByTestId("probe")).toBe(probe);
    expect(screen.queryByRole("status", { name: "Loading Admitto" })).toBeNull();

    await act(async () => {
      resolveRefresh!({ ...sessionResponse, user: { ...sessionResponse.user, display_name: "Renamed" } });
    });
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe("Renamed"));
    expect(screen.getByTestId("probe")).toBe(probe);
  });
});

describe("AuthProvider hand-over from the index.html splash", () => {
  /** Pretend index.html's splash has been drawing for `elapsedMs` when React starts. */
  function bootFromSplash(elapsedMs: number) {
    const root = document.createElement("div");
    root.innerHTML = '<div class="at-splash"><svg></svg></div>';
    Object.assign(root.querySelector("svg")!, { getAnimations: () => [{ currentTime: elapsedMs }] });
    syncLoaderClockToSplash(root);
  }

  /** What a browser sends when a CSS animation ends. */
  function endAnimation(target: Element, animationName: string) {
    act(() => {
      target.dispatchEvent(new AnimationEvent("animationend", { bubbles: true, animationName }));
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    mockFetchMe.mockResolvedValue(sessionResponse);
  });

  afterEach(() => {
    resetLoaderClockForTests();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const flush = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });

  it("keeps the loader up until the tick has finished drawing, even though everything loaded at once", async () => {
    bootFromSplash(100); // first draw-in is done at 650ms, so 550ms are left
    render(
      <AuthProvider>
        <div data-testid="child">ok</div>
      </AuthProvider>,
    );
    await flush(0); // the session resolves and React schedules the wait
    await flush(549);
    expect(screen.queryByTestId("child")).toBeNull();
    expect(screen.getByRole("status", { name: "Loading Admitto" })).toBeTruthy();

    await flush(1);
    expect(screen.getByTestId("child")).toBeTruthy();
  });

  it("fades the loader out over the mounted app instead of cutting it, without remounting the app", async () => {
    bootFromSplash(100);
    const { container } = render(
      <AuthProvider>
        <div data-testid="child">ok</div>
      </AuthProvider>,
    );
    await flush(0);
    await flush(550);
    const child = screen.getByTestId("child");
    const overlay = container.querySelector(".shell-loading--leaving");
    expect(overlay).not.toBeNull();
    expect(overlay?.getAttribute("aria-hidden")).toBe("true");

    // Still there when the fade is nominally over: it is removed when the animation ENDS (the browser
    // tells us), not on a timer, so an animation waiting on it is never cancelled mid-flight.
    await flush(BOOT_FADE_MS);
    expect(container.querySelector(".shell-loading--leaving")).not.toBeNull();

    endAnimation(overlay as Element, "shell-loading-leave");
    expect(container.querySelector(".shell-loading")).toBeNull();
    expect(screen.getByTestId("child")).toBe(child);
  });

  it("ignores the end of any other animation inside the loader", async () => {
    bootFromSplash(100);
    const { container } = render(
      <AuthProvider>
        <div data-testid="child">ok</div>
      </AuthProvider>,
    );
    await flush(0);
    await flush(550);
    endAnimation(container.querySelector(".shell-loading--leaving") as Element, "at-loader-draw");
    expect(container.querySelector(".shell-loading--leaving")).not.toBeNull();
  });

  it("still removes the loader if the browser never reports the end of the fade (safety net)", async () => {
    bootFromSplash(100);
    const { container } = render(
      <AuthProvider>
        <div data-testid="child">ok</div>
      </AuthProvider>,
    );
    await flush(0);
    await flush(550);
    await flush(BOOT_FADE_FALLBACK_MS - 1);
    expect(container.querySelector(".shell-loading--leaving")).not.toBeNull();
    await flush(1);
    expect(container.querySelector(".shell-loading")).toBeNull();
    expect(screen.getByTestId("child")).toBeTruthy();
  });

  it("does not hold a slow start back any longer: the fade begins as soon as the session is there", async () => {
    bootFromSplash(0);
    let resolveSession: ((value: typeof sessionResponse) => void) | undefined;
    mockFetchMe.mockImplementation(
      () => new Promise<typeof sessionResponse>((resolve) => {
        resolveSession = resolve;
      }),
    );
    const { container } = render(
      <AuthProvider>
        <div data-testid="child">ok</div>
      </AuthProvider>,
    );
    await flush(3000);
    expect(screen.queryByTestId("child")).toBeNull();

    await act(async () => {
      resolveSession!(sessionResponse);
      await vi.advanceTimersByTimeAsync(0);
    });
    await flush(0); // nothing left to wait for: the fade starts on the next tick
    expect(screen.getByTestId("child")).toBeTruthy();
    expect(container.querySelector(".shell-loading--leaving")).not.toBeNull();
  });

  it("skips the wait for reduced motion (there is no draw-in), but still fades", async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: true, media: q }));
    bootFromSplash(0);
    const { container } = render(
      <AuthProvider>
        <div data-testid="child">ok</div>
      </AuthProvider>,
    );
    await flush(0);
    await flush(0);
    expect(screen.getByTestId("child")).toBeTruthy();
    expect(container.querySelector(".shell-loading--leaving")).not.toBeNull();
  });

  it("shows a failed start straight away, not after the wait", async () => {
    bootFromSplash(0);
    mockFetchMe.mockRejectedValue(new ApiError(500, "secret_internal"));
    render(
      <AuthProvider>
        <div data-testid="child">should not render</div>
      </AuthProvider>,
    );
    await flush(0);
    expect(screen.getByText("Could not load session")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});

