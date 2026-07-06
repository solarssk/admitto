// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ApiError } from "../../src/api/client.js";
import { EventSettingsPage } from "../../src/pages/EventSettingsPage.js";
import { UsersPage } from "../../src/pages/UsersPage.js";
import { RoleAssignmentsTab } from "../../src/pages/users/RoleAssignmentsTab.js";
import { RequirementsPage } from "../../src/pages/RequirementsPage.js";
import { ReportsPage } from "../../src/pages/ReportsPage.js";
import { EventsPickerPage } from "../../src/pages/EventsPickerPage.js";
import { ImportPage } from "../../src/pages/ImportPage.js";
import { DeviceLabelStep } from "../../src/pages/DeviceLabelStep.js";
import { renderWithToast } from "../test-utils.js";

const superadminAssignments = [
  { role: "superadmin", scope_type: "instance", scope_id: null },
];

vi.mock("../../src/auth/AuthProvider.js", () => ({
  useAuth: () => ({ assignments: superadminAssignments }),
}));

vi.mock("../../src/connection/ConnectionStateProvider.js", () => ({
  useConnectionState: () => ({ reportApiError: vi.fn() }),
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    useBlocker: () => ({ state: "unblocked", proceed: vi.fn(), reset: vi.fn() }),
  };
});

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    fetchEventSettings: vi.fn(),
    patchEvent: vi.fn(),
    archiveEvent: vi.fn(),
    unarchiveEvent: vi.fn(),
    exportEventPii: vi.fn(),
    fetchAdminUsers: vi.fn(),
    fetchRoleAssignments: vi.fn(),
    revokeUserSessions: vi.fn(),
    fetchEventItems: vi.fn(),
    fetchOpsConfig: vi.fn(),
    createEventItem: vi.fn(),
    updateEventItem: vi.fn(),
    updateOpsConfig: vi.fn(),
    fetchEventReports: vi.fn(),
    exportEventReportsCsv: vi.fn(),
    fetchAdminEvents: vi.fn(),
    previewImport: vi.fn(),
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
  fetchEventItems,
  fetchEventReports,
  fetchEventSettings,
  fetchOpsConfig,
  fetchRoleAssignments,
  previewImport,
  revokeUserSessions,
  patchEvent,
  submitSessionDeviceLabel,
  unarchiveEvent,
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
  organization_name: "Org",
  active_items: [] as Array<{ id: string; name: string; enabled: boolean }>,
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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
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
      expect(screen.getByRole("button", { name: "Export PII" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Export PII" }));
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Export failed/);
    });
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
    vi.mocked(fetchOpsConfig).mockResolvedValue(opsConfig);
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
});

describe("ReportsPage operator errors", () => {
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
      expect(screen.getByRole("button", { name: "Export CSV" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Request failed/);
    });
    expect(screen.queryByText("secret_internal")).toBeNull();
  });
});

describe("EventsPickerPage operator errors", () => {
  it("shows unarchive failure in dialog", async () => {
    vi.mocked(fetchAdminEvents).mockResolvedValue([archivedEvent]);
    vi.mocked(unarchiveEvent).mockRejectedValueOnce(new ApiError(500, "secret_internal"));
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
      expect(screen.getByRole("button", { name: "Unarchive" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Unarchive" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Unarchive" }));
    await waitFor(() => {
      expect(within(dialog).getByText(/Failed to unarchive event/)).toBeTruthy();
    });
    expect(screen.queryByText("secret_internal")).toBeNull();
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
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
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
