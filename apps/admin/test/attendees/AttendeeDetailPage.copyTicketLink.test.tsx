// @vitest-environment jsdom
// This import must come first, before every other import in the file - see
// attendeeDetailPageMocks.ts's own doc comment for why.
import { mockModule, mockOutletEvent } from "./attendeeDetailPageMocks.js";
import {
  baseAttendeeDetail,
  baseAttendeeDetailEvent,
  mockAttendeeDetailLoad,
  mockMatchMedia,
  renderAttendeeDetailRoute,
  renderWithToast,
} from "../test-utils.js";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RouterProvider } from "react-router/dom";
import { createMemoryRouter } from "react-router";
import { AttendeeDetailPage } from "../../src/pages/AttendeeDetailPage.js";
import { loadAttendeeDetailData } from "../../src/attendees/attendeeDetailForm.js";
import { ApiError } from "../../src/api/client.js";

const fetchTicketLink = vi.fn();

vi.mock("../../src/attendees/attendeeDetailForm.js");
vi.mock("../../src/auth/AuthProvider.js");

vi.mock("react-router", (importOriginal) =>
  mockOutletEvent(importOriginal, () => baseAttendeeDetailEvent),
);

vi.mock("../../src/api/client.js", (importOriginal) =>
  mockModule(importOriginal, () => ({
    resendTicket: vi.fn(),
    fetchAttendeeDetail: vi.fn(),
    fetchTicketLink: (...args: unknown[]) => fetchTicketLink(...args),
  })),
);

function baseDetail(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ...baseAttendeeDetail,
    admitted_at: "2026-06-01T09:44:00.000Z",
    check_in_status: "admitted" as const,
    ...overrides,
  };
}

function mockLoad(detail: ReturnType<typeof baseDetail>) {
  mockAttendeeDetailLoad(loadAttendeeDetailData, detail);
}

function renderPage() {
  renderAttendeeDetailRoute(<AttendeeDetailPage />);
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

  it("toasts the mapped error when the attendee can't be issued a ticket", async () => {
    fetchTicketLink.mockRejectedValueOnce(new ApiError(422, "ticket_not_issued", "ticket_not_issued"));
    mockLoad(baseDetail());
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Copy ticket link/ }));

    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/can.t be issued a ticket/);
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
