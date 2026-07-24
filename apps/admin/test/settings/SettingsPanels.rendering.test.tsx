// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditLogEntryDto, AuditLogResponse, SessionListDto } from "../../src/api/types.js";
import { ApiError, fetchAdminEvents, fetchAuditLog, fetchSessions } from "../../src/api/client.js";
import { AuditLogPanel } from "../../src/settings/AuditLogPanel.js";
import { SessionsPanel } from "../../src/settings/SessionsPanel.js";
import { renderWithToast } from "../test-utils.js";

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    fetchAdminEvents: vi.fn(),
    fetchAuditLog: vi.fn(),
    fetchSessions: vi.fn(),
  };
});

function emptyAuditLog(total = 0): AuditLogResponse {
  return { entries: [], total, page: 1, pageSize: 25 };
}

function makeAuditEntry(overrides: Partial<AuditLogEntryDto> = {}): AuditLogEntryDto {
  return {
    id: "audit-1",
    action_type: "event_created",
    actor_user_id: "user-1",
    actor_email: "alice@example.com",
    actor_display_name: "Alice Admin",
    ip: "192.0.2.10",
    metadata: { event_id: "evt-1" },
    created_at: "2026-01-01T12:00:00.000Z",
    ...overrides,
  };
}

function makeSession(overrides: Partial<SessionListDto> = {}): SessionListDto {
  return {
    id: "session-1",
    userId: "user-1",
    userEmail: "user@example.com",
    userDisplayName: null,
    role: "admin",
    deviceLabel: null,
    ip: "192.0.2.10",
    userAgent: null,
    loginAt: "2026-01-01T12:00:00.000Z",
    lastSeenAt: "2026-01-01T12:30:00.000Z",
    expiresAt: "2026-01-02T12:00:00.000Z",
    authMethod: "local",
    stage: "active",
    isCurrent: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(fetchAdminEvents).mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("AuditLogPanel rendering", () => {
  it("keeps the loading skeleton visible until the audit request settles", async () => {
    let resolveAuditLog: (response: AuditLogResponse) => void = () => {};
    vi.mocked(fetchAuditLog).mockImplementationOnce(
      () => new Promise<AuditLogResponse>((resolve) => {
        resolveAuditLog = resolve;
      }),
    );

    // useDelayedLoading only shows the skeleton once the fetch has stayed pending past its
    // 200ms grace window (avoids flashing it for a near-instant response) — fake timers must
    // be installed before render so the hook's setTimeout is one of ours.
    vi.useFakeTimers();
    renderWithToast(<AuditLogPanel />);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByLabelText("Loading audit log")).toBeTruthy();
    vi.useRealTimers();

    resolveAuditLog(emptyAuditLog());
    expect(await screen.findByText("No audit log entries found.")).toBeTruthy();
  });

  it("shows an operator-safe error and can retry the audit request", async () => {
    vi.mocked(fetchAuditLog)
      .mockRejectedValueOnce(new ApiError(500, "secret_internal"))
      .mockResolvedValueOnce(emptyAuditLog());

    renderWithToast(<AuditLogPanel />);

    const retry = await screen.findByRole("button", { name: "Retry" });
    expect(screen.getByText(/Failed to load audit log/)).toBeTruthy();
    expect(screen.queryByText("secret_internal")).toBeNull();

    fireEvent.click(retry);

    expect(await screen.findByText("No audit log entries found.")).toBeTruthy();
    expect(fetchAuditLog).toHaveBeenCalledTimes(2);
  });

  it("distinguishes unfiltered, filtered, and paginated empty results", async () => {
    vi.mocked(fetchAuditLog).mockResolvedValue(emptyAuditLog());

    renderWithToast(<AuditLogPanel />);

    expect(await screen.findByText("No audit log entries found.")).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "Action" }), {
      target: { value: "event_created" },
    });
    expect(await screen.findByText("No audit log entries match the filters.")).toBeTruthy();

    cleanup();
    vi.mocked(fetchAuditLog).mockResolvedValue(emptyAuditLog(1));
    renderWithToast(<AuditLogPanel />);

    expect(await screen.findByText("No entries on this page.")).toBeTruthy();
  });

  it("renders audit rows, translated action text, actor details, and metadata", async () => {
    vi.mocked(fetchAuditLog).mockResolvedValue({
      entries: [makeAuditEntry()],
      total: 1,
      page: 1,
      pageSize: 25,
    });

    renderWithToast(<AuditLogPanel />);

    const table = await screen.findByRole("table");
    expect(within(table).getByText("Event created")).toBeTruthy();
    expect(within(table).getByText("Alice Admin")).toBeTruthy();
    expect(within(table).getByText("alice@example.com")).toBeTruthy();
    expect(within(table).getByText("192.0.2.10")).toBeTruthy();

    const trigger = within(table).getByText("View");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(within(table).getByText(/"event_id": "evt-1"/)).toBeTruthy();
  });

  it("renders safe fallbacks when an audit entry has no IP address or metadata", async () => {
    vi.mocked(fetchAuditLog).mockResolvedValue({
      entries: [makeAuditEntry({ id: "audit-fallback", ip: null, metadata: null })],
      total: 1,
      page: 1,
      pageSize: 25,
    });

    renderWithToast(<AuditLogPanel />);

    const table = await screen.findByRole("table");
    expect(within(table).getAllByText("—")).toHaveLength(2);
    expect(within(table).queryByText("View")).toBeNull();
  });

  it("closes the Details popover via its backdrop", async () => {
    vi.mocked(fetchAuditLog).mockResolvedValue({
      entries: [makeAuditEntry()],
      total: 1,
      page: 1,
      pageSize: 25,
    });

    renderWithToast(<AuditLogPanel />);

    const table = await screen.findByRole("table");
    const trigger = within(table).getByText("View");
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(screen.getByLabelText("Close details"));
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("falls back to the actor's email, then to a deleted-user label, when the display name is missing", async () => {
    vi.mocked(fetchAuditLog).mockResolvedValue({
      entries: [
        makeAuditEntry({ id: "audit-email-only", actor_display_name: null }),
        makeAuditEntry({
          id: "audit-deleted",
          actor_display_name: null,
          actor_email: null,
          actor_user_id: "user-ghost",
        }),
      ],
      total: 2,
      page: 1,
      pageSize: 25,
    });

    renderWithToast(<AuditLogPanel />);

    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(within(rows[0]!).getByText("alice@example.com")).toBeTruthy();
    const deletedCell = within(rows[1]!).getByText("Deleted user").closest("td");
    expect(deletedCell?.getAttribute("title")).toBe("user-ghost");
  });

  it("shows the viewer's local timezone label after switching the Time column to Local", async () => {
    vi.mocked(fetchAuditLog).mockResolvedValue({
      entries: [makeAuditEntry()],
      total: 1,
      page: 1,
      pageSize: 25,
    });

    renderWithToast(<AuditLogPanel />);
    await screen.findByRole("table");
    expect(screen.getByText("Time (UTC)")).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: "Local" }));
    const tzLabel = Intl.DateTimeFormat().resolvedOptions().timeZone.split("/").pop()?.replaceAll("_", " ");
    expect(await screen.findByText(`Time (${tzLabel})`)).toBeTruthy();
  });

  it("applies the From/To date filters and resets to page 1", async () => {
    vi.mocked(fetchAuditLog).mockResolvedValue({
      entries: [makeAuditEntry()],
      total: 50,
      page: 1,
      pageSize: 25,
    });

    renderWithToast(<AuditLogPanel />);
    await screen.findByRole("table");

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Page 2 of 2 (50 total)")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-01-01" } });
    expect(await screen.findByText("Page 1 of 2 (50 total)")).toBeTruthy();
    expect(vi.mocked(fetchAuditLog).mock.calls.at(-1)![0]).toMatchObject({ page: 1, start: "2026-01-01T00:00:00.000Z" });

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Page 2 of 2 (50 total)");
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-01-31" } });
    expect(await screen.findByText("Page 1 of 2 (50 total)")).toBeTruthy();
    expect(vi.mocked(fetchAuditLog).mock.calls.at(-1)![0]).toMatchObject({ page: 1, end: "2026-01-31T23:59:59.999Z" });
  });

  it("clears the action filter and reloads unfiltered", async () => {
    vi.mocked(fetchAuditLog).mockResolvedValue(emptyAuditLog());

    renderWithToast(<AuditLogPanel />);
    await screen.findByText("No audit log entries found.");

    fireEvent.change(screen.getByRole("combobox", { name: "Action" }), {
      target: { value: "event_created" },
    });
    expect(await screen.findByText("No audit log entries match the filters.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(await screen.findByText("No audit log entries found.")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Action" })).property("value", "");
  });

  it("pages forward and back through results", async () => {
    vi.mocked(fetchAuditLog).mockResolvedValue({
      entries: [makeAuditEntry()],
      total: 50,
      page: 1,
      pageSize: 25,
    });

    renderWithToast(<AuditLogPanel />);
    expect(await screen.findByText("Page 1 of 2 (50 total)")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Previous" })).property("disabled", true);

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Page 2 of 2 (50 total)")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Next" })).property("disabled", true);
    expect(vi.mocked(fetchAuditLog).mock.calls.at(-1)![0]).toMatchObject({ page: 2 });

    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(await screen.findByText("Page 1 of 2 (50 total)")).toBeTruthy();
    expect(vi.mocked(fetchAuditLog).mock.calls.at(-1)![0]).toMatchObject({ page: 1 });
  });
});

describe("SessionsPanel rendering", () => {
  it("shows filter labels and the empty state after sessions load", async () => {
    vi.mocked(fetchSessions).mockResolvedValue({ sessions: [] });

    renderWithToast(<SessionsPanel />);

    expect(await screen.findByText("No active sessions.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "All" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Admins" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Operators" })).toBeTruthy();
  });

  it("shows an operator-safe session error and retries", async () => {
    vi.mocked(fetchSessions)
      .mockRejectedValueOnce(new ApiError(500, "secret_internal"))
      .mockResolvedValueOnce({ sessions: [] });

    renderWithToast(<SessionsPanel />);

    const retry = await screen.findByRole("button", { name: "Retry" });
    expect(document.querySelector(".sessions-status p")?.textContent).toMatch(/Failed to load sessions/);
    expect(screen.queryByText("secret_internal")).toBeNull();

    fireEvent.click(retry);

    expect(await screen.findByText("No active sessions.")).toBeTruthy();
    expect(fetchSessions).toHaveBeenCalledTimes(2);
  });

  it("renders browser and operating-system labels from user agents", async () => {
    const sessions = [
      makeSession({
        id: "edge",
        userEmail: "edge@example.com",
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36 Edg/120.0",
      }),
      makeSession({
        id: "opera",
        userEmail: "opera@example.com",
        userAgent:
          "Mozilla/5.0 (Mac OS X 13_0) AppleWebKit/537.36 Chrome/120.0 Safari/537.36 OPR/106.0",
      }),
      makeSession({
        id: "chrome",
        userEmail: "chrome@example.com",
        userAgent:
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
      }),
      makeSession({
        id: "firefox",
        userEmail: "firefox@example.com",
        userAgent: "Mozilla/5.0 (Android 14; Mobile; rv:123.0) Gecko/123.0 Firefox/123.0",
      }),
      makeSession({
        id: "safari",
        userEmail: "safari@example.com",
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1",
      }),
      makeSession({
        id: "unknown",
        userEmail: "unknown@example.com",
        userAgent: "CustomScanner/1.0",
      }),
      makeSession({
        id: "missing",
        userEmail: "missing@example.com",
        userAgent: null,
      }),
      makeSession({
        id: "labelled",
        userEmail: "labelled@example.com",
        deviceLabel: "Managed kiosk",
        userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/120.0",
      }),
    ];
    vi.mocked(fetchSessions).mockResolvedValue({ sessions });

    renderWithToast(<SessionsPanel />);

    const table = await screen.findByRole("table");
    for (const label of [
      "Edge / Windows",
      "Opera / macOS",
      "Chrome / Linux",
      "Firefox / Android",
      "Safari / iOS",
      "CustomScanner/1.0",
      "Unknown",
      "Managed kiosk",
    ]) {
      expect(within(table).getByText(label)).toBeTruthy();
    }
  });

  it("includes a device label in the revoke confirmation only when one is available", async () => {
    vi.mocked(fetchSessions).mockResolvedValue({
      sessions: [
        makeSession({
          id: "with-device",
          userEmail: "device@example.com",
          deviceLabel: "Desk iPad",
        }),
        makeSession({
          id: "without-device",
          userEmail: "plain@example.com",
          deviceLabel: null,
        }),
      ],
    });

    renderWithToast(<SessionsPanel />);

    await screen.findByRole("table");
    const withDeviceRow = screen.getByText("device@example.com").closest("tr");
    expect(withDeviceRow).toBeTruthy();
    fireEvent.click(within(withDeviceRow!).getByRole("button", { name: "Revoke" }));
    const withDeviceDialog = await screen.findByRole("dialog");
    expect(withDeviceDialog.textContent).toContain("device@example.com (Desk iPad)? Last active");
    fireEvent.click(within(withDeviceDialog).getByRole("button", { name: "Cancel" }));

    const withoutDeviceRow = screen.getByText("plain@example.com").closest("tr");
    expect(withoutDeviceRow).toBeTruthy();
    fireEvent.click(within(withoutDeviceRow!).getByRole("button", { name: "Revoke" }));
    const withoutDeviceDialog = await screen.findByRole("dialog");
    expect(withoutDeviceDialog.textContent).toContain("plain@example.com? Last active");
  });
});
