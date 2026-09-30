// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { ApiError } from "../../src/api/client.js";
import { AttendeeDetailPage } from "../../src/pages/AttendeeDetailPage.js";
import { baseAttendeeDetailEvent, makeSuperadminAssignment, mockMatchMedia, renderWithToast } from "../test-utils.js";

const loadAttendeeDetailData = vi.fn();

vi.mock("../../src/attendees/attendeeDetailForm.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/attendees/attendeeDetailForm.js")>();
  return {
    ...actual,
    loadAttendeeDetailData: (...args: unknown[]) => loadAttendeeDetailData(...args),
  };
});

vi.mock("../../src/auth/AuthProvider.js", () => ({
  useAuth: () => ({ assignments: [makeSuperadminAssignment()] }),
}));

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    useOutletContext: () => ({
      event: baseAttendeeDetailEvent,
    }),
  };
});

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    updateAttendee: vi.fn(),
    resendTicket: vi.fn(),
    fetchAttendeeDetail: vi.fn(),
    fetchTicketTypes: vi.fn().mockResolvedValue([]),
  };
});

import { fetchTicketTypes, updateAttendee } from "../../src/api/client.js";

const detail = {
  id: "att-1",
  name: "Anna",
  email: "anna@example.com",
  company: null,
  department: null,
  ticket_type: "vip",
  custom_data: {},
  status: "registered" as const,
  admitted_at: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  check_in_status: "not_admitted" as const,
  last_mail_status: null,
  rsvp_status: "confirmed" as const,
  rsvp_updated_at: null,
  rsvp_source: null,
  deliveries: [],
  action_log: [],
  event_items: [],
};

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
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("AttendeeDetailPage operator errors", () => {
  it("shows the loading skeleton once the fetch has genuinely taken a moment", () => {
    loadAttendeeDetailData.mockImplementationOnce(() => new Promise(() => {}));
    vi.useFakeTimers();
    renderPage();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(document.querySelector(".attendee-detail-skeleton")).toBeTruthy();
  });

  it("holds the skeleton's space invisibly for the first 200ms, then fades it in", () => {
    loadAttendeeDetailData.mockImplementationOnce(() => new Promise(() => {}));
    vi.useFakeTimers();
    renderPage();
    const page = () => document.querySelector(".attendee-detail-skeleton")?.closest(".attendee-detail-page");
    expect(page()?.className).toContain("at-loading-hold");
    expect(page()?.getAttribute("aria-busy")).toBe("true");

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(page()?.className).toContain("at-fade-in");
    expect(page()?.className).not.toContain("at-loading-hold");
  });

  it("fades the page in when it replaces the skeleton, as a new element", async () => {
    let resolveLoad!: (value: unknown) => void;
    loadAttendeeDetailData.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveLoad = resolve;
        }),
    );
    vi.useFakeTimers();
    renderPage();
    act(() => {
      vi.advanceTimersByTime(250); // skeleton shown at 200ms
    });
    const skeletonRoot = document.querySelector(".attendee-detail-page") as HTMLElement;
    expect(skeletonRoot.getAttribute("aria-busy")).toBe("true");
    await act(async () => {
      resolveLoad({ detail, attributeFields: [], itemsWarning: null });
    });
    act(() => {
      vi.advanceTimersByTime(400);
    });

    const pageRoot = document.querySelector(".attendee-detail-page") as HTMLElement;
    expect(screen.getByRole("heading", { name: "Anna" })).toBeTruthy();
    expect(pageRoot.className).toContain("at-fade-in");
    // A new element, so the 150ms fade runs again instead of carrying on from the skeleton's.
    expect(pageRoot).not.toBe(skeletonRoot);
    expect(pageRoot.getAttribute("aria-busy")).toBeNull();
  });

  it("fades the not-found notice in too, when the attendee turns out not to exist after a skeleton", async () => {
    let rejectLoad!: (reason: unknown) => void;
    loadAttendeeDetailData.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectLoad = reject;
        }),
    );
    vi.useFakeTimers();
    renderPage();
    act(() => {
      vi.advanceTimersByTime(250);
    });
    await act(async () => {
      rejectLoad(new ApiError(404, "not_found"));
    });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.getByText("Attendee not found")).toBeTruthy();
    expect(document.querySelector(".attendee-detail-page")?.className).toContain("at-fade-in");
  });

  it("fades the error in too, when the load fails after a skeleton", async () => {
    let rejectLoad!: (reason: unknown) => void;
    loadAttendeeDetailData.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectLoad = reject;
        }),
    );
    vi.useFakeTimers();
    renderPage();
    act(() => {
      vi.advanceTimersByTime(250);
    });
    await act(async () => {
      rejectLoad(new ApiError(500, "secret_internal"));
    });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.getByText("Could not load attendee")).toBeTruthy();
    expect(document.querySelector(".attendee-detail-page")?.className).toContain("at-fade-in");
  });

  it("never shows the skeleton for a load that answers within 200ms", async () => {
    let resolveLoad!: (value: unknown) => void;
    loadAttendeeDetailData.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveLoad = resolve;
        }),
    );
    vi.useFakeTimers();
    renderPage();
    act(() => {
      vi.advanceTimersByTime(100);
    });
    await act(async () => {
      resolveLoad({ detail, attributeFields: [], itemsWarning: null });
    });
    expect(screen.getByRole("heading", { name: "Anna" })).toBeTruthy();
    expect(document.querySelector(".attendee-detail-skeleton")).toBeNull();
  });

  it("keeps a skeleton that did appear for at least 400ms before the attendee replaces it", async () => {
    let resolveLoad!: (value: unknown) => void;
    loadAttendeeDetailData.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveLoad = resolve;
        }),
    );
    vi.useFakeTimers();
    renderPage();
    act(() => {
      vi.advanceTimersByTime(250); // the skeleton appeared at 200ms
    });
    await act(async () => {
      resolveLoad({ detail, attributeFields: [], itemsWarning: null });
    });
    act(() => {
      vi.advanceTimersByTime(349); // 599ms: 1ms short of its 400ms minimum
    });
    expect(document.querySelector(".attendee-detail-skeleton")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Anna" })).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(document.querySelector(".attendee-detail-skeleton")).toBeNull();
    expect(screen.getByRole("heading", { name: "Anna" })).toBeTruthy();
  });

  it("shows load failure, and retries the load on demand", async () => {
    loadAttendeeDetailData.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("Could not load attendee")).toBeTruthy();
    });

    loadAttendeeDetailData.mockResolvedValueOnce({ detail, attributeFields: [], itemsWarning: null });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByRole("heading", { name: "Anna" });
    expect(loadAttendeeDetailData).toHaveBeenCalledTimes(2);
  });

  it("shows an inline retryable error next to the Ticket type field when the catalog fails to load (CodeRabbit review)", async () => {
    loadAttendeeDetailData.mockResolvedValueOnce({ detail, attributeFields: [], itemsWarning: null });
    vi.mocked(fetchTicketTypes).mockRejectedValueOnce(new Error("network down"));
    renderPage();

    await screen.findByRole("heading", { name: "Anna" });
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(await screen.findByText("Could not load ticket types.")).toBeTruthy();

    vi.mocked(fetchTicketTypes).mockResolvedValueOnce([
      { id: "tt-1", key: "vip", label: "VIP", color: "purple", sort_order: 0, attendee_count: 1, created_at: "2026-01-01T00:00:00.000Z" },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(screen.queryByText("Could not load ticket types.")).toBeNull());
  });

  it("shows the items-load-warning Notice when custom attribute fields fail to load", async () => {
    loadAttendeeDetailData.mockResolvedValueOnce({
      detail,
      attributeFields: [],
      itemsWarning: "Attribute fields could not be loaded. Core fields are still editable.",
    });
    renderPage();

    await screen.findByRole("heading", { name: "Anna" });
    const notice = await screen.findByText("Attribute fields could not be loaded. Core fields are still editable.");
    expect(notice.closest(".at-notice--warning")).toBeTruthy();
  });
});
