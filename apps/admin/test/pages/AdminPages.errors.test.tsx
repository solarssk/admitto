// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RouterProvider } from "react-router/dom";
import { MemoryRouter, Route, Routes, createMemoryRouter } from "react-router";
import { ApiError } from "../../src/api/client.js";
import { EventSettingsPage } from "../../src/pages/EventSettingsPage.js";
import { UsersPage } from "../../src/pages/UsersPage.js";
import { RoleAssignmentsTab } from "../../src/pages/users/RoleAssignmentsTab.js";
import { RequirementsPage } from "../../src/pages/RequirementsPage.js";
import { ReportsPage } from "../../src/pages/ReportsPage.js";
import { EventsPickerPage } from "../../src/pages/EventsPickerPage.js";
import { ImportPage } from "../../src/pages/ImportPage.js";
import { DeviceLabelStep } from "../../src/pages/DeviceLabelStep.js";
import { getTooltipText, mockMatchMedia, renderWithToast } from "../test-utils.js";

const superadminAssignments = [
  { role: "superadmin", scope_type: "instance", scope_id: null },
];

vi.mock("../../src/auth/AuthProvider.js", () => ({
  useAuth: () => ({ assignments: superadminAssignments }),
}));

// ReportsPage's live SSE wiring (ADR 0014) isn't under test in this shared error-handling file -
// jsdom has no real EventSource, so every ReportsPage render here needs this stubbed out.
vi.mock("../../src/hooks/useEventStream.js", () => ({
  useEventStream: () => ({ connected: true, status: "connected" }),
}));

vi.mock("../../src/connection/ConnectionStateProvider.js", () => {
  // Stable across renders, matching the real provider's own useMemo/useCallback (a fresh object
  // here would make any hook depending on reportApiError's identity re-run its effect on every
  // render, which can starve a fetch that never gets a chance to resolve before being re-aborted).
  const connectionState = { reportApiError: vi.fn() };
  return { useConnectionState: () => connectionState };
});

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    useBlocker: () => ({ state: "unblocked", proceed: vi.fn(), reset: vi.fn() }),
    useOutletContext: () => ({
      event: { id: "evt-1", title: "Demo", archived_at: null },
    }),
  };
});

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    fetchEventSettings: vi.fn(),
    patchEvent: vi.fn(),
    archiveEvent: vi.fn(),
    exportEventPii: vi.fn(),
    fetchAdminUsers: vi.fn(),
    fetchRoleAssignments: vi.fn(),
    revokeUserSessions: vi.fn(),
    fetchEventItems: vi.fn(),
    fetchEventCustomFields: vi.fn(),
    fetchTicketTypes: vi.fn().mockResolvedValue([]),
    fetchOpsConfig: vi.fn(),
    createEventItem: vi.fn(),
    updateEventItem: vi.fn(),
    updateOpsConfig: vi.fn(),
    fetchEventReports: vi.fn(),
    exportEventReportsCsv: vi.fn(),
    fetchAdminEvents: vi.fn(),
    previewImport: vi.fn(),
    fetchImportHistory: vi.fn().mockResolvedValue([]),
    submitSessionDeviceLabel: vi.fn(),
    fetchAttendeeDetail: vi.fn(),
    fetchEventItemsForAttendee: vi.fn(),
    updateAttendee: vi.fn(),
    resendTicket: vi.fn(),
  };
});

import {
  archiveEvent,
  createEventItem,
  exportEventPii,
  exportEventReportsCsv,
  fetchAdminEvents,
  fetchAdminUsers,
  fetchEventCustomFields,
  fetchEventItems,
  fetchEventReports,
  fetchEventSettings,
  fetchOpsConfig,
  fetchRoleAssignments,
  fetchTicketTypes,
  previewImport,
  revokeUserSessions,
  patchEvent,
  submitSessionDeviceLabel,
  updateEventItem,
  updateOpsConfig,
} from "../../src/api/client.js";

const eventSettings = {
  id: "evt-1",
  title: "Summit",
  slug: "summit",
  date: "2026-06-01",
  timezone: "Europe/Warsaw",
  location: "Hall A",
  capacity: 100,
  status: "active" as const,
  archived_at: null as string | null,
  created_at: "2026-01-01T00:00:00.000Z",
  is_deletable: false,
  organization_name: "Org",
  active_items: [] as Array<{ id: string; name: string; enabled: boolean }>,
  logo_url: null as string | null,
  header_image_url: null as string | null,
  resolved_logo_url: null as string | null,
  resolved_header_image_url: null as string | null,
};

const sampleItem = {
  id: "item-1",
  key: "badge",
  label: "Badge",
  type: "badge",
  enabled: true,
  icon: null,
  config: { issue_on_checkin: true },
};

const opsConfig = {
  badge_at_entry: false,
  require_confirm_on_scan: false,
  allow_manual_lookup: true,
  auto_advance_on_valid: false,
};

const emptyReport = {
  timezone: "Europe/Warsaw",
  event: { id: "evt-1", title: "Summit", date: "2026-06-01", capacity: 100 },
  summary: {
    total_attendees: 0,
    admitted: 0,
    no_shows: 0,
    admission_rate_pct: 0,
    peak_hour: null,
    peak_hour_count: 0,
  },
  by_hour: [],
  by_ticket_type: [],
  admission_log: [],
  admission_log_truncated: false,
  admission_log_total: 0,
  by_rsvp_status: [],
  by_checkin_method: [],
  by_device: [],
};

const archivedEvent = {
  id: "evt-arch",
  title: "Archived Summit",
  slug: "archived-summit",
  date: "2025-06-01",
  timezone: "Europe/Warsaw",
  location: "Hall B",
  capacity: 50,
  status: "archived" as const,
  organization_name: "Org",
  archived_at: "2026-01-01T00:00:00.000Z",
  attendee_count: 12,
};

// ReportsPage's AdmissionLog picks a table (desktop) or card list (mobile) via useIsDesktop(),
// which reads window.matchMedia - jsdom doesn't implement it. Defaults to desktop so the
// existing table-shaped assertions elsewhere in this file keep working unchanged.
beforeEach(() => {
  mockMatchMedia(true);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Admin pages delayed loading", () => {
  it("EventsPickerPage shows the loading spinner once the fetch has genuinely taken a moment", () => {
    vi.mocked(fetchAdminEvents).mockImplementationOnce(() => new Promise(() => {}));
    vi.useFakeTimers();
    renderWithToast(
      <MemoryRouter initialEntries={["/admin"]}>
        <Routes>
          <Route path="/admin" element={<EventsPickerPage />} />
        </Routes>
      </MemoryRouter>,
    );
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByLabelText("Loading events")).toBeTruthy();
  });

  it("ReportsPage shows the loading skeleton once the fetch has genuinely taken a moment", () => {
    vi.mocked(fetchEventReports).mockImplementationOnce(() => new Promise(() => {}));
    vi.useFakeTimers();
    renderWithToast(
      <MemoryRouter initialEntries={["/admin/events/evt-1/reports"]}>
        <Routes>
          <Route path="/admin/events/:eventId/reports" element={<ReportsPage />} />
        </Routes>
      </MemoryRouter>,
    );
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(document.querySelector(".reports-loading")).toBeTruthy();
  });

  it("UsersPage shows the loading skeleton once the fetch has genuinely taken a moment", () => {
    vi.mocked(fetchAdminUsers).mockImplementationOnce(() => new Promise(() => {}));
    vi.useFakeTimers();
    renderWithToast(<UsersPage />);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(document.querySelector(".users-page__table-wrap--desktop")).toBeTruthy();
  });

  it("RoleAssignmentsTab shows the loading skeleton once the fetch has genuinely taken a moment", () => {
    vi.mocked(fetchRoleAssignments).mockImplementationOnce(() => new Promise(() => {}));
    vi.useFakeTimers();
    renderWithToast(<RoleAssignmentsTab />);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(document.querySelector(".users-page__table-wrap--desktop")).toBeTruthy();
  });
});

describe("EventSettingsPage operator errors", () => {
  function renderSettings() {
    renderWithToast(
      <MemoryRouter initialEntries={["/admin/events/evt-1/settings"]}>
        <Routes>
          <Route path="/admin/events/:eventId/settings" element={<EventSettingsPage />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("toasts on load failure", async () => {
    vi.mocked(fetchEventSettings).mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderSettings();
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Failed to load event settings/);
    });
  });

  it("toasts on save failure", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(eventSettings);
    vi.mocked(patchEvent).mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderSettings();
    await waitFor(() => {
      expect(screen.getByLabelText("Event title")).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText("Event title"), { target: { value: "Summit 2026" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Failed to save settings/);
    });
  });

  it("rejects an invalid capacity locally instead of sending a malformed settings patch", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(eventSettings);
    renderSettings();
    await screen.findByLabelText("Capacity");

    fireEvent.change(screen.getByLabelText("Capacity"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(
        /Capacity must be a positive whole number/,
      );
    });
    expect(patchEvent).not.toHaveBeenCalled();
  });

  it("toasts event_archived on save", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(eventSettings);
    vi.mocked(patchEvent).mockRejectedValueOnce(new ApiError(400, "event_archived", "event_archived"));
    renderSettings();
    await waitFor(() => {
      expect(screen.getByLabelText("Event title")).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText("Event title"), { target: { value: "Summit 2026" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Cannot edit archived event/);
    });
  });

  it("toasts on archive failure", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(eventSettings);
    vi.mocked(archiveEvent).mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderSettings();
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Danger zone" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("tab", { name: "Danger zone" }));
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "Archive event" }).length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Archive event" })[0]!);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Archive event" }));
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Action failed/);
    });
  });

  it("toasts on export failure", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(eventSettings);
    vi.mocked(exportEventPii).mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderSettings();
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Danger zone" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("tab", { name: "Danger zone" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Export personal data" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Export personal data" }));
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Export failed/);
    });
  });

  it("downloads a truncated PII export using the server-provided filename", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(eventSettings);
    vi.mocked(exportEventPii).mockResolvedValueOnce({
      blob: async () => new Blob(["name,email\nJane,jane@example.com\n"], { type: "text/csv" }),
      headers: new Headers({
        "Content-Disposition": 'attachment; filename="pii-export-summit.csv"',
        "X-Export-Truncated": "true",
        "X-Export-Total-Rows": "12000",
      }),
    } as Response);
    const createObjectURL = vi.fn(() => "blob:mock-pii-export");
    const revokeObjectURL = vi.fn();
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    const anchorClicks: string[] = [];
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        anchorClicks.push(this.download);
      });
    try {
      renderSettings();
      fireEvent.click(await screen.findByRole("tab", { name: "Danger zone" }));
      fireEvent.click(await screen.findByRole("button", { name: "Export personal data" }));

      await waitFor(() => {
        expect(createObjectURL).toHaveBeenCalledOnce();
        expect(anchorClicks).toEqual(["pii-export-summit.csv"]);
        expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-pii-export");
        expect(screen.getByTestId("at-toast").textContent).toMatch(
          /PII export downloaded \(first 10,000 of 12000 attendees\)/,
        );
      });
    } finally {
      clickSpy.mockRestore();
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  });
});

describe("UsersPage operator errors", () => {
  it("shows load failure", async () => {
    vi.mocked(fetchAdminUsers).mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderWithToast(<UsersPage />);
    await waitFor(() => {
      expect(screen.getByText(/Failed to load users/)).toBeTruthy();
    });
  });

});

describe("RoleAssignmentsTab operator errors", () => {
  it("shows load failure", async () => {
    vi.mocked(fetchRoleAssignments).mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderWithToast(<RoleAssignmentsTab />);
    await waitFor(() => {
      expect(screen.getByText(/Failed to load role assignments/)).toBeTruthy();
    });
  });
});

describe("RequirementsPage operator errors", () => {
  function renderRequirements() {
    renderWithToast(
      <MemoryRouter initialEntries={["/admin/events/evt-1/requirements"]}>
        <Routes>
          <Route path="/admin/events/:eventId/requirements" element={<RequirementsPage />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  beforeEach(() => {
    vi.mocked(fetchEventItems).mockResolvedValue([sampleItem]);
    vi.mocked(fetchEventCustomFields).mockResolvedValue([]);
    vi.mocked(fetchOpsConfig).mockResolvedValue(opsConfig);
  });

  it("explains a forbidden requirements load without exposing the API error", async () => {
    vi.mocked(fetchEventItems).mockRejectedValueOnce(new ApiError(403, "internal_permission_detail"));
    renderRequirements();

    expect(await screen.findByText("You do not have access to this event.")).toBeTruthy();
    expect(screen.queryByText("internal_permission_detail")).toBeNull();
  });

  it("uses the generic safe copy when requirements loading fails outside the API layer", async () => {
    vi.mocked(fetchEventItems).mockRejectedValueOnce(new Error("network transport detail"));
    renderRequirements();

    expect(await screen.findByText("Failed to load requirements.")).toBeTruthy();
    expect(screen.queryByText("network transport detail")).toBeNull();
  });

  it("toasts item_in_use on toggle conflict", async () => {
    vi.mocked(updateEventItem).mockRejectedValueOnce(new ApiError(409, "item_in_use", "item_in_use"));
    renderRequirements();
    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "Disable Badge" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("switch", { name: "Disable Badge" }));
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/issued to attendees/);
    });
  });

  it("toasts confirmation when toggling an item's Active state", async () => {
    vi.mocked(updateEventItem).mockResolvedValueOnce({ ...sampleItem, enabled: false });
    renderRequirements();
    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "Disable Badge" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("switch", { name: "Disable Badge" }));
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Item disabled — saved/);
    });
  });

  it("toasts generic update item failure", async () => {
    vi.mocked(updateEventItem).mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderRequirements();
    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "Disable Badge" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("switch", { name: "Disable Badge" }));
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Failed to update item/);
    });
  });

  it("shows create failure", async () => {
    vi.mocked(fetchEventItems).mockResolvedValueOnce([]);
    vi.mocked(createEventItem).mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderRequirements();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Add item" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    fireEvent.change(screen.getByLabelText("Item name"), { target: { value: "Lanyard" } });
    fireEvent.click(screen.getByRole("button", { name: "Create item" }));
    await waitFor(() => {
      expect(screen.getByText(/Failed to create item/)).toBeTruthy();
    });
  });

  it("creates items with requires_return false by default", async () => {
    vi.mocked(fetchEventItems).mockResolvedValue([]);
    vi.mocked(createEventItem).mockResolvedValueOnce({
      ...sampleItem,
      id: "item-2",
      key: "headset",
      label: "Headset",
      config: { requires_return: false },
    });
    renderRequirements();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Add item" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    fireEvent.change(screen.getByLabelText("Item name"), { target: { value: "Headset" } });
    fireEvent.click(screen.getByRole("button", { name: "Create item" }));
    await waitFor(() => {
      expect(createEventItem).toHaveBeenCalledWith("evt-1", {
        key: "headset",
        label: "Headset",
        config: { requires_return: false },
      });
    });
  });

  it("creates badge with issue_on_checkin and requires_return false", async () => {
    vi.mocked(fetchEventItems).mockResolvedValue([]);
    vi.mocked(createEventItem).mockResolvedValueOnce({
      ...sampleItem,
      config: { requires_return: false, issue_on_checkin: true },
    });
    renderRequirements();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Add item" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    fireEvent.change(screen.getByLabelText("Item name"), { target: { value: "Badge" } });
    fireEvent.click(screen.getByRole("button", { name: "Create item" }));
    await waitFor(() => {
      expect(createEventItem).toHaveBeenCalledWith("evt-1", {
        key: "badge",
        label: "Badge",
        config: { requires_return: false, issue_on_checkin: true },
      });
    });
  });

  it("toasts behaviour save failure", async () => {
    vi.mocked(fetchEventItems).mockResolvedValueOnce([]);
    vi.mocked(updateOpsConfig).mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderRequirements();
    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "Issue badge at entry" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("switch", { name: "Issue badge at entry" }));
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Failed to save event behaviour/);
    });
  });

  it("disables Issue badge at entry when the badge item is inactive", async () => {
    // mockResolvedValue (not Once): the effect can re-run more than once in
    // this test harness (unstable useConnectionState mock identity), so every
    // fetchEventItems call must consistently report the badge as disabled.
    vi.mocked(fetchEventItems).mockResolvedValue([{ ...sampleItem, enabled: false }]);
    renderRequirements();
    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "Issue badge at entry" })).toBeTruthy();
    });
    const toggle = screen.getByRole("switch", {
      name: "Issue badge at entry",
    }) as HTMLInputElement;
    expect(toggle.disabled).toBe(true);
    expect(getTooltipText(toggle)).toMatch(/badge item is disabled/);
  });

  it("disables Issue badge at entry when the badge item has Issue on check-in off", async () => {
    vi.mocked(fetchEventItems).mockResolvedValue([
      { ...sampleItem, config: { issue_on_checkin: false } },
    ]);
    renderRequirements();
    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "Issue badge at entry" })).toBeTruthy();
    });
    const toggle = screen.getByRole("switch", {
      name: "Issue badge at entry",
    }) as HTMLInputElement;
    expect(toggle.disabled).toBe(true);
    expect(getTooltipText(toggle)).toMatch(/Issue on check-in/);
  });

  it("keeps Issue badge at entry enabled when the badge item is active", async () => {
    renderRequirements();
    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "Issue badge at entry" })).toBeTruthy();
    });
    const toggle = screen.getByRole("switch", {
      name: "Issue badge at entry",
    }) as HTMLInputElement;
    expect(toggle.disabled).toBe(false);
    expect(getTooltipText(toggle)).toBeNull();
  });

  it("toasts when enabling badge_at_entry is rejected as badge_item_inactive", async () => {
    // Defensive fallback: the Switch is disabled once the badge item is
    // inactive, so this only guards a race between page load and toggle.
    vi.mocked(updateOpsConfig).mockRejectedValueOnce(
      new ApiError(409, "badge_item_inactive", "badge_item_inactive"),
    );
    renderRequirements();
    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "Issue badge at entry" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("switch", { name: "Issue badge at entry" }));
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/badge item is disabled/);
    });
  });
});

describe("ReportsPage operator errors", () => {
  it("shows a generic report-load failure without exposing internal errors", async () => {
    vi.mocked(fetchEventReports).mockRejectedValueOnce(new Error("internal transport detail"));
    renderWithToast(
      <MemoryRouter initialEntries={["/admin/events/evt-1/reports"]}>
        <Routes>
          <Route path="/admin/events/:eventId/reports" element={<ReportsPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByText("Failed to load report.")).toBeTruthy();
    });
    expect(screen.queryByText("internal transport detail")).toBeNull();
  });

  it("shows forbidden without leaking internals", async () => {
    vi.mocked(fetchEventReports).mockRejectedValueOnce(new ApiError(403, "secret_internal"));
    renderWithToast(
      <MemoryRouter initialEntries={["/admin/events/evt-1/reports"]}>
        <Routes>
          <Route path="/admin/events/:eventId/reports" element={<ReportsPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByText(/do not have access/)).toBeTruthy();
    });
    expect(screen.queryByText("secret_internal")).toBeNull();
  });

  it("toasts export failure without leaking internals", async () => {
    vi.mocked(fetchEventReports).mockResolvedValueOnce(emptyReport);
    vi.mocked(exportEventReportsCsv).mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderWithToast(
      <MemoryRouter initialEntries={["/admin/events/evt-1/reports"]}>
        <Routes>
          <Route path="/admin/events/:eventId/reports" element={<ReportsPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Export report" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Export report" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /CSV/ }));
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Request failed/);
    });
    expect(screen.queryByText("secret_internal")).toBeNull();
  });

  it("redirects to login on a 401 while loading the report", async () => {
    vi.stubGlobal("location", {
      ...window.location,
      assign: vi.fn(),
      pathname: "/admin/events/evt-1/reports",
    });
    vi.mocked(fetchEventReports).mockRejectedValueOnce(new ApiError(401, "unauthenticated"));
    renderWithToast(
      <MemoryRouter initialEntries={["/admin/events/evt-1/reports"]}>
        <Routes>
          <Route path="/admin/events/:eventId/reports" element={<ReportsPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(window.location.assign).toHaveBeenCalledWith("/login?next=%2Fadmin%2Fevents%2Fevt-1%2Freports");
    });
  });

  it("redirects to login on a 401 while exporting CSV", async () => {
    vi.stubGlobal("location", {
      ...window.location,
      assign: vi.fn(),
      pathname: "/admin/events/evt-1/reports",
    });
    vi.mocked(fetchEventReports).mockResolvedValueOnce(emptyReport);
    vi.mocked(exportEventReportsCsv).mockRejectedValueOnce(new ApiError(401, "unauthenticated"));
    renderWithToast(
      <MemoryRouter initialEntries={["/admin/events/evt-1/reports"]}>
        <Routes>
          <Route path="/admin/events/:eventId/reports" element={<ReportsPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Export report" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Export report" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /CSV/ }));
    await waitFor(() => {
      expect(window.location.assign).toHaveBeenCalledWith("/login?next=%2Fadmin%2Fevents%2Fevt-1%2Freports");
    });
  });

  it("toasts a generic export failure for a non-API error (e.g. a network failure)", async () => {
    vi.mocked(fetchEventReports).mockResolvedValueOnce(emptyReport);
    vi.mocked(exportEventReportsCsv).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    renderWithToast(
      <MemoryRouter initialEntries={["/admin/events/evt-1/reports"]}>
        <Routes>
          <Route path="/admin/events/:eventId/reports" element={<ReportsPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Export report" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Export report" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /CSV/ }));
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Export failed/);
    });
  });

  it("exports the PDF report by opening the print URL in a new tab", async () => {
    vi.stubGlobal("open", vi.fn());
    vi.mocked(fetchEventReports).mockResolvedValueOnce(emptyReport);
    renderWithToast(
      <MemoryRouter initialEntries={["/admin/events/evt-1/reports"]}>
        <Routes>
          <Route path="/admin/events/:eventId/reports" element={<ReportsPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Export report" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Export report" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /PDF/ }));
    expect(window.open).toHaveBeenCalledWith(
      "/api/admin/events/evt-1/reports/export?format=pdf",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("retries loading the report from the error state", async () => {
    vi.mocked(fetchEventReports).mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(emptyReport);
    renderWithToast(
      <MemoryRouter initialEntries={["/admin/events/evt-1/reports"]}>
        <Routes>
          <Route path="/admin/events/:eventId/reports" element={<ReportsPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByText("Failed to load report.")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => {
      expect(screen.getByText("No check-ins yet")).toBeTruthy();
    });
    expect(fetchEventReports).toHaveBeenCalledTimes(2);
  });

  it("recovers from a ticket-type catalog fetch failure without crashing", async () => {
    vi.mocked(fetchTicketTypes).mockRejectedValueOnce(new Error("network down"));
    vi.mocked(fetchEventReports).mockResolvedValueOnce(emptyReport);
    renderWithToast(
      <MemoryRouter initialEntries={["/admin/events/evt-1/reports"]}>
        <Routes>
          <Route path="/admin/events/:eventId/reports" element={<ReportsPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByText("No check-ins yet")).toBeTruthy();
    });
  });
});

describe("ReportsPage ticket type breakdown", () => {
  it("renders both the (none) bucket and a real catalog type literally keyed 'none' as distinct rows, with no React key collision (CodeRabbit review)", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(fetchEventReports).mockResolvedValue({
      ...emptyReport,
      summary: { ...emptyReport.summary, total_attendees: 2, admitted: 2, admission_rate_pct: 100 },
      by_ticket_type: [
        { key: "none", type: "None", color: "gray", total: 1, admitted: 1, admission_pct: 100 },
        { key: null, type: "(none)", color: "gray", total: 1, admitted: 1, admission_pct: 100 },
      ],
    });
    const { container } = renderWithToast(
      <MemoryRouter initialEntries={["/admin/events/evt-1/reports"]}>
        <Routes>
          <Route path="/admin/events/:eventId/reports" element={<ReportsPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(container.querySelector(".reports-breakdown-list")).toBeTruthy();
    });
    // "None" also legitimately appears in the admission-log filter's <option> below, so this is
    // scoped to the breakdown panel - a React key collision would drop or misrender one of these.
    // The ticket-type card renders first among the (now three) breakdown-list cards on the page,
    // so the first match in document order is still the right one.
    const breakdown = container.querySelector(".reports-breakdown-list");
    if (!breakdown) throw new Error("breakdown panel not found");
    expect(within(breakdown as HTMLElement).getByText("None")).toBeTruthy();
    expect(within(breakdown as HTMLElement).getByText("(none)")).toBeTruthy();
    // React logs an error when two elements in the same list share a key - the null bucket and a
    // catalog type literally keyed "none" must not collide, in the breakdown or the filter below it.
    const keyCollisionWarning = consoleError.mock.calls.some((args) =>
      String(args[0]).includes("same key"),
    );
    expect(keyCollisionWarning).toBe(false);
    consoleError.mockRestore();
  });
});

describe("ReportsPage hourly chart", () => {
  it("renders bars only for the visible range around non-zero hours", async () => {
    vi.mocked(fetchEventReports).mockResolvedValue({
      ...emptyReport,
      summary: { ...emptyReport.summary, total_attendees: 2, admitted: 2, admission_rate_pct: 100 },
      by_hour: [
        { hour: "08:00", count: 0 },
        { hour: "09:00", count: 1 },
        { hour: "10:00", count: 0 },
        { hour: "11:00", count: 1 },
        { hour: "12:00", count: 0 },
      ],
    });
    const { container } = renderWithToast(
      <MemoryRouter initialEntries={["/admin/events/evt-1/reports"]}>
        <Routes>
          <Route path="/admin/events/:eventId/reports" element={<ReportsPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(container.querySelectorAll(".reports-chart__bar-wrap").length).toBeGreaterThan(0);
    });
    // Padded by one hour on each side of the first/last non-zero hour (08:00-12:00), not the
    // full 5-row range collapsed to just the two non-zero rows.
    expect(container.querySelectorAll(".reports-chart__bar-wrap")).toHaveLength(5);
  });

  it("pads a sparse dataset out to a minimum 9-hour window, not just ±1 hour (#383)", async () => {
    const fullDay = Array.from({ length: 24 }, (_, i) => ({
      hour: `${String(i).padStart(2, "0")}:00`,
      count: i === 10 || i === 12 ? 1 : 0,
    }));
    vi.mocked(fetchEventReports).mockResolvedValue({
      ...emptyReport,
      summary: { ...emptyReport.summary, total_attendees: 2, admitted: 2, admission_rate_pct: 100 },
      by_hour: fullDay,
    });
    const { container } = renderWithToast(
      <MemoryRouter initialEntries={["/admin/events/evt-1/reports"]}>
        <Routes>
          <Route path="/admin/events/:eventId/reports" element={<ReportsPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(container.querySelectorAll(".reports-chart__bar-wrap").length).toBeGreaterThan(0);
    });
    // A naive ±1-hour pad around 10:00/12:00 would render just 09:00-13:00 (5 columns) inside
    // the card's full width - real event data (the API always returns all 24 hours) pads out
    // symmetrically to the mockup's own 9-hour example window instead.
    const labels = Array.from(container.querySelectorAll(".reports-chart__label")).map((el) => el.textContent);
    expect(labels).toEqual(["07", "08", "09", "10", "11", "12", "13", "14", "15"]);
  });
});

describe("ReportsPage stat tiles", () => {
  it("renders all four KPI tiles with values and icon variants", async () => {
    vi.mocked(fetchEventReports).mockResolvedValue({
      ...emptyReport,
      summary: {
        total_attendees: 10,
        admitted: 7,
        no_shows: 3,
        admission_rate_pct: 70,
        peak_hour: "14:00",
        peak_hour_count: 4,
      },
    });
    const { container } = renderWithToast(
      <MemoryRouter initialEntries={["/admin/events/evt-1/reports"]}>
        <Routes>
          <Route path="/admin/events/:eventId/reports" element={<ReportsPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByText("Total attendees")).toBeTruthy();
    });
    // Scoped to each tile by its own label, not a bare getByText("10") - a bare number is
    // fragile against any future breakdown row that happens to render the same digits.
    function statValue(label: string): string | null | undefined {
      const labelEl = Array.from(container.querySelectorAll(".reports-stat__label")).find(
        (el) => el.textContent === label,
      );
      return labelEl?.closest(".reports-stat")?.querySelector(".reports-stat__value")?.textContent;
    }
    expect(statValue("Total attendees")).toBe("10");
    expect(statValue("Admitted")).toBe("7");
    expect(statValue("No-shows")).toBe("3");
    expect(statValue("Peak hour")).toBe("14:00");
    expect(container.querySelector(".reports-stat__icon--neutral")).toBeTruthy();
    expect(container.querySelector(".reports-stat__icon--ok")).toBeTruthy();
    expect(container.querySelector(".reports-stat__icon--warn")).toBeTruthy();
    expect(container.querySelector(".reports-stat__icon--info")).toBeTruthy();
  });

  it("shows the No-shows rate to one decimal place, matching Admitted's own precision", async () => {
    vi.mocked(fetchEventReports).mockResolvedValue({
      ...emptyReport,
      summary: {
        total_attendees: 3,
        admitted: 2,
        no_shows: 1,
        admission_rate_pct: 66.7,
        peak_hour: null,
        peak_hour_count: 0,
      },
    });
    renderWithToast(
      <MemoryRouter initialEntries={["/admin/events/evt-1/reports"]}>
        <Routes>
          <Route path="/admin/events/:eventId/reports" element={<ReportsPage />} />
        </Routes>
      </MemoryRouter>,
    );
    // Was Math.round(x * 100) here (whole percent only) - a cosmetic mismatch against the
    // Admitted tile's own 1-decimal rate right next to it.
    expect(await screen.findByText("33.3% of total")).toBeTruthy();
  });
});

describe("ReportsPage — Check-in details section", () => {
  it("zero-fills all 5 RSVP buckets, shows only the 2 real check-in methods, and ranks devices by admissions", async () => {
    vi.mocked(fetchEventReports).mockResolvedValue({
      ...emptyReport,
      summary: { ...emptyReport.summary, total_attendees: 3, admitted: 3, admission_rate_pct: 100 },
      by_rsvp_status: [
        { status: "confirmed", count: 2 },
        { status: "declined", count: 1 },
      ],
      by_checkin_method: [{ method: "scan", count: 3 }],
      by_device: [
        { device_id: "Tablet 1 — main entrance", count: 2 },
        { device_id: null, count: 1 },
      ],
    });
    renderWithToast(
      <MemoryRouter initialEntries={["/admin/events/evt-1/reports"]}>
        <Routes>
          <Route path="/admin/events/:eventId/reports" element={<ReportsPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByText("Attendance confirmation")).toBeTruthy();
    });
    // All 5 statuses render even though the API only returned 2 - the other 3 are zero-filled.
    expect(screen.getByText("Confirmed")).toBeTruthy();
    expect(screen.getByText("Declined")).toBeTruthy();
    expect(screen.getByText("Tentative")).toBeTruthy();
    expect(screen.getByText("Cancelled")).toBeTruthy();
    expect(screen.getByText("Registered")).toBeTruthy();

    expect(screen.getByText("QR scan")).toBeTruthy();
    expect(screen.getByText("Manual search")).toBeTruthy();

    expect(screen.getByText("By device")).toBeTruthy();
    expect(screen.getByText("Tablet 1 — main entrance")).toBeTruthy();
    expect(screen.getByText("(unlabeled device)")).toBeTruthy();
  });

  it("adds a fallback row for an rsvp_status outside the 5 known values, instead of silently dropping it (#587 review)", async () => {
    vi.mocked(fetchEventReports).mockResolvedValue({
      ...emptyReport,
      summary: { ...emptyReport.summary, total_attendees: 4, admitted: 4, admission_rate_pct: 100 },
      // rsvp_status is an unconstrained DB column - "invited" isn't one of the 5 statuses this
      // app's own write paths ever set, simulating a row written outside them (e.g. a script).
      by_rsvp_status: [
        { status: "confirmed", count: 3 },
        { status: "invited", count: 1 },
      ],
    });
    renderWithToast(
      <MemoryRouter initialEntries={["/admin/events/evt-1/reports"]}>
        <Routes>
          <Route path="/admin/events/:eventId/reports" element={<ReportsPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByText("Attendance confirmation")).toBeTruthy();
    });
    // Still zero-fills the 5 known buckets...
    expect(screen.getByText("Confirmed")).toBeTruthy();
    expect(screen.getByText("Declined")).toBeTruthy();
    // ...plus a fallback row for the unrecognized value, instead of that attendee just vanishing
    // from the card despite being counted in the "4" admitted total above.
    expect(screen.getByText("invited (not in catalog)")).toBeTruthy();
  });
});

describe("ReportsPage admission log", () => {
  it("paginates the admission log in both directions", async () => {
    const admissionLog = Array.from({ length: 51 }, (_, index) => ({
      attendee_id: `att-${index + 1}`,
      name: `Guest ${index + 1}`,
      email: `guest-${index + 1}@example.com`,
      ticket_type: null,
      admitted_at: "2026-06-01T10:00:00.000Z",
      device_id: null,
      items: [],
    }));
    vi.mocked(fetchEventReports).mockResolvedValue({
      ...emptyReport,
      summary: { ...emptyReport.summary, total_attendees: 51, admitted: 51, admission_rate_pct: 100 },
      admission_log: admissionLog,
      admission_log_total: admissionLog.length,
    });
    renderWithToast(
      <MemoryRouter initialEntries={["/admin/events/evt-1/reports"]}>
        <Routes>
          <Route path="/admin/events/:eventId/reports" element={<ReportsPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Guest 1")).toBeTruthy();
    expect(screen.getByText("Page 1 of 2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Guest 51")).toBeTruthy();
    expect(screen.queryByText("Guest 1")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(await screen.findByText("Guest 1")).toBeTruthy();
    expect(screen.queryByText("Guest 51")).toBeNull();
  });

  it("re-pages the admission log when rows-per-page changes, resetting to page 1", async () => {
    const admissionLog = Array.from({ length: 51 }, (_, index) => ({
      attendee_id: `att-${index + 1}`,
      name: `Guest ${index + 1}`,
      email: `guest-${index + 1}@example.com`,
      ticket_type: null,
      admitted_at: "2026-06-01T10:00:00.000Z",
      device_id: null,
      items: [],
    }));
    vi.mocked(fetchEventReports).mockResolvedValue({
      ...emptyReport,
      summary: { ...emptyReport.summary, total_attendees: 51, admitted: 51, admission_rate_pct: 100 },
      admission_log: admissionLog,
      admission_log_total: admissionLog.length,
    });
    renderWithToast(
      <MemoryRouter initialEntries={["/admin/events/evt-1/reports"]}>
        <Routes>
          <Route path="/admin/events/:eventId/reports" element={<ReportsPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Guest 1")).toBeTruthy();
    expect(screen.getByText("Page 1 of 2")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Guest 51")).toBeTruthy();

    const pageSizeSelect = screen.getByLabelText("Rows per page") as HTMLSelectElement;
    fireEvent.change(pageSizeSelect, { target: { value: "100" } });

    // All 51 rows fit on one page at size 100 - the pager disappears and page 1's rows return,
    // proving the page index reset instead of staying on the now out-of-range page 2.
    await waitFor(() => {
      expect(screen.getByText("Guest 1")).toBeTruthy();
      expect(screen.getByText("Guest 51")).toBeTruthy();
    });
    expect(screen.queryByText("Page 1 of 2")).toBeNull();
  });

  it("renders the admission log as cards instead of a table below the desktop breakpoint", async () => {
    mockMatchMedia(false);
    vi.mocked(fetchEventReports).mockResolvedValue({
      ...emptyReport,
      summary: { ...emptyReport.summary, total_attendees: 1, admitted: 1, admission_rate_pct: 100 },
      admission_log: [
        {
          attendee_id: "att-mobile",
          name: "Mobile Guest",
          email: "mobile-guest@example.com",
          ticket_type: null,
          admitted_at: "2026-06-01T10:00:00.000Z",
          device_id: "scanner-01",
          items: ["Badge"],
        },
      ],
      admission_log_total: 1,
    });
    const { container } = renderWithToast(
      <MemoryRouter initialEntries={["/admin/events/evt-1/reports"]}>
        <Routes>
          <Route path="/admin/events/:eventId/reports" element={<ReportsPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Mobile Guest")).toBeTruthy();
    });
    expect(container.querySelector(".reports-log-cards")).toBeTruthy();
    expect(container.querySelector(".reports-log-table")).toBeNull();
    const card = screen.getByText("Mobile Guest").closest("a");
    expect(card?.getAttribute("href")).toBe("/admin/events/evt-1/attendees/att-mobile");
  });

  it("renders joined issued item labels in the Items column, or a dash when none", async () => {
    vi.mocked(fetchEventReports).mockResolvedValue({
      ...emptyReport,
      summary: { ...emptyReport.summary, total_attendees: 2, admitted: 2, admission_rate_pct: 100 },
      admission_log: [
        {
          attendee_id: "att-with-items",
          name: "Has Items Guest",
          email: "has-items@example.com",
          ticket_type: null,
          admitted_at: "2026-06-01T10:00:00.000Z",
          device_id: null,
          items: ["Badge", "Gift bag"],
        },
        {
          attendee_id: "att-no-items",
          name: "No Items Guest",
          email: "no-items@example.com",
          ticket_type: null,
          admitted_at: "2026-06-01T10:05:00.000Z",
          device_id: null,
          items: [],
        },
      ],
      admission_log_total: 2,
    });
    renderWithToast(
      <MemoryRouter initialEntries={["/admin/events/evt-1/reports"]}>
        <Routes>
          <Route path="/admin/events/:eventId/reports" element={<ReportsPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByText("Has Items Guest")).toBeTruthy();
    });
    expect(screen.getByText("Badge, Gift bag")).toBeTruthy();
    const noItemsRow = screen.getByText("No Items Guest").closest("tr");
    if (!noItemsRow) throw new Error("admission log row not found");
    const itemsCell = noItemsRow.querySelectorAll("td")[4];
    if (!itemsCell) throw new Error("items cell not found");
    expect(itemsCell.textContent).toBe("—");
  });

  it("links the admission log's attendee name/email to that attendee's detail page", async () => {
    vi.mocked(fetchEventReports).mockResolvedValue({
      ...emptyReport,
      summary: { ...emptyReport.summary, total_attendees: 1, admitted: 1, admission_rate_pct: 100 },
      admission_log: [
        {
          attendee_id: "att-linked",
          name: "Linked Guest",
          email: "linked-guest@example.com",
          ticket_type: null,
          admitted_at: "2026-06-01T10:00:00.000Z",
          device_id: null,
          items: [],
        },
      ],
      admission_log_total: 1,
    });
    renderWithToast(
      <MemoryRouter initialEntries={["/admin/events/evt-1/reports"]}>
        <Routes>
          <Route path="/admin/events/:eventId/reports" element={<ReportsPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByText("Linked Guest")).toBeTruthy();
    });
    const link = screen.getByText("Linked Guest").closest("a");
    if (!link) throw new Error("attendee link not found");
    expect(link.getAttribute("href")).toBe("/admin/events/evt-1/attendees/att-linked");
    expect(screen.getByText("linked-guest@example.com").closest("a")).toBe(link);
  });

  it("labels an untyped admission as (none), matching the breakdown/filter instead of the Attendees table's dash", async () => {
    // mockResolvedValue (not ...Once): the mocked useConnectionState() below returns a fresh
    // object every render, so ReportsPage's load effect can legitimately fire more than once -
    // every call must see the same response, not just the first.
    vi.mocked(fetchEventReports).mockResolvedValue({
      ...emptyReport,
      summary: { ...emptyReport.summary, total_attendees: 1, admitted: 1, admission_rate_pct: 100 },
      by_ticket_type: [
        { key: null, type: "(none)", color: "gray", total: 1, admitted: 1, admission_pct: 100 },
      ],
      admission_log: [
        {
          attendee_id: "att-1",
          name: "Jan Kowalski",
          email: "jan@example.com",
          ticket_type: null,
          admitted_at: "2026-06-01T10:00:00.000Z",
          device_id: null,
          items: [],
        },
      ],
      admission_log_total: 1,
    });
    renderWithToast(
      <MemoryRouter initialEntries={["/admin/events/evt-1/reports"]}>
        <Routes>
          <Route path="/admin/events/:eventId/reports" element={<ReportsPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByText("Jan Kowalski")).toBeTruthy();
    });
    const row = screen.getByText("Jan Kowalski").closest("tr");
    if (!row) throw new Error("admission log row not found");
    // Second <td> is "Ticket type" (Attendee, Ticket type, Admitted at, Device, Items) - scoped
    // past the Device cell, which legitimately shows "-" for this row's own null device_id.
    const typeCell = row.querySelectorAll("td")[1];
    if (!typeCell) throw new Error("ticket-type cell not found");
    // The Attendees table's shared badge renders "-" for a null ticket_type - this cell must show
    // the same "(none)" label the breakdown/filter above it already use instead.
    expect(within(typeCell).getByText("(none)")).toBeTruthy();
    expect(within(typeCell).queryByText("—")).toBeNull();
  });

  it("does not conflate a genuinely untyped admission with one whose raw ticket_type is literally the filter's internal sentinel string (Codex review)", async () => {
    vi.mocked(fetchEventReports).mockResolvedValue({
      ...emptyReport,
      summary: { ...emptyReport.summary, total_attendees: 2, admitted: 2, admission_rate_pct: 100 },
      by_ticket_type: [
        { key: null, type: "(none)", color: "gray", total: 1, admitted: 1, admission_pct: 100 },
        {
          key: "__none__",
          type: "__none__ (not in catalog)",
          color: "gray",
          total: 1,
          admitted: 1,
          admission_pct: 100,
        },
      ],
      admission_log: [
        {
          attendee_id: "att-null",
          name: "Null Guest",
          email: "null-guest@example.com",
          ticket_type: null,
          admitted_at: "2026-06-01T10:00:00.000Z",
          device_id: null,
          items: [],
        },
        {
          attendee_id: "att-literal",
          name: "Literal Guest",
          email: "literal-guest@example.com",
          // Legacy/orphaned data seeded outside the app's normal write paths isn't constrained to
          // the slugified key format - it could coincidentally match the filter's own internal
          // sentinel string for "no type".
          ticket_type: "__none__",
          admitted_at: "2026-06-01T10:05:00.000Z",
          device_id: null,
          items: [],
        },
      ],
      admission_log_total: 2,
    });
    renderWithToast(
      <MemoryRouter initialEntries={["/admin/events/evt-1/reports"]}>
        <Routes>
          <Route path="/admin/events/:eventId/reports" element={<ReportsPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByText("Null Guest")).toBeTruthy();
    });
    expect(screen.getByText("Literal Guest")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
    const select = screen.getByLabelText("Filter by ticket type") as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    // The two buckets must not share a select option value.
    expect(new Set(options).size).toBe(options.length);

    fireEvent.change(select, { target: { value: "__none__" } });
    await waitFor(() => {
      expect(screen.getByText("Null Guest")).toBeTruthy();
    });
    expect(screen.queryByText("Literal Guest")).toBeNull();

    const literalOption = Array.from(select.options).find((o) => o.textContent === "__none__ (not in catalog)");
    if (!literalOption) throw new Error("option for the literal __none__ bucket not found");
    fireEvent.change(select, { target: { value: literalOption.value } });
    await waitFor(() => {
      expect(screen.getByText("Literal Guest")).toBeTruthy();
    });
    expect(screen.queryByText("Null Guest")).toBeNull();
  });

  it("filters the admission log by device, including a bucket for admissions with no device", async () => {
    vi.mocked(fetchEventReports).mockResolvedValueOnce({
      ...emptyReport,
      summary: { ...emptyReport.summary, total_attendees: 3, admitted: 3, admission_rate_pct: 100 },
      by_device: [
        { device_id: "scanner-01", count: 1 },
        { device_id: "desk-01", count: 1 },
        { device_id: null, count: 1 },
      ],
      admission_log: [
        {
          attendee_id: "att-scanner",
          name: "Scanner Guest",
          email: "scanner-guest@example.com",
          ticket_type: null,
          admitted_at: "2026-06-01T10:00:00.000Z",
          device_id: "scanner-01",
          items: [],
        },
        {
          attendee_id: "att-desk",
          name: "Desk Guest",
          email: "desk-guest@example.com",
          ticket_type: null,
          admitted_at: "2026-06-01T10:05:00.000Z",
          device_id: "desk-01",
          items: [],
        },
        {
          attendee_id: "att-no-device",
          name: "No Device Guest",
          email: "no-device-guest@example.com",
          ticket_type: null,
          admitted_at: "2026-06-01T10:10:00.000Z",
          device_id: null,
          items: [],
        },
      ],
    });
    renderWithToast(
      <MemoryRouter initialEntries={["/admin/events/evt-1/reports"]}>
        <Routes>
          <Route path="/admin/events/:eventId/reports" element={<ReportsPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText("Scanner Guest")).toBeTruthy();
    expect(screen.getByText("Desk Guest")).toBeTruthy();
    expect(screen.getByText("No Device Guest")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
    const deviceSelect = screen.getByLabelText("Filter by device") as HTMLSelectElement;
    const optionLabels = Array.from(deviceSelect.options).map((o) => o.textContent);
    expect(optionLabels).toEqual(["All devices", "scanner-01", "desk-01", "(unlabeled device)"]);

    fireEvent.change(deviceSelect, { target: { value: "device:desk-01" } });
    await waitFor(() => {
      expect(screen.queryByText("Scanner Guest")).toBeNull();
    });
    expect(screen.getByText("Desk Guest")).toBeTruthy();
    expect(screen.queryByText("No Device Guest")).toBeNull();
    // The trigger button surfaces how many filters are active - scoped to the trigger itself,
    // not a bare getByText("1"), since the By device breakdown's own "1 · 33.3%" meta text could
    // otherwise make this ambiguous depending on the exact counts in play.
    expect(screen.getByRole("button", { name: /Filters/ }).textContent).toMatch(/1/);

    const noDeviceOption = Array.from(deviceSelect.options).find((o) => o.textContent === "(unlabeled device)");
    if (!noDeviceOption) throw new Error("'(unlabeled device)' option not found");
    fireEvent.change(deviceSelect, { target: { value: noDeviceOption.value } });
    await waitFor(() => {
      expect(screen.getByText("No Device Guest")).toBeTruthy();
    });
    expect(screen.queryByText("Scanner Guest")).toBeNull();
    expect(screen.queryByText("Desk Guest")).toBeNull();
  });
});

describe("ReportsPage — ticket type catalog cross-event staleness", () => {
  // createMemoryRouter + RouterProvider (not the plain <MemoryRouter> the rest of this file uses)
  // so router.navigate() can change the :eventId param in place, the same way a real in-app
  // navigation from one event's reports to another's does - matches
  // EventSettingsPage.test.tsx's equivalent staleness suite.
  function renderReportsRouter(entry: string) {
    return createMemoryRouter(
      [{ path: "/admin/events/:eventId/reports", element: <ReportsPage /> }],
      { initialEntries: [entry] },
    );
  }

  it("does not resolve a badge against the previous event's catalog while navigating to a new event (Codex review)", async () => {
    const reportFor = (eventId: string) => ({
      ...emptyReport,
      event: { ...emptyReport.event, id: eventId },
      summary: { ...emptyReport.summary, total_attendees: 1, admitted: 1, admission_rate_pct: 100 },
      admission_log: [
        {
          attendee_id: `att-${eventId}`,
          name: "Shared Key Guest",
          email: "guest@example.com",
          ticket_type: "vip",
          admitted_at: "2026-06-01T10:00:00.000Z",
          device_id: null,
          items: [],
        },
      ],
    });
    vi.mocked(fetchEventReports).mockImplementation(async (eventId: string) => reportFor(eventId));

    let resolveEventBTypes!: (types: unknown[]) => void;
    const eventBTypes = new Promise((resolve) => {
      resolveEventBTypes = resolve;
    });
    vi.mocked(fetchTicketTypes).mockImplementation((eventId: string) =>
      eventId === "evt-a"
        ? Promise.resolve([
            { id: "tt-a", key: "vip", label: "VIP (Event A)", color: "purple", sort_order: 0, attendee_count: 1, created_at: "2026-01-01T00:00:00.000Z" },
          ])
        : (eventBTypes as Promise<unknown[]>),
    );

    const router = renderReportsRouter("/admin/events/evt-a/reports");
    renderWithToast(<RouterProvider router={router} />);

    await waitFor(() => {
      expect(screen.getByText("VIP (Event A)")).toBeTruthy();
    });

    await router.navigate("/admin/events/evt-b/reports");

    // Both events render the same guest name, and the unstable mocked useConnectionState() below
    // can trigger more than one load/loading-skeleton cycle for event B - the row lookup and its
    // assertions are polled together as one unit, not split across a separate waitFor, so a
    // transiently-stale match from event A's still-mounted row can't slip through.
    await waitFor(() => {
      const row = screen.getByText("Shared Key Guest").closest("tr");
      if (!row) throw new Error("admission log row not found");
      const typeCell = row.querySelectorAll("td")[1];
      if (!typeCell) throw new Error("ticket-type cell not found");
      // Event A's label/color must not still resolve for the "vip" key on event B while event B's
      // own catalog fetch is still in flight - the badge should fall back to the raw key instead.
      expect(within(typeCell).queryByText("VIP (Event A)")).toBeNull();
      expect(within(typeCell).getByText("vip")).toBeTruthy();
    });

    resolveEventBTypes([
      { id: "tt-b", key: "vip", label: "VIP (Event B)", color: "blue", sort_order: 0, attendee_count: 1, created_at: "2026-01-01T00:00:00.000Z" },
    ]);
    await waitFor(() => {
      expect(screen.getByText("VIP (Event B)")).toBeTruthy();
    });
  });
});

describe("EventsPickerPage archived event navigation", () => {
  it("renders an active event card with the Active badge and no archived styling", async () => {
    const activeEvent = {
      id: "evt-active",
      title: "Spring Gala",
      slug: "spring-gala",
      date: "2026-06-01",
      timezone: "Europe/Warsaw",
      location: "Hall A",
      capacity: 100,
      archived_at: null as string | null,
    };
    vi.mocked(fetchAdminEvents).mockResolvedValue([activeEvent]);
    renderWithToast(
      <MemoryRouter initialEntries={["/admin"]}>
        <Routes>
          <Route path="/admin" element={<EventsPickerPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByText("Spring Gala")).toBeTruthy();
    });

    const link = screen.getByRole("link", { name: /Spring Gala/ });
    expect(screen.getByText("Active")).toBeTruthy();
    expect(link.querySelector(".event-card")?.classList.contains("event-card--archived")).toBe(
      false,
    );
  });

  it("lets a superadmin click into an archived event from the Archived events tab", async () => {
    vi.mocked(fetchAdminEvents).mockResolvedValue([archivedEvent]);
    renderWithToast(
      <MemoryRouter initialEntries={["/admin"]}>
        <Routes>
          <Route path="/admin" element={<EventsPickerPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /Archived events/ })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("tab", { name: /Archived events/ }));
    await waitFor(() => {
      expect(screen.getByText("Archived Summit")).toBeTruthy();
    });

    const link = screen.getByRole("link", { name: /Archived Summit/ });
    expect(link.getAttribute("href")).toBe("/admin/events/evt-arch/overview");
    // Card matches the active-event card style (same badge position, no separate
    // Unarchive button) — that action now lives on Event settings / Settings only.
    expect(screen.getByText("Archived")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Unarchive" })).toBeNull();
    // Grey (not green) left-border accent distinguishes archived from active cards.
    expect(link.querySelector(".event-card")?.classList.contains("event-card--archived")).toBe(
      true,
    );
  });

  it("shows an EmptyState on the Archived tab when there are active events but none archived", async () => {
    const activeEvent = {
      id: "evt-active",
      title: "Spring Gala",
      slug: "spring-gala",
      date: "2026-06-01",
      timezone: "Europe/Warsaw",
      location: "Hall A",
      capacity: 100,
      archived_at: null as string | null,
    };
    vi.mocked(fetchAdminEvents).mockResolvedValue([activeEvent]);
    renderWithToast(
      <MemoryRouter initialEntries={["/admin"]}>
        <Routes>
          <Route path="/admin" element={<EventsPickerPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /Archived events/ })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("tab", { name: /Archived events/ }));

    await waitFor(() => {
      expect(screen.getByText("No archived events")).toBeTruthy();
    });
    expect(screen.getByText("Events you archive will appear here.")).toBeTruthy();
  });

  it("shows an EmptyState with a link back to Archived when every event is archived (superadmin copy)", async () => {
    vi.mocked(fetchAdminEvents).mockResolvedValue([archivedEvent]);
    renderWithToast(
      <MemoryRouter initialEntries={["/admin"]}>
        <Routes>
          <Route path="/admin" element={<EventsPickerPage />} />
        </Routes>
      </MemoryRouter>,
    );

    // The page auto-switches to Archived once data loads (every event is archived) — wait
    // for that to actually happen before clicking Active, otherwise the click can land
    // while "Active" is still the untouched default tab and no-ops.
    await waitFor(() => {
      expect(screen.getByText("Archived Summit")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("tab", { name: /Active events/ }));

    await waitFor(() => {
      expect(screen.getByText("No active events")).toBeTruthy();
    });
    expect(
      screen.getByText("All events are archived. Open the Archived events tab to unarchive one."),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "View archived events" }));
    await waitFor(() => {
      expect(screen.getByText("Archived Summit")).toBeTruthy();
    });
  });
});

describe("ImportPage operator errors", () => {
  it("toasts preview failure without leaking internals", async () => {
    vi.mocked(fetchEventItems).mockResolvedValue([]);
    vi.mocked(previewImport).mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderWithToast(
      <MemoryRouter initialEntries={["/admin/events/evt-1/import"]}>
        <Routes>
          <Route path="/admin/events/:eventId/import" element={<ImportPage />} />
        </Routes>
      </MemoryRouter>,
    );
    const file = new File(["email,name\ntest@example.com,Test"], "attendees.csv", { type: "text/csv" });
    await waitFor(() => {
      expect(screen.getByLabelText(/File \(\.csv or \.xlsx\)/)).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText(/File \(\.csv or \.xlsx\)/), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Validate file" }));
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Request failed/);
    });
    expect(screen.queryByText("secret_internal")).toBeNull();
  });
});

describe("DeviceLabelStep operator errors", () => {
  it("shows save failure", async () => {
    vi.mocked(submitSessionDeviceLabel).mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderWithToast(<DeviceLabelStep onSaved={vi.fn()} onSkip={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Device label"), { target: { value: "Gate A" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/Could not save device label/);
    });
  });
});
