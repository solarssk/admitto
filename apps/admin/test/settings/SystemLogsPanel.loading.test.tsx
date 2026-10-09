// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SystemLogEntryDto, SystemLogResponse } from "../../src/api/types.js";
import { LOAD_TIMEOUT_MESSAGE } from "../../src/utils/loading-timing.js";
import { advanceTimers, hangUntilAborted, renderWithToast } from "../test-utils.js";
import { describePanelLoading } from "./panel-loading.js";

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return { ...actual, fetchSystemLogs: vi.fn() };
});

import { ApiError, fetchSystemLogs } from "../../src/api/client.js";
import {
  resetPollIntervalMsForTests,
  setPollIntervalMsForTests,
  SystemLogsPanel,
} from "../../src/settings/SystemLogsPanel.js";

const mockFetch = vi.mocked(fetchSystemLogs);

function entry(id: number, message: string): SystemLogEntryDto {
  return { id, ts: "2026-10-02T12:00:00.000Z", level: "info", source: "api", message };
}

function answer(...entries: SystemLogEntryDto[]): SystemLogResponse {
  return { entries, cursor: entries.length };
}

function renderPanel() {
  return renderWithToast(<SystemLogsPanel isDesktop isVisible={false} />);
}

function renderPanelVisible() {
  return renderWithToast(<SystemLogsPanel isDesktop isVisible />);
}

beforeEach(() => {
  // Not visible: the live poll stays off, so only the snapshot requests are made.
  mockFetch.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  resetPollIntervalMsForTests();
});

describePanelLoading({
  label: "Loading system logs",
  errorTitle: LOAD_TIMEOUT_MESSAGE,
  render: () => renderPanel(),
  hang: () => mockFetch.mockImplementationOnce(hangUntilAborted),
});

describe("SystemLogsPanel loading", () => {
  it("shows no 'Loading system logs…' text: the console's placeholder is lines in the dark shell, named for assistive tech", () => {
    mockFetch.mockImplementationOnce(hangUntilAborted);
    renderPanel();
    expect(screen.queryByText("Loading system logs…")).toBeNull();
    const region = screen.getByLabelText("Loading system logs");
    expect(region.tagName).toBe("OUTPUT");
    expect(region.closest(".system-log-panel__console")).toBeTruthy();
  });

  it("shows the lines once the first load has answered, with no placeholder", async () => {
    mockFetch.mockResolvedValueOnce(answer(entry(1, "http_request")));
    renderPanel();
    expect(await screen.findByText("http_request")).toBeTruthy();
    expect(screen.queryByLabelText("Loading system logs")).toBeNull();
  });

  it("jumps to the newest lines when the lines replace a placeholder that was drawn, not while it still fills the console", async () => {
    // jsdom has no layout: a console taller than its viewport, as a full live tail is.
    const scrollHeight = Object.getOwnPropertyDescriptor(Element.prototype, "scrollHeight")!;
    const clientHeight = Object.getOwnPropertyDescriptor(Element.prototype, "clientHeight")!;
    Object.defineProperty(Element.prototype, "scrollHeight", { configurable: true, get: () => 4000 });
    Object.defineProperty(Element.prototype, "clientHeight", { configurable: true, get: () => 400 });
    try {
      setPollIntervalMsForTests(600_000);
      vi.useFakeTimers();
      let resolveFirst: (value: SystemLogResponse) => void = () => {};
      mockFetch.mockReturnValueOnce(new Promise((resolve) => (resolveFirst = resolve)));
      renderWithToast(<SystemLogsPanel isDesktop isVisible />);
      await advanceTimers(300);
      expect(screen.getByLabelText("Loading system logs").className).not.toContain("at-loading-hold");
      await act(async () => resolveFirst(answer(entry(1, "newest line"))));
      // The answer is in, but the drawn placeholder stays for 400ms: the console is not showing lines yet. A real
      // browser has the scroll position at 0 under a short placeholder.
      const consoleEl = document.querySelector<HTMLElement>(".system-log-panel__console")!;
      consoleEl.scrollTop = 0;
      expect(screen.queryByText("newest line")).toBeNull();
      await advanceTimers(400);
      expect(screen.getByText("newest line")).toBeTruthy();
      expect(consoleEl.scrollTop).toBe(4000);
    } finally {
      Object.defineProperty(Element.prototype, "scrollHeight", scrollHeight);
      Object.defineProperty(Element.prototype, "clientHeight", clientHeight);
    }
  });

  it("moves the focus the console's Retry held to the tab panel when the retry works", async () => {
    mockFetch.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderWithToast(
      <div role="tabpanel" aria-label="Logs">
        <SystemLogsPanel isDesktop isVisible={false} />
      </div>,
    );
    const retry = await screen.findByRole("button", { name: "Retry" });
    retry.focus();
    mockFetch.mockResolvedValueOnce(answer(entry(1, "http_request")));
    fireEvent.click(retry);
    await screen.findByText("http_request");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("tabpanel")));
  });

  it("keeps the console's error and its busy Retry on screen when Retry now in the warning banner reloads", async () => {
    setPollIntervalMsForTests(5);
    // Every request fails until released: the first load, then the polls that bring up the banner.
    let failing = true;
    // Once released, every request (the reload, and the polls that keep ticking) waits for the answer.
    const pending: Array<(value: SystemLogResponse) => void> = [];
    mockFetch.mockImplementation(() =>
      failing ? Promise.reject(new ApiError(500, "secret_internal")) : new Promise((resolve) => pending.push(resolve)),
    );
    renderPanelVisible();
    const retryNow = await screen.findByRole("button", { name: "Retry now" });
    failing = false;
    fireEvent.click(retryNow);
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry" }).getAttribute("aria-busy")).toBe("true"));
    expect(screen.getByText("Could not load system logs.")).toBeTruthy();
    expect(screen.queryByLabelText("Loading system logs")).toBeNull();
    await act(async () => {
      for (const resolve of pending.splice(0)) resolve(answer(entry(1, "recovered")));
    });
    expect(await screen.findByText("recovered")).toBeTruthy();
  });

  it("keeps the error and a busy Retry on screen while it loads again, then shows the lines", async () => {
    mockFetch.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderPanel();
    const retry = await screen.findByRole("button", { name: "Retry" });
    expect(screen.getByRole("alert").textContent).toContain("Could not load system logs.");
    expect(screen.queryByText("secret_internal")).toBeNull();
    // The console's failure starts with the glyph a failed load has everywhere, hidden from assistive tech.
    const failureGlyph = screen.getByRole("alert").querySelector("p > i.ti-circle-x.failure-icon--large");
    expect(failureGlyph?.getAttribute("aria-hidden")).toBe("true");
    let resolveRetry: (value: SystemLogResponse) => void = () => {};
    mockFetch.mockReturnValueOnce(new Promise((resolve) => (resolveRetry = resolve)));
    fireEvent.click(retry);
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry" }).getAttribute("aria-busy")).toBe("true"));
    expect(screen.getByRole("alert").textContent).toContain("Could not load system logs.");
    expect(screen.queryByLabelText("Loading system logs")).toBeNull();
    await act(async () => resolveRetry(answer(entry(1, "http_request"))));
    expect(await screen.findByText("http_request")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("says a failure that a Retry did not clear again, as a new message, without replacing the Retry that holds the focus", async () => {
    mockFetch.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderPanel();
    const retry = await screen.findByRole("button", { name: "Retry" });
    const message = screen.getByText("Could not load system logs.");
    retry.focus();
    mockFetch.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    fireEvent.click(retry);
    await waitFor(() => expect(screen.getByText("Could not load system logs.")).not.toBe(message));
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry" }).getAttribute("aria-busy")).toBeNull());
    expect(screen.getByRole("button", { name: "Retry" })).toBe(retry);
    expect(document.activeElement).toBe(retry);
  });

  it("keeps the lines on screen, blocked and marked busy, while a changed filter loads, and shows the new ones after", async () => {
    mockFetch.mockResolvedValueOnce(answer(entry(1, "first line")));
    renderPanel();
    await screen.findByText("first line");
    let resolveNext: (value: SystemLogResponse) => void = () => {};
    mockFetch.mockReturnValueOnce(new Promise((resolve) => (resolveNext = resolve)));
    fireEvent.change(screen.getByLabelText("Search message text"), { target: { value: "mail" } });
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    expect(screen.getByText("first line")).toBeTruthy();
    expect(document.querySelector(".refetch-card--busy")?.getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByLabelText("Loading system logs")).toBeNull();
    await act(async () => resolveNext(answer(entry(2, "second line"))));
    expect(await screen.findByText("second line")).toBeTruthy();
    expect(screen.queryByText("first line")).toBeNull();
    expect(document.querySelector(".refetch-card--busy")).toBeNull();
  });

  it("replaces the lines with the error when a changed filter fails to load", async () => {
    mockFetch.mockResolvedValueOnce(answer(entry(1, "first line")));
    renderPanel();
    await screen.findByText("first line");
    mockFetch.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    fireEvent.change(screen.getByLabelText("Search message text"), { target: { value: "mail" } });
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.queryByText("first line")).toBeNull();
  });
});
