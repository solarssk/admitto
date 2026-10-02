// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditLogEntryDto, AuditLogResponse, SecurityAuditLogResponse, SystemLogResponse } from "../../src/api/types.js";
import { hangUntilAborted, mockMatchMedia, renderWithToast } from "../test-utils.js";
import { describePanelLoading } from "./panel-loading.js";

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    fetchAdminEvents: vi.fn(),
    fetchAuditLog: vi.fn(),
    fetchSecurityAuditLog: vi.fn(),
    exportAuditLog: vi.fn(),
    exportSecurityAuditLog: vi.fn(),
    fetchSystemLogs: vi.fn(),
  };
});

vi.mock("../../src/connection/ConnectionStateProvider.js", () => ({
  useConnectionState: () => ({ reportApiError: vi.fn() }),
}));

import {
  ApiError,
  exportAuditLog,
  exportSecurityAuditLog,
  fetchAdminEvents,
  fetchAuditLog,
  fetchSecurityAuditLog,
  fetchSystemLogs,
} from "../../src/api/client.js";
import { AuditLogPanel } from "../../src/settings/AuditLogPanel.js";
import { resetPollIntervalMsForTests, setPollIntervalMsForTests } from "../../src/settings/SystemLogsPanel.js";

const mockAudit = vi.mocked(fetchAuditLog);
const mockExport = vi.mocked(exportAuditLog);

function entry(id: string, actionType = "event_created"): AuditLogEntryDto {
  return {
    id,
    action_type: actionType,
    actor_user_id: "user-1",
    actor_email: "alice@example.com",
    actor_display_name: "Alice Admin",
    actor_timezone: null,
    ip: "192.0.2.10",
    country: { kind: "unknown" },
    metadata: null,
    created_at: "2026-01-01T12:00:00.000Z",
  };
}

function page(entries: AuditLogEntryDto[], total = entries.length): AuditLogResponse {
  return { entries, total, page: 1, pageSize: 25 };
}

/** The panel opens on the System view; every test here is about the Audit side. */
function renderAuditPanel() {
  const result = renderWithToast(<AuditLogPanel />);
  fireEvent.click(screen.getByRole("radio", { name: "Audit" }));
  return result;
}

beforeEach(() => {
  // Desktop layout: the table, and the Export logs button in the card header.
  mockMatchMedia(true);
  // No live poll tick during a test: a tick would take the answer a test has queued for something else.
  setPollIntervalMsForTests(600_000);
  // jsdom does not implement scrollIntoView (a page change scrolls the list back into view).
  Element.prototype.scrollIntoView = vi.fn();
  vi.mocked(fetchAdminEvents).mockResolvedValue([]);
  mockAudit.mockResolvedValue(page([]));
  vi.mocked(fetchSecurityAuditLog).mockResolvedValue({ entries: [], total: 0, page: 1, pageSize: 25 } as SecurityAuditLogResponse);
  vi.mocked(fetchSystemLogs).mockResolvedValue({ entries: [], cursor: 0 } as SystemLogResponse);
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetPollIntervalMsForTests();
});

describePanelLoading({
  label: "Loading audit log",
  errorTitle: "Could not load audit log",
  render: () => renderAuditPanel(),
  hang: () => mockAudit.mockImplementationOnce(hangUntilAborted),
});

describe("AuditLogPanel loading", () => {
  it("keeps the error and a busy Retry on screen while it loads again, never an empty state", async () => {
    mockAudit.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderAuditPanel();
    const retry = await screen.findByRole("button", { name: "Retry" });
    let resolveRetry: (value: AuditLogResponse) => void = () => {};
    mockAudit.mockReturnValueOnce(new Promise((resolve) => (resolveRetry = resolve)));
    fireEvent.click(retry);
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry" }).getAttribute("aria-busy")).toBe("true"));
    expect(screen.getByText("Could not load audit log")).toBeTruthy();
    expect(screen.queryByText("No audit log entries yet")).toBeNull();
    await act(async () => resolveRetry(page([entry("a1")])));
    expect(await screen.findByText("Event created")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("says a failure that a Retry did not clear again, as a new message, without replacing the Retry that holds the focus", async () => {
    mockAudit.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderAuditPanel();
    const retry = await screen.findByRole("button", { name: "Retry" });
    const message = screen.getByText("Could not load audit log.");
    retry.focus();
    mockAudit.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    fireEvent.click(retry);
    await waitFor(() => expect(screen.getByText("Could not load audit log.")).not.toBe(message));
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry" }).getAttribute("aria-busy")).toBeNull());
    expect(screen.getByRole("button", { name: "Retry" })).toBe(retry);
    expect(document.activeElement).toBe(retry);
  });

  it("leaves a list that failed to load to a placeholder, not to 'No entries yet', when a filter changes", async () => {
    mockAudit.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderAuditPanel();
    await screen.findByText("Could not load audit log");
    let resolveNext: (value: AuditLogResponse) => void = () => {};
    mockAudit.mockReturnValueOnce(new Promise((resolve) => (resolveNext = resolve)));
    fireEvent.change(screen.getByLabelText("Search user or event"), { target: { value: "event" } });
    await waitFor(() => expect(mockAudit).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText("Loading audit log")).toBeTruthy();
    expect(screen.queryByText("No audit log entries yet")).toBeNull();
    expect(screen.queryByText("No matches")).toBeNull();
    await act(async () => resolveNext(page([entry("a1")])));
    expect(await screen.findByText("Event created")).toBeTruthy();
  });

  it("keeps the list's error and its busy Retry on screen when Retry now in the warning banner reloads", async () => {
    setPollIntervalMsForTests(5);
    // Every request fails until released: the first load, then the live polls that bring up the banner.
    let failing = true;
    const pending: Array<(value: AuditLogResponse) => void> = [];
    mockAudit.mockImplementation(() =>
      failing ? Promise.reject(new ApiError(500, "secret_internal")) : new Promise((resolve) => pending.push(resolve)),
    );
    renderAuditPanel();
    const retryNow = await screen.findByRole("button", { name: "Retry now" });
    failing = false;
    fireEvent.click(retryNow);
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry" }).getAttribute("aria-busy")).toBe("true"));
    expect(screen.getByText("Could not load audit log")).toBeTruthy();
    expect(screen.queryByText("No audit log entries yet")).toBeNull();
    await act(async () => {
      for (const resolve of pending.splice(0)) resolve(page([entry("a1")]));
    });
    expect(await screen.findByText("Event created")).toBeTruthy();
  });

  it("moves the focus the list's Retry held to the tab panel when the retry works", async () => {
    mockAudit.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderWithToast(
      <div role="tabpanel" aria-label="Logs">
        <AuditLogPanel />
      </div>,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Audit" }));
    const retry = await screen.findByRole("button", { name: "Retry" });
    retry.focus();
    mockAudit.mockResolvedValueOnce(page([entry("a1")]));
    fireEvent.click(retry);
    await screen.findByText("Event created");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("tabpanel")));
  });

  it("keeps the rows on screen, blocked and marked busy, while a page change loads", async () => {
    mockAudit.mockResolvedValueOnce(page([entry("a1")], 60));
    renderAuditPanel();
    await screen.findByText("Event created");
    let resolveNext: (value: AuditLogResponse) => void = () => {};
    mockAudit.mockReturnValueOnce(new Promise((resolve) => (resolveNext = resolve)));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(document.querySelector(".refetch-card--busy")?.getAttribute("aria-busy")).toBe("true"));
    expect(screen.getByText("Event created")).toBeTruthy();
    expect(screen.queryByLabelText("Loading audit log")).toBeNull();
    await act(async () => resolveNext(page([entry("a2", "event_archived")], 60)));
    expect(await screen.findByText("Event archived")).toBeTruthy();
    expect(document.querySelector(".refetch-card--busy")).toBeNull();
  });

  it("keeps an empty answer on screen, blocked and marked busy, while a filter change loads, and describes the new answer when it is in", async () => {
    renderAuditPanel();
    expect(await screen.findByText("No audit log entries yet")).toBeTruthy();
    let resolveNext: (value: AuditLogResponse) => void = () => {};
    mockAudit.mockReturnValueOnce(new Promise((resolve) => (resolveNext = resolve)));
    fireEvent.change(screen.getByLabelText("Search user or event"), { target: { value: "event" } });
    await waitFor(() => expect(mockAudit).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(document.querySelector(".refetch-card--busy")?.getAttribute("aria-busy")).toBe("true"));
    expect(document.querySelector(".refetch-card--busy")?.textContent).toContain("No audit log entries yet");
    expect(screen.queryByText("No matches")).toBeNull();
    expect(screen.queryByLabelText("Loading audit log")).toBeNull();
    await act(async () => resolveNext(page([])));
    expect(await screen.findByText("No matches")).toBeTruthy();
    expect(document.querySelector(".refetch-card--busy")).toBeNull();
  });

  it("keeps the Security view's empty answer on screen, blocked and marked busy, while a filter change loads", async () => {
    renderAuditPanel();
    fireEvent.click(screen.getByRole("radio", { name: "Security" }));
    expect(await screen.findByText("No security events yet")).toBeTruthy();
    let resolveNext: (value: SecurityAuditLogResponse) => void = () => {};
    vi.mocked(fetchSecurityAuditLog).mockReturnValueOnce(new Promise((resolve) => (resolveNext = resolve)));
    fireEvent.change(screen.getByLabelText("Search user"), { target: { value: "login" } });
    await waitFor(() => expect(vi.mocked(fetchSecurityAuditLog)).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(document.querySelector(".refetch-card--busy")?.getAttribute("aria-busy")).toBe("true"));
    expect(document.querySelector(".refetch-card--busy")?.textContent).toContain("No security events yet");
    expect(screen.queryByText("No matches")).toBeNull();
    await act(async () => resolveNext({ entries: [], total: 0, page: 1, pageSize: 25 } as SecurityAuditLogResponse));
    expect(await screen.findByText("No matches")).toBeTruthy();
  });

  it("keeps the Security view's Export logs focusable and busy as Exporting… too, on its own flag", async () => {
    renderAuditPanel();
    fireEvent.click(screen.getByRole("radio", { name: "Security" }));
    let resolveExport: () => void = () => {};
    vi.mocked(exportSecurityAuditLog).mockReturnValueOnce(new Promise<void>((resolve) => (resolveExport = resolve)));
    fireEvent.click(screen.getByRole("button", { name: "Export logs" }));
    const busy = await screen.findByRole("button", { name: "Exporting…" });
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect((busy as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(busy);
    expect(vi.mocked(exportSecurityAuditLog)).toHaveBeenCalledTimes(1);
    expect(mockExport).not.toHaveBeenCalled();
    await act(async () => resolveExport());
    await waitFor(() => expect(busy.getAttribute("aria-busy")).toBeNull());
  });

  it("keeps Export logs focusable and busy as Exporting… while the file is made, and ignores a second click", async () => {
    mockAudit.mockResolvedValueOnce(page([entry("a1")]));
    renderAuditPanel();
    await screen.findByText("Event created");
    let resolveExport: () => void = () => {};
    mockExport.mockReturnValueOnce(new Promise<void>((resolve) => (resolveExport = resolve)));
    fireEvent.click(screen.getByRole("button", { name: "Export logs" }));
    const busy = await screen.findByRole("button", { name: "Exporting…" });
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect((busy as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(busy);
    expect(mockExport).toHaveBeenCalledTimes(1);
    await act(async () => resolveExport());
    await waitFor(() => expect(busy.getAttribute("aria-busy")).toBeNull());
  });
});
