// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SecurityAuditLogEntryDto, SecurityAuditLogResponse } from "../../src/api/types.js";
import { ApiError, fetchSecurityAuditLog } from "../../src/api/client.js";
import { SecurityAuditLogPanel } from "../../src/settings/SecurityAuditLogPanel.js";

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    fetchSecurityAuditLog: vi.fn(),
  };
});

function emptyLog(total = 0): SecurityAuditLogResponse {
  return { entries: [], total, page: 1, pageSize: 25 };
}

function makeEntry(overrides: Partial<SecurityAuditLogEntryDto> = {}): SecurityAuditLogEntryDto {
  return {
    id: "sec-1",
    event_type: "auth.login.success",
    user_id: "user-1",
    user_email: "alice@example.com",
    user_display_name: "Alice Admin",
    ip: "192.0.2.10",
    metadata: { email: "alice@example.com", userAgent: "curl/8.0" },
    created_at: "2026-01-01T12:00:00.000Z",
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("SecurityAuditLogPanel rendering", () => {
  it("shows the loading placeholder once the fetch has genuinely taken a moment", () => {
    vi.mocked(fetchSecurityAuditLog).mockImplementationOnce(() => new Promise(() => {}));
    vi.useFakeTimers();

    render(<SecurityAuditLogPanel />);
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  it("shows the empty state when there are no events yet", async () => {
    vi.mocked(fetchSecurityAuditLog).mockResolvedValueOnce(emptyLog());

    render(<SecurityAuditLogPanel />);

    expect(await screen.findByText("No security events yet")).toBeTruthy();
  });

  it("shows an operator-safe load failure (no raw error text) and retries", async () => {
    vi.mocked(fetchSecurityAuditLog)
      .mockRejectedValueOnce(new ApiError(500, "secret_internal"))
      .mockResolvedValueOnce(emptyLog());

    render(<SecurityAuditLogPanel />);

    const retry = await screen.findByRole("button", { name: "Retry" });
    expect(screen.getByText(/Failed to load security audit log/)).toBeTruthy();
    expect(screen.queryByText("secret_internal")).toBeNull();

    fireEvent.click(retry);

    expect(await screen.findByText("No security events yet")).toBeTruthy();
    expect(fetchSecurityAuditLog).toHaveBeenCalledTimes(2);
  });

  it("renders the event badge, resolved user, IP, and time for a row", async () => {
    vi.mocked(fetchSecurityAuditLog).mockResolvedValueOnce({
      entries: [makeEntry()],
      total: 1,
      page: 1,
      pageSize: 25,
    });

    render(<SecurityAuditLogPanel />);

    const table = await screen.findByRole("table");
    expect(within(table).getByText("Login succeeded")).toBeTruthy();
    expect(within(table).getByText("Alice Admin")).toBeTruthy();
    expect(within(table).getByText("192.0.2.10")).toBeTruthy();
  });

  it("falls back to email when display name is unset, and to \"Unknown\" for a null user_id", async () => {
    vi.mocked(fetchSecurityAuditLog).mockResolvedValueOnce({
      entries: [
        makeEntry({ id: "sec-2", user_display_name: null, user_email: "bob@example.com" }),
        makeEntry({
          id: "sec-3",
          event_type: "auth.login.fail",
          user_id: null,
          user_email: null,
          user_display_name: null,
          ip: null,
          metadata: { email_redacted: "t***@example.com", userAgent: null },
        }),
      ],
      total: 2,
      page: 1,
      pageSize: 25,
    });

    render(<SecurityAuditLogPanel />);

    const table = await screen.findByRole("table");
    expect(within(table).getByText("bob@example.com")).toBeTruthy();
    expect(within(table).getByText("Unknown")).toBeTruthy();
    expect(within(table).getByText("Login failed")).toBeTruthy();
    expect(within(table).getByText("—")).toBeTruthy();
  });

  it("expands and collapses raw metadata via the Details toggle", async () => {
    vi.mocked(fetchSecurityAuditLog).mockResolvedValueOnce({
      entries: [makeEntry({ metadata: { email: "alice@example.com", userAgent: "curl/8.0" } })],
      total: 1,
      page: 1,
      pageSize: 25,
    });

    render(<SecurityAuditLogPanel />);

    const toggle = await screen.findByRole("button", { name: "Details" });
    fireEvent.click(toggle);
    expect(screen.getByText(/alice@example\.com/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Hide" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(screen.queryByRole("button", { name: "Hide" })).toBeNull();
  });

  it("does not render a Details toggle when metadata is empty", async () => {
    vi.mocked(fetchSecurityAuditLog).mockResolvedValueOnce({
      entries: [makeEntry({ metadata: {} })],
      total: 1,
      page: 1,
      pageSize: 25,
    });

    render(<SecurityAuditLogPanel />);

    await screen.findByRole("table");
    expect(screen.queryByRole("button", { name: "Details" })).toBeNull();
  });

  it("filters by event type, resetting to page 1", async () => {
    vi.mocked(fetchSecurityAuditLog).mockResolvedValue(emptyLog());

    render(<SecurityAuditLogPanel />);
    await waitFor(() => expect(fetchSecurityAuditLog).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByRole("combobox", { name: "Event type" }), {
      target: { value: "auth.access.denied" },
    });

    await waitFor(() => expect(fetchSecurityAuditLog).toHaveBeenCalledTimes(2));
    expect(fetchSecurityAuditLog).toHaveBeenLastCalledWith({
      eventType: "auth.access.denied",
      page: 1,
      pageSize: 25,
    });
  });

  it("paginates with Previous/Next", async () => {
    vi.mocked(fetchSecurityAuditLog).mockResolvedValue({
      entries: [makeEntry()],
      total: 60,
      page: 1,
      pageSize: 25,
    });

    render(<SecurityAuditLogPanel />);

    expect(await screen.findByText("Showing 1–25 of 60")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Previous" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Page 1 of 3")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() =>
      expect(fetchSecurityAuditLog).toHaveBeenLastCalledWith({ eventType: undefined, page: 2, pageSize: 25 }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Previous" }));

    await waitFor(() =>
      expect(fetchSecurityAuditLog).toHaveBeenLastCalledWith({ eventType: undefined, page: 1, pageSize: 25 }),
    );
  });

  it("falls back to the raw event type and a neutral badge tone for an unrecognized event type", async () => {
    vi.mocked(fetchSecurityAuditLog).mockResolvedValueOnce({
      entries: [makeEntry({ event_type: "auth.some_future_event" })],
      total: 1,
      page: 1,
      pageSize: 25,
    });

    render(<SecurityAuditLogPanel />);

    const table = await screen.findByRole("table");
    const badge = within(table).getByText("auth.some_future_event");
    expect(badge.className).toContain("neutral");
  });

  it("shows Unknown when a row's user_id no longer resolves to any display name or email", async () => {
    vi.mocked(fetchSecurityAuditLog).mockResolvedValueOnce({
      entries: [makeEntry({ user_id: "deleted-user", user_display_name: null, user_email: null })],
      total: 1,
      page: 1,
      pageSize: 25,
    });

    render(<SecurityAuditLogPanel />);

    const table = await screen.findByRole("table");
    expect(within(table).getByText("Unknown")).toBeTruthy();
  });
});
