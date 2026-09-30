// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import App, { PageChangeProgress, RoutesReadyMarker } from "../../src/App.js";
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

describe("App", () => {
  it("shows the page-change bar only once the first page has rendered", async () => {
    render(
      <MemoryRouter initialEntries={[{ pathname: "/admin/events/evt-1/overview", state: { event } }]}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByText("mapped event overview")).toBeTruthy();

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
