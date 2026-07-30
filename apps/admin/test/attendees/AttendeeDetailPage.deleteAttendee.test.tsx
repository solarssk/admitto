// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RouterProvider } from "react-router/dom";
import { createMemoryRouter, MemoryRouter, Route, Routes } from "react-router";
import { AttendeeDetailPage } from "../../src/pages/AttendeeDetailPage.js";
import { mockMatchMedia, renderWithToast } from "../test-utils.js";

const loadAttendeeDetailData = vi.fn();
const deleteAttendee = vi.fn();

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
    fetchAttendeeDetail: vi.fn(),
    revokeAttendeeCheckIn: vi.fn(),
    resendTicket: vi.fn(),
    fetchEventMailSettings: vi.fn().mockResolvedValue({
      eventId: "evt-1",
      organizationId: "org-1",
      isProduction: false,
      hasEventOverride: false,
      fields: { provider: { value: "graph", source: "organization", locked: false } },
    }),
    fetchTicketTypes: vi.fn().mockResolvedValue([]),
    deleteAttendee: (...args: unknown[]) => deleteAttendee(...args),
  };
});

function baseDetail(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "att-1",
    name: "Anna Alpha",
    email: "anna@example.com",
    company: "Acme",
    department: "Eng",
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
    ...overrides,
  };
}

function mockLoad(detail: ReturnType<typeof baseDetail>) {
  loadAttendeeDetailData.mockResolvedValueOnce({ detail, attributeFields: [], itemsWarning: null });
}

function renderPage() {
  return renderWithToast(
    <MemoryRouter initialEntries={["/admin/events/evt-1/attendees/att-1"]}>
      <Routes>
        <Route path="/admin/events/:eventId/attendees/:attendeeId" element={<AttendeeDetailPage />} />
        <Route path="/admin/events/:eventId/attendees" element={<div>Attendees list marker</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function openDeleteDialog() {
  await screen.findByRole("heading", { name: "Anna Alpha" });
  fireEvent.click(screen.getByRole("button", { name: "More actions" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: /Delete attendee/ }));
  await screen.findByText("Permanently delete this attendee?");
}

beforeEach(() => {
  mockMatchMedia(true);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("AttendeeDetailPage — Delete attendee (GDPR erasure, #356)", () => {
  it("keeps the confirm button disabled until the attendee's exact name is typed", async () => {
    mockLoad(baseDetail());
    renderPage();
    await openDeleteDialog();

    const confirmButton = screen.getByRole("button", { name: "Delete" });
    expect((confirmButton as HTMLButtonElement).disabled).toBe(true);

    const input = screen.getByLabelText('Type the attendee\'s name to confirm: "Anna Alpha"');
    fireEvent.change(input, { target: { value: "wrong name" } });
    expect((confirmButton as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(input, { target: { value: "Anna Alpha" } });
    expect((confirmButton as HTMLButtonElement).disabled).toBe(false);
  });

  it("deletes, toasts, and navigates back to the attendees list on success", async () => {
    deleteAttendee.mockResolvedValueOnce(undefined);
    mockLoad(baseDetail());
    renderPage();
    await openDeleteDialog();

    fireEvent.change(screen.getByLabelText('Type the attendee\'s name to confirm: "Anna Alpha"'), {
      target: { value: "Anna Alpha" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await screen.findByText("Attendees list marker");
    expect(deleteAttendee).toHaveBeenCalledWith("evt-1", "att-1");
    expect(await screen.findByText("Attendee permanently deleted")).toBeTruthy();
  });

  it("shows an inline error and keeps the dialog open when the delete fails", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    deleteAttendee.mockRejectedValueOnce(new ApiError(403, "forbidden", "forbidden"));
    mockLoad(baseDetail());
    renderPage();
    await openDeleteDialog();

    fireEvent.change(screen.getByLabelText('Type the attendee\'s name to confirm: "Anna Alpha"'), {
      target: { value: "Anna Alpha" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await screen.findByText("You do not have access.");
    expect(screen.getByText("Permanently delete this attendee?")).toBeTruthy();
  });

  it("Cancel closes the dialog without calling deleteAttendee", async () => {
    mockLoad(baseDetail());
    renderPage();
    await openDeleteDialog();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByText("Permanently delete this attendee?")).toBeNull();
    expect(deleteAttendee).not.toHaveBeenCalled();
  });

  it("ignores a stale delete completion after navigating to a different attendee mid-request (CodeRabbit review)", async () => {
    let resolveDelete!: () => void;
    deleteAttendee.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveDelete = resolve;
      }),
    );
    mockLoad(baseDetail());
    mockLoad(baseDetail({ id: "att-2", name: "Bob Beta" }));

    const router = createMemoryRouter(
      [
        { path: "/admin/events/:eventId/attendees/:attendeeId", element: <AttendeeDetailPage /> },
        { path: "/admin/events/:eventId/attendees", element: <div>Attendees list marker</div> },
      ],
      { initialEntries: ["/admin/events/evt-1/attendees/att-1"] },
    );
    renderWithToast(<RouterProvider router={router} />);
    await openDeleteDialog();

    fireEvent.change(screen.getByLabelText('Type the attendee\'s name to confirm: "Anna Alpha"'), {
      target: { value: "Anna Alpha" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    // Navigate to a different attendee while the delete request is still in flight — the
    // completion below must not toast or navigate on behalf of a selection that's gone stale.
    await act(async () => router.navigate("/admin/events/evt-1/attendees/att-2"));
    await screen.findByRole("heading", { name: "Bob Beta" });

    await act(async () => {
      resolveDelete();
      await Promise.resolve();
    });

    expect(screen.queryByText("Attendee permanently deleted")).toBeNull();
    expect(screen.getByRole("heading", { name: "Bob Beta" })).toBeTruthy();
  });

  it("ignores a stale delete failure after navigating to a different attendee mid-request (CodeRabbit review)", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    let rejectDelete!: (err: unknown) => void;
    deleteAttendee.mockReturnValueOnce(
      new Promise<void>((_resolve, reject) => {
        rejectDelete = reject;
      }),
    );
    mockLoad(baseDetail());
    mockLoad(baseDetail({ id: "att-2", name: "Bob Beta" }));

    const router = createMemoryRouter(
      [
        { path: "/admin/events/:eventId/attendees/:attendeeId", element: <AttendeeDetailPage /> },
        { path: "/admin/events/:eventId/attendees", element: <div>Attendees list marker</div> },
      ],
      { initialEntries: ["/admin/events/evt-1/attendees/att-1"] },
    );
    renderWithToast(<RouterProvider router={router} />);
    await openDeleteDialog();

    fireEvent.change(screen.getByLabelText('Type the attendee\'s name to confirm: "Anna Alpha"'), {
      target: { value: "Anna Alpha" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    // Navigate away before the delete request rejects — the failure below must not set the
    // (now unmounted-for-this-attendee) delete dialog's inline error on behalf of Anna Alpha.
    await act(async () => router.navigate("/admin/events/evt-1/attendees/att-2"));
    await screen.findByRole("heading", { name: "Bob Beta" });

    await act(async () => {
      rejectDelete(new ApiError(403, "forbidden", "forbidden"));
      await Promise.resolve().catch(() => {});
    });

    expect(screen.queryByText("You do not have access.")).toBeNull();
    expect(screen.getByRole("heading", { name: "Bob Beta" })).toBeTruthy();
  });
});
