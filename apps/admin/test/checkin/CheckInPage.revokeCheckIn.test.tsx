// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
const revokeAttendeeCheckIn = vi.fn();

vi.mock("../../src/hooks/useEventStream.js", () => ({
  useEventStream: () => ({ connected: true, status: "connected" }),
}));

// Admin (org-scoped), not superadmin and not operator — matches isAdmin()'s
// broader check, distinct from operator-only assignments used elsewhere.
vi.mock("../../src/auth/AuthProvider.js", () => ({
  useAuth: () => ({
    deviceLabel: "desk-1",
    assignments: [{ role: "admin", scope_type: "organization", scope_id: "org-1" }],
  }),
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
  return { ...actual, useToast: () => ({ addToast: vi.fn() }) };
});

vi.mock("../../src/api/client.js", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  fetchCheckInHistory: (...args: unknown[]) => fetchCheckInHistory(...args),
  fetchCheckInStats: (...args: unknown[]) => fetchCheckInStats(...args),
  fetchCheckInOpsConfig: (...args: unknown[]) => fetchCheckInOpsConfig(...args),
  fetchCheckInEvents: (...args: unknown[]) => fetchCheckInEvents(...args),
  fetchAttendeeCard: (...args: unknown[]) => fetchAttendeeCard(...args),
  lookupCheckInAttendees: (...args: unknown[]) => lookupCheckInAttendees(...args),
  revokeAttendeeCheckIn: (...args: unknown[]) => revokeAttendeeCheckIn(...args),
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

const annaHit = {
  id: "att-1",
  name: "Anna Alpha",
  ticket_type: "vip",
  company: "Acme",
  department: null,
  check_in_status: "admitted" as const,
};

const admittedCard = {
  id: "att-1",
  name: "Anna Alpha",
  company: null,
  department: null,
  ticket_type: "vip",
  check_in_status: "admitted" as const,
  admitted_at: "2026-09-01T09:44:00.000Z",
  items: [],
  notes: [],
  warnings: [] as string[],
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CheckInPage — admin Revoke check-in (#379/#380/#381 follow-up)", () => {
  async function openAlreadyCheckedInCard() {
    mockPageBootstrap();
    lookupCheckInAttendees.mockResolvedValue([annaHit]);
    fetchAttendeeCard.mockResolvedValue(admittedCard);

    renderPage();
    await waitFor(() => {
      expect(screen.getByLabelText("QR scan or search")).toBeTruthy();
    });
    const input = screen.getByLabelText("QR scan or search") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "anna" } });
    await waitFor(() => {
      expect(screen.getByText("Anna Alpha")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("Anna Alpha"));
    await waitFor(() => {
      expect(screen.getByText("Already checked in")).toBeTruthy();
    });
  }

  it("shows Revoke check-in for an admin on an already-admitted card", async () => {
    await openAlreadyCheckedInCard();
    expect(screen.getByRole("button", { name: "Revoke check-in" })).toBeTruthy();
  });

  it("asks for confirmation, then revokes and updates the card", async () => {
    await openAlreadyCheckedInCard();
    revokeAttendeeCheckIn.mockResolvedValue({
      card: { ...admittedCard, check_in_status: "not_admitted", admitted_at: null },
    });

    fireEvent.click(screen.getByRole("button", { name: "Revoke check-in" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Revoke check-in?")).toBeTruthy();
    expect(revokeAttendeeCheckIn).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke check-in" }));
    await waitFor(() => {
      expect(revokeAttendeeCheckIn).toHaveBeenCalledWith("evt-live", "att-1");
    });
    await waitFor(() => {
      expect(screen.queryByText("Already checked in")).toBeNull();
    });
  });

  it("shows an inline error and keeps the dialog open on failure", async () => {
    await openAlreadyCheckedInCard();
    revokeAttendeeCheckIn.mockRejectedValue(new Error("boom"));

    fireEvent.click(screen.getByRole("button", { name: "Revoke check-in" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke check-in" }));

    await waitFor(() => {
      expect(within(dialog).getByText("Failed to revoke check-in. Try again.")).toBeTruthy();
    });
    // Dialog stays open — the guest is still shown as admitted.
    expect(screen.getByText("Already checked in")).toBeTruthy();
  });

  it("cancelling the dialog does not call the API", async () => {
    await openAlreadyCheckedInCard();
    fireEvent.click(screen.getByRole("button", { name: "Revoke check-in" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Revoke check-in?")).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(revokeAttendeeCheckIn).not.toHaveBeenCalled();
  });
});
