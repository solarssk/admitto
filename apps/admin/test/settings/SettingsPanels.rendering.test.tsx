// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AuditLogEntryDto,
  AuditLogResponse,
  EventDto,
  SecurityAuditLogEntryDto,
  SecurityAuditLogResponse,
  SystemLogResponse,
} from "../../src/api/types.js";
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
import { EventArchivingPanel } from "../../src/settings/EventArchivingPanel.js";
import { POLL_INTERVAL_MS } from "../../src/settings/SystemLogsPanel.js";
import { mockMatchMedia, renderWithToast, renderWithToastAndRouter } from "../test-utils.js";
import { setPreferredLocale } from "../../src/utils/locale-store.js";

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

function emptySystemLog(cursor = 0): SystemLogResponse {
  return { entries: [], cursor };
}

function emptyAuditLog(total = 0): AuditLogResponse {
  return { entries: [], total, page: 1, pageSize: 25 };
}

function emptySecurityLog(total = 0): SecurityAuditLogResponse {
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
    country: { kind: "unknown" },
    metadata: { event_id: "evt-1" },
    created_at: "2026-01-01T12:00:00.000Z",
    ...overrides,
  };
}

function makeSecurityEntry(overrides: Partial<SecurityAuditLogEntryDto> = {}): SecurityAuditLogEntryDto {
  return {
    id: "sec-1",
    event_type: "auth.login.success",
    user_id: "user-1",
    user_email: "alice@example.com",
    user_display_name: "Alice Admin",
    ip: "192.0.2.10",
    country: { kind: "unknown" },
    metadata: { email: "alice@example.com", userAgent: "curl/8.0" },
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

beforeEach(() => {
  vi.mocked(fetchAdminEvents).mockResolvedValue([]);
  vi.mocked(fetchSystemLogs).mockResolvedValue(emptySystemLog());
  // The Security view stays mounted (and fetches) alongside System/Audit even when a test only
  // cares about one of the other two - give it a harmless default so it never leaks a real,
  // unmocked network call into tests that don't override it themselves.
  vi.mocked(fetchSecurityAuditLog).mockResolvedValue(emptySecurityLog());
  // jsdom does not implement scrollIntoView.
  Element.prototype.scrollIntoView = vi.fn();
  // AuditLogPanel picks table vs. mobile cards via useIsDesktop() - default to desktop so
  // these tests exercise the <table> markup they assert against.
  mockMatchMedia(true);
});

afterEach(() => {
  cleanup();
  // resetAllMocks (not clearAllMocks): several tests here queue mockResolvedValueOnce/
  // mockRejectedValueOnce chains (or a one-off mockImplementation override) sized to an exact
  // expected call count - but a couple of those counts depend on real setInterval-driven polling
  // (POLL_INTERVAL_MS), so a slower or faster CI run can leave one unconsumed. clearAllMocks only
  // wipes call history, not queued/overridden implementations, so a leftover would otherwise
  // silently answer the next test's first call to that same mocked function instead of it.
  vi.resetAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setPreferredLocale(null);
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

  it("does not flash the loading skeleton when a filter refetch still resolves to zero results", async () => {
    // Regression test: isInitialLoad used to be `loading && entries.length === 0`, which is
    // true again on every refetch that starts from an empty result - not just the very first
    // load - so a filter change here used to swap "No audit log entries yet" out for the
    // skeleton (then back) even though this is a completed load, not a first load.
    vi.mocked(fetchAuditLog).mockResolvedValueOnce(emptyAuditLog());
    renderAuditPanel();
    expect(await screen.findByText("No audit log entries yet")).toBeTruthy();

    let resolveFiltered: (response: AuditLogResponse) => void = () => {};
    vi.mocked(fetchAuditLog).mockImplementationOnce(
      () => new Promise<AuditLogResponse>((resolve) => {
        resolveFiltered = resolve;
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
    fireEvent.change(screen.getByRole("combobox", { name: "Action" }), {
      target: { value: "event_created" },
    });

    // hasActiveFilters flips synchronously with the filter change, so "No matches" replaces the
    // unfiltered empty state right away, even though the new request is still in flight - the
    // skeleton must never appear while it settles.
    expect(screen.getByText("No matches")).toBeTruthy();
    expect(screen.queryByLabelText("Loading audit log")).toBeNull();

    resolveFiltered(emptyAuditLog());
    expect(await screen.findByText("No matches")).toBeTruthy();
    expect(fetchAuditLog).toHaveBeenCalledTimes(2);
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
    expect(within(table).getAllByText("-")).toHaveLength(2);
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
    expect(within(table).getByText("2026-06-15 12:00:00 UTC")).toBeTruthy();
    expect(within(table).getByText(/Europe\/Warsaw, UTC\+2/)).toBeTruthy();
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
    expect(within(table).getByText("-")).toBeTruthy();
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
        makeAuditEntry({
          actor_timezone: "Europe/Warsaw",
          metadata: { event_id: "evt-1", note: "hello" },
          country: { kind: "resolved", countryCode: "US" },
        }),
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
      expect(within(table).getByText("United States")).toBeTruthy();
      fireEvent.click(within(table).getByRole("button", { name: "Copy row" }));

      expect(writeText).toHaveBeenCalledTimes(1);
      const [summary] = writeText.mock.calls[0]!;
      expect(summary).toContain("Action: Event created");
      expect(summary).toContain("User: Alice Admin (alice@example.com)");
      expect(summary).toMatch(/Time: 2026-01-01 12:00:00 UTC \(13:00 \(Europe\/Warsaw, UTC\+1\)\)/);
      expect(summary).toContain("IP address: 192.0.2.10 (United States)");
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

      expect(await screen.findByText("Could not copy. Clipboard access was blocked.")).toBeTruthy();
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
      expect(within(firstCard).getByText(/Europe\/Warsaw, UTC\+1/)).toBeTruthy();
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
    fireEvent.change(screen.getByPlaceholderText("Search user or event…"), { target: { value: "jane" } });
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

    const searchInput = screen.getByPlaceholderText("Search user or event…") as HTMLInputElement;
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
    expect(within(table).getByText("2026-01-01 12:00:00 UTC")).toBeTruthy();
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

    // getByRole (not getByLabelText): the Security view's own From/To fields share the exact
    // same aria-label, and testing-library's role query is the one that respects the sibling
    // view's display:none hiding - getByLabelText doesn't filter on visibility at all, so it'd
    // match both and throw "found multiple elements".
    const fromInput = screen.getByRole("textbox", { name: "From" });
    fireEvent.change(fromInput, { target: { value: "2026-01-01" } });
    fireEvent.blur(fromInput);
    expect(await screen.findByText("Page 1 of 2")).toBeTruthy();
    expect(vi.mocked(fetchAuditLog).mock.calls.at(-1)![0]).toMatchObject({ page: 1, start: "2026-01-01T00:00:00.000Z" });

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Page 2 of 2");
    const toInput = screen.getByRole("textbox", { name: "To" });
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
    fireEvent.click(screen.getByRole("button", { name: "Export logs" }));
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

    fireEvent.click(screen.getByRole("button", { name: "Export logs" }));
    await waitFor(() => expect(exportAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: "event_created" }),
    ));

    fireEvent.click(await screen.findByRole("button", { name: "Export logs" }));
    expect(await screen.findByText(/Failed to export audit log/)).toBeTruthy();
  });

  it("shows a System/Audit/Security toggle in the header, defaulting to System", async () => {
    vi.mocked(fetchAuditLog).mockResolvedValue(emptyAuditLog());

    renderWithToast(<AuditLogPanel />);
    await screen.findByText("No log activity yet");

    const audit = screen.getByRole("radio", { name: "Audit" });
    const system = screen.getByRole("radio", { name: "System" });
    const security = screen.getByRole("radio", { name: "Security" });
    expect(system.getAttribute("aria-checked")).toBe("true");
    expect(audit.getAttribute("aria-checked")).toBe("false");
    expect(security.getAttribute("aria-checked")).toBe("false");
    expect(audit).property("disabled", false);
    expect(system).property("disabled", false);
    expect(security).property("disabled", false);
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
    expect(screen.queryByRole("textbox", { name: "Search user or event" })).toBeNull();
    expect(screen.getByText("System logs")).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: "Audit" }));

    expect(await screen.findByText("No audit log entries yet")).toBeTruthy();
    expect(screen.getByText("Audit logs")).toBeTruthy();
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

  it("silently re-fetches on a timer and shows newly arrived rows", async () => {
    vi.mocked(fetchAuditLog)
      .mockResolvedValueOnce({ entries: [makeAuditEntry()], total: 1, page: 1, pageSize: 25 })
      .mockResolvedValueOnce({
        entries: [makeAuditEntry({ id: "audit-2", actor_display_name: "Bob Admin" }), makeAuditEntry()],
        total: 2,
        page: 1,
        pageSize: 25,
      });

    renderAuditPanel();
    await screen.findByText("Alice Admin");

    // The poll tick fires on its own, with no user action - this is what makes it "live".
    expect(await screen.findByText("Bob Admin", {}, { timeout: 3000 })).toBeTruthy();
    expect(fetchAuditLog).toHaveBeenCalledTimes(2);
  }, 10000);

  it("does not let a poll cancel a newer filter/page reload", async () => {
    vi.mocked(fetchAuditLog).mockResolvedValueOnce({
      entries: [makeAuditEntry()],
      total: 50,
      page: 1,
      pageSize: 25,
    });

    renderAuditPanel();
    await screen.findByText("Page 1 of 2");
    vi.mocked(fetchAuditLog).mockClear();

    let resolveNewestLoad: (value: AuditLogResponse) => void = () => {};
    vi.mocked(fetchAuditLog).mockImplementation(
      (params, signal) =>
        new Promise<AuditLogResponse>((resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
          if (params.page === 1 && params.actionType === "event_created") resolveNewestLoad = resolve;
        }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(fetchAuditLog).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
    fireEvent.change(screen.getByRole("combobox", { name: "Action" }), { target: { value: "event_created" } });
    await waitFor(() => expect(fetchAuditLog).toHaveBeenCalledTimes(2));

    // The first, aborted non-silent request must not clear the guard owned by the second one.
    // If it did, this tick would start a third request and abort the reload the operator awaits.
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS + 250));
    expect(fetchAuditLog).toHaveBeenCalledTimes(2);

    await act(async () => resolveNewestLoad({ entries: [makeAuditEntry()], total: 50, page: 1, pageSize: 25 }));
  }, 10000);

  it("clears an initial load error when a live poll recovers", async () => {
    vi.mocked(fetchAuditLog).mockRejectedValueOnce(new Error("network error")).mockResolvedValueOnce(emptyAuditLog());

    renderAuditPanel();
    expect(await screen.findByText("Could not load audit log")).toBeTruthy();
    expect(await screen.findByText("No audit log entries yet", {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.queryByText("Could not load audit log")).toBeNull();
  }, 10000);

  it("stops polling once Live is turned off, and resumes when clicked again", async () => {
    vi.mocked(fetchAuditLog).mockResolvedValue(emptyAuditLog());

    renderAuditPanel();
    await screen.findByText("No audit log entries yet");

    fireEvent.click(screen.getByRole("button", { name: "Live" }));
    expect(screen.getByRole("button", { name: "Paused" })).toBeTruthy();
    const callsAfterPause = vi.mocked(fetchAuditLog).mock.calls.length;

    // Long enough to cross at least one interval tick, proving it did NOT fire while paused.
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS + 750));
    expect(vi.mocked(fetchAuditLog).mock.calls).toHaveLength(callsAfterPause);

    fireEvent.click(screen.getByRole("button", { name: "Paused" }));
    expect(screen.getByRole("button", { name: "Live" })).toBeTruthy();

    await waitFor(() => expect(vi.mocked(fetchAuditLog).mock.calls.length).toBeGreaterThan(callsAfterPause), {
      timeout: 3000,
    });
  }, 10000);

  it("surfaces a banner after sustained live-poll failures, and clears it on the next success", async () => {
    vi.mocked(fetchAuditLog)
      .mockResolvedValueOnce(emptyAuditLog()) // initial load
      .mockRejectedValueOnce(new Error("network error")) // poll 1
      .mockRejectedValueOnce(new Error("network error")) // poll 2
      .mockRejectedValueOnce(new Error("network error")) // poll 3
      .mockRejectedValueOnce(new Error("network error")) // poll 4
      .mockRejectedValueOnce(new Error("network error")) // poll 5 - crosses POLL_DEGRADED_THRESHOLD
      .mockResolvedValueOnce(emptyAuditLog()); // poll 6 - recovers

    renderAuditPanel();
    await screen.findByText("No audit log entries yet");

    const pollWarning = await screen.findByText(/Live updates stopped coming through/, {}, { timeout: 12000 });
    expect(pollWarning.closest(".at-notice--warning")).toBeTruthy();

    await waitFor(
      () => expect(screen.queryByText(/Live updates stopped coming through/)).toBeNull(),
      { timeout: 5000 },
    );
  }, 20000);
});

describe("AuditLogPanel Security view rendering", () => {
  // All three views fetch on mount regardless of which is active (see the "System/Audit/Security
  // toggle" comment in AuditLogPanel itself) - give Audit's own fetch a harmless default so these
  // Security-focused tests don't each have to set it up too, mirroring the SystemLogsPanel
  // rendering block below (which does the same per-test, since it predates this shared default).
  beforeEach(() => {
    vi.mocked(fetchAuditLog).mockResolvedValue(emptyAuditLog());
  });

  /** Mirrors renderAuditPanel() above - render then switch to the Security view. All three
   * views stay mounted underneath (only display toggles), so this switch is synchronous. */
  function renderSecurityPanel() {
    const result = renderWithToast(<AuditLogPanel />);
    fireEvent.click(screen.getByRole("radio", { name: "Security" }));
    return result;
  }

  it("keeps the loading skeleton visible until the security request settles", async () => {
    let resolveSecurityLog: (response: SecurityAuditLogResponse) => void = () => {};
    vi.mocked(fetchSecurityAuditLog).mockImplementationOnce(
      () => new Promise<SecurityAuditLogResponse>((resolve) => {
        resolveSecurityLog = resolve;
      }),
    );

    vi.useFakeTimers();
    renderSecurityPanel();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByLabelText("Loading security audit log")).toBeTruthy();
    vi.useRealTimers();

    resolveSecurityLog(emptySecurityLog());
    expect(await screen.findByText("No security events yet")).toBeTruthy();
  });

  it("shows an operator-safe error and can retry the security request", async () => {
    vi.mocked(fetchSecurityAuditLog)
      .mockRejectedValueOnce(new ApiError(500, "secret_internal"))
      .mockResolvedValueOnce(emptySecurityLog());

    renderSecurityPanel();

    expect(await screen.findByText("Could not load security audit log")).toBeTruthy();
    expect(screen.getByText(/Failed to load security audit log/)).toBeTruthy();
    expect(screen.queryByText("secret_internal")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("No security events yet")).toBeTruthy();
    expect(fetchSecurityAuditLog).toHaveBeenCalledTimes(2);
  });

  it("shows the empty state when there are no security events yet", async () => {
    renderSecurityPanel();

    expect(await screen.findByText("No security events yet")).toBeTruthy();
  });

  it("renders the event badge, resolved user, IP, and time for a row", async () => {
    vi.mocked(fetchSecurityAuditLog).mockResolvedValueOnce({
      entries: [makeSecurityEntry()],
      total: 1,
      page: 1,
      pageSize: 25,
    });

    renderSecurityPanel();

    const table = await screen.findByRole("table");
    expect(within(table).getByText("Login succeeded")).toBeTruthy();
    expect(within(table).getByText("Alice Admin")).toBeTruthy();
    expect(within(table).getByText("alice@example.com")).toBeTruthy();
    expect(within(table).getByText("192.0.2.10")).toBeTruthy();
  });

  it("shows the viewer's own local time as a secondary line under the UTC timestamp, not the actor's", async () => {
    const resolvedOptionsSpy = vi
      .spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions")
      .mockReturnValue({ timeZone: "Europe/Warsaw" } as Intl.ResolvedDateTimeFormatOptions);
    try {
      vi.mocked(fetchSecurityAuditLog).mockResolvedValueOnce({
        entries: [makeSecurityEntry()],
        total: 1,
        page: 1,
        pageSize: 25,
      });

      renderSecurityPanel();

      const table = await screen.findByRole("table");
      expect(within(table).getByText("2026-01-01 12:00:00 UTC")).toBeTruthy();
      expect(within(table).getByText(/Europe\/Warsaw, UTC\+1/)).toBeTruthy();
    } finally {
      resolvedOptionsSpy.mockRestore();
    }
  });

  it("shows the redacted email under Unknown for a failed login, mirroring Audit's actor email subline", async () => {
    vi.mocked(fetchSecurityAuditLog).mockResolvedValueOnce({
      entries: [
        makeSecurityEntry({
          id: "sec-5",
          event_type: "auth.login.fail",
          user_id: null,
          user_email: null,
          user_display_name: null,
          metadata: { email_redacted: "a***@example.com" },
        }),
      ],
      total: 1,
      page: 1,
      pageSize: 25,
    });

    renderSecurityPanel();

    const table = await screen.findByRole("table");
    expect(within(table).getByText("Unknown")).toBeTruthy();
    expect(within(table).getByText("a***@example.com")).toBeTruthy();
  });

  it("falls back to email when display name is unset, to Unknown for a null user_id, and Unknown for a since-deleted user", async () => {
    vi.mocked(fetchSecurityAuditLog).mockResolvedValueOnce({
      entries: [
        makeSecurityEntry({ id: "sec-2", user_display_name: null, user_email: "bob@example.com" }),
        makeSecurityEntry({
          id: "sec-3",
          event_type: "auth.login.fail",
          user_id: null,
          user_email: null,
          user_display_name: null,
          ip: null,
        }),
        makeSecurityEntry({ id: "sec-4", user_id: "deleted-user", user_display_name: null, user_email: null }),
      ],
      total: 3,
      page: 1,
      pageSize: 25,
    });

    renderSecurityPanel();

    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(within(rows[0]!).getByText("bob@example.com")).toBeTruthy();
    expect(within(rows[1]!).getByText("Unknown")).toBeTruthy();
    expect(within(rows[1]!).getByText("Login failed")).toBeTruthy();
    expect(within(rows[1]!).getByText("-")).toBeTruthy();
    const deletedCell = within(rows[2]!).getByText("Unknown").closest("td");
    expect(deletedCell?.getAttribute("title")).toBe("deleted-user");
  });

  it("shows metadata in a View popover, humanized, and hides the trigger when there's nothing to show", async () => {
    vi.mocked(fetchSecurityAuditLog).mockResolvedValueOnce({
      entries: [makeSecurityEntry({ metadata: { email: "alice@example.com", userAgent: "curl/8.0" } })],
      total: 1,
      page: 1,
      pageSize: 25,
    });

    renderSecurityPanel();

    const table = await screen.findByRole("table");
    const trigger = within(table).getByText("View");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(within(table).getByText("User agent")).toBeTruthy();
    expect(within(table).getByText("curl/8.0")).toBeTruthy();
  });

  it("does not render a View trigger when metadata is empty", async () => {
    vi.mocked(fetchSecurityAuditLog).mockResolvedValueOnce({
      entries: [makeSecurityEntry({ metadata: {} })],
      total: 1,
      page: 1,
      pageSize: 25,
    });

    renderSecurityPanel();

    await screen.findByRole("table");
    expect(screen.queryByText("View")).toBeNull();
  });

  it("renders one card per entry on mobile instead of a table, with a working copy-row action", async () => {
    mockMatchMedia(false);
    vi.mocked(fetchSecurityAuditLog).mockResolvedValueOnce({
      entries: [makeSecurityEntry(), makeSecurityEntry({ id: "sec-2", user_id: null, user_email: null, user_display_name: null })],
      total: 2,
      page: 1,
      pageSize: 25,
    });
    const originalClipboard = navigator.clipboard;
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    try {
      renderSecurityPanel();

      await screen.findAllByText("Login succeeded");
      expect(screen.queryByRole("table")).toBeNull();
      const cards = document.querySelectorAll(".audit-log-card");
      expect(cards).toHaveLength(2);
      const firstCard = cards[0] as HTMLElement;
      expect(within(firstCard).getByText("Alice Admin")).toBeTruthy();
      expect(within(firstCard).getByText("alice@example.com")).toBeTruthy();
      const secondCard = cards[1] as HTMLElement;
      expect(within(secondCard).getByText("Unknown")).toBeTruthy();

      fireEvent.click(within(firstCard).getByRole("button", { name: "Copy row" }));
      expect(writeText).toHaveBeenCalledTimes(1);
    } finally {
      Object.assign(navigator, { clipboard: originalClipboard });
    }
  });

  it("copies a plain-text row summary to the clipboard and toasts on success", async () => {
    const resolvedOptionsSpy = vi
      .spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions")
      .mockReturnValue({ timeZone: "Europe/Warsaw" } as Intl.ResolvedDateTimeFormatOptions);
    vi.mocked(fetchSecurityAuditLog).mockResolvedValueOnce({
      entries: [
        makeSecurityEntry({
          metadata: { email: "alice@example.com", userAgent: "curl/8.0" },
          country: { kind: "internal" },
        }),
      ],
      total: 1,
      page: 1,
      pageSize: 25,
    });
    const originalClipboard = navigator.clipboard;
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    try {
      renderSecurityPanel();
      const table = await screen.findByRole("table");
      expect(within(table).getByText("Internal network")).toBeTruthy();
      fireEvent.click(within(table).getByRole("button", { name: "Copy row" }));

      expect(writeText).toHaveBeenCalledTimes(1);
      const [summary] = writeText.mock.calls[0]!;
      expect(summary).toMatch(/Time: 2026-01-01 12:00:00 UTC \(13:00 \(Europe\/Warsaw, UTC\+1\)\)/);
      expect(summary).toContain("Event: Login succeeded");
      expect(summary).toContain("User: Alice Admin");
      expect(summary).toContain("IP address: 192.0.2.10 (Internal network)");
      expect(summary).toContain("Details:");
      expect(summary).toContain("User agent: curl/8.0");
      expect(await screen.findByText("Row copied to clipboard")).toBeTruthy();
    } finally {
      Object.assign(navigator, { clipboard: originalClipboard });
      resolvedOptionsSpy.mockRestore();
    }
  });

  it("row-copy summary excludes email_redacted from Details, already shown in the User line", async () => {
    vi.mocked(fetchSecurityAuditLog).mockResolvedValueOnce({
      entries: [
        makeSecurityEntry({
          user_id: null,
          user_email: null,
          user_display_name: null,
          metadata: { email_redacted: "a***@example.com", note: "hello" },
        }),
      ],
      total: 1,
      page: 1,
      pageSize: 25,
    });
    const originalClipboard = navigator.clipboard;
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    try {
      renderSecurityPanel();
      const table = await screen.findByRole("table");
      fireEvent.click(within(table).getByRole("button", { name: "Copy row" }));

      expect(writeText).toHaveBeenCalledTimes(1);
      const [summary] = writeText.mock.calls[0]!;
      expect(summary).toContain("User: Unknown (a***@example.com)");
      expect(summary).toContain("Details:");
      expect(summary).toContain("Note: hello");
      // email_redacted already shown on the User line above - the Details section (mirroring
      // Audit's own buildRowSummary and the Details popover) must not repeat it.
      expect(summary).not.toMatch(/Email redacted/i);
    } finally {
      Object.assign(navigator, { clipboard: originalClipboard });
    }
  });

  it("debounces the search box before refetching with the trimmed term", async () => {
    renderSecurityPanel();
    await screen.findByText("No security events yet");

    vi.useFakeTimers();
    fireEvent.change(screen.getByPlaceholderText("Search user…"), { target: { value: "alice" } });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    vi.useRealTimers();

    await waitFor(() =>
      expect(fetchSecurityAuditLog).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: "alice" }),
        expect.anything(),
      ),
    );
  });

  it("clears the search box and refocuses it via the Clear search button", async () => {
    renderSecurityPanel();
    await screen.findByText("No security events yet");

    const searchInput = screen.getByPlaceholderText("Search user…") as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: "alice" } });
    expect(searchInput.value).toBe("alice");

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));

    expect(searchInput.value).toBe("");
    expect(document.activeElement).toBe(searchInput);
  });

  it("filters by event type via the Filters panel's Event dropdown, resetting to page 1", async () => {
    renderSecurityPanel();
    await waitFor(() => expect(fetchSecurityAuditLog).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
    fireEvent.change(screen.getByRole("combobox", { name: "Event" }), {
      target: { value: "auth.access.denied" },
    });

    await waitFor(() =>
      expect(fetchSecurityAuditLog).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 1, eventType: "auth.access.denied" }),
        expect.anything(),
      ),
    );
    expect(await screen.findByText("No matches")).toBeTruthy();
  });

  it("applies the From/To date filters (as UTC day bounds), resets to page 1, and carries them into export", async () => {
    vi.mocked(fetchSecurityAuditLog).mockResolvedValue({
      entries: [makeSecurityEntry()],
      total: 50,
      page: 1,
      pageSize: 25,
    });
    vi.mocked(exportSecurityAuditLog).mockResolvedValueOnce(undefined);

    renderSecurityPanel();
    await screen.findByRole("table");

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Page 2 of 2")).toBeTruthy();

    // getByRole (not getByLabelText): Audit's own From/To fields share the exact same
    // aria-label - see the matching comment on Audit's own version of this test.
    const fromInput = screen.getByRole("textbox", { name: "From" });
    fireEvent.change(fromInput, { target: { value: "2026-01-01" } });
    fireEvent.blur(fromInput);
    expect(await screen.findByText("Page 1 of 2")).toBeTruthy();
    expect(vi.mocked(fetchSecurityAuditLog).mock.calls.at(-1)![0]).toMatchObject({
      page: 1,
      start: "2026-01-01T00:00:00.000Z",
    });

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Page 2 of 2");
    const toInput = screen.getByRole("textbox", { name: "To" });
    fireEvent.change(toInput, { target: { value: "2026-01-31" } });
    fireEvent.blur(toInput);
    expect(await screen.findByText("Page 1 of 2")).toBeTruthy();
    expect(vi.mocked(fetchSecurityAuditLog).mock.calls.at(-1)![0]).toMatchObject({
      page: 1,
      end: "2026-01-31T23:59:59.999Z",
    });

    fireEvent.click(screen.getByRole("button", { name: "Export logs" }));
    await waitFor(() =>
      expect(exportSecurityAuditLog).toHaveBeenCalledWith({
        eventType: undefined,
        search: undefined,
        start: "2026-01-01T00:00:00.000Z",
        end: "2026-01-31T23:59:59.999Z",
      }),
    );
  });

  it("exports the current filters as CSV and toasts on failure", async () => {
    vi.mocked(exportSecurityAuditLog)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new ApiError(500, "secret_internal"));

    renderSecurityPanel();
    await screen.findByText("No security events yet");

    // With no filters active yet, every optional export param is omitted.
    fireEvent.click(screen.getByRole("button", { name: "Export logs" }));
    await waitFor(() =>
      expect(exportSecurityAuditLog).toHaveBeenNthCalledWith(1, {
        eventType: undefined,
        search: undefined,
        start: undefined,
        end: undefined,
      }),
    );

    fireEvent.click(await screen.findByRole("button", { name: "Export logs" }));
    expect(await screen.findByText(/Failed to export security audit log/)).toBeTruthy();
  });

  it("does not flash the loading skeleton when a filter refetch still resolves to zero results", async () => {
    // Mirrors the Audit-view regression test above - same isInitialLoad bug, same fix, in the
    // Security view's own hook. This edge case was the one the user actually hit: the Security
    // table was empty for an unrelated reason (a stale backend build, fixed separately), so
    // every filter change during that session reliably re-triggered this flicker.
    vi.mocked(fetchSecurityAuditLog).mockResolvedValueOnce(emptySecurityLog());
    renderSecurityPanel();
    expect(await screen.findByText("No security events yet")).toBeTruthy();

    let resolveFiltered: (response: SecurityAuditLogResponse) => void = () => {};
    vi.mocked(fetchSecurityAuditLog).mockImplementationOnce(
      () => new Promise<SecurityAuditLogResponse>((resolve) => {
        resolveFiltered = resolve;
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
    fireEvent.change(screen.getByRole("combobox", { name: "Event" }), {
      target: { value: "auth.access.denied" },
    });

    // hasActiveFilters flips synchronously with the filter change, so "No matches" replaces the
    // unfiltered empty state right away, even though the new request is still in flight - the
    // skeleton must never appear while it settles.
    expect(screen.getByText("No matches")).toBeTruthy();
    expect(screen.queryByLabelText("Loading security audit log")).toBeNull();

    resolveFiltered(emptySecurityLog());
    expect(await screen.findByText("No matches")).toBeTruthy();
    expect(fetchSecurityAuditLog).toHaveBeenCalledTimes(2);
  });

  it("paginates with Previous/Next", async () => {
    vi.mocked(fetchSecurityAuditLog).mockResolvedValue({
      entries: [makeSecurityEntry()],
      total: 60,
      page: 1,
      pageSize: 25,
    });

    renderSecurityPanel();

    expect(await screen.findByText("Showing 1–25 of 60")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Previous" })).property("disabled", true);
    expect(screen.getByText("Page 1 of 3")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(vi.mocked(fetchSecurityAuditLog).mock.calls.at(-1)![0]).toMatchObject({ page: 2 }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    await waitFor(() =>
      expect(vi.mocked(fetchSecurityAuditLog).mock.calls.at(-1)![0]).toMatchObject({ page: 1 }),
    );
  });

  it("falls back to the raw event type and a neutral badge tone for an unrecognized event type", async () => {
    vi.mocked(fetchSecurityAuditLog).mockResolvedValueOnce({
      entries: [makeSecurityEntry({ event_type: "auth.some_future_event" })],
      total: 1,
      page: 1,
      pageSize: 25,
    });

    renderSecurityPanel();

    const table = await screen.findByRole("table");
    const badge = within(table).getByText("auth.some_future_event");
    expect(badge.className).toContain("neutral");
  });

  it("bails out of the in-flight request without touching state once the component has unmounted (resolve race)", async () => {
    let resolveFetch: (value: SecurityAuditLogResponse) => void = () => {};
    vi.mocked(fetchSecurityAuditLog).mockImplementationOnce(
      () => new Promise<SecurityAuditLogResponse>((resolve) => {
        resolveFetch = resolve;
      }),
    );
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = renderSecurityPanel();
    unmount();

    resolveFetch(emptySecurityLog());
    await Promise.resolve();

    expect(consoleErrorSpy).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it("bails out of the in-flight request without touching state once the component has unmounted (reject race)", async () => {
    let rejectFetch: (err: unknown) => void = () => {};
    vi.mocked(fetchSecurityAuditLog).mockImplementationOnce(
      () => new Promise<SecurityAuditLogResponse>((_resolve, reject) => {
        rejectFetch = reject;
      }),
    );
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = renderSecurityPanel();
    unmount();

    rejectFetch(new Error("network error after unmount"));
    await Promise.resolve();

    expect(consoleErrorSpy).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it("silently re-fetches on a timer and shows newly arrived rows", async () => {
    vi.mocked(fetchSecurityAuditLog)
      .mockResolvedValueOnce({ entries: [makeSecurityEntry()], total: 1, page: 1, pageSize: 25 })
      .mockResolvedValueOnce({
        entries: [makeSecurityEntry({ id: "sec-2", user_display_name: "Bob Admin" }), makeSecurityEntry()],
        total: 2,
        page: 1,
        pageSize: 25,
      });

    renderSecurityPanel();
    await screen.findByText("Alice Admin");

    // The poll tick fires on its own, with no user action - this is what makes it "live".
    expect(await screen.findByText("Bob Admin", {}, { timeout: 3000 })).toBeTruthy();
    expect(fetchSecurityAuditLog).toHaveBeenCalledTimes(2);
  }, 10000);

  it("clears an initial load error when a live poll recovers", async () => {
    vi.mocked(fetchSecurityAuditLog)
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce(emptySecurityLog());

    renderSecurityPanel();
    expect(await screen.findByText("Could not load security audit log")).toBeTruthy();
    expect(await screen.findByText("No security events yet", {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.queryByText("Could not load security audit log")).toBeNull();
  }, 10000);

  it("stops polling once Live is turned off, and resumes when clicked again", async () => {
    vi.mocked(fetchSecurityAuditLog).mockResolvedValue(emptySecurityLog());

    renderSecurityPanel();
    await screen.findByText("No security events yet");

    fireEvent.click(screen.getByRole("button", { name: "Live" }));
    expect(screen.getByRole("button", { name: "Paused" })).toBeTruthy();
    const callsAfterPause = vi.mocked(fetchSecurityAuditLog).mock.calls.length;

    // Long enough to cross at least one interval tick, proving it did NOT fire while paused.
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS + 750));
    expect(vi.mocked(fetchSecurityAuditLog).mock.calls).toHaveLength(callsAfterPause);

    fireEvent.click(screen.getByRole("button", { name: "Paused" }));
    expect(screen.getByRole("button", { name: "Live" })).toBeTruthy();

    await waitFor(
      () => expect(vi.mocked(fetchSecurityAuditLog).mock.calls.length).toBeGreaterThan(callsAfterPause),
      { timeout: 3000 },
    );
  }, 10000);

  it("surfaces a banner after sustained live-poll failures, and clears it on the next success", async () => {
    vi.mocked(fetchSecurityAuditLog)
      .mockResolvedValueOnce(emptySecurityLog()) // initial load
      .mockRejectedValueOnce(new Error("network error")) // poll 1
      .mockRejectedValueOnce(new Error("network error")) // poll 2
      .mockRejectedValueOnce(new Error("network error")) // poll 3
      .mockRejectedValueOnce(new Error("network error")) // poll 4
      .mockRejectedValueOnce(new Error("network error")) // poll 5 - crosses POLL_DEGRADED_THRESHOLD
      .mockResolvedValueOnce(emptySecurityLog()); // poll 6 - recovers

    renderSecurityPanel();
    await screen.findByText("No security events yet");

    const pollWarning = await screen.findByText(/Live updates stopped coming through/, {}, { timeout: 12000 });
    expect(pollWarning.closest(".at-notice--warning")).toBeTruthy();

    await waitFor(
      () => expect(screen.queryByText(/Live updates stopped coming through/)).toBeNull(),
      { timeout: 5000 },
    );
  }, 20000);
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

  it("hosts Export logs/Live in the Card header, next to the System/Audit/Security toggle", async () => {
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
    await waitFor(() => expect(screen.getByRole("button", { name: "Export logs" })).property("disabled", false));

    const liveButton = screen.getByRole("button", { name: "Live" });
    fireEvent.click(liveButton);
    expect(screen.getByRole("button", { name: "Paused" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Paused" }));
    expect(screen.getByRole("button", { name: "Live" })).toBeTruthy();
  });

  it("disables the header Export logs button until there's something to download", async () => {
    vi.mocked(fetchAuditLog).mockResolvedValue(emptyAuditLog());
    vi.mocked(fetchSystemLogs).mockResolvedValue(emptySystemLog());

    renderWithToast(<AuditLogPanel />);
    await screen.findByText("No audit log entries yet");
    openSystemLogsView();
    await screen.findByText("No log activity yet");

    expect(screen.getByRole("button", { name: "Export logs" })).property("disabled", true);
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

  it("refetches when the level filter changes", async () => {
    vi.mocked(fetchAuditLog).mockResolvedValue(emptyAuditLog());
    vi.mocked(fetchSystemLogs).mockResolvedValue(emptySystemLog());

    renderWithToast(<AuditLogPanel />);
    await screen.findByText("No audit log entries yet");
    openSystemLogsView();
    await screen.findByText("No log activity yet");

    fireEvent.change(screen.getByRole("combobox", { name: "Level" }), { target: { value: "error" } });

    await waitFor(() =>
      expect(fetchSystemLogs).toHaveBeenLastCalledWith(
        { level: "error", source: undefined, search: undefined },
        expect.anything(),
      ),
    );
  });

  it("copies the visible lines to the clipboard and Clear view empties them", async () => {
    vi.mocked(fetchAuditLog).mockResolvedValue(emptyAuditLog());
    vi.mocked(fetchSystemLogs).mockResolvedValueOnce({
      entries: [{ id: 1, ts: "2026-01-01T12:00:00.000Z", level: "info", source: "api", message: "http_request" }],
      cursor: 1,
    });
    const originalClipboard = navigator.clipboard;
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    try {
      renderWithToast(<AuditLogPanel />);
      await screen.findByText("No audit log entries yet");
      openSystemLogsView();
      await screen.findByText("http_request");

      fireEvent.click(screen.getByRole("button", { name: "Copy" }));
      await screen.findByText("Log lines copied to clipboard");
      expect(writeText).toHaveBeenCalledTimes(1);
      expect(writeText.mock.calls[0]![0]).toContain("http_request");

      fireEvent.click(screen.getByRole("button", { name: "Clear view" }));
      expect(screen.getByText("No log activity yet")).toBeTruthy();
    } finally {
      Object.assign(navigator, { clipboard: originalClipboard });
    }
  });

  it("toasts an error when the clipboard write is blocked", async () => {
    vi.mocked(fetchAuditLog).mockResolvedValue(emptyAuditLog());
    vi.mocked(fetchSystemLogs).mockResolvedValueOnce({
      entries: [{ id: 1, ts: "2026-01-01T12:00:00.000Z", level: "info", source: "api", message: "http_request" }],
      cursor: 1,
    });
    const originalClipboard = navigator.clipboard;
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("blocked")) } });

    try {
      renderWithToast(<AuditLogPanel />);
      await screen.findByText("No audit log entries yet");
      openSystemLogsView();
      await screen.findByText("http_request");

      fireEvent.click(screen.getByRole("button", { name: "Copy" }));
      expect(await screen.findByText("Could not copy. Clipboard access was blocked.")).toBeTruthy();
    } finally {
      Object.assign(navigator, { clipboard: originalClipboard });
    }
  });

  it("downloads the visible lines as a .log file via the header Export logs button", async () => {
    vi.mocked(fetchAuditLog).mockResolvedValue(emptyAuditLog());
    vi.mocked(fetchSystemLogs).mockResolvedValueOnce({
      entries: [{ id: 1, ts: "2026-01-01T12:00:00.000Z", level: "info", source: "api", message: "http_request" }],
      cursor: 1,
    });
    vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:mock"), revokeObjectURL: vi.fn() });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    try {
      renderWithToast(<AuditLogPanel />);
      await screen.findByText("No audit log entries yet");
      openSystemLogsView();
      await screen.findByText("http_request");

      await waitFor(() => expect(screen.getByRole("button", { name: "Export logs" })).property("disabled", false));
      fireEvent.click(screen.getByRole("button", { name: "Export logs" }));

      expect(clickSpy).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
      clickSpy.mockRestore();
    }
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

  it("replaces the view with a fresh snapshot when the server cursor resets (restart recovery)", async () => {
    // Real timers throughout, same reasoning as the test above - the poll interval is created
    // at real mount time.
    vi.mocked(fetchAuditLog).mockResolvedValue(emptyAuditLog());
    vi.mocked(fetchSystemLogs)
      .mockResolvedValueOnce({
        entries: [{ id: 5, ts: "2026-01-01T12:00:00.000Z", level: "info", source: "api", message: "before-restart" }],
        cursor: 5,
      })
      .mockResolvedValueOnce({
        // Poll asked for since=5; a cursor lower than that means the buffer reset (server
        // restart), not "zero new entries".
        entries: [],
        cursor: 1,
      })
      .mockResolvedValueOnce({
        entries: [{ id: 1, ts: "2026-01-01T12:05:00.000Z", level: "info", source: "api", message: "after-restart" }],
        cursor: 1,
      });

    renderWithToast(<AuditLogPanel />);
    await screen.findByText("No audit log entries yet");
    openSystemLogsView();
    await screen.findByText("before-restart");

    expect(await screen.findByText("after-restart", {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.queryByText("before-restart")).toBeNull();
    // Third call is the full re-fetch snapshot triggered by the cursor reset - no `since`.
    expect(fetchSystemLogs).toHaveBeenNthCalledWith(
      3,
      { level: undefined, source: undefined, search: undefined },
      expect.anything(),
    );
  }, 10000);

  it("surfaces a banner after sustained live-poll failures, and clears it on the next success", async () => {
    vi.mocked(fetchAuditLog).mockResolvedValue(emptyAuditLog());
    vi.mocked(fetchSystemLogs)
      .mockResolvedValueOnce(emptySystemLog()) // initial snapshot
      .mockRejectedValueOnce(new Error("network error")) // poll 1
      .mockRejectedValueOnce(new Error("network error")) // poll 2
      .mockRejectedValueOnce(new Error("network error")) // poll 3
      .mockRejectedValueOnce(new Error("network error")) // poll 4
      .mockRejectedValueOnce(new Error("network error")) // poll 5 - crosses POLL_DEGRADED_THRESHOLD
      .mockResolvedValueOnce(emptySystemLog()); // poll 6 - recovers

    renderWithToast(<AuditLogPanel />);
    await screen.findByText("No audit log entries yet");
    openSystemLogsView();
    await screen.findByText("No log activity yet");

    const pollWarning = await screen.findByText(/Live updates stopped coming through/, {}, { timeout: 12000 });
    expect(pollWarning.closest(".at-notice--warning")).toBeTruthy();

    await waitFor(
      () => expect(screen.queryByText(/Live updates stopped coming through/)).toBeNull(),
      { timeout: 5000 },
    );
  }, 20000);

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

    expect(vi.mocked(fetchSystemLogs).mock.calls).toHaveLength(callsAfterPause);
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

  it("moves Export logs/Live into the toolbar on mobile instead of the Card header", async () => {
    mockMatchMedia(false);
    vi.mocked(fetchAuditLog).mockResolvedValue(emptyAuditLog());
    vi.mocked(fetchSystemLogs).mockResolvedValue(emptySystemLog());

    renderWithToast(<AuditLogPanel />);
    await screen.findByText("No log activity yet");

    expect(screen.getByRole("button", { name: "Live" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Export logs" })).toBeTruthy();
  });
});

describe("EventArchivingPanel rendering", () => {
  it("renders an active event's details in a table row, including a link to its overview", async () => {
    vi.mocked(fetchAdminEvents).mockResolvedValueOnce([
      makeEvent({
        id: "evt-spring-summit",
        title: "Spring Summit",
        slug: "spring-summit",
        attendee_count: 42,
        created_by_display_name: "Alice Admin",
      }),
    ]);
    renderWithToastAndRouter(<EventArchivingPanel />);

    const link = await screen.findByRole("link", { name: "Spring Summit" });
    expect(link.getAttribute("href")).toBe("/admin/events/evt-spring-summit/overview");
    expect(screen.getByText("spring-summit")).toBeTruthy();
    expect(screen.getByText("42")).toBeTruthy();
    expect(screen.getByText("by Alice Admin")).toBeTruthy();
  });

  it("shows the Created date in the creator's own timezone rather than UTC, when known", async () => {
    // 11:30 PM UTC on the 21st is already the 22nd in Kolkata (UTC+5:30) - an unambiguous way to
    // tell the two apart without depending on exact formatted-string equality.
    // Pinned so the "Jun"/month-name assertions below don't depend on the test runner's own locale.
    setPreferredLocale("en-US");
    vi.mocked(fetchAdminEvents).mockResolvedValueOnce([
      makeEvent({
        title: "Diwali Meetup",
        created_at: "2026-06-21T23:30:00.000Z",
        created_by_timezone: "Asia/Kolkata",
      }),
    ]);
    renderWithToastAndRouter(<EventArchivingPanel />);

    await screen.findByText("Diwali Meetup");
    expect(screen.getByText(/Jun 22, 2026/)).toBeTruthy();
    expect(screen.queryByText(/Jun 21, 2026/)).toBeNull();
    expect(screen.getByRole("button", { name: "Archive" })).toBeTruthy();
  });

  it("falls back to email, then '-', when created_by has no display name or no attribution at all", async () => {
    vi.mocked(fetchAdminEvents).mockResolvedValueOnce([
      makeEvent({ id: "evt-a", title: "Event A", created_by_email: "bob@example.com" }),
      makeEvent({ id: "evt-b", title: "Event B", slug: "event-b" }),
    ]);
    renderWithToastAndRouter(<EventArchivingPanel />);

    await screen.findByText("Event A");
    expect(screen.getByText("by bob@example.com")).toBeTruthy();
    expect(screen.getByText("by -")).toBeTruthy();
  });

  it("switches to the Archived view and renders the archived date, who archived it, and an Unarchive action", async () => {
    // Pinned so the "Feb"/month-name assertion below doesn't depend on the test runner's own locale.
    setPreferredLocale("en-US");
    vi.mocked(fetchAdminEvents).mockResolvedValueOnce([
      makeEvent({
        title: "Winter Meetup",
        archived_at: "2026-02-15T10:30:00.000Z",
        archived_by_display_name: "Carol Superadmin",
      }),
    ]);
    renderWithToastAndRouter(<EventArchivingPanel />);

    await screen.findByText("No active events");
    fireEvent.click(screen.getByRole("radio", { name: "Archived" }));

    await screen.findByText("Winter Meetup");
    expect(screen.getByText(/Feb 15, 2026/)).toBeTruthy();
    expect(screen.getByText("by Carol Superadmin")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Unarchive" })).toBeTruthy();
  });

  it("shows empty-state copy with no table underneath, for both views", async () => {
    vi.mocked(fetchAdminEvents).mockResolvedValueOnce([]);
    renderWithToastAndRouter(<EventArchivingPanel />);

    await screen.findByText("No active events");
    expect(screen.queryByRole("table")).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: "Archived" }));
    await screen.findByText("No archived events");
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("paginates client-side once a view has more rows than one page", async () => {
    const many = Array.from({ length: 30 }, (_, i) => makeEvent({ id: `evt-page-${i}`, title: `Event ${i}` }));
    vi.mocked(fetchAdminEvents).mockResolvedValueOnce(many);
    renderWithToastAndRouter(<EventArchivingPanel />);

    await screen.findByText("Showing 1–25 of 30");
    expect(screen.getByText("Event 0")).toBeTruthy();
    expect(screen.queryByText("Event 25")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Event 25");
    expect(screen.queryByText("Event 0")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    await screen.findByText("Event 0");
    expect(screen.queryByText("Event 25")).toBeNull();
  });

  it("shows more rows on one page after increasing the page size", async () => {
    const many = Array.from({ length: 30 }, (_, i) => makeEvent({ id: `evt-page-${i}`, title: `Event ${i}` }));
    vi.mocked(fetchAdminEvents).mockResolvedValueOnce(many);
    renderWithToastAndRouter(<EventArchivingPanel />);

    await screen.findByText("Showing 1–25 of 30");
    fireEvent.change(screen.getByLabelText("Rows per page"), { target: { value: "50" } });

    await screen.findByText("Showing 1–30 of 30");
    expect(screen.getByText("Event 25")).toBeTruthy();
  });

  it("renders a one-card-per-event list instead of a table below the desktop breakpoint", async () => {
    mockMatchMedia(false);
    vi.mocked(fetchAdminEvents).mockResolvedValueOnce([
      makeEvent({ title: "Mobile Meetup", attendee_count: 7, created_by_display_name: "Dana Admin" }),
    ]);
    renderWithToastAndRouter(<EventArchivingPanel />);

    await screen.findByText("Mobile Meetup");
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText("Event date")).toBeTruthy();
    expect(screen.getByText("7")).toBeTruthy();
    expect(screen.getByText("by Dana Admin")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Archive" })).toBeTruthy();
  });

  it("shows the Archived row and attendee fallback in the mobile card view when viewing archived events", async () => {
    mockMatchMedia(false);
    vi.mocked(fetchAdminEvents).mockResolvedValueOnce([
      makeEvent({
        title: "Archived Mobile Meetup",
        created_at: "2026-01-10T09:00:00.000Z",
        created_by_display_name: "Erin Creator",
        archived_at: "2026-02-15T10:30:00.000Z",
        archived_by_display_name: "Carol Superadmin",
      }),
    ]);
    renderWithToastAndRouter(<EventArchivingPanel />);

    await screen.findByText("No active events");
    fireEvent.click(screen.getByRole("radio", { name: "Archived" }));

    await screen.findByText("Archived Mobile Meetup");
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText("Attendees")).toBeTruthy();
    expect(screen.getByText("-")).toBeTruthy();
    expect(screen.getByText("by Carol Superadmin")).toBeTruthy();
  });
});
