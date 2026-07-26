// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AuditLogEntryDto,
  AuditLogResponse,
  EventDto,
  SessionListDto,
  SystemLogResponse,
} from "../../src/api/types.js";
import {
  ApiError,
  exportAuditLog,
  fetchAdminEvents,
  fetchAuditLog,
  fetchSessions,
  fetchSystemLogs,
} from "../../src/api/client.js";
import { AuditLogPanel } from "../../src/settings/AuditLogPanel.js";
import { SessionsPanel } from "../../src/settings/SessionsPanel.js";
import { mockMatchMedia, renderWithToast } from "../test-utils.js";

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    fetchAdminEvents: vi.fn(),
    fetchAuditLog: vi.fn(),
    exportAuditLog: vi.fn(),
    fetchSessions: vi.fn(),
    fetchSystemLogs: vi.fn(),
  };
});

function emptySystemLog(cursor = 0): SystemLogResponse {
  return { entries: [], cursor };
}

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
  vi.mocked(fetchSystemLogs).mockResolvedValue(emptySystemLog());
  // jsdom does not implement scrollIntoView.
  Element.prototype.scrollIntoView = vi.fn();
  // AuditLogPanel picks table vs. mobile cards via useIsDesktop() - default to desktop so
  // these tests exercise the <table> markup they assert against.
  mockMatchMedia(true);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("AuditLogPanel rendering", () => {
  /** AuditLogPanel now opens on the System view by default (PO: "System first, not Audit") -
   * every test in this describe block exercises the Audit side specifically, so render then
   * switch to it. Both views stay mounted underneath (only display toggles), so this switch is
   * synchronous and doesn't need its own await. */
  function renderAuditPanel() {
    const result = renderWithToast(<AuditLogPanel />);
    fireEvent.click(screen.getByRole("radio", { name: "Audit" }));
    return result;
  }

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
    renderAuditPanel();
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

    renderAuditPanel();

    expect(await screen.findByText("Could not load audit log")).toBeTruthy();
    expect(screen.getByText(/Failed to load audit log/)).toBeTruthy();
    expect(screen.queryByText("secret_internal")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("No audit log entries yet")).toBeTruthy();
    expect(fetchAuditLog).toHaveBeenCalledTimes(2);
  });

  it("distinguishes unfiltered, filtered, and paginated empty results", async () => {
    vi.mocked(fetchAuditLog).mockResolvedValue(emptyAuditLog());

    renderAuditPanel();

    expect(await screen.findByText("No audit log entries yet")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
    fireEvent.change(screen.getByRole("combobox", { name: "Action" }), {
      target: { value: "event_created" },
    });
    expect(await screen.findByText("No matches")).toBeTruthy();

    cleanup();
    vi.mocked(fetchAuditLog).mockResolvedValue(emptyAuditLog(1));
    renderAuditPanel();

    expect(await screen.findByText("No entries on this page.")).toBeTruthy();
  });

  it("renders audit rows, translated action text, actor details, and humanized metadata", async () => {
    vi.mocked(fetchAuditLog).mockResolvedValue({
      entries: [makeAuditEntry({ metadata: { event_id: "evt-1", attendee_name: "Jane Doe" } })],
      total: 1,
      page: 1,
      pageSize: 25,
    });

    renderAuditPanel();

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

    renderAuditPanel();

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

    renderAuditPanel();

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

    renderAuditPanel();

    const table = await screen.findByRole("table");
    const trigger = within(table).getByText("View");
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    fireEvent.pointerDown(document.body);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps the audit log usable when the background event-list fetch fails", async () => {
    vi.mocked(fetchAdminEvents).mockRejectedValueOnce(new Error("network error"));
    vi.mocked(fetchAuditLog).mockResolvedValue({
      entries: [makeAuditEntry()],
      total: 1,
      page: 1,
      pageSize: 25,
    });

    renderAuditPanel();

    const table = await screen.findByRole("table");
    // Scope can't resolve evt-1's title without the event list, so it falls back the same
    // way it would for a genuinely deleted event.
    expect(within(table).getByText("Deleted event")).toBeTruthy();
  });

  it("renders the actor's own local time as a secondary line under the UTC timestamp", async () => {
    vi.mocked(fetchAuditLog).mockResolvedValue({
      entries: [makeAuditEntry({ actor_timezone: "Europe/Warsaw", created_at: "2026-06-15T12:00:00.000Z" })],
      total: 1,
      page: 1,
      pageSize: 25,
    });

    renderAuditPanel();

    const table = await screen.findByRole("table");
    expect(within(table).getByText("2026-06-15 12:00:00")).toBeTruthy();
    expect(within(table).getByText(/Warsaw, Poland/)).toBeTruthy();
  });

  it("humanizes the mail provider metadata value instead of showing the raw enum", async () => {
    vi.mocked(fetchAuditLog).mockResolvedValue({
      entries: [makeAuditEntry({ action_type: "mail_settings_updated", metadata: { provider: "export_only" } })],
      total: 1,
      page: 1,
      pageSize: 25,
    });

    renderAuditPanel();

    const table = await screen.findByRole("table");
    fireEvent.click(within(table).getByText("View"));
    expect(within(table).getByText("Provider")).toBeTruthy();
    expect(within(table).getByText("Export only")).toBeTruthy();
  });

  it("reduces an array of metadata objects to a recognizable identifier per item, falling back to JSON", async () => {
    vi.mocked(fetchAuditLog).mockResolvedValue({
      entries: [
        makeAuditEntry({
          metadata: { event_id: "evt-1", affected: [{ name: "Jane Doe" }, { nothing: "recognizable" }] },
        }),
      ],
      total: 1,
      page: 1,
      pageSize: 25,
    });

    renderAuditPanel();

    const table = await screen.findByRole("table");
    fireEvent.click(within(table).getByText("View"));
    expect(within(table).getByText('Jane Doe, {"nothing":"recognizable"}')).toBeTruthy();
  });

  it("formats the remaining metadata value shapes: null, empty array, humanized array items, plain array items, and nested objects", async () => {
    vi.mocked(fetchAuditLog).mockResolvedValue({
      entries: [
        makeAuditEntry({
          metadata: {
            event_id: "evt-1",
            note: null,
            fields_changed: ["fromAddress"],
            removed_ids: [1, 2],
            cleared: [],
            config: { nested: true },
          },
        }),
      ],
      total: 1,
      page: 1,
      pageSize: 25,
    });

    renderAuditPanel();

    const table = await screen.findByRole("table");
    fireEvent.click(within(table).getByText("View"));
    expect(within(table).getByText("Note")).toBeTruthy();
    expect(within(table).getByText("—")).toBeTruthy();
    expect(within(table).getByText("Fields changed")).toBeTruthy();
    expect(within(table).getByText("From address")).toBeTruthy();
    expect(within(table).getByText("Removed ids")).toBeTruthy();
    expect(within(table).getByText("1, 2")).toBeTruthy();
    expect(within(table).getByText("Cleared")).toBeTruthy();
    expect(within(table).getByText("None")).toBeTruthy();
    expect(within(table).getByText("Config")).toBeTruthy();
    expect(within(table).getByText('{"nested":true}')).toBeTruthy();
  });

  it("copies a plain-text row summary (with local time and Details) to the clipboard and toasts on success", async () => {
    vi.mocked(fetchAuditLog).mockResolvedValue({
      entries: [
        makeAuditEntry({ actor_timezone: "Europe/Warsaw", metadata: { event_id: "evt-1", note: "hello" } }),
      ],
      total: 1,
      page: 1,
      pageSize: 25,
    });
    const originalClipboard = navigator.clipboard;
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    try {
      renderAuditPanel();
      const table = await screen.findByRole("table");
      fireEvent.click(within(table).getByRole("button", { name: "Copy row" }));

      expect(writeText).toHaveBeenCalledTimes(1);
      const [summary] = writeText.mock.calls[0]!;
      expect(summary).toContain("Action: Event created");
      expect(summary).toContain("Actor: Alice Admin (alice@example.com)");
      expect(summary).toMatch(/Time: 2026-01-01 12:00:00 UTC \(.*Warsaw, Poland.*\)/);
      expect(summary).toContain("Details:");
      expect(summary).toContain("Note: hello");
      expect(await screen.findByText("Row copied to clipboard")).toBeTruthy();
    } finally {
      Object.assign(navigator, { clipboard: originalClipboard });
    }
  });

  it("toasts an error when copying a row fails", async () => {
    vi.mocked(fetchAuditLog).mockResolvedValue({
      entries: [
        makeAuditEntry({ actor_display_name: null, actor_email: null, ip: null }),
      ],
      total: 1,
      page: 1,
      pageSize: 25,
    });
    const originalClipboard = navigator.clipboard;
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.assign(navigator, { clipboard: { writeText } });

    try {
      renderAuditPanel();
      const table = await screen.findByRole("table");
      fireEvent.click(within(table).getByRole("button", { name: "Copy row" }));

      expect(await screen.findByText("Could not copy — clipboard access was blocked.")).toBeTruthy();
    } finally {
      Object.assign(navigator, { clipboard: originalClipboard });
    }
  });

  it("renders one card per entry on mobile instead of a table, with a working copy-row action", async () => {
    mockMatchMedia(false);
    vi.mocked(fetchAuditLog).mockResolvedValue({
      entries: [
        makeAuditEntry({ actor_timezone: "Europe/Warsaw" }),
        makeAuditEntry({ id: "audit-2", actor_display_name: null, actor_email: null, ip: null }),
      ],
      total: 2,
      page: 1,
      pageSize: 25,
    });
    const originalClipboard = navigator.clipboard;
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    try {
      renderAuditPanel();

      await screen.findAllByText("Event created");
      expect(screen.queryByRole("table")).toBeNull();
      const cards = document.querySelectorAll(".audit-log-card");
      expect(cards).toHaveLength(2);
      const firstCard = cards[0] as HTMLElement;
      expect(within(firstCard).getByText("Alice Admin")).toBeTruthy();
      expect(within(firstCard).getByText(/Warsaw, Poland/)).toBeTruthy();
      expect(within(firstCard).getByText("alice@example.com")).toBeTruthy();
      const secondCard = cards[1] as HTMLElement;
      expect(within(secondCard).getByText("Deleted user")).toBeTruthy();

      fireEvent.click(within(firstCard).getByRole("button", { name: "Copy row" }));
      expect(writeText).toHaveBeenCalledTimes(1);
    } finally {
      Object.assign(navigator, { clipboard: originalClipboard });
    }
  });

  it("debounces the search box before refetching with the trimmed term", async () => {
    vi.mocked(fetchAuditLog).mockResolvedValue(emptyAuditLog());

    renderAuditPanel();
    await screen.findByText("No audit log entries yet");

    vi.useFakeTimers();
    fireEvent.change(screen.getByPlaceholderText("Search actor or event…"), { target: { value: "jane" } });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    vi.useRealTimers();

    await waitFor(() =>
      expect(fetchAuditLog).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: "jane" }),
        expect.anything(),
      ),
    );
  });

  it("clears the search box and refocuses it via the Clear search button", async () => {
    vi.mocked(fetchAuditLog).mockResolvedValue(emptyAuditLog());

    renderAuditPanel();
    await screen.findByText("No audit log entries yet");

    const searchInput = screen.getByPlaceholderText("Search actor or event…") as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: "jane" } });
    expect(searchInput.value).toBe("jane");

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));

    expect(searchInput.value).toBe("");
    expect(document.activeElement).toBe(searchInput);
  });

  it("sorts the Event filter dropdown alphabetically regardless of fetch order", async () => {
    vi.mocked(fetchAdminEvents).mockResolvedValueOnce([
      makeEvent({ id: "evt-z", title: "Zebra Kickoff" }),
      makeEvent({ id: "evt-a", title: "Alpha Summit" }),
    ]);
    vi.mocked(fetchAuditLog).mockResolvedValue(emptyAuditLog());

    renderAuditPanel();
    await screen.findByText("No audit log entries yet");

    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
    const scopeSelect = await screen.findByRole("combobox", { name: "Event" });
    const optionLabels = within(scopeSelect)
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(optionLabels).toEqual(["All events", "Alpha Summit", "Zebra Kickoff"]);
  });

  it("flips the Details popover above the trigger when there's no room below", async () => {
    vi.mocked(fetchAuditLog).mockResolvedValue({
      entries: [makeAuditEntry({ metadata: { event_id: "evt-1", note: "hello" } })],
      total: 1,
      page: 1,
      pageSize: 25,
    });

    const rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({ top: 700, bottom: 720, right: 300, left: 260, width: 40, height: 20 } as DOMRect);
    const innerHeightSpy = vi.spyOn(window, "innerHeight", "get").mockReturnValue(800);
    const innerWidthSpy = vi.spyOn(window, "innerWidth", "get").mockReturnValue(1024);

    try {
      renderAuditPanel();
      const table = await screen.findByRole("table");
      fireEvent.click(within(table).getByText("View"));

      const panel = document.querySelector(".audit-log-details__panel") as HTMLElement;
      expect(panel.style.bottom).not.toBe("");
      expect(panel.style.top).toBe("");
    } finally {
      rectSpy.mockRestore();
      innerHeightSpy.mockRestore();
      innerWidthSpy.mockRestore();
    }
  });

  it("shows an explanatory tooltip on the Scope column header", async () => {
    vi.mocked(fetchAuditLog).mockResolvedValue({
      entries: [makeAuditEntry()],
      total: 1,
      page: 1,
      pageSize: 25,
    });

    renderAuditPanel();
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
    renderAuditPanel();
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
      expect(screen.getByText("Page 1 of 1")).toBeTruthy();
    });
  });

  it("falls back to the raw action_type string for an action outside the known label map", async () => {
    vi.mocked(fetchAuditLog).mockResolvedValue({
      entries: [makeAuditEntry({ action_type: "some_future_action" })],
      total: 1,
      page: 1,
      pageSize: 25,
    });

    renderAuditPanel();

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

    renderAuditPanel();

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
    const { unmount } = renderAuditPanel();
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
    const { unmount } = renderAuditPanel();
    unmount();

    rejectFetch(new Error("network error after unmount"));
    await Promise.resolve();

    expect(consoleErrorSpy).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it("always shows Time as UTC first, actor-local second (no viewer-timezone toggle)", async () => {
    vi.mocked(fetchAuditLog).mockResolvedValue({
      entries: [makeAuditEntry()],
      total: 1,
      page: 1,
      pageSize: 25,
    });

    renderAuditPanel();
    const table = await screen.findByRole("table");
    expect(within(table).getByText("Time")).toBeTruthy();
    expect(within(table).getByText("2026-01-01 12:00:00")).toBeTruthy();
    expect(screen.queryByRole("radio", { name: "Local" })).toBeNull();
  });

  it("applies the From/To date filters (as UTC day bounds) and resets to page 1", async () => {
    vi.mocked(fetchAuditLog).mockResolvedValue({
      entries: [makeAuditEntry()],
      total: 50,
      page: 1,
      pageSize: 25,
    });

    renderAuditPanel();
    await screen.findByRole("table");

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Page 2 of 2")).toBeTruthy();

    const fromInput = screen.getByLabelText("From");
    fireEvent.change(fromInput, { target: { value: "2026-01-01" } });
    fireEvent.blur(fromInput);
    expect(await screen.findByText("Page 1 of 2")).toBeTruthy();
    expect(vi.mocked(fetchAuditLog).mock.calls.at(-1)![0]).toMatchObject({ page: 1, start: "2026-01-01T00:00:00.000Z" });

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Page 2 of 2");
    const toInput = screen.getByLabelText("To");
    fireEvent.change(toInput, { target: { value: "2026-01-31" } });
    fireEvent.blur(toInput);
    expect(await screen.findByText("Page 1 of 2")).toBeTruthy();
    expect(vi.mocked(fetchAuditLog).mock.calls.at(-1)![0]).toMatchObject({ page: 1, end: "2026-01-31T23:59:59.999Z" });
  });

  it("clears the action filter and reloads unfiltered", async () => {
    vi.mocked(fetchAuditLog).mockResolvedValue(emptyAuditLog());

    renderAuditPanel();
    await screen.findByText("No audit log entries yet");

    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
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

    renderAuditPanel();
    expect(await screen.findByText("Page 1 of 2")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Previous" })).property("disabled", true);

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Page 2 of 2")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Next" })).property("disabled", true);
    expect(vi.mocked(fetchAuditLog).mock.calls.at(-1)![0]).toMatchObject({ page: 2 });

    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(await screen.findByText("Page 1 of 2")).toBeTruthy();
    expect(vi.mocked(fetchAuditLog).mock.calls.at(-1)![0]).toMatchObject({ page: 1 });
  });

  it("scrolls the panel back into view after paginating", async () => {
    vi.mocked(fetchAuditLog)
      .mockResolvedValueOnce({ entries: [makeAuditEntry()], total: 50, page: 1, pageSize: 25 })
      .mockResolvedValueOnce({ entries: [makeAuditEntry()], total: 50, page: 2, pageSize: 25 });

    renderAuditPanel();
    await screen.findByText("Page 1 of 2");

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Page 2 of 2");

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

    renderAuditPanel();
    resolveInitial({ entries: [makeAuditEntry()], total: 50, page: 1, pageSize: 25 });
    await screen.findByText("Page 1 of 2");

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await act(async () => {});

    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
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

    renderAuditPanel();

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

    renderAuditPanel();

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

    renderAuditPanel();

    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(within(rows[0]!).getByText("Instance")).toBeTruthy();
    expect(await within(rows[1]!).findByText("Spring Summit")).toBeTruthy();
    expect(within(rows[2]!).getByText("Deleted event")).toBeTruthy();
  });

  it("filters by event via the Filters panel's Event dropdown, resetting to page 1", async () => {
    vi.mocked(fetchAdminEvents).mockResolvedValueOnce([makeEvent({ id: "evt-1", title: "Spring Summit" })]);
    vi.mocked(fetchAuditLog).mockResolvedValue(emptyAuditLog());

    renderAuditPanel();
    await screen.findByText("No audit log entries yet");

    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
    const scopeSelect = await screen.findByRole("combobox", { name: "Event" });
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
    vi.mocked(exportAuditLog)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new ApiError(500, "secret_internal"));

    renderAuditPanel();
    await screen.findByText("No audit log entries yet");

    // With no filters active yet, every optional export param is omitted.
    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    await waitFor(() =>
      expect(exportAuditLog).toHaveBeenNthCalledWith(1, {
        actionType: undefined,
        eventId: undefined,
        search: undefined,
        start: undefined,
        end: undefined,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
    fireEvent.change(screen.getByRole("combobox", { name: "Action" }), {
      target: { value: "event_created" },
    });
    await waitFor(() => expect(fetchAuditLog).toHaveBeenLastCalledWith(
      expect.objectContaining({ actionType: "event_created" }),
      expect.anything(),
    ));

    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    await waitFor(() => expect(exportAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: "event_created" }),
    ));

    fireEvent.click(await screen.findByRole("button", { name: "Export CSV" }));
    expect(await screen.findByText(/Failed to export audit log/)).toBeTruthy();
  });

  it("shows a System/Audit toggle in the header, defaulting to System", async () => {
    vi.mocked(fetchAuditLog).mockResolvedValue(emptyAuditLog());

    renderWithToast(<AuditLogPanel />);
    await screen.findByText("No log activity yet");

    const audit = screen.getByRole("radio", { name: "Audit" });
    const system = screen.getByRole("radio", { name: "System" });
    expect(system.getAttribute("aria-checked")).toBe("true");
    expect(audit.getAttribute("aria-checked")).toBe("false");
    expect(audit).property("disabled", false);
    expect(system).property("disabled", false);
  });

  it("switches to the System logs view, hiding the Audit toolbar/table, and back again", async () => {
    vi.mocked(fetchAuditLog).mockResolvedValue(emptyAuditLog());

    renderAuditPanel();
    await screen.findByText("No audit log entries yet");

    fireEvent.click(screen.getByRole("radio", { name: "System" }));

    expect(await screen.findByText("No log activity yet")).toBeTruthy();
    // The Audit side stays mounted underneath (only its wrapper's display toggles, so switching
    // back doesn't re-fetch/flash) - queryByRole respects that hidden state, unlike a raw DOM
    // query, so this confirms it's inaccessible rather than merely absent.
    expect(screen.queryByRole("textbox", { name: "Search actor or event" })).toBeNull();
    expect(screen.getByText("System logs")).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: "Audit" }));

    expect(await screen.findByText("No audit log entries yet")).toBeTruthy();
    expect(screen.getByText("Audit log")).toBeTruthy();
  });

  it("changes rows per page and reloads from page 1", async () => {
    vi.mocked(fetchAuditLog).mockResolvedValue({
      entries: [makeAuditEntry()],
      total: 120,
      page: 1,
      pageSize: 25,
    });

    renderAuditPanel();
    await screen.findByText("Page 1 of 5");

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Page 2 of 5");

    fireEvent.change(screen.getByRole("combobox", { name: "Rows per page" }), {
      target: { value: "100" },
    });

    await waitFor(() =>
      expect(vi.mocked(fetchAuditLog).mock.calls.at(-1)![0]).toMatchObject({ page: 1, pageSize: 100 }),
    );
    expect(await screen.findByText("Page 1 of 2")).toBeTruthy();
  });
});

describe("SystemLogsPanel rendering", () => {
  function openSystemLogsView() {
    fireEvent.click(screen.getByRole("radio", { name: "System" }));
  }

  it("fetches with no since on mount and renders returned entries", async () => {
    vi.mocked(fetchAuditLog).mockResolvedValue(emptyAuditLog());
    vi.mocked(fetchSystemLogs).mockResolvedValueOnce({
      entries: [{ id: 1, ts: "2026-01-01T12:00:00.000Z", level: "info", source: "api", message: "http_request" }],
      cursor: 1,
    });

    renderWithToast(<AuditLogPanel />);
    await screen.findByText("No audit log entries yet");
    openSystemLogsView();

    expect(await screen.findByText("http_request")).toBeTruthy();
    expect(fetchSystemLogs).toHaveBeenCalledWith(
      { level: undefined, source: undefined, search: undefined },
      expect.anything(),
    );
    expect(screen.getByText("Showing 1 line")).toBeTruthy();
  });

  it("shows a Retry action on load failure and recovers once clicked", async () => {
    vi.mocked(fetchAuditLog).mockResolvedValue(emptyAuditLog());
    vi.mocked(fetchSystemLogs).mockRejectedValueOnce(new Error("network error"));

    renderWithToast(<AuditLogPanel />);
    await screen.findByText("No audit log entries yet");
    openSystemLogsView();

    await screen.findByText(/Could not load system logs/);
    vi.mocked(fetchSystemLogs).mockResolvedValueOnce({
      entries: [{ id: 1, ts: "2026-01-01T12:00:00.000Z", level: "info", source: "api", message: "http_request" }],
      cursor: 1,
    });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("http_request")).toBeTruthy();
    expect(screen.queryByText(/Could not load system logs/)).toBeNull();
  });

  it("renders an entry's fields alongside its message, for entries that have them", async () => {
    vi.mocked(fetchAuditLog).mockResolvedValue(emptyAuditLog());
    vi.mocked(fetchSystemLogs).mockResolvedValueOnce({
      entries: [
        {
          id: 1,
          ts: "2026-01-01T12:00:00.000Z",
          level: "info",
          source: "admin",
          message: "event_archived",
          fields: { eventId: "evt-1", actorUserId: "user-1", ip: "1.2.3.4" },
        },
      ],
      cursor: 1,
    });

    renderWithToast(<AuditLogPanel />);
    await screen.findByText("No audit log entries yet");
    openSystemLogsView();

    await screen.findByText("event_archived");
    expect(
      screen.getByText((_, node) => node?.textContent === '{"eventId":"evt-1","actorUserId":"user-1","ip":"1.2.3.4"}'),
    ).toBeTruthy();
  });

  it("hosts Live/Download in the Card header, next to the System/Audit toggle", async () => {
    vi.mocked(fetchAuditLog).mockResolvedValue(emptyAuditLog());
    vi.mocked(fetchSystemLogs).mockResolvedValueOnce({
      entries: [{ id: 1, ts: "2026-01-01T12:00:00.000Z", level: "info", source: "api", message: "http_request" }],
      cursor: 1,
    });

    renderWithToast(<AuditLogPanel />);
    await screen.findByText("No audit log entries yet");
    openSystemLogsView();
    await screen.findByText("http_request");

    // onHasEntriesChange fires from a useEffect one tick after the entries themselves render,
    // so the header button's disabled state can lag the text by a render - wait for it rather
    // than asserting synchronously.
    await waitFor(() => expect(screen.getByRole("button", { name: "Download .log" })).property("disabled", false));

    const liveButton = screen.getByRole("button", { name: "Live" });
    fireEvent.click(liveButton);
    expect(screen.getByRole("button", { name: "Paused" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Paused" }));
    expect(screen.getByRole("button", { name: "Live" })).toBeTruthy();
  });

  it("disables the header Download button until there's something to download", async () => {
    vi.mocked(fetchAuditLog).mockResolvedValue(emptyAuditLog());
    vi.mocked(fetchSystemLogs).mockResolvedValue(emptySystemLog());

    renderWithToast(<AuditLogPanel />);
    await screen.findByText("No audit log entries yet");
    openSystemLogsView();
    await screen.findByText("No log activity yet");

    expect(screen.getByRole("button", { name: "Download .log" })).property("disabled", true);
  });

  it("refetches when the source filter changes", async () => {
    vi.mocked(fetchAuditLog).mockResolvedValue(emptyAuditLog());
    vi.mocked(fetchSystemLogs).mockResolvedValue(emptySystemLog());

    renderWithToast(<AuditLogPanel />);
    await screen.findByText("No audit log entries yet");
    openSystemLogsView();
    await screen.findByText("No log activity yet");

    fireEvent.change(screen.getByRole("combobox", { name: "Source" }), { target: { value: "mail" } });

    await waitFor(() =>
      expect(fetchSystemLogs).toHaveBeenLastCalledWith(
        { level: undefined, source: "mail", search: undefined },
        expect.anything(),
      ),
    );
  });

  it("polls with the last cursor as since, appending new lines without resetting existing ones", async () => {
    // Real timers throughout - the poll interval is created at real mount time, so faking
    // timers only around the wait (as elsewhere in this file) wouldn't control it; this is a
    // genuine ~2s real-time wait, not a fake-timer fast-forward.
    vi.mocked(fetchAuditLog).mockResolvedValue(emptyAuditLog());
    vi.mocked(fetchSystemLogs)
      .mockResolvedValueOnce({
        entries: [{ id: 1, ts: "2026-01-01T12:00:00.000Z", level: "info", source: "api", message: "first" }],
        cursor: 1,
      })
      .mockResolvedValueOnce({
        entries: [{ id: 2, ts: "2026-01-01T12:00:01.000Z", level: "info", source: "api", message: "second" }],
        cursor: 2,
      });

    renderWithToast(<AuditLogPanel />);
    await screen.findByText("No audit log entries yet");
    openSystemLogsView();
    await screen.findByText("first");

    expect(await screen.findByText("second", {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByText("first")).toBeTruthy();
    expect(fetchSystemLogs).toHaveBeenLastCalledWith(
      { since: 1, level: undefined, source: undefined, search: undefined },
      expect.anything(),
    );
  }, 10000);

  it("stops polling once Live is turned off", async () => {
    vi.mocked(fetchAuditLog).mockResolvedValue(emptyAuditLog());
    vi.mocked(fetchSystemLogs).mockResolvedValue(emptySystemLog());

    renderWithToast(<AuditLogPanel />);
    await screen.findByText("No audit log entries yet");
    openSystemLogsView();
    await screen.findByText("No log activity yet");

    fireEvent.click(screen.getByRole("button", { name: "Live" }));
    const callsAfterPause = vi.mocked(fetchSystemLogs).mock.calls.length;

    await new Promise((resolve) => setTimeout(resolve, 2500));

    expect(vi.mocked(fetchSystemLogs).mock.calls.length).toBe(callsAfterPause);
  }, 10000);

  it("spells out the database source instead of abbreviating it", async () => {
    vi.mocked(fetchAuditLog).mockResolvedValue(emptyAuditLog());
    vi.mocked(fetchSystemLogs).mockResolvedValue(emptySystemLog());

    renderWithToast(<AuditLogPanel />);
    await screen.findByText("No log activity yet");

    const sourceSelect = screen.getByRole("combobox", { name: "Source" });
    expect(within(sourceSelect).getByText("Database")).toBeTruthy();
    expect(within(sourceSelect).queryByText("DB")).toBeNull();
  });

  it("clears the search box and refocuses it via the Clear search button", async () => {
    vi.mocked(fetchAuditLog).mockResolvedValue(emptyAuditLog());
    vi.mocked(fetchSystemLogs).mockResolvedValue(emptySystemLog());

    renderWithToast(<AuditLogPanel />);
    await screen.findByText("No log activity yet");

    const searchInput = screen.getByPlaceholderText("Search message text…") as HTMLInputElement;
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();

    fireEvent.change(searchInput, { target: { value: "smtp" } });
    expect(searchInput.value).toBe("smtp");

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));

    expect(searchInput.value).toBe("");
    expect(document.activeElement).toBe(searchInput);
  });

  it("moves Source/Level behind a Filters dropdown on mobile, keeping Search inline", async () => {
    mockMatchMedia(false);
    vi.mocked(fetchAuditLog).mockResolvedValue(emptyAuditLog());
    vi.mocked(fetchSystemLogs).mockResolvedValue(emptySystemLog());

    renderWithToast(<AuditLogPanel />);
    await screen.findByText("No log activity yet");

    expect(screen.getByPlaceholderText("Search message text…")).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Source" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Level" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
    expect(await screen.findByRole("combobox", { name: "Source" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Level" })).toBeTruthy();
  });

  it("moves Live/Download into the toolbar on mobile instead of the Card header", async () => {
    mockMatchMedia(false);
    vi.mocked(fetchAuditLog).mockResolvedValue(emptyAuditLog());
    vi.mocked(fetchSystemLogs).mockResolvedValue(emptySystemLog());

    renderWithToast(<AuditLogPanel />);
    await screen.findByText("No log activity yet");

    expect(screen.getByRole("button", { name: "Live" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download .log" })).toBeTruthy();
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
