// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { resetSystemStatusCache, SystemStatus } from "../../src/components/SystemStatus.js";
import { UserMenu } from "../../src/components/UserMenu.js";
import type { AuthUser, RoleAssignment } from "../../src/api/types.js";

const fetchSetupChecks = vi.fn();
const fetchEventMailSettings = vi.fn();
vi.mock("../../src/api/client.js", () => ({
  fetchSetupChecks: (...args: unknown[]) => fetchSetupChecks(...args),
  fetchEventMailSettings: (...args: unknown[]) => fetchEventMailSettings(...args),
}));

function eventMailSettings(provider: string | null, hasEventOverride: boolean, failedDeliveries = 0) {
  return { hasEventOverride, failedDeliveries, fields: { provider: { value: provider } } };
}

const SUPERADMIN: RoleAssignment[] = [{ role: "superadmin", scope_type: "instance", scope_id: null }];
const OPERATOR: RoleAssignment[] = [{ role: "operator", scope_type: "event", scope_id: "evt-1" }];

const OK_CHECKS = {
  database: { ok: true, detail: "PostgreSQL connected · migrations current" },
  redis: { ok: true, detail: "Redis OK (2 ms)" },
  encryption: { ok: true, detail: "ENCRYPTION_KEY configured (32 bytes)" },
  base_url: { ok: true, detail: "https://tickets.example.com" },
};

function SettingsPageProbe() {
  const loc = useLocation();
  return <div data-testid="settings-page">{loc.search}</div>;
}

function renderStatus(
  assignments: RoleAssignment[],
  mailerStatus: { configured: boolean; provider: string | null } | null = { configured: true, provider: "smtp" },
  eventId?: string,
) {
  return render(
    <MemoryRouter>
      <Routes>
        <Route
          path="/"
          element={<SystemStatus assignments={assignments} mailerStatus={mailerStatus} eventId={eventId} />}
        />
        <Route path="/admin/settings" element={<SettingsPageProbe />} />
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
  vi.useRealTimers();
});

describe("SystemStatus", () => {
  it("shows all 4 rows and 'All systems normal' for a superadmin once checks pass", async () => {
    fetchSetupChecks.mockResolvedValueOnce({ checks: OK_CHECKS });

    renderStatus(SUPERADMIN);
    await screen.findByRole("button", { name: /All systems normal/ });

    openMenu();
    expect(screen.getByText("Database")).toBeTruthy();
    expect(screen.getByText("Session storage")).toBeTruthy();
    expect(screen.getByText("Email sending")).toBeTruthy();
    expect(screen.getByText("Data encryption")).toBeTruthy();
    expect(screen.queryByText("Instance URL")).toBeNull();
    expect(screen.queryByText("Check-in connection")).toBeNull();
    // Database, Session storage, and Email sending all report the same plain "Connected"
    // — no PostgreSQL/Redis/vendor jargon in the topbar (that detail lives in System
    // logs), and no long explanatory sentence next to the other rows' one-word status.
    expect(screen.getAllByText("Connected")).toHaveLength(3);
    expect(screen.getByText("Active")).toBeTruthy();
  });

  it("does not flip to 'Action needed' when only the (hidden) instance-URL check fails", async () => {
    fetchSetupChecks.mockResolvedValueOnce({
      checks: { ...OK_CHECKS, base_url: { ok: false, detail: "BASE_URL env is required in production" } },
    });

    renderStatus(SUPERADMIN);
    await screen.findByRole("button", { name: /All systems normal/ });

    openMenu();
    expect(screen.queryByText("Instance URL")).toBeNull();
  });

  it("does not flash 'Action needed' while checks are still loading", async () => {
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

  it("shows 'Schema update pending' (not 'Not reachable') when the database is up but migrations can't be confirmed current", async () => {
    fetchSetupChecks.mockResolvedValueOnce({
      checks: {
        ...OK_CHECKS,
        database: {
          ok: false,
          reason: "migrations_pending",
          detail: "PostgreSQL connected · migrations pending",
        },
      },
    });

    renderStatus(SUPERADMIN);
    await screen.findByRole("button", { name: /Action needed/ });

    openMenu();
    expect(screen.getByText("Schema update pending")).toBeTruthy();
    expect(screen.queryByText("Not reachable")).toBeNull();
  });

  it("shows 'Degraded performance' when a check passes with a warning", async () => {
    fetchSetupChecks.mockResolvedValueOnce({
      checks: { ...OK_CHECKS, redis: { ok: true, warn: true, detail: "Redis unreachable, using in-memory fallback" } },
    });

    renderStatus(SUPERADMIN);
    await screen.findByRole("button", { name: /Degraded performance/ });

    openMenu();
    expect(screen.getByText("Responding slowly")).toBeTruthy();
  });

  it("shows 'Action needed' and marks rows 'Unavailable' when fetchSetupChecks rejects, instead of getting stuck 'Checking…' forever", async () => {
    fetchSetupChecks.mockRejectedValueOnce(new Error("network error"));

    renderStatus(SUPERADMIN);
    await screen.findByRole("button", { name: /Action needed/ });

    openMenu();
    expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(0);
    expect(screen.queryByText("Checking…")).toBeNull();
  });

  it("caches a successful setup-checks result across remounts within the TTL", async () => {
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
    fetchSetupChecks.mockResolvedValueOnce({ checks: OK_CHECKS });

    renderStatus(SUPERADMIN, null);
    await screen.findByRole("button", { name: /All systems normal/ });

    openMenu();
    expect(screen.queryByText("Email sending")).toBeNull();
  });

  it("renders nothing when there are no rows to show (non-superadmin, mailer status not reached yet)", () => {
    const { container } = renderStatus(OPERATOR, null);

    expect(fetchSetupChecks).not.toHaveBeenCalled();
    expect(container.firstChild).toBeNull();
  });

  it("shows the Email sending row to a non-superadmin when mailerStatus is available (not superadmin-gated)", () => {
    renderStatus(OPERATOR);

    openMenu();
    expect(fetchSetupChecks).not.toHaveBeenCalled();
    expect(screen.getByText("Email sending")).toBeTruthy();
    expect(screen.queryByText("Database")).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /View system logs/ })).toBeNull();
  });

  it("labels Email sending 'Connected · event' for a superadmin viewing an event with its own dedicated transport", async () => {
    fetchSetupChecks.mockResolvedValueOnce({ checks: OK_CHECKS });
    fetchEventMailSettings.mockResolvedValueOnce(eventMailSettings("graph", true));

    renderStatus(SUPERADMIN, { configured: false, provider: null }, "evt-1");
    await screen.findByRole("button", { name: /All systems normal/ });

    openMenu();
    expect(fetchEventMailSettings).toHaveBeenCalledWith("evt-1", expect.anything());
    expect(screen.getByText("Connected · event")).toBeTruthy();
  });

  it("labels Email sending 'Connected · organization' for a superadmin viewing an event with no override of its own", async () => {
    fetchSetupChecks.mockResolvedValueOnce({ checks: OK_CHECKS });
    fetchEventMailSettings.mockResolvedValueOnce(eventMailSettings("smtp", false));

    renderStatus(SUPERADMIN, null, "evt-1");
    await screen.findByRole("button", { name: /All systems normal/ });

    openMenu();
    expect(screen.getByText("Connected · organization")).toBeTruthy();
  });

  it("caches a successful event-level mail result across remounts within the TTL", async () => {
    fetchSetupChecks.mockResolvedValue({ checks: OK_CHECKS });
    fetchEventMailSettings.mockResolvedValueOnce(eventMailSettings("smtp", true));

    const { unmount } = renderStatus(SUPERADMIN, null, "evt-1");
    await screen.findByRole("button", { name: /All systems normal/ });
    unmount();

    renderStatus(SUPERADMIN, null, "evt-1");
    await screen.findByRole("button", { name: /All systems normal/ });

    openMenu();
    // Shows the cached result immediately — no second event-mail fetch.
    expect(screen.getByText("Connected · event")).toBeTruthy();
    expect(fetchEventMailSettings).toHaveBeenCalledTimes(1);
  });

  it("falls back to org-level mailerStatus when the initial event-level fetch fails", async () => {
    fetchSetupChecks.mockResolvedValueOnce({ checks: OK_CHECKS });
    fetchEventMailSettings.mockRejectedValueOnce(new Error("network error"));

    renderStatus(SUPERADMIN, { configured: true, provider: "smtp" }, "evt-1");
    await screen.findByRole("button", { name: /All systems normal/ });

    openMenu();
    // Database, Session storage, and Email sending (fallen back to the org-level prop) all
    // read the same plain "Connected" — no event-specific "· event"/"· organization" suffix.
    expect(screen.getAllByText("Connected")).toHaveLength(3);
    expect(screen.queryByText("Connected · event")).toBeNull();
    expect(screen.queryByText("Connected · organization")).toBeNull();
  });

  it("ignores a resolved event-mail fetch for an eventId that's no longer current (abort branch)", async () => {
    fetchSetupChecks.mockResolvedValue({ checks: OK_CHECKS });
    let resolveFirst!: (value: ReturnType<typeof eventMailSettings>) => void;
    fetchEventMailSettings.mockImplementationOnce(
      () => new Promise((resolve) => { resolveFirst = resolve; }),
    );
    fetchEventMailSettings.mockResolvedValueOnce(eventMailSettings("smtp", false));

    const { rerender } = render(
      <MemoryRouter>
        <SystemStatus assignments={SUPERADMIN} mailerStatus={null} eventId="evt-1" />
      </MemoryRouter>,
    );
    await act(async () => {});

    rerender(
      <MemoryRouter>
        <SystemStatus assignments={SUPERADMIN} mailerStatus={null} eventId="evt-2" />
      </MemoryRouter>,
    );
    await act(async () => {});
    openMenu();
    expect(screen.getByText("Connected · organization")).toBeTruthy();

    // The stale evt-1 fetch resolving late must not clobber evt-2's already-settled value.
    resolveFirst(eventMailSettings("graph", true));
    await act(async () => {});

    expect(screen.getByText("Connected · organization")).toBeTruthy();
    expect(screen.queryByText("Connected · event")).toBeNull();
  });

  it("ignores a resolved checks fetch for a stale effect instance (superadmin toggled off then on)", async () => {
    let resolveFirst!: (value: { checks: typeof OK_CHECKS }) => void;
    fetchSetupChecks.mockImplementationOnce(
      () => new Promise((resolve) => { resolveFirst = resolve; }),
    );
    fetchSetupChecks.mockResolvedValueOnce({ checks: OK_CHECKS });

    const { rerender } = render(
      <MemoryRouter>
        <SystemStatus assignments={SUPERADMIN} mailerStatus={null} />
      </MemoryRouter>,
    );
    await act(async () => {});

    rerender(
      <MemoryRouter>
        <SystemStatus assignments={OPERATOR} mailerStatus={{ configured: true, provider: "smtp" }} />
      </MemoryRouter>,
    );
    rerender(
      <MemoryRouter>
        <SystemStatus assignments={SUPERADMIN} mailerStatus={null} />
      </MemoryRouter>,
    );
    await act(async () => {});

    // The stale first request resolving late must not clobber the second effect instance.
    resolveFirst({ checks: { ...OK_CHECKS, database: { ok: false, detail: "stale response" } } });
    await act(async () => {});

    expect(screen.getByRole("button", { name: /All systems normal/ })).toBeTruthy();
  });

  it("shows Email sending as degraded (not a flat 'ok') when the event's transport is configured but has unresolved failed deliveries", async () => {
    fetchSetupChecks.mockResolvedValueOnce({ checks: OK_CHECKS });
    fetchEventMailSettings.mockResolvedValueOnce(eventMailSettings("smtp", true, 2));

    renderStatus(SUPERADMIN, null, "evt-1");
    await screen.findByRole("button", { name: /Degraded performance/ });

    openMenu();
    expect(screen.getByText("Delivery failures need attention")).toBeTruthy();
    expect(screen.queryByText("Connected · event")).toBeNull();
  });

  it("shows the event-level Email sending row for a superadmin even when org-level mailerStatus hasn't reached this session (e.g. an operator route)", async () => {
    fetchSetupChecks.mockResolvedValueOnce({ checks: OK_CHECKS });
    fetchEventMailSettings.mockResolvedValueOnce(eventMailSettings("export_only", true));

    renderStatus(SUPERADMIN, null, "evt-1");
    await screen.findByRole("button", { name: /Action needed/ });

    openMenu();
    // export_only never actually delivers mail, so a dedicated override set to it still
    // reads as "Not configured", not "Connected · event".
    expect(screen.getByText("Email sending")).toBeTruthy();
    expect(screen.getByText("Not configured")).toBeTruthy();
  });

  it("never fetches event-level mail settings for a non-superadmin, even with an eventId in view", () => {
    renderStatus(OPERATOR, { configured: true, provider: "smtp" }, "evt-1");

    openMenu();
    expect(fetchEventMailSettings).not.toHaveBeenCalled();
    expect(screen.getByText("Connected")).toBeTruthy();
  });

  it("uses role=menu for a superadmin, who has an actionable 'View system logs' item", async () => {
    fetchSetupChecks.mockResolvedValueOnce({ checks: OK_CHECKS });

    renderStatus(SUPERADMIN);
    await screen.findByRole("button", { name: /All systems normal/ });
    openMenu();

    expect(screen.getByRole("menu")).toBeTruthy();
  });

  it("uses role=group (not menu) for a non-superadmin, whose panel is purely informational", () => {
    renderStatus(OPERATOR);
    openMenu();

    expect(screen.getByRole("group", { name: "System status" })).toBeTruthy();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("navigates to Settings → Logs when 'View system logs' is clicked", async () => {
    fetchSetupChecks.mockResolvedValueOnce({ checks: OK_CHECKS });

    renderStatus(SUPERADMIN);
    await screen.findByRole("button", { name: /All systems normal/ });

    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /View system logs/ }));

    expect(screen.getByTestId("settings-page").textContent).toContain("tab=logs");
  });

  it("closes when the user tabs to the adjacent UserMenu trigger, instead of leaving both dropdowns open", () => {
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
    // stay open for. Real focus transfer, not just a synthetic focusin dispatch, so this
    // also proves SystemStatus's close doesn't yank focus back off the trigger just tabbed to.
    const userMenuTrigger = screen.getByRole("button", { name: /Ada Superadmin/ });
    act(() => userMenuTrigger.focus());

    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(userMenuTrigger);
  });
});

describe("SystemStatus polling", () => {
  it("re-fetches checks automatically ~30s after the initial load, without a remount", async () => {
    vi.useFakeTimers();
    fetchSetupChecks.mockResolvedValueOnce({ checks: OK_CHECKS });
    fetchSetupChecks.mockResolvedValueOnce({
      checks: { ...OK_CHECKS, database: { ok: false, detail: "Cannot connect to PostgreSQL", reason: "unreachable" } },
    });

    renderStatus(SUPERADMIN);
    await act(async () => {});
    expect(fetchSetupChecks).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /All systems normal/ })).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(fetchSetupChecks).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: /Action needed/ })).toBeTruthy();
  });

  it("keeps the last-known checks state when a background poll tick fails, instead of flipping to Unavailable", async () => {
    vi.useFakeTimers();
    fetchSetupChecks.mockResolvedValueOnce({ checks: OK_CHECKS });
    fetchSetupChecks.mockRejectedValueOnce(new Error("transient network error"));

    renderStatus(SUPERADMIN);
    await act(async () => {});
    expect(screen.getByRole("button", { name: /All systems normal/ })).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(fetchSetupChecks).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: /All systems normal/ })).toBeTruthy();
  });

  it("re-fetches the event-level mail status automatically, reflecting a newly-appeared delivery failure without a remount", async () => {
    vi.useFakeTimers();
    fetchSetupChecks.mockResolvedValue({ checks: OK_CHECKS });
    fetchEventMailSettings.mockResolvedValueOnce(eventMailSettings("smtp", true, 0));
    fetchEventMailSettings.mockResolvedValueOnce(eventMailSettings("smtp", true, 1));

    renderStatus(SUPERADMIN, null, "evt-1");
    await act(async () => {});
    openMenu();
    expect(screen.getByText("Connected · event")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(fetchEventMailSettings).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Delivery failures need attention")).toBeTruthy();
  });

  it("stops polling once unmounted — no further fetch calls after the component is gone", async () => {
    vi.useFakeTimers();
    fetchSetupChecks.mockResolvedValue({ checks: OK_CHECKS });

    const { unmount } = renderStatus(SUPERADMIN);
    await act(async () => {});
    expect(fetchSetupChecks).toHaveBeenCalledTimes(1);

    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(fetchSetupChecks).toHaveBeenCalledTimes(1);
  });
});

describe("SystemStatus trigger label weight", () => {
  it("does not add a degraded/down modifier class to the trigger label when all-clear", async () => {
    fetchSetupChecks.mockResolvedValueOnce({ checks: OK_CHECKS });

    renderStatus(SUPERADMIN);
    const trigger = await screen.findByRole("button", { name: /All systems normal/ });

    expect(trigger.querySelector(".sys-status__label--degraded, .sys-status__label--down")).toBeNull();
  });

  it("adds the down modifier class to the trigger label when a check is down", async () => {
    fetchSetupChecks.mockResolvedValueOnce({
      checks: { ...OK_CHECKS, database: { ok: false, detail: "Cannot connect to PostgreSQL" } },
    });

    renderStatus(SUPERADMIN);
    const trigger = await screen.findByRole("button", { name: /Action needed/ });

    expect(trigger.querySelector(".sys-status__label--down")).toBeTruthy();
  });

  it("adds the degraded modifier class to the trigger label when a check is degraded", async () => {
    fetchSetupChecks.mockResolvedValueOnce({
      checks: { ...OK_CHECKS, redis: { ok: true, warn: true, detail: "Redis unreachable, using in-memory fallback" } },
    });

    renderStatus(SUPERADMIN);
    const trigger = await screen.findByRole("button", { name: /Degraded performance/ });

    expect(trigger.querySelector(".sys-status__label--degraded")).toBeTruthy();
  });
});
