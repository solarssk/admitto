// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ToastProvider } from "@admitto/ui";
import { CheckInPage } from "../../src/pages/CheckInPage.js";

vi.mock("../../src/checkin/CameraScanner.js", () => ({
  CameraScanner: () => <div data-testid="camera-scanner" />,
}));

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
  useAuth: () => ({ deviceLabel: "desk-1", assignments: [] }),
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

function mockPageBootstrap(overrides: { allow_manual_lookup?: boolean } = {}) {
  fetchCheckInOpsConfig.mockResolvedValue({
    require_confirm_on_scan: false,
    badge_at_entry: true,
    allow_manual_lookup: true,
    auto_advance_on_valid: true,
    ...overrides,
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

async function scanInput(): Promise<HTMLInputElement> {
  await waitFor(() => {
    expect(screen.getByLabelText("QR scan or search")).toBeTruthy();
  });
  return screen.getByLabelText("QR scan or search") as HTMLInputElement;
}

const annaHit = {
  id: "att-1",
  name: "Anna Alpha",
  ticket_type: "vip",
  company: "Acme",
  department: null,
  check_in_status: "not_admitted" as const,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CheckInPage scan-bar lookup", () => {
  it("Enter with multiple matches shows them as scan-bar suggestions", async () => {
    mockPageBootstrap();
    lookupCheckInAttendees.mockResolvedValue([
      annaHit,
      { ...annaHit, id: "att-2", name: "Anna Beta" },
    ]);

    renderPage();
    const input = await scanInput();
    fireEvent.change(input, { target: { value: "an" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByText("Anna Alpha")).toBeTruthy();
      expect(screen.getByText("Anna Beta")).toBeTruthy();
    });
    expect(addToast).not.toHaveBeenCalled();
  });

  it("cancels a pending suggestion request on unmount", async () => {
    mockPageBootstrap();
    lookupCheckInAttendees.mockResolvedValue([annaHit]);

    const { unmount } = renderPage();
    const input = await scanInput();
    fireEvent.change(input, { target: { value: "anna" } });
    unmount();

    // Past the 300ms debounce — if the timer weren't cleared, this would fire.
    await new Promise((r) => setTimeout(r, 400));
    expect(lookupCheckInAttendees).not.toHaveBeenCalled();
  });

  it("shows a warning toast when Enter finds no attendees", async () => {
    mockPageBootstrap();
    lookupCheckInAttendees.mockResolvedValue([]);

    renderPage();
    const input = await scanInput();
    fireEvent.change(input, { target: { value: "filip" } });
    fireEvent.keyDown(input, { key: "Enter" });

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
    const input = await scanInput();
    fireEvent.change(input, { target: { value: "filip" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByText(/Manual lookup is disabled for this event/)).toBeTruthy();
    });
    expect(screen.queryByText(/do not have access/i)).toBeNull();
  });

  it("suppresses lookup entirely when ops config disables it", async () => {
    mockPageBootstrap({ allow_manual_lookup: false });

    renderPage();
    const input = await scanInput();
    fireEvent.change(input, { target: { value: "filip" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByText(/Manual lookup is disabled for this event/)).toBeTruthy();
    });
    expect(lookupCheckInAttendees).not.toHaveBeenCalled();
  });

  it("shows debounced suggestions under the scan bar while typing", async () => {
    mockPageBootstrap();
    lookupCheckInAttendees.mockResolvedValue([
      annaHit,
      { ...annaHit, id: "att-2", name: "Anna Beta", check_in_status: "admitted" as const },
    ]);

    renderPage();
    const input = await scanInput();
    fireEvent.change(input, { target: { value: "anna" } });

    // Debounce (300ms) then the dropdown renders both hits.
    await waitFor(() => {
      expect(screen.getByText("Anna Alpha")).toBeTruthy();
      expect(screen.getByText("Anna Beta")).toBeTruthy();
    });
    expect(lookupCheckInAttendees).toHaveBeenCalledWith("evt-live", "anna");
    // Already-admitted hit is flagged in the dropdown.
    expect(screen.getByText(/checked in/)).toBeTruthy();
  });

  it("does not fetch suggestions for token-length input", async () => {
    mockPageBootstrap();

    renderPage();
    const input = await scanInput();
    fireEvent.change(input, { target: { value: "tok_1234567890abcdefghij" } });

    await new Promise((r) => setTimeout(r, 400));
    expect(lookupCheckInAttendees).not.toHaveBeenCalled();
  });

  it("marks the scan input with password-manager ignore hints", async () => {
    mockPageBootstrap();
    renderPage();

    const input = await scanInput();
    expect(input.getAttribute("data-bwignore")).not.toBeNull();
    expect(input.getAttribute("data-lpignore")).toBe("true");
    expect(input.getAttribute("name")).toBe("checkin-scan");
  });
});

describe("CheckInPage lookup card states (#379)", () => {
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

  async function typeAndPickSuggestion(): Promise<HTMLInputElement> {
    renderPage();
    const input = await scanInput();
    fireEvent.change(input, { target: { value: "anna" } });
    await waitFor(() => {
      expect(screen.getByText("Anna Alpha")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("Anna Alpha"));
    return input;
  }

  it("admitted attendee opens as Already checked in without a Confirm button and clears the bar", async () => {
    mockPageBootstrap();
    lookupCheckInAttendees.mockResolvedValue([{ ...annaHit, check_in_status: "admitted" as const }]);
    fetchAttendeeCard.mockResolvedValue({
      ...baseCard,
      check_in_status: "admitted",
      admitted_at: "2026-09-01T09:44:00.000Z",
    });

    const input = await typeAndPickSuggestion();

    await waitFor(() => {
      expect(screen.getByText("Already checked in")).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: "Confirm check-in" })).toBeNull();
    expect(screen.queryByText("Ready to check in")).toBeNull();
    // #379B: selecting a suggestion clears the scan bar and the dropdown.
    expect(input.value).toBe("");
    expect(screen.queryByText(/Acme · vip/)).toBeNull();
    // No dismiss button existed for this state before — Clear resets the view.
    expect(screen.getByRole("button", { name: "Clear" })).toBeTruthy();
    // Operators (default mock: no admin assignment) don't get the
    // admin/superadmin-only revoke action.
    expect(screen.queryByRole("button", { name: "Revoke check-in" })).toBeNull();
  });

  it("revoked attendee opens as revoked with item actions disabled", async () => {
    mockPageBootstrap();
    lookupCheckInAttendees.mockResolvedValue([annaHit]);
    fetchAttendeeCard.mockResolvedValue({
      ...baseCard,
      warnings: ["Ticket is not admittable (status: revoked)."],
      items: [
        { key: "badge", label: "Badge", icon: null, detail: null, state: "pending", actions: ["issued"] },
      ],
    });

    await typeAndPickSuggestion();

    await waitFor(() => {
      expect(screen.getByText(/Ticket is not admittable/)).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: "Confirm check-in" })).toBeNull();
    const itemAction = screen.getByRole("button", { name: "Issue badge" }) as HTMLButtonElement;
    expect(itemAction.disabled).toBe(true);
    // A revoked card has no Confirm/Cancel — Clear is the only way to dismiss it.
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.queryByText(/Ticket is not admittable/)).toBeNull();
  });

  it("not-admitted attendee opens as preview with Confirm available (Enter, single match)", async () => {
    mockPageBootstrap();
    lookupCheckInAttendees.mockResolvedValue([annaHit]);
    fetchAttendeeCard.mockResolvedValue(baseCard);

    renderPage();
    const input = await scanInput();
    fireEvent.change(input, { target: { value: "anna" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByText("Ready to check in")).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: "Confirm check-in" })).toBeTruthy();
    // PREVIEW already has a block-width Clear button — no duplicate footer Clear.
    const clearButtons = screen.getAllByRole("button", { name: "Clear" });
    expect(clearButtons).toHaveLength(1);
  });
});

describe("CheckInPage operator desktop camera toggle (#381)", () => {
  it("flips between Use camera and Disable camera and stays mounted", async () => {
    mockPageBootstrap();
    renderPage();
    await scanInput();

    const useCamera = screen.getByRole("button", { name: "Use camera" });
    fireEvent.click(useCamera);

    expect(screen.getByTestId("camera-scanner")).toBeTruthy();
    const disable = screen.getByRole("button", { name: "Disable camera" });

    fireEvent.click(disable);
    expect(screen.queryByTestId("camera-scanner")).toBeNull();
    expect(screen.getByRole("button", { name: "Use camera" })).toBeTruthy();
  });

  it("clears a stale scan result when the camera is toggled off from the header", async () => {
    mockPageBootstrap();
    lookupCheckInAttendees.mockResolvedValue([annaHit]);
    fetchAttendeeCard.mockResolvedValue({
      id: "att-1",
      name: "Anna Alpha",
      company: null,
      department: null,
      ticket_type: "vip",
      check_in_status: "not_admitted" as const,
      admitted_at: null,
      items: [],
      notes: [],
      warnings: [],
    });

    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Use camera" }));

    const input = await scanInput();
    fireEvent.change(input, { target: { value: "anna" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      expect(screen.getByText("Ready to check in")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Disable camera" }));
    expect(screen.queryByText("Ready to check in")).toBeNull();

    // Reopening the camera doesn't resurrect the old card.
    fireEvent.click(screen.getByRole("button", { name: "Use camera" }));
    expect(screen.queryByText("Ready to check in")).toBeNull();
  });
});
