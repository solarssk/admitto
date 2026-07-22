// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { SystemStatus } from "../../src/components/SystemStatus.js";
import type { RoleAssignment } from "../../src/api/types.js";
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

function renderStatus(assignments: RoleAssignment[]) {
  return render(
    <MemoryRouter>
      <Routes>
        <Route
          path="/"
          element={
            <SystemStatus assignments={assignments} mailerStatus={{ configured: true, provider: "smtp" }} />
          }
        />
        <Route path="/admin/settings" element={<div>settings-page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

function openMenu() {
  fireEvent.click(screen.getByRole("button", { name: /All systems normal|Degraded performance|Action needed/ }));
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SystemStatus", () => {
  it("shows all 5 rows and 'All systems normal' for a superadmin once checks pass", async () => {
    useConnectionState.mockReturnValue(connectionStateValue("connected"));
    fetchSetupChecks.mockResolvedValueOnce({ checks: OK_CHECKS });

    renderStatus(SUPERADMIN);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /All systems normal/ })).toBeTruthy();
    });

    openMenu();
    expect(screen.getByText("Database")).toBeTruthy();
    expect(screen.getByText("Session storage")).toBeTruthy();
    expect(screen.getByText("Email sending")).toBeTruthy();
    expect(screen.getByText("Data encryption")).toBeTruthy();
    expect(screen.getByText("Check-in connection")).toBeTruthy();
    // Database, Session storage, Email sending, and Check-in connection all report the
    // same plain "Connected" — no PostgreSQL/Redis/vendor jargon in the topbar (that
    // detail lives in System logs), and no long explanatory sentence next to the other
    // rows' one-word status.
    expect(screen.getAllByText("Connected")).toHaveLength(4);
    expect(screen.getByText("Active")).toBeTruthy();
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

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Action needed/ })).toBeTruthy();
    });
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

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Degraded performance/ })).toBeTruthy();
    });
    openMenu();
    expect(screen.getByText("Responding slowly")).toBeTruthy();
  });

  it("never calls fetchSetupChecks for a non-superadmin and only shows the connection row", () => {
    useConnectionState.mockReturnValue(connectionStateValue("connected"));

    renderStatus(OPERATOR);

    openMenu();
    expect(fetchSetupChecks).not.toHaveBeenCalled();
    expect(screen.getByText("Check-in connection")).toBeTruthy();
    expect(screen.queryByText("Database")).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /View system logs/ })).toBeNull();
  });

  it("navigates to Settings → Security when 'View system logs' is clicked", async () => {
    useConnectionState.mockReturnValue(connectionStateValue("connected"));
    fetchSetupChecks.mockResolvedValueOnce({ checks: OK_CHECKS });

    renderStatus(SUPERADMIN);
    await waitFor(() => expect(screen.getByRole("button", { name: /All systems normal/ })).toBeTruthy());

    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /View system logs/ }));

    expect(screen.getByText("settings-page")).toBeTruthy();
  });
});
