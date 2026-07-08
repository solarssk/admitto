// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ToastProvider } from "@admitto/ui";
import { CheckInPage } from "../../src/pages/CheckInPage.js";

const fetchCheckInHistory = vi.fn();
const fetchCheckInStats = vi.fn();
const fetchCheckInOpsConfig = vi.fn();
const fetchCheckInEvents = vi.fn();
const fetchAttendeeCard = vi.fn();
const lookupCheckInAttendees = vi.fn();
const addToast = vi.fn();

vi.mock("../../src/hooks/useEventStream.js", () => ({
  useEventStream: () => ({ connected: true, status: "connected" }),
}));

vi.mock("../../src/auth/AuthProvider.js", () => ({
  useAuth: () => ({ deviceLabel: "desk-1" }),
}));

vi.mock("../../src/connection/ConnectionStateProvider.js", () => ({
  useConnectionState: () => ({ state: "connected", reportApiError: vi.fn() }),
}));

vi.mock("../../src/hooks/useIsDesktop.js", () => ({
  useIsDesktop: () => true,
  isDesktopViewport: () => true,
}));

vi.mock("@admitto/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@admitto/ui")>();
  return {
    ...actual,
    useToast: () => ({ addToast }),
  };
});

vi.mock("../../src/api/client.js", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    code?: string;
    constructor(status: number, message: string, code?: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
  fetchCheckInHistory: (...args: unknown[]) => fetchCheckInHistory(...args),
  fetchCheckInStats: (...args: unknown[]) => fetchCheckInStats(...args),
  fetchCheckInOpsConfig: (...args: unknown[]) => fetchCheckInOpsConfig(...args),
  fetchCheckInEvents: (...args: unknown[]) => fetchCheckInEvents(...args),
  fetchAttendeeCard: (...args: unknown[]) => fetchAttendeeCard(...args),
  lookupCheckInAttendees: (...args: unknown[]) => lookupCheckInAttendees(...args),
  submitAttendeeNote: vi.fn(),
  submitCheckInAdmit: vi.fn(),
  submitCheckInScan: vi.fn(),
  submitItemAction: vi.fn(),
  undoLastCheckIn: vi.fn(),
}));

function mockPageBootstrap() {
  fetchCheckInOpsConfig.mockResolvedValue({
    require_confirm_on_scan: false,
    badge_at_entry: true,
    allow_manual_lookup: true,
    auto_advance_on_valid: true,
  });
  fetchCheckInEvents.mockResolvedValue([{ id: "evt-live", timezone: "UTC" }]);
  fetchCheckInHistory.mockResolvedValue([]);
  fetchCheckInStats.mockResolvedValue({ admitted_count: 0, total_count: 1 });
}

function renderPage() {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={["/admin/events/evt-live/checkin"]}>
        <Routes>
          <Route path="/admin/events/:eventId/checkin" element={<CheckInPage />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CheckInPage lookup feedback", () => {
  it("shows a warning toast when manual lookup finds no attendees", async () => {
    mockPageBootstrap();
    lookupCheckInAttendees.mockResolvedValue([]);

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Manual lookup" })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Manual lookup" }));

    const lookupPanel = screen.getByRole("searchbox", {
      name: "Search attendees by name, email, or company",
    }).closest(".checkin-lookup");
    expect(lookupPanel).toBeTruthy();

    const lookupInput = within(lookupPanel as HTMLElement).getByRole("searchbox", {
      name: "Search attendees by name, email, or company",
    });
    fireEvent.change(lookupInput, { target: { value: "filip" } });
    fireEvent.click(within(lookupPanel as HTMLElement).getByRole("button", { name: "Search" }));

    await waitFor(() => {
      expect(lookupCheckInAttendees).toHaveBeenCalledWith("evt-live", "filip");
      expect(addToast).toHaveBeenCalledWith("No attendees matched that search.", "warning");
    });
  });

  it("shows lookup-disabled copy when manual lookup was turned off server-side", async () => {
    mockPageBootstrap();
    const { ApiError } = await import("../../src/api/client.js");
    lookupCheckInAttendees.mockRejectedValueOnce(
      new ApiError(403, "manual_lookup_disabled", "manual_lookup_disabled"),
    );

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Manual lookup" })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Manual lookup" }));

    const lookupPanel = screen.getByRole("searchbox", {
      name: "Search attendees by name, email, or company",
    }).closest(".checkin-lookup");
    expect(lookupPanel).toBeTruthy();

    const lookupInput = within(lookupPanel as HTMLElement).getByRole("searchbox", {
      name: "Search attendees by name, email, or company",
    });
    fireEvent.change(lookupInput, { target: { value: "filip" } });
    fireEvent.click(within(lookupPanel as HTMLElement).getByRole("button", { name: "Search" }));

    await waitFor(() => {
      expect(screen.getByText(/Manual lookup is disabled for this event/)).toBeTruthy();
    });
    expect(screen.queryByText(/do not have access/i)).toBeNull();
  });

  it("marks scan and lookup inputs with password-manager ignore hints", async () => {
    mockPageBootstrap();
    renderPage();

    await waitFor(() => {
      expect(screen.getByLabelText("QR scan or search")).toBeTruthy();
    });

    const scanInput = screen.getByLabelText("QR scan or search");
    expect(scanInput.getAttribute("data-bwignore")).not.toBeNull();
    expect(scanInput.getAttribute("data-lpignore")).toBe("true");
    expect(scanInput.getAttribute("name")).toBe("checkin-scan");

    fireEvent.click(screen.getByRole("button", { name: "Manual lookup" }));

    const lookupInput = screen.getByRole("searchbox", {
      name: "Search attendees by name, email, or company",
    });
    expect(lookupInput.getAttribute("data-bwignore")).not.toBeNull();
    expect(lookupInput.getAttribute("name")).toBe("checkin-lookup");
  });
});

describe("CheckInPage lookup card states (#379)", () => {
  async function searchAndSelect(name: string) {
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Manual lookup" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Manual lookup" }));
    const lookupInput = screen.getByRole("searchbox", {
      name: "Search attendees by name, email, or company",
    });
    const lookupPanel = lookupInput.closest(".checkin-lookup") as HTMLElement;
    fireEvent.change(lookupInput, { target: { value: "anna" } });
    fireEvent.click(within(lookupPanel).getByRole("button", { name: "Search" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: new RegExp(name) })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: new RegExp(name) }));
  }

  const baseCard = {
    id: "att-1",
    name: "Anna Alpha",
    company: null,
    department: null,
    ticket_type: "vip",
    check_in_status: "not_admitted" as const,
    admitted_at: null,
    items: [],
    notes: [],
    warnings: [] as string[],
  };

  it("admitted attendee opens as Already checked in without a Confirm button", async () => {
    mockPageBootstrap();
    lookupCheckInAttendees.mockResolvedValue([
      { id: "att-1", name: "Anna Alpha", ticket_type: "vip", company: null, department: null, check_in_status: "admitted" },
    ]);
    fetchAttendeeCard.mockResolvedValue({
      ...baseCard,
      check_in_status: "admitted",
      admitted_at: "2026-09-01T09:44:00.000Z",
    });

    await searchAndSelect("Anna Alpha");

    await waitFor(() => {
      expect(screen.getByText("Already checked in")).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: "Confirm check-in" })).toBeNull();
    expect(screen.queryByText("Ready to check in")).toBeNull();

    // #379B: query and results cleared — reopening the panel shows a fresh search.
    fireEvent.click(screen.getByRole("button", { name: "Manual lookup" }));
    const reopened = screen.getByRole("searchbox", {
      name: "Search attendees by name, email, or company",
    }) as HTMLInputElement;
    expect(reopened.value).toBe("");
    expect(screen.queryByRole("button", { name: /Anna Alpha/ })).toBeNull();
  });

  it("revoked attendee opens as revoked with item actions disabled", async () => {
    mockPageBootstrap();
    lookupCheckInAttendees.mockResolvedValue([
      { id: "att-1", name: "Anna Alpha", ticket_type: "vip", company: null, department: null, check_in_status: "not_admitted" },
    ]);
    fetchAttendeeCard.mockResolvedValue({
      ...baseCard,
      warnings: ["Ticket is not admittable (status: revoked)."],
      items: [
        { key: "badge", label: "Badge", icon: null, detail: null, state: "pending", actions: ["issued"] },
      ],
    });

    await searchAndSelect("Anna Alpha");

    await waitFor(() => {
      expect(screen.getByText(/Ticket is not admittable/)).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: "Confirm check-in" })).toBeNull();
    const itemAction = screen.getByRole("button", { name: "Issue badge" }) as HTMLButtonElement;
    expect(itemAction.disabled).toBe(true);
  });

  it("not-admitted attendee still opens as preview with Confirm available", async () => {
    mockPageBootstrap();
    lookupCheckInAttendees.mockResolvedValue([
      { id: "att-1", name: "Anna Alpha", ticket_type: "vip", company: null, department: null, check_in_status: "not_admitted" },
    ]);
    fetchAttendeeCard.mockResolvedValue(baseCard);

    await searchAndSelect("Anna Alpha");

    await waitFor(() => {
      expect(screen.getByText("Ready to check in")).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: "Confirm check-in" })).toBeTruthy();
  });
});
