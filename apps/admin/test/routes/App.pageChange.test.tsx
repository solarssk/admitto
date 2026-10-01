// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useNavigate } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import App, { PageChangeProgress, RouteFallback, RoutesReadyMarker } from "../../src/App.js";
import { SLOW_NOTICE_TEXT } from "../../src/utils/loading-timing.js";
import type { EventDto } from "../../src/api/types.js";
import { trackChunk } from "../../src/utils/lazy-route.js";

vi.mock("../../src/auth/AuthProvider.js", () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useAuth: () => ({ assignments: [], setupComplete: true, refresh: async () => {} }),
}));

vi.mock("../../src/connection/ConnectionStateProvider.js", () => ({
  ConnectionStateProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("../../src/auth/capabilities.js", () => ({
  isSuperadmin: () => false,
}));

vi.mock("../../src/auth/RoleRouter.js", async () => {
  const { Outlet } = await import("react-router");
  return {
    AdminGuard: () => <Outlet />,
    AuthenticatedGuard: () => <Outlet />,
    OperatorGuard: () => <Outlet />,
    SuperadminGuard: () => <Outlet />,
  };
});

vi.mock("../../src/layouts/AdminShell.js", async () => {
  const { Outlet } = await import("react-router");
  return { AdminShell: () => <Outlet /> };
});

vi.mock("../../src/pages/EventOverviewPage.js", () => ({
  EventOverviewPage: () => <div>mapped event overview</div>,
}));

const event = {
  id: "evt-1",
  title: "Spring Gala",
  slug: "spring-gala",
  date: "2026-09-01",
  timezone: "UTC",
  location: "Hall A",
  archived_at: null,
} as EventDto;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("RoutesReadyMarker", () => {
  it("reports that the first page has rendered, once it is mounted", () => {
    const onReady = vi.fn();
    render(<RoutesReadyMarker onReady={onReady} />);
    expect(onReady).toHaveBeenCalledTimes(1);
  });
});

describe("PageChangeProgress", () => {
  it("stays out of the way while disabled, even with a page downloading (the start screen already says it)", async () => {
    vi.useFakeTimers();
    render(<PageChangeProgress enabled={false} />);
    const slow = deferred();
    act(() => {
      void trackChunk(slow.promise);
    });
    await advance(1000);
    expect(screen.queryByRole("status", { name: "Loading page" })).toBeNull();
    slow.resolve();
    await advance(0);
  });

  it("shows the bar after the 200ms delay, keeps it at least 400ms, then lets it finish", async () => {
    vi.useFakeTimers();
    render(<PageChangeProgress enabled />);
    const slow = deferred();
    act(() => {
      void trackChunk(slow.promise);
    });
    await advance(199);
    expect(screen.queryByRole("status", { name: "Loading page" })).toBeNull();
    await advance(1);
    expect(screen.getByRole("status", { name: "Loading page" }).getAttribute("data-phase")).toBe("running");

    slow.resolve();
    await advance(0);
    expect(screen.getByRole("status", { name: "Loading page" }).getAttribute("data-phase")).toBe("running");
    await advance(400);
    expect(screen.getByRole("status", { name: "Loading page" }).getAttribute("data-phase")).toBe("finishing");
    await advance(300);
    expect(screen.queryByRole("status", { name: "Loading page" })).toBeNull();
  });

  it("never shows it for a chunk that arrives inside the delay", async () => {
    vi.useFakeTimers();
    render(<PageChangeProgress enabled />);
    const quick = deferred();
    act(() => {
      void trackChunk(quick.promise);
    });
    await advance(100);
    quick.resolve();
    await advance(1000);
    expect(screen.queryByRole("status", { name: "Loading page" })).toBeNull();
  });
});

describe("PageChangeProgress when the user has moved on", () => {
  it("lets go of a download that belongs to a page the user has already left, bar and slow line included", async () => {
    vi.useFakeTimers();
    const { rerender } = render(<PageChangeProgress enabled locationKey="a" />);
    const abandoned = deferred();
    act(() => {
      void trackChunk(abandoned.promise);
    });
    await advance(200);
    expect(screen.getByRole("status", { name: "Loading page" })).toBeTruthy();

    // A newer page rendered (the location changed): the first download is still running but obsolete.
    rerender(<PageChangeProgress enabled locationKey="b" />);
    await advance(0);
    await advance(400);
    await advance(300);
    expect(screen.queryByRole("status", { name: "Loading page" })).toBeNull();
    await advance(9000);
    expect(screen.queryByText(SLOW_NOTICE_TEXT)).toBeNull();

    abandoned.resolve();
    await advance(0);
    expect(screen.queryByRole("status", { name: "Loading page" })).toBeNull();
  });

  it("still shows the bar for a download started after the page changed", async () => {
    vi.useFakeTimers();
    const { rerender } = render(<PageChangeProgress enabled locationKey="a" />);
    rerender(<PageChangeProgress enabled locationKey="b" />);
    const next = deferred();
    act(() => {
      void trackChunk(next.promise);
    });
    await advance(200);
    expect(screen.getByRole("status", { name: "Loading page" })).toBeTruthy();
    next.resolve();
    await advance(0);
  });
});

describe("PageChangeProgress slow note", () => {
  it("adds the taking-longer line to the bar after 8 seconds, and takes it away when the page arrives", async () => {
    vi.useFakeTimers();
    render(<PageChangeProgress enabled />);
    const slow = deferred();
    act(() => {
      void trackChunk(slow.promise);
    });
    await advance(7999);
    expect(screen.getByRole("status", { name: "Loading page" })).toBeTruthy();
    expect(screen.queryByText(SLOW_NOTICE_TEXT)).toBeNull();

    await advance(1);
    expect(screen.getByText(SLOW_NOTICE_TEXT)).toBeTruthy();

    slow.resolve();
    await advance(0);
    await advance(400);
    expect(screen.queryByText(SLOW_NOTICE_TEXT)).toBeNull();
  });

  it("never shows the line while disabled", async () => {
    vi.useFakeTimers();
    render(<PageChangeProgress enabled={false} />);
    const slow = deferred();
    act(() => {
      void trackChunk(slow.promise);
    });
    await advance(9000);
    expect(screen.queryByText(SLOW_NOTICE_TEXT)).toBeNull();
    slow.resolve();
    await advance(0);
  });
});

describe("RouteFallback", () => {
  it("shows the start loader at once and the taking-longer line only after 8 seconds", async () => {
    vi.useFakeTimers();
    render(<RouteFallback />);
    expect(screen.getByRole("status", { name: "Loading page" })).toBeTruthy();
    // The line under the logo says what is loading, not just that something is.
    expect(screen.getByText("Loading page…")).toBeTruthy();
    // Structurally, too: the page-change bar has the same default name, so the name alone does not tell them apart.
    expect(document.querySelector(".shell-loading .at-loader--page")).not.toBeNull();
    await advance(7999);
    expect(screen.queryByText(SLOW_NOTICE_TEXT)).toBeNull();
    await advance(1);
    expect(screen.getByText(SLOW_NOTICE_TEXT)).toBeTruthy();
  });
});

describe("App when a newer page renders while an older download is still running", () => {
  it("stops showing the bar, and its slow line, for the download of the page that was left", async () => {
    let go!: (to: string) => void;
    function Nav() {
      const navigate = useNavigate();
      go = (to) => void navigate(to);
      return null;
    }
    render(
      <MemoryRouter initialEntries={[{ pathname: "/admin/events/evt-1/overview", state: { event } }]}>
        <Nav />
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByText("mapped event overview")).toBeTruthy();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });

    vi.useFakeTimers();
    const abandoned = deferred();
    act(() => {
      void trackChunk(abandoned.promise);
    });
    await advance(200);
    expect(screen.getByRole("status", { name: "Loading page" })).toBeTruthy();

    // The user moves on to a page that renders at once; the first download is still running.
    act(() => {
      go("/admin/events/evt-1/overview?tab=2");
    });
    await advance(0);
    await advance(400);
    await advance(300);
    expect(screen.queryByRole("status", { name: "Loading page" })).toBeNull();
    await advance(9000);
    expect(screen.queryByText(SLOW_NOTICE_TEXT)).toBeNull();
    abandoned.resolve();
    await advance(0);
  });
});

describe("App", () => {
  it("shows the page-change bar only once the first page has rendered", async () => {
    render(
      <MemoryRouter initialEntries={[{ pathname: "/admin/events/evt-1/overview", state: { event } }]}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByText("mapped event overview")).toBeTruthy();
    // EventLayout replaces the entry that carried the event in its state, which is one more committed
    // location; let it land before the clock is faked, or it would supersede the download below.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });

    vi.useFakeTimers();
    const slow = deferred();
    act(() => {
      void trackChunk(slow.promise);
    });
    await advance(200);
    expect(screen.getByRole("status", { name: "Loading page" })).toBeTruthy();
    slow.resolve();
    // One step per stage: React commits state between them, which one big jump would skip past.
    await advance(0);
    await advance(400); // the shown bar stays at least 400ms
    await advance(300); // then finishes and fades
    expect(screen.queryByRole("status", { name: "Loading page" })).toBeNull();
  });
});
