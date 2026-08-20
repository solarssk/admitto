// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../../src/api/client.js";
import { ActiveSessionsTab } from "../../../src/pages/users/ActiveSessionsTab.js";
import type { EventDto, SessionListDto } from "../../../src/api/types.js";
import { mockMatchMedia, renderWithToast } from "../../test-utils.js";

const EDIT_NAME = /^Edit device label for/;
const REVOKE_NAME = /^Revoke session for/;

function makeSession(overrides: Partial<SessionListDto> = {}): SessionListDto {
  return {
    id: "session-1",
    userId: "user-1",
    userEmail: "user@example.com",
    userDisplayName: null,
    role: "admin",
    deviceLabel: null,
    ip: "192.0.2.10",
    country: { kind: "unknown" },
    userAgent: null,
    loginAt: "2026-01-01T12:00:00.000Z",
    lastSeenAt: "2026-01-01T12:30:00.000Z",
    expiresAt: "2026-01-02T12:00:00.000Z",
    authMethod: "local",
    stage: "active",
    timezone: null,
    isCurrent: false,
    ...overrides,
  };
}

const sampleEvent: EventDto = {
  id: "evt-1",
  title: "Summit",
  slug: "summit",
  date: "2026-06-01",
  timezone: "Europe/Warsaw",
  archived_at: null,
};

vi.mock("../../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/api/client.js")>();
  return {
    ...actual,
    fetchSessions: vi.fn(),
    fetchAdminEvents: vi.fn(),
    revokeSessionById: vi.fn(),
    revokeAllOperatorSessions: vi.fn(),
    updateSessionDeviceLabel: vi.fn(),
  };
});

import {
  fetchAdminEvents,
  fetchSessions,
  revokeAllOperatorSessions,
  revokeSessionById,
  updateSessionDeviceLabel,
} from "../../../src/api/client.js";

beforeEach(() => {
  vi.mocked(fetchAdminEvents).mockResolvedValue([]);
  // ActiveSessionsTab picks table vs. mobile cards via useIsDesktop(), same convention as
  // AuditLogPanel - default to desktop so these tests exercise the <table> markup; the one
  // "mobile cards" test below overrides this to exercise the other branch.
  mockMatchMedia(true);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  // resetAllMocks (not clearAllMocks): several tests here queue mockResolvedValueOnce/
  // mockRejectedValueOnce chains sized to an exact expected call count - clearAllMocks only
  // wipes call history, not queued/overridden implementations, so a leftover would otherwise
  // silently answer the next test's first call to that same mocked function instead of it.
  vi.resetAllMocks();
  vi.useRealTimers();
});

describe("ActiveSessionsTab rendering", () => {
  it("shows filter labels and the empty state after sessions load", async () => {
    vi.mocked(fetchSessions).mockResolvedValue({ sessions: [] });

    renderWithToast(<ActiveSessionsTab />);

    expect(await screen.findByText("No active sessions")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "All" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Admins" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Operators" })).toBeTruthy();
  });

  it("shows a filter-specific empty state when sessions exist but none match the filter", async () => {
    vi.mocked(fetchSessions).mockResolvedValue({
      sessions: [makeSession({ role: "operator" })],
    });

    renderWithToast(<ActiveSessionsTab />);

    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("radio", { name: "Admins" }));

    expect(await screen.findByText("No sessions match this filter")).toBeTruthy();
    expect(screen.queryByText("No active sessions")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));

    expect(await screen.findByRole("radio", { name: "All", checked: true })).toBeTruthy();
    expect((screen.getByLabelText("Search sessions by user name or email") as HTMLInputElement).value).toBe("");
  });

  it("the Operators filter shows only operator-role sessions", async () => {
    vi.mocked(fetchSessions).mockResolvedValue({
      sessions: [
        makeSession({ id: "admin-1", userEmail: "admin@example.com", role: "admin" }),
        makeSession({ id: "op-1", userEmail: "operator@example.com", role: "operator" }),
      ],
    });

    renderWithToast(<ActiveSessionsTab />);

    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("radio", { name: "Operators" }));

    expect(screen.getByText("operator@example.com")).toBeTruthy();
    expect(screen.queryByText("admin@example.com")).toBeNull();
  });

  it("filters sessions by user name or email as you type, no debounce needed (client-side)", async () => {
    vi.mocked(fetchSessions).mockResolvedValue({
      sessions: [
        makeSession({ id: "s-jane", userEmail: "jane@example.com", userDisplayName: "Jane Doe" }),
        makeSession({ id: "s-bob", userEmail: "bob@example.com", userDisplayName: "Bob Smith" }),
      ],
    });

    renderWithToast(<ActiveSessionsTab />);

    await screen.findByRole("table");
    fireEvent.change(screen.getByLabelText("Search sessions by user name or email"), {
      target: { value: "jane" },
    });

    expect(screen.getByText("Jane Doe")).toBeTruthy();
    expect(screen.queryByText("Bob Smith")).toBeNull();
  });

  it("clears the search box via its own inline clear button and refocuses it", async () => {
    vi.mocked(fetchSessions).mockResolvedValue({ sessions: [makeSession()] });
    renderWithToast(<ActiveSessionsTab />);
    await screen.findByRole("table");
    const searchInput = screen.getByLabelText("Search sessions by user name or email") as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: "jane" } });
    expect(searchInput.value).toBe("jane");

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));

    expect(searchInput.value).toBe("");
    expect(document.activeElement).toBe(searchInput);
  });

  it("matches by email when the session has no display name", async () => {
    vi.mocked(fetchSessions).mockResolvedValue({
      sessions: [makeSession({ userEmail: "noname@example.com", userDisplayName: null })],
    });

    renderWithToast(<ActiveSessionsTab />);

    await screen.findByRole("table");
    fireEvent.change(screen.getByLabelText("Search sessions by user name or email"), {
      target: { value: "noname" },
    });

    expect(screen.getByText("noname@example.com")).toBeTruthy();
  });

  it("changing rows-per-page resets to page 1 and updates the page slice", async () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      makeSession({ id: `s${i}`, userEmail: `user${i}@example.com` }),
    );
    vi.mocked(fetchSessions).mockResolvedValue({ sessions: many });

    renderWithToast(<ActiveSessionsTab />);

    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Page 2 of 2")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^Rows per page,/ }));
    fireEvent.click(screen.getByRole("button", { name: "50" }));

    expect(screen.getByText("Showing 1–30 of 30")).toBeTruthy();
    expect(screen.getByText("Page 1 of 1")).toBeTruthy();
  });

  it("steps from the clamped page, not a stale raw page, after a revoke shrinks the page count (codex review)", async () => {
    const makeMany = (n: number) =>
      Array.from({ length: n }, (_, i) => makeSession({ id: `s${i}`, userEmail: `user${i}@example.com` }));
    // 51 sessions = 3 pages of 25/25/1. Revoking the sole session on page 3 leaves 50 = 2 pages,
    // clamping the view to page 2 - Previous must then land on page 1, not stay on page 2.
    vi.mocked(fetchSessions).mockResolvedValueOnce({ sessions: makeMany(51) });
    vi.mocked(fetchAdminEvents).mockResolvedValueOnce([]);
    vi.mocked(revokeSessionById).mockResolvedValueOnce(undefined);
    vi.mocked(fetchSessions).mockResolvedValueOnce({ sessions: makeMany(50) });

    renderWithToast(<ActiveSessionsTab />);
    await screen.findByRole("table");

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Page 3 of 3")).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: REVOKE_NAME })[0]!);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));

    await waitFor(() => {
      expect(screen.getByText("Page 2 of 2")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(screen.getByText("Page 1 of 2")).toBeTruthy();
  });

  it("shows an operator-safe session error and retries", async () => {
    vi.mocked(fetchSessions)
      .mockRejectedValueOnce(new ApiError(500, "secret_internal"))
      .mockResolvedValueOnce({ sessions: [] });

    renderWithToast(<ActiveSessionsTab />);

    const retry = await screen.findByRole("button", { name: "Retry" });
    expect(document.querySelector(".sessions-status p")?.textContent).toMatch(/Failed to load sessions/);
    expect(screen.queryByText("secret_internal")).toBeNull();

    fireEvent.click(retry);

    expect(await screen.findByText("No active sessions")).toBeTruthy();
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

    renderWithToast(<ActiveSessionsTab />);

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

  it("shows a capitalized, colored role badge (Superadmin/Administrator/Operator)", async () => {
    vi.mocked(fetchSessions).mockResolvedValue({
      sessions: [
        makeSession({ id: "sa", userEmail: "sa@example.com", role: "superadmin" }),
        makeSession({ id: "ad", userEmail: "ad@example.com", role: "admin" }),
        makeSession({ id: "op", userEmail: "op@example.com", role: "operator" }),
      ],
    });

    renderWithToast(<ActiveSessionsTab />);

    await screen.findByRole("table");
    expect(screen.getByText("Superadmin").className).toMatch(/at-badge--error/);
    expect(screen.getByText("Administrator").className).toMatch(/at-badge--warn/);
    expect(screen.getByText("Operator").className).toMatch(/at-badge--info/);
  });

  it("shows an avatar with initials next to the user's name", async () => {
    vi.mocked(fetchSessions).mockResolvedValue({
      sessions: [makeSession({ userEmail: "avatar@example.com", userDisplayName: "Ada Lovelace" })],
    });

    renderWithToast(<ActiveSessionsTab />);

    await screen.findByText("Ada Lovelace");
    expect(document.querySelector(".users-page__user-cell .at-avatar")).toBeTruthy();
  });

  it("labels the sign-in method as Local or SSO with a distinct icon each", async () => {
    vi.mocked(fetchSessions).mockResolvedValue({
      sessions: [
        makeSession({ id: "local", userEmail: "local@example.com", authMethod: "local" }),
        makeSession({ id: "sso", userEmail: "sso@example.com", authMethod: "oidc" }),
      ],
    });

    renderWithToast(<ActiveSessionsTab />);

    await screen.findByRole("table");
    expect(within(screen.getByText("local@example.com").closest("tr")!).getByText("Local password")).toBeTruthy();
    expect(within(screen.getByText("sso@example.com").closest("tr")!).getByText("Identity provider")).toBeTruthy();
  });

  it("reports the loaded session count to the parent for the tab label", async () => {
    const onCountChange = vi.fn();
    vi.mocked(fetchSessions).mockResolvedValue({
      sessions: [makeSession({ id: "a" }), makeSession({ id: "b" })],
    });

    renderWithToast(<ActiveSessionsTab onCountChange={onCountChange} />);

    await screen.findByRole("table");
    await waitFor(() => {
      expect(onCountChange).toHaveBeenCalledWith(2);
    });
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

    renderWithToast(<ActiveSessionsTab />);

    await screen.findByRole("table");
    const withDeviceRow = screen.getByText("device@example.com").closest("tr");
    expect(withDeviceRow).toBeTruthy();
    fireEvent.click(within(withDeviceRow!).getByRole("button", { name: REVOKE_NAME }));
    const withDeviceDialog = await screen.findByRole("dialog");
    expect(withDeviceDialog.textContent).toContain("device@example.com (Desk iPad)? Last active");
    fireEvent.click(within(withDeviceDialog).getByRole("button", { name: "Cancel" }));

    const withoutDeviceRow = screen.getByText("plain@example.com").closest("tr");
    expect(withoutDeviceRow).toBeTruthy();
    fireEvent.click(within(withoutDeviceRow!).getByRole("button", { name: REVOKE_NAME }));
    const withoutDeviceDialog = await screen.findByRole("dialog");
    expect(withoutDeviceDialog.textContent).toContain("plain@example.com? Last active");
  });

  it("disables Revoke (but not Edit) for the current session", async () => {
    vi.mocked(fetchSessions).mockResolvedValue({
      sessions: [makeSession({ id: "self", userEmail: "self@example.com", isCurrent: true })],
    });

    renderWithToast(<ActiveSessionsTab />);

    const row = (await screen.findByText("self@example.com")).closest("tr");
    expect(row).toBeTruthy();
    const revokeButton = within(row!).getByRole("button", { name: REVOKE_NAME }) as HTMLButtonElement;
    expect(revokeButton.disabled).toBe(true);
    const editButton = within(row!).getByRole("button", { name: EDIT_NAME }) as HTMLButtonElement;
    expect(editButton.disabled).toBe(false);
  });

  it("shows a tooltip on the disabled self-revoke button explaining why", async () => {
    vi.mocked(fetchSessions).mockResolvedValue({
      sessions: [makeSession({ id: "self", userEmail: "self@example.com", isCurrent: true })],
    });

    renderWithToast(<ActiveSessionsTab />);

    const row = (await screen.findByText("self@example.com")).closest("tr");
    const trigger = within(row!).getByRole("button", { name: REVOKE_NAME }).closest(".at-tooltip-trigger");
    expect(trigger).toBeTruthy();
    fireEvent.mouseEnter(trigger!);
    expect(await screen.findByRole("tooltip")).toHaveProperty(
      "textContent",
      "You cannot revoke your own session",
    );
  });

  it("Edit opens a dialog prefilled with the current device label; Save is disabled until it changes", async () => {
    vi.mocked(fetchSessions).mockResolvedValue({
      sessions: [
        makeSession({ id: "with-device", userEmail: "device@example.com", deviceLabel: "Desk iPad" }),
      ],
    });

    renderWithToast(<ActiveSessionsTab />);

    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: EDIT_NAME }));
    const dialog = await screen.findByRole("dialog");
    const input = within(dialog).getByLabelText("Device label") as HTMLInputElement;
    expect(input.value).toBe("Desk iPad");
    const saveButton = within(dialog).getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);

    fireEvent.change(input, { target: { value: "Desk iPad 2" } });
    expect(saveButton.disabled).toBe(false);
  });

  it("saving a changed device label calls the API with the trimmed value and reloads the list", async () => {
    vi.mocked(fetchSessions).mockResolvedValue({
      sessions: [
        makeSession({ id: "with-device", userEmail: "device@example.com", deviceLabel: "Desk iPad" }),
      ],
    });
    vi.mocked(updateSessionDeviceLabel).mockResolvedValueOnce({ deviceLabel: "Fixed Label" });

    renderWithToast(<ActiveSessionsTab />);

    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: EDIT_NAME }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Device label"), {
      target: { value: "  Fixed Label  " },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(updateSessionDeviceLabel).toHaveBeenCalledWith("with-device", "Fixed Label");
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(fetchSessions).toHaveBeenCalledTimes(2);
  });

  it("Edit opens with an empty input for a session with no device label yet", async () => {
    vi.mocked(fetchSessions).mockResolvedValue({
      sessions: [makeSession({ id: "no-device", userEmail: "plain@example.com", deviceLabel: null })],
    });

    renderWithToast(<ActiveSessionsTab />);

    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: EDIT_NAME }));
    const dialog = await screen.findByRole("dialog");
    const input = within(dialog).getByLabelText("Device label") as HTMLInputElement;
    expect(input.value).toBe("");
    expect(dialog.textContent).not.toContain("currently");
  });

  it("saving a cleared device label sends null, not an empty string", async () => {
    vi.mocked(fetchSessions).mockResolvedValue({
      sessions: [
        makeSession({ id: "with-device", userEmail: "device@example.com", deviceLabel: "Desk iPad" }),
      ],
    });
    vi.mocked(updateSessionDeviceLabel).mockResolvedValueOnce({ deviceLabel: null });

    renderWithToast(<ActiveSessionsTab />);

    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: EDIT_NAME }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Device label"), { target: { value: "   " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(updateSessionDeviceLabel).toHaveBeenCalledWith("with-device", null);
    });
  });

  it("Cancel closes the edit dialog without saving", async () => {
    vi.mocked(fetchSessions).mockResolvedValue({
      sessions: [
        makeSession({ id: "with-device", userEmail: "device@example.com", deviceLabel: "Desk iPad" }),
      ],
    });

    renderWithToast(<ActiveSessionsTab />);

    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: EDIT_NAME }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Device label"), {
      target: { value: "Ignored change" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(updateSessionDeviceLabel).not.toHaveBeenCalled();
  });

  it("blocks a backdrop-click close while a device-label save is in flight", async () => {
    vi.mocked(fetchSessions).mockResolvedValue({
      sessions: [
        makeSession({ id: "with-device", userEmail: "device@example.com", deviceLabel: "Desk iPad" }),
      ],
    });
    let resolveSave: ((value: { deviceLabel: string | null }) => void) | undefined;
    vi.mocked(updateSessionDeviceLabel).mockImplementationOnce(
      () => new Promise((resolve) => { resolveSave = resolve; }),
    );

    renderWithToast(<ActiveSessionsTab />);

    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: EDIT_NAME }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Device label"), {
      target: { value: "Desk iPad 2" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    // The Cancel button itself is disabled while saving, but the modal backdrop's click-outside
    // isn't gated the same way - onCancel's own `if (!editSaving)` guard is what actually stops
    // this from clearing editTarget mid-save (same pattern already covered for
    // CommunicationSendDialog's send-in-flight case).
    fireEvent.click(document.querySelector(".at-modal-backdrop")!);
    expect(screen.getByRole("dialog")).toBeTruthy();

    await act(async () => {
      resolveSave?.({ deviceLabel: "Desk iPad 2" });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it("shows the login time in UTC with the viewer's own local time below it when no signer timezone is stored", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(new Date("2026-01-01T13:00:00.000Z").getTime());
    try {
      vi.mocked(fetchSessions).mockResolvedValue({
        sessions: [makeSession({ ip: null, loginAt: "2026-01-01T12:00:00.000Z", lastSeenAt: "2026-01-01T12:30:00.000Z" })],
      });
      renderWithToast(<ActiveSessionsTab />);

      const table = await screen.findByRole("table");
      expect(within(table).getByRole("columnheader", { name: "IP address" })).toBeTruthy();
      expect(within(table).getByText("-")).toBeTruthy();
      expect(within(table).getByText("30 min ago")).toBeTruthy();
      expect(within(table).getByText("2026-01-01 12:00:00 UTC")).toBeTruthy();
      expect(within(table).getByTitle("Your local time")).toBeTruthy();

      const headerTrigger = within(table).getByText("Logged in").closest(".at-tooltip-trigger");
      expect(headerTrigger).toBeTruthy();
      fireEvent.mouseEnter(headerTrigger!);
      expect(await screen.findByRole("tooltip")).toHaveProperty(
        "textContent",
        "UTC on top. Below (user icon): the signer's local time at login. Missing for older sessions - then your browser timezone (desktop icon).",
      );
    } finally {
      now.mockRestore();
    }
  });

  it("shows the signer's stored timezone under Logged in when Session.timezone is set", async () => {
    vi.mocked(fetchSessions).mockResolvedValue({
      sessions: [
        makeSession({
          timezone: "Europe/Warsaw",
          loginAt: "2026-01-01T12:00:00.000Z",
        }),
      ],
    });
    renderWithToast(<ActiveSessionsTab />);

    const table = await screen.findByRole("table");
    expect(within(table).getByText(/Warsaw/)).toBeTruthy();
    expect(within(table).getByTitle("Signer's local time")).toBeTruthy();
  });
});

describe("ActiveSessionsTab responsive layout", () => {
  it("renders stacked cards instead of a table below the desktop breakpoint, with every field populated", async () => {
    mockMatchMedia(false);
    vi.mocked(fetchSessions).mockResolvedValue({
      sessions: [
        makeSession({
          userEmail: "mobile@example.com",
          userDisplayName: "Mobile User",
          role: "operator",
          deviceLabel: "Field Tablet",
          ip: null,
        }),
      ],
    });

    renderWithToast(<ActiveSessionsTab />);

    await screen.findByText("mobile@example.com");
    expect(screen.queryByRole("table")).toBeNull();
    const card = document.querySelector(".users-page__card") as HTMLElement;
    expect(card).toBeTruthy();
    // Exercises the branches only this (mobile) rendering path has: a display name present
    // (shows the email as a secondary line), a device label present (skips the user-agent
    // parse), and a missing IP (falls back to "-") - all already covered for the desktop table
    // by other tests here, but SessionCard is a separate component with its own copies.
    expect(within(card).getByText("Mobile User")).toBeTruthy();
    expect(within(card).getByText("Field Tablet")).toBeTruthy();
    expect(within(card).getByText("-")).toBeTruthy();
    expect(screen.getByRole("button", { name: REVOKE_NAME })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: EDIT_NAME }));
    const dialog = await screen.findByRole("dialog");
    const input = within(dialog).getByLabelText("Device label") as HTMLInputElement;
    expect(input.value).toBe("Field Tablet");
  });

  it("falls back to email, parsed user agent, and a dash when a mobile card's optional fields are empty", async () => {
    mockMatchMedia(false);
    vi.mocked(fetchSessions).mockResolvedValue({
      sessions: [
        makeSession({
          userEmail: "plain-mobile@example.com",
          userDisplayName: null,
          deviceLabel: null,
          userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
          ip: "203.0.113.5",
        }),
      ],
    });

    renderWithToast(<ActiveSessionsTab />);

    const card = (await screen.findByText("plain-mobile@example.com")).closest("article") as HTMLElement;
    // No display name -> no secondary email line under the name (it's already the name itself).
    expect(within(card).queryByText("plain-mobile@example.com", { selector: ".users-page__user-email" })).toBeNull();
    expect(within(card).getByText("Chrome / Linux")).toBeTruthy();
    expect(within(card).getByText("203.0.113.5")).toBeTruthy();
  });
});

describe("ActiveSessionsTab pagination", () => {
  it("paginates when there are more sessions than the page size, and Next/Previous work", async () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      makeSession({ id: `s${i}`, userEmail: `user${i}@example.com` }),
    );
    vi.mocked(fetchSessions).mockResolvedValue({ sessions: many });

    renderWithToast(<ActiveSessionsTab />);

    await screen.findByRole("table");
    expect(screen.getByText("Showing 1–25 of 30")).toBeTruthy();
    expect(screen.getByText("Page 1 of 2")).toBeTruthy();
    expect(screen.getByText("user0@example.com")).toBeTruthy();
    expect(screen.queryByText("user25@example.com")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByText("Showing 26–30 of 30")).toBeTruthy();
    expect(screen.getByText("Page 2 of 2")).toBeTruthy();
    expect(screen.getByText("user25@example.com")).toBeTruthy();
    expect(screen.queryByText("user0@example.com")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(screen.getByText("user0@example.com")).toBeTruthy();
  });

  it("still shows the pager (Previous/Page 1 of 1/Next, all inert) when everything fits on one page", async () => {
    // Matches the Logs table's own footer, which never hides the pager row either.
    vi.mocked(fetchSessions).mockResolvedValue({ sessions: [makeSession()] });

    renderWithToast(<ActiveSessionsTab />);

    await screen.findByRole("table");
    expect(screen.getByText("Showing 1–1 of 1")).toBeTruthy();
    expect(screen.getByText("Page 1 of 1")).toBeTruthy();
    const previousButton = screen.getByRole("button", { name: "Previous" }) as HTMLButtonElement;
    const nextButton = screen.getByRole("button", { name: "Next" }) as HTMLButtonElement;
    expect(previousButton.disabled).toBe(true);
    expect(nextButton.disabled).toBe(true);
  });
});

describe("ActiveSessionsTab delayed loading", () => {
  it("shows the loading placeholder once the fetch has genuinely taken a moment", () => {
    vi.mocked(fetchSessions).mockImplementationOnce(() => new Promise(() => {}));
    vi.mocked(fetchAdminEvents).mockResolvedValueOnce([]);
    vi.useFakeTimers();
    renderWithToast(<ActiveSessionsTab />);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByText("Loading…")).toBeTruthy();
  });
});

describe("ActiveSessionsTab operator errors", () => {
  it("shows session-expired copy when load fails with authentication_required", async () => {
    vi.mocked(fetchSessions).mockRejectedValueOnce(new ApiError(401, "authentication_required"));
    vi.mocked(fetchAdminEvents).mockResolvedValueOnce([]);
    renderWithToast(<ActiveSessionsTab />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    });
    const panel = document.querySelector(".sessions-status p");
    expect(panel?.textContent).toMatch(/session has expired/i);
    expect(screen.queryByText("authentication_required")).toBeNull();
  });

  it("toasts operator-safe message when revoke fails", async () => {
    vi.mocked(fetchSessions).mockResolvedValueOnce({ sessions: [makeSession()] });
    vi.mocked(fetchAdminEvents).mockResolvedValueOnce([]);
    vi.mocked(revokeSessionById).mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderWithToast(<ActiveSessionsTab />);
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: REVOKE_NAME }).length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByRole("button", { name: REVOKE_NAME })[0]!);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Failed to revoke session/);
    });
    expect(screen.queryByText("secret_internal")).toBeNull();
  });

  it("shows an operator-safe message inline in the modal when device label edit fails", async () => {
    vi.mocked(fetchSessions).mockResolvedValueOnce({ sessions: [makeSession()] });
    vi.mocked(fetchAdminEvents).mockResolvedValueOnce([]);
    vi.mocked(updateSessionDeviceLabel).mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderWithToast(<ActiveSessionsTab />);
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: EDIT_NAME }).length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByRole("button", { name: EDIT_NAME })[0]!);
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Device label"), {
      target: { value: "New Label" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(within(dialog).getByRole("alert").textContent).toMatch(/Failed to update device label/);
    });
    expect(screen.queryByText("secret_internal")).toBeNull();
    // Stays open on failure, same as UserEditModal - the operator can retry or cancel.
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("toasts operator-safe message when bulk revoke fails", async () => {
    vi.mocked(fetchSessions).mockResolvedValueOnce({ sessions: [] });
    vi.mocked(fetchAdminEvents).mockResolvedValueOnce([sampleEvent]);
    vi.mocked(revokeAllOperatorSessions).mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderWithToast(<ActiveSessionsTab />);
    fireEvent.click(await screen.findByRole("button", { name: /^Event,/ }));
    fireEvent.click(screen.getByRole("button", { name: "Summit" }));
    fireEvent.click(screen.getByRole("button", { name: "Revoke all" }));
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Failed to revoke sessions/);
    });
  });
});

describe("ActiveSessionsTab revoke success", () => {
  it("closes the dialog, toasts, and reloads after a successful revoke; blocks backdrop-close while in flight", async () => {
    let resolveRevoke: (() => void) | undefined;
    vi.mocked(fetchSessions).mockResolvedValue({ sessions: [makeSession()] });
    vi.mocked(revokeSessionById).mockImplementationOnce(
      () => new Promise((resolve) => { resolveRevoke = resolve; }),
    );

    renderWithToast(<ActiveSessionsTab />);

    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: REVOKE_NAME }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));

    // The backdrop's onClose is wired to onCancel regardless of loading state - only the
    // handler's own `if (!revoking)` guard stops it from clearing confirmTarget mid-request
    // (same pattern already covered for DeviceLabelEditModal's save-in-flight case).
    fireEvent.click(document.querySelector(".at-modal-backdrop")!);
    expect(screen.getByRole("dialog")).toBeTruthy();

    await act(async () => {
      resolveRevoke?.();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(screen.getByTestId("at-toast").textContent).toMatch(/Session revoked/);
    expect(fetchSessions).toHaveBeenCalledTimes(2);
  });

  it("blocks backdrop-close while a bulk revoke is in flight, then closes and toasts with plural wording on success", async () => {
    let resolveBulk: ((value: { revokedCount: number }) => void) | undefined;
    vi.mocked(fetchSessions).mockResolvedValue({ sessions: [] });
    vi.mocked(fetchAdminEvents).mockResolvedValue([sampleEvent]);
    vi.mocked(revokeAllOperatorSessions).mockImplementationOnce(
      () => new Promise((resolve) => { resolveBulk = resolve; }),
    );

    renderWithToast(<ActiveSessionsTab />);

    fireEvent.click(await screen.findByRole("button", { name: /^Event,/ }));
    fireEvent.click(screen.getByRole("button", { name: "Summit" }));
    fireEvent.click(screen.getByRole("button", { name: "Revoke all" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));

    fireEvent.click(document.querySelector(".at-modal-backdrop")!);
    expect(screen.getByRole("dialog")).toBeTruthy();

    await act(async () => {
      resolveBulk?.({ revokedCount: 3 });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(screen.getByTestId("at-toast").textContent).toMatch(/Revoked 3 operator sessions\./);
  });

  it("uses singular wording when exactly one operator session is revoked", async () => {
    vi.mocked(fetchSessions).mockResolvedValue({ sessions: [] });
    vi.mocked(fetchAdminEvents).mockResolvedValue([sampleEvent]);
    vi.mocked(revokeAllOperatorSessions).mockResolvedValueOnce({ revokedCount: 1 });

    renderWithToast(<ActiveSessionsTab />);

    fireEvent.click(await screen.findByRole("button", { name: /^Event,/ }));
    fireEvent.click(screen.getByRole("button", { name: "Summit" }));
    fireEvent.click(screen.getByRole("button", { name: "Revoke all" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));

    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Revoked 1 operator session\./);
    });
  });

  it("Cancel closes the bulk-revoke dialog without revoking anything", async () => {
    vi.mocked(fetchSessions).mockResolvedValue({ sessions: [] });
    vi.mocked(fetchAdminEvents).mockResolvedValue([sampleEvent]);

    renderWithToast(<ActiveSessionsTab />);

    fireEvent.click(await screen.findByRole("button", { name: /^Event,/ }));
    fireEvent.click(screen.getByRole("button", { name: "Summit" }));
    fireEvent.click(screen.getByRole("button", { name: "Revoke all" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(revokeAllOperatorSessions).not.toHaveBeenCalled();
  });

  it("marks an archived event in the event picker", async () => {
    vi.mocked(fetchSessions).mockResolvedValue({ sessions: [] });
    vi.mocked(fetchAdminEvents).mockResolvedValue([
      { ...sampleEvent, id: "evt-arch", title: "Old Summit", archived_at: "2025-01-01T00:00:00.000Z" },
    ]);

    renderWithToast(<ActiveSessionsTab />);

    fireEvent.click(await screen.findByRole("button", { name: /^Event,/ }));
    expect(await screen.findByRole("button", { name: "Old Summit (archived)" })).toBeTruthy();
  });

  it("filters by sign-in method via the Filters panel", async () => {
    vi.mocked(fetchSessions).mockResolvedValue({
      sessions: [
        makeSession({ id: "s-local", userEmail: "local@example.com", authMethod: "local" }),
        makeSession({ id: "s-sso", userEmail: "sso@example.com", authMethod: "oidc" }),
      ],
    });

    renderWithToast(<ActiveSessionsTab />);

    await screen.findByText("local@example.com");
    expect(screen.getByText("sso@example.com")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Sign-in method,/ }));
    fireEvent.click(screen.getByRole("button", { name: "Identity provider" }));

    expect(screen.queryByText("local@example.com")).toBeNull();
    expect(screen.getByText("sso@example.com")).toBeTruthy();
  });
});
