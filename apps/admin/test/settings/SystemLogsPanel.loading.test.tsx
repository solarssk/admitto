// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SystemLogEntryDto, SystemLogResponse } from "../../src/api/types.js";
import { LOAD_TIMEOUT_MESSAGE } from "../../src/utils/loading-timing.js";
import { hangUntilAborted, renderWithToast } from "../test-utils.js";
import { describePanelLoading } from "./panel-loading.js";

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return { ...actual, fetchSystemLogs: vi.fn() };
});

import { fetchSystemLogs } from "../../src/api/client.js";
import { SystemLogsPanel } from "../../src/settings/SystemLogsPanel.js";
import { ApiError } from "../../src/api/client.js";

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

beforeEach(() => {
  // Not visible: the live poll stays off, so only the snapshot requests are made.
  mockFetch.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
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

  it("keeps the error and a busy Retry on screen while it loads again, then shows the lines", async () => {
    mockFetch.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderPanel();
    const retry = await screen.findByRole("button", { name: "Retry" });
    expect(screen.getByRole("alert").textContent).toContain("Could not load system logs.");
    expect(screen.queryByText("secret_internal")).toBeNull();
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
