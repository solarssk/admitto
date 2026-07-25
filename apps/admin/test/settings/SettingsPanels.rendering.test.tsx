// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditLogEntryDto, AuditLogResponse, SessionListDto } from "../../src/api/types.js";
import { ApiError, fetchAdminEvents, fetchAuditLog, fetchSessions } from "../../src/api/client.js";
import { AuditLogPanel } from "../../src/settings/AuditLogPanel.js";
import { SessionsPanel } from "../../src/settings/SessionsPanel.js";
import { renderWithToast } from "../test-utils.js";
import { zonedDayEndIso, zonedDayStartIso } from "../../src/utils/event-dates.js";

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
    // The details panel portals into document.body (bot review: it must escape the table
    // wrap's own clipping), so it's no longer a descendant of `table`.
    expect(screen.getByText(/"event_id": "evt-1"/)).toBeTruthy();
  });

  it("renders the details popover outside .sessions-table-wrap so its own overflow can't clip it (bot review)", async () => {
    // .sessions-table-wrap sets overflow-x: auto, which per the CSS spec also computes
    // overflow-y to auto (not the default visible) - a popover left in-flow inside it could
    // open below the wrap's own clipped/scrollable bounds for a row near the bottom.
    vi.mocked(fetchAuditLog).mockResolvedValue({
      entries: [makeAuditEntry()],
      total: 1,
      page: 1,
      pageSize: 25,
    });
    renderWithToast(<AuditLogPanel />);

    const table = await screen.findByRole("table");
    fireEvent.click(within(table).getByText("View"));

    const panel = screen.getByText(/"event_id": "evt-1"/);
    const wrap = document.querySelector(".sessions-table-wrap");
    expect(wrap?.contains(panel)).toBe(false);
    expect(document.body.contains(panel)).toBe(true);
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

  it("switches the Time column to the viewer's local timezone", async () => {
    vi.mocked(fetchAuditLog).mockResolvedValue({
      entries: [makeAuditEntry()],
      total: 1,
      page: 1,
      pageSize: 25,
    });

    renderWithToast(<AuditLogPanel />);

    await screen.findByRole("table");
    expect(screen.getByText("Time (UTC)")).toBeTruthy();

    const localRadio = screen.getByRole("radio", { name: "Local" });
    fireEvent.click(localRadio);

    expect(localRadio.getAttribute("aria-checked")).toBe("true");
    // Switching time mode now also reloads (the date filters need to reload in the
    // newly-selected zone too) - await the table reappearing before reading its header text.
    await screen.findByRole("table");
    // The expected label depends on the test runner's own timezone (a developer's machine vs.
    // CI, which typically runs in UTC) - computed the same way AuditLogPanel itself derives it,
    // instead of assuming "Local" always renders a different string than "Time (UTC)", which
    // isn't true when the runner's own local zone happens to be UTC.
    const viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const viewerTzLabel = viewerTz.split("/").pop()?.replaceAll("_", " ") ?? viewerTz;
    expect(screen.getByText(`Time (${viewerTzLabel})`)).toBeTruthy();
  });

  it("recomputes the viewer's timezone on each use instead of caching it once at module load (Sonar/PO review)", async () => {
    // A module-level `const VIEWER_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone`
    // would only ever call the zero-arg Intl.DateTimeFormat() once, at first import - stale
    // for the rest of a long-lived session if the browser's timezone changes. Recomputing it
    // per use means a second visit to "Local" mode makes a fresh zero-arg call.
    vi.mocked(fetchAuditLog).mockResolvedValue({
      entries: [makeAuditEntry()],
      total: 1,
      page: 1,
      pageSize: 25,
    });
    const spy = vi.spyOn(Intl, "DateTimeFormat");

    renderWithToast(<AuditLogPanel />);
    await screen.findByRole("table");

    const localRadio = screen.getByRole("radio", { name: "Local" });
    const utcRadio = screen.getByRole("radio", { name: "UTC" });

    fireEvent.click(localRadio);
    // Switching time mode now also reloads (fixed below: the date filters need to reload in
    // the newly-selected zone too) - await the table reappearing so the reload settles before
    // counting, instead of catching mid-flight state with nothing rendered yet.
    await screen.findByRole("table");
    const zeroArgCallsAfterFirstToggle = spy.mock.calls.filter((args) => args.length === 0).length;
    expect(zeroArgCallsAfterFirstToggle).toBeGreaterThan(0);

    fireEvent.click(utcRadio);
    await screen.findByRole("table");
    fireEvent.click(localRadio);
    await screen.findByRole("table");
    const zeroArgCallsAfterSecondToggle = spy.mock.calls.filter((args) => args.length === 0).length;
    expect(zeroArgCallsAfterSecondToggle).toBeGreaterThan(zeroArgCallsAfterFirstToggle);

    spy.mockRestore();
  });

  it("paginates via Previous/Next and restores scroll position once the next page has loaded", async () => {
    vi.mocked(fetchAuditLog).mockResolvedValueOnce({
      entries: [makeAuditEntry({ id: "audit-p1" })],
      total: 30,
      page: 1,
      pageSize: 25,
    });
    vi.mocked(fetchAuditLog).mockResolvedValueOnce({
      entries: [makeAuditEntry({ id: "audit-p2" })],
      total: 30,
      page: 2,
      pageSize: 25,
    });

    renderWithToast(<AuditLogPanel />);

    await screen.findByRole("table");
    expect(screen.getByText("Page 1 of 2 (30 total)")).toBeTruthy();
    const previous = screen.getByRole("button", { name: "Previous" });
    const next = screen.getByRole("button", { name: "Next" });
    expect((previous as HTMLButtonElement).disabled).toBe(true);
    expect((next as HTMLButtonElement).disabled).toBe(false);

    const scrollToSpy = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    fireEvent.click(next);

    await waitFor(() => {
      expect(screen.getByText("Page 2 of 2 (30 total)")).toBeTruthy();
    });
    expect(fetchAuditLog).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 2 }),
      expect.anything(),
    );
    expect(scrollToSpy).toHaveBeenCalled();

    vi.mocked(fetchAuditLog).mockResolvedValueOnce({
      entries: [makeAuditEntry({ id: "audit-p1" })],
      total: 30,
      page: 1,
      pageSize: 25,
    });
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    await waitFor(() => {
      expect(screen.getByText("Page 1 of 2 (30 total)")).toBeTruthy();
    });
    expect(fetchAuditLog).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 1 }),
      expect.anything(),
    );
    scrollToSpy.mockRestore();
  });

  it("resets to page 1 once a retried page no longer exists against the current total", async () => {
    // Page 1 loads fine; the page-2 request fails (server-side data shrank in the
    // meantime), so Retry re-issues the *same* page-2 request rather than a filter
    // change resetting the page itself — the only way `load()` ever re-runs with
    // an unchanged `page` that's now beyond the new total.
    vi.mocked(fetchAuditLog).mockResolvedValueOnce({
      entries: [makeAuditEntry({ id: "audit-p1" })],
      total: 30,
      page: 1,
      pageSize: 25,
    });
    vi.mocked(fetchAuditLog).mockRejectedValueOnce(new Error("network hiccup"));
    const scrollToSpy = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    renderWithToast(<AuditLogPanel />);
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    const retry = await screen.findByRole("button", { name: "Retry" });

    vi.mocked(fetchAuditLog).mockResolvedValueOnce({
      entries: [],
      total: 5,
      page: 2,
      pageSize: 25,
    });
    vi.mocked(fetchAuditLog).mockResolvedValueOnce({
      entries: [makeAuditEntry({ id: "audit-narrowed" })],
      total: 5,
      page: 1,
      pageSize: 25,
    });
    fireEvent.click(retry);

    await waitFor(() => {
      expect(screen.getByText("Page 1 of 1 (5 total)")).toBeTruthy();
    });
    scrollToSpy.mockRestore();
  });

  it("filters by date range and clears all filters at once", async () => {
    vi.mocked(fetchAuditLog).mockResolvedValue(emptyAuditLog());
    renderWithToast(<AuditLogPanel />);
    await screen.findByText("No audit log entries found.");

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-01-01" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-01-31" } });

    await waitFor(() => {
      expect(fetchAuditLog).toHaveBeenLastCalledWith(
        expect.objectContaining({
          start: expect.any(String),
          end: expect.any(String),
        }),
        expect.anything(),
      );
    });

    const clearButton = await screen.findByRole("button", { name: "Clear filters" });
    fireEvent.click(clearButton);

    await waitFor(() => {
      expect(fetchAuditLog).toHaveBeenLastCalledWith(
        expect.objectContaining({ start: undefined, end: undefined, actionType: undefined }),
        expect.anything(),
      );
    });
    expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();
    expect((screen.getByLabelText("From") as HTMLInputElement).value).toBe("");
  });

  it("computes date filter bounds in the selected zone, not always UTC (bot review)", async () => {
    // Local mode changes what timestamps look like, but the From/To bounds sent to the server
    // must shift with it too - otherwise a displayed "Local" day doesn't match what's actually
    // filtered (adjacent-day records included/excluded near the boundary).
    vi.mocked(fetchAuditLog).mockResolvedValue(emptyAuditLog());
    renderWithToast(<AuditLogPanel />);
    await screen.findByText("No audit log entries found.");

    fireEvent.click(screen.getByRole("radio", { name: "Local" }));
    await waitFor(() => expect(fetchAuditLog).toHaveBeenLastCalledWith(
      expect.objectContaining({ start: undefined, end: undefined }),
      expect.anything(),
    ));

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-06-15" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-06-15" } });

    const viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    await waitFor(() => {
      expect(fetchAuditLog).toHaveBeenLastCalledWith(
        expect.objectContaining({
          start: zonedDayStartIso("2026-06-15", viewerTz),
          end: zonedDayEndIso("2026-06-15", viewerTz),
        }),
        expect.anything(),
      );
    });
  });

  it("falls back to the raw action_type string for an action outside the known label map", async () => {
    vi.mocked(fetchAuditLog).mockResolvedValue({
      entries: [makeAuditEntry({ action_type: "some_future_action" })],
      total: 1,
      page: 1,
      pageSize: 25,
    });

    renderWithToast(<AuditLogPanel />);

    const table = await screen.findByRole("table");
    expect(within(table).getByText("some_future_action")).toBeTruthy();
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

  it("bails out of the in-flight request without touching state once the component has unmounted (resolve race)", async () => {
    let resolveFetch: (value: AuditLogResponse) => void = () => {};
    vi.mocked(fetchAuditLog).mockImplementationOnce(
      () => new Promise<AuditLogResponse>((resolve) => {
        resolveFetch = resolve;
      }),
    );
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = renderWithToast(<AuditLogPanel />);
    unmount();

    // Resolving after unmount races the effect cleanup's abort — must not throw, and a broken
    // abort guard would otherwise surface as React's "state update on an unmounted component"
    // console.error.
    resolveFetch(emptyAuditLog());
    await Promise.resolve();

    expect(consoleErrorSpy).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it("bails out of the in-flight request without touching state once the component has unmounted (reject race)", async () => {
    let rejectFetch: (err: unknown) => void = () => {};
    vi.mocked(fetchAuditLog).mockImplementationOnce(
      () => new Promise<AuditLogResponse>((_resolve, reject) => {
        rejectFetch = reject;
      }),
    );
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = renderWithToast(<AuditLogPanel />);
    unmount();

    rejectFetch(new Error("network error after unmount"));
    await Promise.resolve();

    expect(consoleErrorSpy).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
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
