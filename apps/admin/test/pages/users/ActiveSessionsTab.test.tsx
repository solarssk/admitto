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
    expect(within(screen.getByText("local@example.com").closest("tr")!).getByText("Local")).toBeTruthy();
    expect(within(screen.getByText("sso@example.com").closest("tr")!).getByText("SSO")).toBeTruthy();
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

  it("shows the login time in UTC with the viewer's own local time below it, and an explanatory tooltip on the column header", async () => {
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

      const headerTrigger = within(table).getByText("Logged in").closest(".at-tooltip-trigger");
      expect(headerTrigger).toBeTruthy();
      fireEvent.mouseEnter(headerTrigger!);
      expect(await screen.findByRole("tooltip")).toHaveProperty(
        "textContent",
        "Top: when this session started, in UTC. Below: the same moment in your own local time.",
      );
    } finally {
      now.mockRestore();
    }
  });
});

describe("ActiveSessionsTab responsive layout", () => {
  it("renders stacked cards instead of a table below the desktop breakpoint", async () => {
    mockMatchMedia(false);
    vi.mocked(fetchSessions).mockResolvedValue({
      sessions: [makeSession({ userEmail: "mobile@example.com", role: "operator" })],
    });

    renderWithToast(<ActiveSessionsTab />);

    await screen.findByText("mobile@example.com");
    expect(screen.queryByRole("table")).toBeNull();
    expect(document.querySelector(".users-page__card")).toBeTruthy();
    expect(screen.getByRole("button", { name: EDIT_NAME })).toBeTruthy();
    expect(screen.getByRole("button", { name: REVOKE_NAME })).toBeTruthy();
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
    await waitFor(() => {
      expect(screen.getByRole("combobox")).toBeTruthy();
    });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "evt-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Revoke all operator sessions" }));
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Failed to revoke sessions/);
    });
  });
});
