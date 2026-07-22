// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { resetSystemStatusCache, SystemStatus } from "../../src/components/SystemStatus.js";
import { UserMenu } from "../../src/components/UserMenu.js";
import type { AuthUser, RoleAssignment } from "../../src/api/types.js";
import { connectionStateValue } from "../checkin/connectionStateMock.js";

const fetchSetupChecks = vi.fn();
vi.mock("../../src/api/client.js", () => ({
  fetchSetupChecks: (...args: unknown[]) => fetchSetupChecks(...args),
}));

const useConnectionState = vi.fn();
vi.mock("../../src/connection/ConnectionStateProvider.js", () => ({
  useConnectionState: () => useConnectionState(),
}));

const SUPERADMIN: RoleAssignment[] = [{ role: "superadmin", scope_type: "instance", scope_id: null }];
const OPERATOR: RoleAssignment[] = [{ role: "operator", scope_type: "event", scope_id: "evt-1" }];

const OK_CHECKS = {
  database: { ok: true, detail: "PostgreSQL connected · migrations current" },
  redis: { ok: true, detail: "Redis OK (2 ms)" },
  encryption: { ok: true, detail: "ENCRYPTION_KEY configured (32 bytes)" },
  base_url: { ok: true, detail: "https://tickets.example.com" },
};

function renderStatus(
  assignments: RoleAssignment[],
  mailerStatus: { configured: boolean; provider: string | null } | null = { configured: true, provider: "smtp" },
) {
  return render(
    <MemoryRouter>
      <Routes>
        <Route
          path="/"
          element={<SystemStatus assignments={assignments} mailerStatus={mailerStatus} />}
        />
        <Route path="/admin/settings" element={<div>settings-page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

function openMenu() {
  fireEvent.click(
    screen.getByRole("button", { name: /All systems normal|Degraded performance|Action needed/ }),
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  resetSystemStatusCache();
});

describe("SystemStatus", () => {
  it("shows all 6 rows and 'All systems normal' for a superadmin once checks pass", async () => {
    useConnectionState.mockReturnValue(connectionStateValue("connected"));
    fetchSetupChecks.mockResolvedValueOnce({ checks: OK_CHECKS });

    renderStatus(SUPERADMIN);
    await screen.findByRole("button", { name: /All systems normal/ });

    openMenu();
    expect(screen.getByText("Database")).toBeTruthy();
    expect(screen.getByText("Session storage")).toBeTruthy();
    expect(screen.getByText("Email sending")).toBeTruthy();
    expect(screen.getByText("Data encryption")).toBeTruthy();
    expect(screen.getByText("Instance URL")).toBeTruthy();
    expect(screen.getByText("Check-in connection")).toBeTruthy();
    // Database, Session storage, Email sending, and Check-in connection all report the
    // same plain "Connected" — no PostgreSQL/Redis/vendor jargon in the topbar (that
    // detail lives in System logs), and no long explanatory sentence next to the other
    // rows' one-word status.
    expect(screen.getAllByText("Connected")).toHaveLength(4);
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.getByText("Configured")).toBeTruthy();
  });

  it("shows 'Action needed' when the instance-URL check fails, even though database/redis/encryption/mailer all pass", async () => {
    useConnectionState.mockReturnValue(connectionStateValue("connected"));
    fetchSetupChecks.mockResolvedValueOnce({
      checks: { ...OK_CHECKS, base_url: { ok: false, detail: "BASE_URL env is required in production" } },
    });

    renderStatus(SUPERADMIN);
    await screen.findByRole("button", { name: /Action needed/ });

    openMenu();
    expect(screen.getByText("Instance URL")).toBeTruthy();
    expect(screen.getByText("Not configured")).toBeTruthy();
  });

  it("does not flash 'Action needed' while checks are still loading", async () => {
    useConnectionState.mockReturnValue(connectionStateValue("connected"));
    let resolveChecks!: (value: { checks: typeof OK_CHECKS }) => void;
    fetchSetupChecks.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveChecks = resolve;
      }),
    );

    renderStatus(SUPERADMIN);

    expect(screen.getByRole("button", { name: /All systems normal/ })).toBeTruthy();
    openMenu();
    expect(screen.getAllByText("Checking…").length).toBeGreaterThan(0);

    resolveChecks({ checks: OK_CHECKS });
    await waitFor(() => {
      expect(screen.queryByText("Checking…")).toBeNull();
    });
  });

  it("shows 'Action needed' when a check is down", async () => {
    useConnectionState.mockReturnValue(connectionStateValue("connected"));
    fetchSetupChecks.mockResolvedValueOnce({
      checks: { ...OK_CHECKS, database: { ok: false, detail: "Cannot connect to PostgreSQL" } },
    });

    renderStatus(SUPERADMIN);
    await screen.findByRole("button", { name: /Action needed/ });

    openMenu();
    // Plain language, not the raw API detail ("Cannot connect to PostgreSQL") — no
    // product names in the topbar.
    expect(screen.getByText("Not reachable")).toBeTruthy();
  });

  it("shows 'Degraded performance' when a check passes with a warning", async () => {
    useConnectionState.mockReturnValue(connectionStateValue("connected"));
    fetchSetupChecks.mockResolvedValueOnce({
      checks: { ...OK_CHECKS, redis: { ok: true, warn: true, detail: "Redis unreachable, using in-memory fallback" } },
    });

    renderStatus(SUPERADMIN);
    await screen.findByRole("button", { name: /Degraded performance/ });

    openMenu();
    expect(screen.getByText("Responding slowly")).toBeTruthy();
  });

  it("shows 'Action needed' and marks rows 'Unavailable' when fetchSetupChecks rejects, instead of getting stuck 'Checking…' forever", async () => {
    useConnectionState.mockReturnValue(connectionStateValue("connected"));
    fetchSetupChecks.mockRejectedValueOnce(new Error("network error"));

    renderStatus(SUPERADMIN);
    await screen.findByRole("button", { name: /Action needed/ });

    openMenu();
    expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(0);
    expect(screen.queryByText("Checking…")).toBeNull();
  });

  it("caches a successful setup-checks result across remounts within the TTL", async () => {
    useConnectionState.mockReturnValue(connectionStateValue("connected"));
    fetchSetupChecks.mockResolvedValueOnce({ checks: OK_CHECKS });

    const { unmount } = renderStatus(SUPERADMIN);
    await screen.findByRole("button", { name: /All systems normal/ });
    unmount();

    renderStatus(SUPERADMIN);
    // Shows the cached result immediately — no second "Checking…" flash and no second fetch.
    expect(screen.getByRole("button", { name: /All systems normal/ })).toBeTruthy();
    expect(fetchSetupChecks).toHaveBeenCalledTimes(1);
  });

  it("omits the Email sending row (no false alarm) when mailerStatus hasn't reached this session yet", async () => {
    useConnectionState.mockReturnValue(connectionStateValue("connected"));
    fetchSetupChecks.mockResolvedValueOnce({ checks: OK_CHECKS });

    renderStatus(SUPERADMIN, null);
    await screen.findByRole("button", { name: /All systems normal/ });

    openMenu();
    expect(screen.queryByText("Email sending")).toBeNull();
  });

  it("shows the Email sending row to a non-superadmin when mailerStatus is available (not superadmin-gated)", () => {
    useConnectionState.mockReturnValue(connectionStateValue("connected"));

    renderStatus(OPERATOR);

    openMenu();
    expect(fetchSetupChecks).not.toHaveBeenCalled();
    expect(screen.getByText("Email sending")).toBeTruthy();
    expect(screen.getByText("Check-in connection")).toBeTruthy();
    expect(screen.queryByText("Database")).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /View system logs/ })).toBeNull();
  });

  it("uses role=menu for a superadmin, who has an actionable 'View system logs' item", async () => {
    useConnectionState.mockReturnValue(connectionStateValue("connected"));
    fetchSetupChecks.mockResolvedValueOnce({ checks: OK_CHECKS });

    renderStatus(SUPERADMIN);
    await screen.findByRole("button", { name: /All systems normal/ });
    openMenu();

    expect(screen.getByRole("menu")).toBeTruthy();
  });

  it("uses role=group (not menu) for a non-superadmin, whose panel is purely informational", () => {
    useConnectionState.mockReturnValue(connectionStateValue("connected"));

    renderStatus(OPERATOR);
    openMenu();

    expect(screen.getByRole("group", { name: "System status" })).toBeTruthy();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("navigates to Settings → Security when 'View system logs' is clicked", async () => {
    useConnectionState.mockReturnValue(connectionStateValue("connected"));
    fetchSetupChecks.mockResolvedValueOnce({ checks: OK_CHECKS });

    renderStatus(SUPERADMIN);
    await screen.findByRole("button", { name: /All systems normal/ });

    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /View system logs/ }));

    expect(screen.getByText("settings-page")).toBeTruthy();
  });

  it("closes when the user tabs to the adjacent UserMenu trigger, instead of leaving both dropdowns open", () => {
    useConnectionState.mockReturnValue(connectionStateValue("connected"));
    const user: AuthUser = {
      id: "u1",
      email: "superadmin@example.com",
      display_name: "Ada Superadmin",
      is_active: true,
      created_at: "2026-01-01T00:00:00.000Z",
    };

    render(
      <MemoryRouter>
        <SystemStatus assignments={SUPERADMIN} mailerStatus={{ configured: true, provider: "smtp" }} />
        <UserMenu user={user} assignments={SUPERADMIN} />
      </MemoryRouter>,
    );

    openMenu();
    expect(screen.getByRole("menu")).toBeTruthy();

    // Tab from inside the open SystemStatus panel straight to UserMenu's trigger — no
    // pointerdown in between, the exact keyboard-only path the two dropdowns used to both
    // stay open for.
    fireEvent.focusIn(screen.getByRole("button", { name: /Ada Superadmin/ }));

    expect(screen.queryByRole("menu")).toBeNull();
  });
});
