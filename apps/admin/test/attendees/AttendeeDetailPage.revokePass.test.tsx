// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { AttendeeDetailPage } from "../../src/pages/AttendeeDetailPage.js";
import { mockMatchMedia, renderWithToast } from "../test-utils.js";

const loadAttendeeDetailData = vi.fn();
const updateAttendee = vi.fn();

vi.mock("../../src/attendees/attendeeDetailForm.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/attendees/attendeeDetailForm.js")>();
  return {
    ...actual,
    loadAttendeeDetailData: (...args: unknown[]) => loadAttendeeDetailData(...args),
  };
});

let mockAssignments: Array<{ role: string; scope_type: string; scope_id: string | null }> = [
  { role: "admin", scope_type: "organization", scope_id: "org-1" },
];

vi.mock("../../src/auth/AuthProvider.js", () => ({
  useAuth: () => ({ assignments: mockAssignments }),
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
    updateAttendee: (...args: unknown[]) => updateAttendee(...args),
    resendTicket: vi.fn(),
    fetchAttendeeDetail: vi.fn(),
    revokeAttendeeCheckIn: vi.fn(),
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
    admitted_at: null,
    updated_at: "2026-01-01T00:00:00.000Z",
    check_in_status: "not_admitted" as const,
    last_mail_status: null,
    rsvp_status: "confirmed" as const,
    rsvp_updated_at: null,
    rsvp_source: null,
    ticket_ref: null,
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
  mockAssignments = [{ role: "admin", scope_type: "organization", scope_id: "org-1" }];
  vi.unstubAllGlobals();
});

/** Revoke pass/check-in live only inside "More actions" now, on every viewport (the standalone
 * desktop "Revoke" dropdown was folded in there too) - matches accessible names with a regex
 * since each item also carries a hint line (e.g. "Revoke pass Block check-in for this
 * attendee"), same convention as the Attendees list's bulk menu tests. */
function clickRevokePassMenuItem() {
  fireEvent.click(screen.getByRole("button", { name: "More actions" }));
  fireEvent.click(screen.getByRole("menuitem", { name: /Revoke pass/ }));
}

describe("AttendeeDetailPage — Revoke pass / Restore pass (consolidated confirm-flow state)", () => {
  it("closes the Restore pass dialog without changing status when cancelled", async () => {
    mockLoad(baseDetail({ status: "revoked" }));
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Restore pass/ }));
    const dialog = screen.getByRole("dialog", { name: "Restore pass?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(updateAttendee).not.toHaveBeenCalled();
  });

  it("keeps the Restore pass dialog open when its backdrop is clicked during the request", async () => {
    mockLoad(baseDetail({ status: "revoked" }));
    let rejectRequest!: (reason?: unknown) => void;
    updateAttendee.mockReturnValueOnce(
      new Promise((_, reject) => {
        rejectRequest = reject;
      }),
    );
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Restore pass/ }));
    const dialog = screen.getByRole("dialog", { name: "Restore pass?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Restore pass" }));
    await waitFor(() => expect(updateAttendee).toHaveBeenCalledOnce());

    fireEvent.click(document.querySelector(".confirm-dialog__backdrop")!);
    expect(screen.getByRole("dialog", { name: "Restore pass?" })).toBeTruthy();

    rejectRequest(new Error("request failed"));
    await within(dialog).findByText("Could not update pass status.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("confirms Revoke pass, closes the dialog, and shows Restore pass afterward", async () => {
    mockLoad(baseDetail());
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    updateAttendee.mockResolvedValue(
      baseDetail({ status: "revoked", updated_at: "2026-01-02T00:00:00.000Z" }),
    );

    clickRevokePassMenuItem();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Revoke pass?")).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke pass" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    expect(screen.getByRole("menuitem", { name: /Restore pass/ })).toBeTruthy();
    // The other flow's ConfirmDialog must not have opened as a side effect.
    expect(screen.queryByText("Revoke check-in?")).toBeNull();
  });

  it("keeps the capacity-blocked error in the Restore pass dialog when it hits event_full", async () => {
    mockLoad(baseDetail({ status: "revoked" }));
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    const { ApiError } = await import("../../src/api/client.js");
    updateAttendee.mockRejectedValue(
      new ApiError(409, "event_full", "event_full", { current: 5, capacity: 5 }),
    );

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Restore pass/ }));
    const dialog = screen.getByRole("dialog", { name: "Restore pass?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Restore pass" }));

    await waitFor(() => {
      expect(within(dialog).getByText(/Event is at capacity/)).toBeTruthy();
    });
    // Stays in the dialog (superadmin-only override checkbox lives here too), not a page banner.
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("keeps an unmapped 409 pass error in the revoke confirmation dialog", async () => {
    mockLoad(baseDetail());
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    const { ApiError } = await import("../../src/api/client.js");
    updateAttendee.mockRejectedValue(new ApiError(409, "unexpected_conflict", "unexpected_conflict"));

    clickRevokePassMenuItem();
    const dialog = screen.getByRole("dialog", { name: "Revoke pass?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke pass" }));

    expect(await within(dialog).findByText("Could not update pass status.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps a generic server error in the revoke confirmation dialog", async () => {
    mockLoad(baseDetail());
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    const { ApiError } = await import("../../src/api/client.js");
    updateAttendee.mockRejectedValue(new ApiError(500, "server_error", "server_error"));

    clickRevokePassMenuItem();
    const dialog = screen.getByRole("dialog", { name: "Revoke pass?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke pass" }));

    expect(await within(dialog).findByText("Could not update pass status.")).toBeTruthy();
  });

  it("reloads the page after a stale-write pass conflict", async () => {
    mockLoad(baseDetail());
    mockLoad(baseDetail({ updated_at: "2026-01-02T00:00:00.000Z" }));
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    const { ApiError } = await import("../../src/api/client.js");
    updateAttendee.mockRejectedValue(new ApiError(409, "stale_write", "stale_write"));

    clickRevokePassMenuItem();
    const dialog = screen.getByRole("dialog", { name: "Revoke pass?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke pass" }));

    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Someone else updated this attendee/);
      expect(loadAttendeeDetailData).toHaveBeenCalledTimes(2);
    });
  });

  it("lets a superadmin override the capacity block and retries with force: true", async () => {
    mockAssignments = [{ role: "superadmin", scope_type: "instance", scope_id: null }];
    mockLoad(baseDetail({ status: "revoked" }));
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    const { ApiError } = await import("../../src/api/client.js");
    updateAttendee
      .mockRejectedValueOnce(
        new ApiError(409, "event_full", "event_full", { current: 5, capacity: 5 }),
      )
      .mockResolvedValueOnce(baseDetail({ status: "registered" }));

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Restore pass/ }));
    const dialog = screen.getByRole("dialog", { name: "Restore pass?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Restore pass" }));

    await waitFor(() => {
      expect(within(dialog).getByText(/Event is at capacity/)).toBeTruthy();
    });

    fireEvent.click(within(dialog).getByLabelText(/Override capacity limit/));
    fireEvent.click(within(dialog).getByRole("button", { name: "Restore pass" }));

    await waitFor(() => {
      expect(updateAttendee).toHaveBeenLastCalledWith(
        "evt-1",
        "att-1",
        expect.objectContaining({ status: "registered" }),
        { force: true },
      );
    });
  });

  it("clears a cancelled capacity override before Restore pass is reopened", async () => {
    mockAssignments = [{ role: "superadmin", scope_type: "instance", scope_id: null }];
    mockLoad(baseDetail({ status: "revoked" }));
    mockLoad(baseDetail({ status: "registered" }));
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    const { ApiError } = await import("../../src/api/client.js");
    updateAttendee
      .mockRejectedValueOnce(new ApiError(409, "event_full", "event_full", { current: 5, capacity: 5 }))
      .mockResolvedValueOnce(baseDetail({ status: "registered" }));

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Restore pass/ }));
    let dialog = screen.getByRole("dialog", { name: "Restore pass?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Restore pass" }));
    await within(dialog).findByText(/Event is at capacity/);

    fireEvent.click(within(dialog).getByLabelText(/Override capacity limit/));
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Restore pass/ }));
    dialog = screen.getByRole("dialog", { name: "Restore pass?" });
    expect(within(dialog).queryByLabelText(/Override capacity limit/)).toBeNull();

    fireEvent.click(within(dialog).getByRole("button", { name: "Restore pass" }));
    await waitFor(() => {
      expect(updateAttendee).toHaveBeenLastCalledWith(
        "evt-1",
        "att-1",
        expect.objectContaining({ status: "registered" }),
        { force: false },
      );
    });
  });
});
