// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditLogEntryDto, AuditLogResponse, EventDto, SessionListDto } from "../../src/api/types.js";
import { ApiError, exportAuditLog, fetchAdminEvents, fetchAuditLog, fetchSessions } from "../../src/api/client.js";
import { AuditLogPanel } from "../../src/settings/AuditLogPanel.js";
import { SessionsPanel } from "../../src/settings/SessionsPanel.js";
import { renderWithToast } from "../test-utils.js";

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    fetchAdminEvents: vi.fn(),
    fetchAuditLog: vi.fn(),
    exportAuditLog: vi.fn(),
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
    actor_timezone: null,
    ip: "192.0.2.10",
    metadata: { event_id: "evt-1" },
    created_at: "2026-01-01T12:00:00.000Z",
    ...overrides,
  };
}

function makeEvent(overrides: Partial<EventDto> = {}): EventDto {
  return {
    id: "evt-1",
    title: "Spring Summit",
    slug: "spring-summit",
    date: "2026-03-01T09:00:00.000Z",
    timezone: "Europe/Warsaw",
    location: null,
    organization_id: "org-1",
    archived_at: null,
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
  // jsdom does not implement scrollIntoView.
  Element.prototype.scrollIntoView = vi.fn();
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
    expect(await screen.findByText("No audit log entries yet")).toBeTruthy();
  });

  it("shows an operator-safe error and can retry the audit request", async () => {
    vi.mocked(fetchAuditLog)
      .mockRejectedValueOnce(new ApiError(500, "secret_internal"))
      .mockResolvedValueOnce(emptyAuditLog());

    renderWithToast(<AuditLogPanel />);

    expect(await screen.findByText("Could not load audit log")).toBeTruthy();
    expect(screen.getByText(/Failed to load audit log/)).toBeTruthy();
    expect(screen.queryByText("secret_internal")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("No audit log entries yet")).toBeTruthy();
    expect(fetchAuditLog).toHaveBeenCalledTimes(2);
  });

  it("distinguishes unfiltered, filtered, and paginated empty results", async () => {
    vi.mocked(fetchAuditLog).mockResolvedValue(emptyAuditLog());

    renderWithToast(<AuditLogPanel />);

    expect(await screen.findByText("No audit log entries yet")).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "Action" }), {
      target: { value: "event_created" },
    });
    expect(await screen.findByText("No matches")).toBeTruthy();

    cleanup();
    vi.mocked(fetchAuditLog).mockResolvedValue(emptyAuditLog(1));
    renderWithToast(<AuditLogPanel />);

    expect(await screen.findByText("No entries on this page.")).toBeTruthy();
  });

  it("renders audit rows, translated action text, actor details, and humanized metadata", async () => {
    vi.mocked(fetchAuditLog).mockResolvedValue({
      entries: [makeAuditEntry({ metadata: { event_id: "evt-1", attendee_name: "Jane Doe" } })],
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
    // Humanized label + value, not a raw JSON blob.
    expect(within(table).getByText("Attendee name")).toBeTruthy();
    expect(within(table).getByText("Jane Doe")).toBeTruthy();
    // event_id is already shown via the Scope column - not repeated here.
    expect(within(table).queryByText("Event id")).toBeNull();
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

  it("treats metadata whose only key is already shown via Scope as having nothing to view", async () => {
    vi.mocked(fetchAuditLog).mockResolvedValue({
      entries: [makeAuditEntry({ metadata: { event_id: "evt-1" } })],
      total: 1,
      page: 1,
      pageSize: 25,
    });

    renderWithToast(<AuditLogPanel />);

    const table = await screen.findByRole("table");
    expect(within(table).queryByText("View")).toBeNull();
  });

  it("closes the Details popover on an outside click", async () => {
    vi.mocked(fetchAuditLog).mockResolvedValue({
      entries: [makeAuditEntry({ metadata: { event_id: "evt-1", note: "hello" } })],
      total: 1,
      page: 1,
      pageSize: 25,
    });

    renderWithToast(<AuditLogPanel />);

    const table = await screen.findByRole("table");
    const trigger = within(table).getByText("View");
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    fireEvent.pointerDown(document.body);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("shows an explanatory tooltip on the Scope column header", async () => {
    vi.mocked(fetchAuditLog).mockResolvedValue({
      entries: [makeAuditEntry()],
      total: 1,
      page: 1,
      pageSize: 25,
    });

    renderWithToast(<AuditLogPanel />);
    const table = await screen.findByRole("table");
    const scopeHeader = within(table).getByText(/Scope/);
    fireEvent.mouseEnter(scopeHeader);
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip.textContent).toMatch(/Instance/);
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

  it("always labels the Time column as UTC (no viewer-timezone toggle)", async () => {
    vi.mocked(fetchAuditLog).mockResolvedValue({
      entries: [makeAuditEntry()],
      total: 1,
      page: 1,
      pageSize: 25,
    });

    renderWithToast(<AuditLogPanel />);
    await screen.findByRole("table");
    expect(screen.getByText("Time (UTC)")).toBeTruthy();
    expect(screen.queryByRole("radio", { name: "Local" })).toBeNull();
  });

  it("applies the From/To date filters (as UTC day bounds) and resets to page 1", async () => {
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

    const fromInput = screen.getByLabelText("From");
    fireEvent.change(fromInput, { target: { value: "2026-01-01" } });
    fireEvent.blur(fromInput);
    expect(await screen.findByText("Page 1 of 2 (50 total)")).toBeTruthy();
    expect(vi.mocked(fetchAuditLog).mock.calls.at(-1)![0]).toMatchObject({ page: 1, start: "2026-01-01T00:00:00.000Z" });

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Page 2 of 2 (50 total)");
    const toInput = screen.getByLabelText("To");
    fireEvent.change(toInput, { target: { value: "2026-01-31" } });
    fireEvent.blur(toInput);
    expect(await screen.findByText("Page 1 of 2 (50 total)")).toBeTruthy();
    expect(vi.mocked(fetchAuditLog).mock.calls.at(-1)![0]).toMatchObject({ page: 1, end: "2026-01-31T23:59:59.999Z" });
  });

  it("clears the action filter and reloads unfiltered", async () => {
    vi.mocked(fetchAuditLog).mockResolvedValue(emptyAuditLog());

    renderWithToast(<AuditLogPanel />);
    await screen.findByText("No audit log entries yet");

    fireEvent.change(screen.getByRole("combobox", { name: "Action" }), {
      target: { value: "event_created" },
    });
    expect(await screen.findByText("No matches")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(await screen.findByText("No audit log entries yet")).toBeTruthy();
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

  it("scrolls the panel back into view after paginating", async () => {
    vi.mocked(fetchAuditLog)
      .mockResolvedValueOnce({ entries: [makeAuditEntry()], total: 50, page: 1, pageSize: 25 })
      .mockResolvedValueOnce({ entries: [makeAuditEntry()], total: 50, page: 2, pageSize: 25 });

    renderWithToast(<AuditLogPanel />);
    await screen.findByText("Page 1 of 2 (50 total)");

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Page 2 of 2 (50 total)");

    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("ignores a stale scroll-restore when an unrelated reload resolves instead of the pagination fetch", async () => {
    let resolveInitial: (r: AuditLogResponse) => void = () => {};
    let resolveFiltered: (r: AuditLogResponse) => void = () => {};
    const impls = [
      () => new Promise<AuditLogResponse>((r) => { resolveInitial = r; }),
      () => new Promise<AuditLogResponse>(() => {}), // the Next-triggered fetch: never resolves (superseded)
      () => new Promise<AuditLogResponse>((r) => { resolveFiltered = r; }),
    ];
    let call = 0;
    vi.mocked(fetchAuditLog).mockImplementation(() => impls[call++]!());

    renderWithToast(<AuditLogPanel />);
    resolveInitial({ entries: [makeAuditEntry()], total: 50, page: 1, pageSize: 25 });
    await screen.findByText("Page 1 of 2 (50 total)");

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await act(async () => {});

    fireEvent.change(screen.getByRole("combobox", { name: "Action" }), {
      target: { value: "event_created" },
    });
    await act(async () => {});

    resolveFiltered({ entries: [], total: 0, page: 1, pageSize: 25 });
    await screen.findByText("No matches");

    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it("badges a destructive action as error and a permission change as info, leaving routine actions unbadged", async () => {
    vi.mocked(fetchAuditLog).mockResolvedValue({
      entries: [
        makeAuditEntry({ id: "audit-erase", action_type: "attendee_erased" }),
        makeAuditEntry({ id: "audit-grant", action_type: "role_granted" }),
        makeAuditEntry({ id: "audit-created", action_type: "event_created" }),
      ],
      total: 3,
      page: 1,
      pageSize: 25,
    });

    renderWithToast(<AuditLogPanel />);

    const table = await screen.findByRole("table");
    expect(within(table).getByText("Attendee erased (GDPR)").className).toContain("at-badge--error");
    expect(within(table).getByText("Role granted").className).toContain("at-badge--info");
    expect(within(table).getByText("Event created").className).toContain("at-badge--neutral");
  });

  it("shows the entry's own local time under the viewer's time when actor_timezone is set, and nothing when it isn't", async () => {
    vi.mocked(fetchAuditLog).mockResolvedValue({
      entries: [
        makeAuditEntry({ id: "audit-tz", actor_timezone: "Europe/Warsaw" }),
        makeAuditEntry({ id: "audit-no-tz", actor_timezone: null }),
      ],
      total: 2,
      page: 1,
      pageSize: 25,
    });

    renderWithToast(<AuditLogPanel />);

    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(within(rows[0]!).getByText(/Warsaw/)).toBeTruthy();
    expect(within(rows[1]!).queryByText(/Warsaw/)).toBeNull();
  });

  it("shows Instance for an entry with no event scope, and the event's title once events have loaded", async () => {
    vi.mocked(fetchAdminEvents).mockResolvedValueOnce([makeEvent({ id: "evt-1", title: "Spring Summit" })]);
    vi.mocked(fetchAuditLog).mockResolvedValue({
      entries: [
        makeAuditEntry({ id: "audit-instance", action_type: "system_settings_updated", metadata: null }),
        makeAuditEntry({ id: "audit-scoped", action_type: "event_updated", metadata: { eventId: "evt-1" } }),
        makeAuditEntry({ id: "audit-orphan", action_type: "event_updated", metadata: { eventId: "evt-gone" } }),
      ],
      total: 3,
      page: 1,
      pageSize: 25,
    });

    renderWithToast(<AuditLogPanel />);

    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(within(rows[0]!).getByText("Instance")).toBeTruthy();
    expect(await within(rows[1]!).findByText("Spring Summit")).toBeTruthy();
    expect(within(rows[2]!).getByText("Deleted event")).toBeTruthy();
  });

  it("filters by event via the Scope dropdown, resetting to page 1", async () => {
    vi.mocked(fetchAdminEvents).mockResolvedValueOnce([makeEvent({ id: "evt-1", title: "Spring Summit" })]);
    vi.mocked(fetchAuditLog).mockResolvedValue(emptyAuditLog());

    renderWithToast(<AuditLogPanel />);
    await screen.findByText("No audit log entries yet");

    const scopeSelect = await screen.findByRole("combobox", { name: "Scope" });
    expect(within(scopeSelect).getByText("Spring Summit")).toBeTruthy();

    fireEvent.change(scopeSelect, { target: { value: "evt-1" } });

    await waitFor(() =>
      expect(fetchAuditLog).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 1, eventId: "evt-1" }),
        expect.anything(),
      ),
    );
  });

  it("exports the current filters as CSV and toasts on failure", async () => {
    vi.mocked(fetchAuditLog).mockResolvedValue(emptyAuditLog());
    vi.mocked(exportAuditLog).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new ApiError(500, "secret_internal"));

    renderWithToast(<AuditLogPanel />);
    await screen.findByText("No audit log entries yet");

    fireEvent.change(screen.getByRole("combobox", { name: "Action" }), {
      target: { value: "event_created" },
    });
    await waitFor(() => expect(fetchAuditLog).toHaveBeenLastCalledWith(
      expect.objectContaining({ actionType: "event_created" }),
      expect.anything(),
    ));

    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() => expect(exportAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: "event_created" }),
    ));

    fireEvent.click(await screen.findByRole("button", { name: "Export" }));
    expect(await screen.findByText(/Failed to export audit log/)).toBeTruthy();
  });

  it("shows a System/Audit toggle in the header with System not yet selectable", async () => {
    vi.mocked(fetchAuditLog).mockResolvedValue(emptyAuditLog());

    renderWithToast(<AuditLogPanel />);
    await screen.findByText("No audit log entries yet");

    const audit = screen.getByRole("radio", { name: "Audit" });
    const system = screen.getByRole("radio", { name: "System" });
    expect(audit.getAttribute("aria-checked")).toBe("true");
    expect(system).property("disabled", true);
    expect(audit).property("disabled", false);
  });

  it("changes rows per page and reloads from page 1", async () => {
    vi.mocked(fetchAuditLog).mockResolvedValue({
      entries: [makeAuditEntry()],
      total: 120,
      page: 1,
      pageSize: 25,
    });

    renderWithToast(<AuditLogPanel />);
    await screen.findByText("Page 1 of 5 (120 total)");

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Page 2 of 5 (120 total)");

    fireEvent.change(screen.getByRole("combobox", { name: "Rows per page" }), {
      target: { value: "100" },
    });

    await waitFor(() =>
      expect(vi.mocked(fetchAuditLog).mock.calls.at(-1)![0]).toMatchObject({ page: 1, pageSize: 100 }),
    );
    expect(await screen.findByText("Page 1 of 2 (120 total)")).toBeTruthy();
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
