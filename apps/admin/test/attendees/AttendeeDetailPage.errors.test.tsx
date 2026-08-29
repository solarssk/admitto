// @vitest-environment jsdom
// This import must come first, before every other import in the file - see
// attendeeDetailPageMocks.ts's own doc comment for why.
import { mockAttendeeDetailForm, mockAuthProvider, mockModule, mockOutletEvent } from "./attendeeDetailPageMocks.js";
import { baseAttendeeDetail, baseAttendeeDetailEvent, mockMatchMedia, renderAttendeeDetailRoute } from "../test-utils.js";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/api/client.js";
import { AttendeeDetailPage } from "../../src/pages/AttendeeDetailPage.js";

const loadAttendeeDetailData = vi.fn();

vi.mock("../../src/attendees/attendeeDetailForm.js", (importOriginal) =>
  mockAttendeeDetailForm(importOriginal, () => loadAttendeeDetailData),
);

vi.mock("../../src/auth/AuthProvider.js", () =>
  mockAuthProvider(() => ({ assignments: [{ role: "superadmin", scope_type: "instance", scope_id: null }] })),
);

vi.mock("react-router", (importOriginal) =>
  mockOutletEvent(importOriginal, () => baseAttendeeDetailEvent),
);

vi.mock("../../src/api/client.js", (importOriginal) =>
  mockModule(importOriginal, () => ({
    updateAttendee: vi.fn(),
    resendTicket: vi.fn(),
    fetchAttendeeDetail: vi.fn(),
    fetchTicketTypes: vi.fn().mockResolvedValue([]),
  })),
);

import { fetchTicketTypes, updateAttendee } from "../../src/api/client.js";

const detail = {
  ...baseAttendeeDetail,
  created_at: "2026-01-01T00:00:00.000Z",
};

function renderPage() {
  renderAttendeeDetailRoute(<AttendeeDetailPage />);
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

  it("shows load failure", async () => {
    loadAttendeeDetailData.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/Could not load attendee/)).toBeTruthy();
    });
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
