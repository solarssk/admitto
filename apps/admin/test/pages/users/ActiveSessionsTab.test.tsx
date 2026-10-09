// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../../src/api/client.js";
import { ActiveSessionsTab } from "../../../src/pages/users/ActiveSessionsTab.js";
import type { EventDto, SessionListDto } from "../../../src/api/types.js";
import { advanceTimers, deferred, mockMatchMedia, renderWithToast } from "../../test-utils.js";

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
    // The shared error placeholder: the title says what failed, the description why, and the glyph an error has everywhere is over them.
    expect(document.querySelector("[role='alert'] .at-empty-state__title")?.textContent).toBe("Could not load sessions");
    expect(document.querySelector("[role='alert'] .at-empty-state__desc")?.textContent).toMatch(/Could not load sessions/);
    expect(document.querySelector("[role='alert'] .at-empty-state__icon i.ti-circle-x")).not.toBeNull();
    expect(screen.queryByText("secret_internal")).toBeNull();
    // The alert in the card is the message: it is not said a second time as a toast.
    expect(screen.queryByTestId("at-toast")).toBeNull();

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

  it("keeps Save where it is, busy and with its own label, while a device-label save is in flight, and saves once", async () => {
    vi.mocked(fetchSessions).mockResolvedValue({
      sessions: [makeSession({ id: "with-device", userEmail: "device@example.com", deviceLabel: "Desk iPad" })],
    });
    vi.mocked(updateSessionDeviceLabel).mockImplementationOnce(() => new Promise(() => {}));
    renderWithToast(<ActiveSessionsTab />);

    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: EDIT_NAME }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Device label"), { target: { value: "Desk iPad 2" } });
    const save = within(dialog).getByRole("button", { name: "Save" });
    save.focus();
    fireEvent.click(save);

    await waitFor(() => expect(save.getAttribute("aria-busy")).toBe("true"));
    // `aria-disabled`, not `disabled`, so the keyboard keeps its place; the label does not change.
    expect(save.getAttribute("aria-disabled")).toBe("true");
    expect(save).toHaveProperty("disabled", false);
    expect(document.activeElement).toBe(save);
    fireEvent.click(save);
    expect(updateSessionDeviceLabel).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveProperty("disabled", true);
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
    // The cell of the login time and its local time under it is the wide one (users-page.css), which the card's other cells are not.
    expect(within(card).getByText("Logged in").closest("div")?.className).toBe("users-page__card-meta-wide");
    expect(within(card).getByText("Device").closest("div")?.className).toBe("");
    expect(within(card).getByText("-")).toBeTruthy();
    expect(screen.getByRole("button", { name: REVOKE_NAME })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: EDIT_NAME }));
    const dialog = await screen.findByRole("dialog");
    const input = within(dialog).getByLabelText("Device label") as HTMLInputElement;
    expect(input.value).toBe("Field Tablet");
  });

  it("drops only the Sign-in column on a laptop, keeping Device and IP address, which are what a reviewer of sessions looks at", async () => {
    vi.mocked(fetchSessions).mockResolvedValue({ sessions: [makeSession({ userEmail: "laptop@example.com" })] });

    renderWithToast(<ActiveSessionsTab />);

    await screen.findByText("laptop@example.com");
    const table = screen.getByRole("table");
    const headers = [...table.querySelectorAll("thead th")];
    expect(headers.filter((th) => th.classList.contains("sessions-col-laptop-hide")).map((th) => th.textContent)).toEqual(["Sign-in"]);
    // Its cells carry the class too, so the whole column goes and a row never has a cell more than a heading.
    const cells = [...table.querySelectorAll("tbody tr:first-child td")];
    expect(cells).toHaveLength(headers.length);
    expect(cells.map((td) => td.classList.contains("sessions-col-laptop-hide"))).toEqual(headers.map((th) => th.classList.contains("sessions-col-laptop-hide")));
    // On a tablet the three supplementary columns still drop together, as before.
    expect(headers.filter((th) => th.classList.contains("sessions-col-tablet-hide")).map((th) => th.textContent)).toEqual(["Device", "IP address", "Sign-in"]);
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
    const previousButton = screen.getByRole("button", { name: "Previous" });
    const nextButton = screen.getByRole("button", { name: "Next" });
    expect(previousButton.getAttribute("aria-disabled")).toBe("true");
    expect(nextButton.getAttribute("aria-disabled")).toBe("true");
  });
});

describe("ActiveSessionsTab on the loading standard", () => {
  const region = () => screen.queryByLabelText("Loading sessions");

  it("holds the placeholder's room from the first frame, draws it after 200ms, keeps it for 400ms, and says so after 8 seconds", async () => {
    const first = deferred<{ sessions: SessionListDto[] }>();
    vi.mocked(fetchSessions).mockReturnValue(first.promise);
    vi.useFakeTimers();
    renderWithToast(<ActiveSessionsTab />);
    await advanceTimers(0);

    expect(region()?.className).toContain("at-loading-hold");
    await advanceTimers(199);
    expect(region()?.className).toContain("at-loading-hold");
    await advanceTimers(1);
    expect(region()?.className).not.toContain("at-loading-hold");
    expect(screen.queryByText("Loading…")).toBeNull();

    await advanceTimers(7800);
    expect(region()?.textContent).toContain("Taking longer than usual");
    await act(async () => first.resolve({ sessions: [makeSession()] }));
    await advanceTimers(400);
    expect(region()).toBeNull();
    expect(screen.getByRole("table")).toBeTruthy();
  });

  it("draws the placeholder's Sign-in column with the classes of the real one, so it has the columns the table will have at every width", async () => {
    vi.mocked(fetchSessions).mockReturnValue(deferred<{ sessions: SessionListDto[] }>().promise);
    vi.useFakeTimers();
    renderWithToast(<ActiveSessionsTab />);
    await advanceTimers(200);

    const headers = [...(region() as HTMLElement).querySelectorAll("th")];
    expect(headers.find((th) => th.textContent === "Sign-in")?.className).toBe("sessions-col-tablet-hide sessions-col-laptop-hide");
    expect(headers.filter((th) => th.classList.contains("sessions-col-laptop-hide"))).toHaveLength(1);
  });

  const TIMED_OUT = "The server did not answer in time. Check your connection and try again.";

  /** A fetcher that never answers, and gives up (rejects) when its signal aborts: what the 30 second limit does. */
  function hangingSessions() {
    const signals: AbortSignal[] = [];
    vi.mocked(fetchSessions).mockImplementation(
      (_role, signal) =>
        new Promise((_resolve, reject) => {
          if (signal) signals.push(signal);
          signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
        }),
    );
    return signals;
  }

  it("gives up after 30 seconds with an error and Retry", async () => {
    const signals = hangingSessions();
    vi.useFakeTimers();
    renderWithToast(<ActiveSessionsTab />);
    await advanceTimers(30_000);
    await advanceTimers(0);
    expect(screen.getByText(TIMED_OUT)).toBeTruthy();
    expect(signals[0]?.aborted).toBe(true);
    // The error that replaces the placeholder fades in.
    expect(screen.getByRole("button", { name: "Retry" }).closest(".at-fade-in")).not.toBeNull();
  });

  it("keeps the error on screen, with a busy Retry that keeps the focus, while a Retry runs: no placeholder takes its place, and a repeat failure is announced again", async () => {
    const signals = hangingSessions();
    vi.useFakeTimers();
    renderWithToast(<ActiveSessionsTab />);
    await advanceTimers(30_000);
    await advanceTimers(0);
    const message = screen.getByText(TIMED_OUT);
    const retry = screen.getByRole("button", { name: "Retry" });
    expect(retry.getAttribute("aria-busy")).toBeNull();

    retry.focus();
    fireEvent.click(retry);
    await advanceTimers(0);
    expect(region()).toBeNull();
    expect(screen.getByRole("button", { name: "Retry" })).toBe(retry);
    expect(retry.getAttribute("aria-busy")).toBe("true");
    expect(document.activeElement).toBe(retry);
    expect(screen.getByText(TIMED_OUT)).toBe(message);
    expect(signals).toHaveLength(2);

    await advanceTimers(30_000);
    await advanceTimers(0);
    expect(signals[1]?.aborted).toBe(true);
    expect(screen.getByText(TIMED_OUT)).not.toBe(message);
    expect(screen.getByRole("button", { name: "Retry" })).toBe(retry);
    expect(retry.getAttribute("aria-busy")).toBeNull();
    expect(document.activeElement).toBe(retry);
  });

  it("hands the focus to the card that holds the list when the retry works", async () => {
    vi.mocked(fetchSessions).mockRejectedValueOnce(new Error("network down"));
    renderWithToast(<ActiveSessionsTab />);
    expect(await screen.findByText("Could not load sessions.")).toBeTruthy();
    const retry = screen.getByRole("button", { name: "Retry" });
    const card = retry.closest(".at-card");
    expect(card).not.toBeNull();

    const second = deferred<{ sessions: SessionListDto[] }>();
    vi.mocked(fetchSessions).mockReturnValueOnce(second.promise);
    retry.focus();
    fireEvent.click(retry);
    expect(retry.getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByText("No active sessions")).toBeNull();

    await act(async () => second.resolve({ sessions: [makeSession()] }));
    await screen.findByRole("table");
    expect(screen.queryByText("Could not load sessions.")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(card));
  });

  it("keeps the rows while the refresh after a revoke is on its way: blocked, dimmed with a bar once it is noticeable, and no placeholder", async () => {
    const refresh = deferred<{ sessions: SessionListDto[] }>();
    vi.mocked(fetchSessions)
      .mockResolvedValueOnce({ sessions: [makeSession({ id: "s1" }), makeSession({ id: "s2", userEmail: "second@example.com" })] })
      .mockReturnValueOnce(refresh.promise);
    vi.mocked(revokeSessionById).mockResolvedValue(undefined);
    renderWithToast(<ActiveSessionsTab />);
    await screen.findByRole("table");

    fireEvent.click(screen.getAllByRole("button", { name: REVOKE_NAME })[0]!);
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(fetchSessions).toHaveBeenCalledTimes(2));

    // The rows stay, blocked at once; a click on one of them does nothing.
    expect(screen.getByRole("table")).toBeTruthy();
    expect(region()).toBeNull();
    await waitFor(() => expect(document.querySelectorAll(".refetch-card--busy")).toHaveLength(1));
    fireEvent.click(screen.getAllByRole("button", { name: EDIT_NAME })[0]!);
    expect(screen.queryByRole("dialog")).toBeNull();
    // Once the wait is noticeable: dimmed, with the bar.
    await waitFor(() => expect(document.querySelector(".refetch-card--dim")).not.toBeNull());
    expect(await screen.findByLabelText("Refreshing sessions")).toBeTruthy();

    await act(async () => refresh.resolve({ sessions: [makeSession({ id: "s2", userEmail: "second@example.com" })] }));
    await waitFor(() => expect(screen.queryByText("user@example.com")).toBeNull());
    await waitFor(() => expect(document.querySelectorAll(".refetch-card")).toHaveLength(0));
  });

  it("shows the revoke when the refresh after it fails: the session is gone, the others stay, and a warning with a Retry says the list may be older", async () => {
    const onCountChange = vi.fn();
    vi.mocked(fetchSessions)
      .mockResolvedValueOnce({ sessions: [makeSession({ id: "s1", userEmail: "one@example.com" }), makeSession({ id: "s2", userEmail: "two@example.com" })] })
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({ sessions: [makeSession({ id: "s2", userEmail: "two@example.com" })] });
    vi.mocked(revokeSessionById).mockResolvedValue(undefined);
    renderWithToast(<ActiveSessionsTab onCountChange={onCountChange} />);
    await screen.findByRole("table");

    fireEvent.click(screen.getAllByRole("button", { name: REVOKE_NAME })[0]!);
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Revoke" }));

    expect(await screen.findByText(/Could not refresh this list, so it may show older details/)).toBeTruthy();
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.queryByText("one@example.com")).toBeNull();
    expect(screen.getAllByText("two@example.com").length).toBeGreaterThan(0);
    expect(screen.queryByText("Could not load sessions.")).toBeNull();
    expect(onCountChange).toHaveBeenLastCalledWith(1);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.queryByText(/Could not refresh this list/)).toBeNull());
  });

  it("replaces the rows with the error, instead of leaving possibly revoked sessions under the success toast, when the refresh after a bulk revoke fails", async () => {
    vi.mocked(fetchSessions)
      .mockResolvedValueOnce({ sessions: [makeSession({ id: "s1", userEmail: "one@example.com" })] })
      .mockRejectedValueOnce(new Error("network down"));
    vi.mocked(fetchAdminEvents).mockResolvedValue([sampleEvent]);
    vi.mocked(revokeAllOperatorSessions).mockResolvedValue({ revokedCount: 1 });
    const onCountChange = vi.fn();
    renderWithToast(<ActiveSessionsTab onCountChange={onCountChange} />);
    await screen.findByRole("table");
    expect(onCountChange).toHaveBeenLastCalledWith(1);

    fireEvent.click(await screen.findByRole("button", { name: /^Event,/ }));
    fireEvent.click(screen.getByRole("button", { name: "Summit" }));
    fireEvent.click(screen.getByRole("button", { name: "Revoke all" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Revoke" }));

    expect(await screen.findByText("Could not load sessions.")).toBeTruthy();
    // The tab label does not keep vouching for a number that the revoke has made untrue.
    expect(onCountChange).toHaveBeenLastCalledWith(undefined);
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByText("one@example.com")).toBeNull();
    expect(screen.queryByText(/may show older details/)).toBeNull();
  });

  it("does not bring the possibly revoked rows back while the Retry of that error runs: the error stays, busy, until the answer is in", async () => {
    vi.mocked(fetchSessions)
      .mockResolvedValueOnce({ sessions: [makeSession({ id: "s1", userEmail: "one@example.com" })] })
      .mockRejectedValueOnce(new Error("network down"));
    vi.mocked(fetchAdminEvents).mockResolvedValue([sampleEvent]);
    vi.mocked(revokeAllOperatorSessions).mockResolvedValue({ revokedCount: 1 });
    const onCountChange = vi.fn();
    renderWithToast(<ActiveSessionsTab onCountChange={onCountChange} />);
    await screen.findByRole("table");

    fireEvent.click(await screen.findByRole("button", { name: /^Event,/ }));
    fireEvent.click(screen.getByRole("button", { name: "Summit" }));
    fireEvent.click(screen.getByRole("button", { name: "Revoke all" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Revoke" }));
    expect(await screen.findByText("Could not load sessions.")).toBeTruthy();

    const second = deferred<{ sessions: SessionListDto[] }>();
    vi.mocked(fetchSessions).mockReturnValueOnce(second.promise);
    const retry = screen.getByRole("button", { name: "Retry" });
    retry.focus();
    fireEvent.click(retry);

    // The rows on screen before the revoke are older than the server's: they stay away, and so does the empty state.
    expect(retry.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("button", { name: "Retry" })).toBe(retry);
    expect(document.activeElement).toBe(retry);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByText("one@example.com")).toBeNull();
    expect(screen.queryByText("No active sessions")).toBeNull();
    // And the tab label keeps showing no number.
    expect(onCountChange).toHaveBeenLastCalledWith(undefined);

    await act(async () => second.resolve({ sessions: [makeSession({ id: "s2", userEmail: "two@example.com" })] }));
    await screen.findByRole("table");
    expect(screen.getAllByText("two@example.com").length).toBeGreaterThan(0);
    expect(onCountChange).toHaveBeenLastCalledWith(1);
  });

  it("keeps the rows with a warning when a bulk revoke that revoked nothing is followed by a refresh that fails", async () => {
    vi.mocked(fetchSessions)
      .mockResolvedValueOnce({ sessions: [makeSession({ id: "s1", userEmail: "one@example.com" })] })
      .mockRejectedValueOnce(new Error("network down"));
    vi.mocked(fetchAdminEvents).mockResolvedValue([sampleEvent]);
    vi.mocked(revokeAllOperatorSessions).mockResolvedValue({ revokedCount: 0 });
    renderWithToast(<ActiveSessionsTab />);
    await screen.findByRole("table");

    fireEvent.click(await screen.findByRole("button", { name: /^Event,/ }));
    fireEvent.click(screen.getByRole("button", { name: "Summit" }));
    fireEvent.click(screen.getByRole("button", { name: "Revoke all" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Revoke" }));

    expect(await screen.findByText(/Could not refresh this list, so it may show older details/)).toBeTruthy();
    expect(screen.getAllByText("one@example.com").length).toBeGreaterThan(0);
  });

  it("marks the pager as busy while the refresh after a revoke is on its way", async () => {
    const refresh = deferred<{ sessions: SessionListDto[] }>();
    const many = Array.from({ length: 30 }, (_, i) => makeSession({ id: `s${i}`, userEmail: `user${i}@example.com` }));
    vi.mocked(fetchSessions).mockResolvedValueOnce({ sessions: many }).mockReturnValueOnce(refresh.promise);
    vi.mocked(revokeSessionById).mockResolvedValue(undefined);
    renderWithToast(<ActiveSessionsTab />);
    await screen.findByRole("table");
    const next = screen.getByRole("button", { name: "Next" });
    expect(next.getAttribute("aria-disabled")).not.toBe("true");

    fireEvent.click(screen.getAllByRole("button", { name: REVOKE_NAME })[0]!);
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(fetchSessions).toHaveBeenCalledTimes(2));
    expect(next.getAttribute("aria-disabled")).toBe("true");
    await act(async () => refresh.resolve({ sessions: many.slice(1) }));
  });

  it("shows a saved device label when the refresh after it fails", async () => {
    vi.mocked(fetchSessions)
      .mockResolvedValueOnce({ sessions: [makeSession({ id: "s1", deviceLabel: "Old tablet" })] })
      .mockRejectedValueOnce(new Error("network down"));
    vi.mocked(updateSessionDeviceLabel).mockResolvedValue({ deviceLabel: "Door tablet (as saved)" });
    renderWithToast(<ActiveSessionsTab />);
    await screen.findByRole("table");
    expect(screen.getAllByText("Old tablet").length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByRole("button", { name: EDIT_NAME })[0]!);
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "door tablet" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await screen.findByText(/Could not refresh this list, so it may show older details/)).toBeTruthy();
    // The label the server saved, not the one that was typed.
    expect(screen.getAllByText("Door tablet (as saved)").length).toBeGreaterThan(0);
    expect(screen.queryByText("Old tablet")).toBeNull();
  });

  it("ends the bulk revoke dialog's busy state with the revoke, not with the refresh behind it", async () => {
    const refresh = deferred<{ sessions: SessionListDto[] }>();
    vi.mocked(fetchSessions)
      .mockResolvedValueOnce({ sessions: [makeSession({ id: "s1" })] })
      .mockReturnValueOnce(refresh.promise);
    vi.mocked(fetchAdminEvents).mockResolvedValue([sampleEvent]);
    vi.mocked(revokeAllOperatorSessions).mockResolvedValue({ revokedCount: 1 });
    renderWithToast(<ActiveSessionsTab />);
    await screen.findByRole("table");

    fireEvent.click(await screen.findByRole("button", { name: /^Event,/ }));
    fireEvent.click(screen.getByRole("button", { name: "Summit" }));
    fireEvent.click(screen.getByRole("button", { name: "Revoke all" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(fetchSessions).toHaveBeenCalledTimes(2));

    // The refresh is still pending, and the list is blocked. Revoke all lies outside the list, and its dialog is
    // not busy: the flag ended with the revoke.
    expect(document.querySelectorAll(".refetch-card--busy")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Revoke all" }));
    const confirm = within(await screen.findByRole("dialog")).getByRole("button", { name: "Revoke" });
    expect(confirm.getAttribute("aria-busy")).toBeNull();
    await act(async () => refresh.resolve({ sessions: [] }));
  });

  it("blocks, dims and marks as refreshing an empty list too while the refresh after a bulk revoke is on its way", async () => {
    const refresh = deferred<{ sessions: SessionListDto[] }>();
    vi.mocked(fetchSessions).mockResolvedValueOnce({ sessions: [] }).mockReturnValueOnce(refresh.promise);
    vi.mocked(fetchAdminEvents).mockResolvedValue([sampleEvent]);
    vi.mocked(revokeAllOperatorSessions).mockResolvedValue({ revokedCount: 0 });
    renderWithToast(<ActiveSessionsTab />);
    await screen.findByText("No active sessions");

    fireEvent.click(await screen.findByRole("button", { name: /^Event,/ }));
    fireEvent.click(screen.getByRole("button", { name: "Summit" }));
    fireEvent.click(screen.getByRole("button", { name: "Revoke all" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(fetchSessions).toHaveBeenCalledTimes(2));

    await waitFor(() => expect(document.querySelectorAll(".refetch-card--busy")).toHaveLength(1));
    await waitFor(() => expect(document.querySelector(".refetch-card--dim")).not.toBeNull());
    expect(await screen.findByLabelText("Refreshing sessions")).toBeTruthy();

    await act(async () => refresh.resolve({ sessions: [makeSession({ id: "s1" })] }));
    expect(await screen.findByRole("table")).toBeTruthy();
    await waitFor(() => expect(document.querySelectorAll(".refetch-card")).toHaveLength(0));
  });

  it("swallows Clear filters in the no-match state while a refresh is on its way", async () => {
    const refresh = deferred<{ sessions: SessionListDto[] }>();
    vi.mocked(fetchSessions)
      .mockResolvedValueOnce({ sessions: [makeSession({ id: "s1" })] })
      .mockReturnValueOnce(refresh.promise);
    vi.mocked(fetchAdminEvents).mockResolvedValue([sampleEvent]);
    vi.mocked(revokeAllOperatorSessions).mockResolvedValue({ revokedCount: 0 });
    renderWithToast(<ActiveSessionsTab />);
    await screen.findByRole("table");

    fireEvent.change(screen.getByLabelText("Search sessions by user name or email"), { target: { value: "nobody" } });
    expect(await screen.findByText("No sessions match this filter")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: /^Event,/ }));
    fireEvent.click(screen.getByRole("button", { name: "Summit" }));
    fireEvent.click(screen.getByRole("button", { name: "Revoke all" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(document.querySelectorAll(".refetch-card--busy")).toHaveLength(1));

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect((screen.getByLabelText("Search sessions by user name or email") as HTMLInputElement).value).toBe("nobody");

    await act(async () => refresh.resolve({ sessions: [makeSession({ id: "s1" })] }));
    await waitFor(() => expect(document.querySelectorAll(".refetch-card")).toHaveLength(0));
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect((screen.getByLabelText("Search sessions by user name or email") as HTMLInputElement).value).toBe("");
  });

  it("says when the events for the bulk revoke could not load, with a Retry that reruns only that request", async () => {
    vi.mocked(fetchSessions).mockResolvedValue({ sessions: [] });
    vi.mocked(fetchAdminEvents).mockRejectedValueOnce(new Error("network down")).mockResolvedValueOnce([sampleEvent]);
    renderWithToast(<ActiveSessionsTab />);
    expect(await screen.findByText("Could not load events.")).toBeTruthy();
    const sessionCalls = vi.mocked(fetchSessions).mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.queryByText("Could not load events.")).toBeNull());
    expect(fetchAdminEvents).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetchSessions).mock.calls).toHaveLength(sessionCalls);
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
    const panel = document.querySelector("[role='alert'] .at-empty-state__desc");
    expect(panel?.textContent).toMatch(/session has expired/i);
    expect(screen.queryByText("authentication_required")).toBeNull();
  });

  it("shows an operator-safe message inline in the dialog when revoke fails, and keeps it open", async () => {
    // Not a toast: ConfirmDialog sits above the toast stack (--z-modal > --z-toast), so a
    // toast-only failure would render invisibly behind the still-open dialog's own backdrop (bot
    // review finding) - same reasoning and pattern as the device-label-edit failure below.
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
      expect(within(dialog).getByRole("alert").textContent).toMatch(/Failed to revoke session/);
    });
    expect(screen.queryByText("secret_internal")).toBeNull();
    expect(screen.queryByTestId("at-toast")).toBeNull();
    expect(screen.getByRole("dialog")).toBeTruthy();
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

  it("shows an operator-safe message inline in the dialog when bulk revoke fails, and keeps it open", async () => {
    vi.mocked(fetchSessions).mockResolvedValueOnce({ sessions: [] });
    vi.mocked(fetchAdminEvents).mockResolvedValueOnce([sampleEvent]);
    vi.mocked(revokeAllOperatorSessions).mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderWithToast(<ActiveSessionsTab />);
    fireEvent.click(await screen.findByRole("button", { name: /^Event,/ }));
    fireEvent.click(screen.getByRole("button", { name: "Summit" }));
    fireEvent.click(screen.getByRole("button", { name: "Revoke all" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    await waitFor(() => {
      expect(within(dialog).getByRole("alert").textContent).toMatch(/Failed to revoke sessions/);
    });
    expect(screen.queryByTestId("at-toast")).toBeNull();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("ignores Escape/backdrop cancellation while a revoke request is still in flight", async () => {
    vi.mocked(fetchSessions).mockResolvedValueOnce({ sessions: [makeSession()] });
    vi.mocked(fetchAdminEvents).mockResolvedValueOnce([]);
    let resolveRevoke: (() => void) | undefined;
    vi.mocked(revokeSessionById).mockImplementationOnce(
      () => new Promise((resolve) => { resolveRevoke = () => resolve(undefined); }),
    );
    renderWithToast(<ActiveSessionsTab />);
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: REVOKE_NAME }).length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByRole("button", { name: REVOKE_NAME })[0]!);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeTruthy();

    resolveRevoke?.();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
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
