// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RouterProvider } from "react-router/dom";
import { createMemoryRouter, MemoryRouter, Route, Routes } from "react-router";
import { AttendeeDetailPage } from "../../src/pages/AttendeeDetailPage.js";
import { ApiError } from "../../src/api/client.js";
import { mockMatchMedia, renderWithToast } from "../test-utils.js";

const loadAttendeeDetailData = vi.fn();
const fetchTicketLink = vi.fn();

vi.mock("../../src/attendees/attendeeDetailForm.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/attendees/attendeeDetailForm.js")>();
  return {
    ...actual,
    loadAttendeeDetailData: (...args: unknown[]) => loadAttendeeDetailData(...args),
  };
});

vi.mock("../../src/auth/AuthProvider.js", () => ({
  useAuth: () => ({ assignments: [{ role: "admin", scope_type: "organization", scope_id: "org-1" }] }),
}));

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    useOutletContext: () => ({
      event: {
        id: "evt-1",
        title: "Demo",
        slug: "demo",
        date: "2026-06-01",
        timezone: "Europe/Warsaw",
        location: null,
        attendee_count: 1,
        archived_at: null,
      },
    }),
  };
});

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    resendTicket: vi.fn(),
    fetchAttendeeDetail: vi.fn(),
    fetchTicketLink: (...args: unknown[]) => fetchTicketLink(...args),
  };
});

function baseDetail(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "att-1",
    name: "Anna",
    email: "anna@example.com",
    company: null,
    department: null,
    ticket_type: "vip",
    custom_data: {},
    status: "registered" as const,
    admitted_at: "2026-06-01T09:44:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    check_in_status: "admitted" as const,
    last_mail_status: null,
    rsvp_status: "confirmed" as const,
    rsvp_updated_at: null,
    rsvp_source: null,
    deliveries: [],
    action_log: [],
    event_items: [],
    ...overrides,
  };
}

function mockLoad(detail: ReturnType<typeof baseDetail>) {
  loadAttendeeDetailData.mockResolvedValueOnce({ detail, attributeFields: [], itemsWarning: null });
}

function renderPage() {
  renderWithToast(
    <MemoryRouter initialEntries={["/admin/events/evt-1/attendees/att-1"]}>
      <Routes>
        <Route path="/admin/events/:eventId/attendees/:attendeeId" element={<AttendeeDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockMatchMedia(true);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("AttendeeDetailPage — Copy ticket link", () => {
  it("fetches the ticket URL and copies it to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    fetchTicketLink.mockResolvedValueOnce({ url: "https://tickets.example.com/t/abc123" });
    mockLoad(baseDetail());
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Copy ticket link/ }));

    await waitFor(() => {
      expect(fetchTicketLink).toHaveBeenCalledWith("evt-1", "att-1");
      expect(writeText).toHaveBeenCalledWith("https://tickets.example.com/t/abc123");
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Ticket link copied to clipboard/);
    });
  });

  it("toasts the mapped error when the ticket hasn't been issued yet", async () => {
    fetchTicketLink.mockRejectedValueOnce(new ApiError(422, "ticket_not_issued", "ticket_not_issued"));
    mockLoad(baseDetail());
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Copy ticket link/ }));

    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/hasn.t been sent yet/);
    });
  });

  it("ignores a stale ticket-link success after navigating to a different attendee mid-request", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    let resolveFetch!: (value: { url: string }) => void;
    fetchTicketLink.mockReturnValueOnce(
      new Promise<{ url: string }>((resolve) => {
        resolveFetch = resolve;
      }),
    );
    mockLoad(baseDetail());
    mockLoad(baseDetail({ id: "att-2", name: "Bob Beta" }));

    const router = createMemoryRouter(
      [{ path: "/admin/events/:eventId/attendees/:attendeeId", element: <AttendeeDetailPage /> }],
      { initialEntries: ["/admin/events/evt-1/attendees/att-1"] },
    );
    renderWithToast(<RouterProvider router={router} />);
    await screen.findByRole("heading", { name: "Anna" });

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Copy ticket link/ }));

    // Navigate to a different attendee while the fetch is still in flight - the resolution
    // below must not copy Anna's link into the clipboard on Bob's behalf.
    await act(async () => router.navigate("/admin/events/evt-1/attendees/att-2"));
    await screen.findByRole("heading", { name: "Bob Beta" });

    await act(async () => {
      resolveFetch({ url: "https://tickets.example.com/t/anna123" });
      await Promise.resolve();
    });

    expect(writeText).not.toHaveBeenCalled();
    expect(screen.queryByTestId("at-toast")).toBeNull();
  });

  it("ignores a stale ticket-link failure after navigating to a different attendee mid-request", async () => {
    let rejectFetch!: (err: unknown) => void;
    fetchTicketLink.mockReturnValueOnce(
      new Promise<{ url: string }>((_resolve, reject) => {
        rejectFetch = reject;
      }),
    );
    mockLoad(baseDetail());
    mockLoad(baseDetail({ id: "att-2", name: "Bob Beta" }));

    const router = createMemoryRouter(
      [{ path: "/admin/events/:eventId/attendees/:attendeeId", element: <AttendeeDetailPage /> }],
      { initialEntries: ["/admin/events/evt-1/attendees/att-1"] },
    );
    renderWithToast(<RouterProvider router={router} />);
    await screen.findByRole("heading", { name: "Anna" });

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Copy ticket link/ }));

    await act(async () => router.navigate("/admin/events/evt-1/attendees/att-2"));
    await screen.findByRole("heading", { name: "Bob Beta" });

    await act(async () => {
      rejectFetch(new ApiError(422, "ticket_not_issued", "ticket_not_issued"));
      await Promise.resolve();
    });

    expect(screen.queryByTestId("at-toast")).toBeNull();
  });
});
