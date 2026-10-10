// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RouterProvider } from "react-router/dom";
import { createMemoryRouter, MemoryRouter, Route, Routes } from "react-router";
import { AttendeeDetailPage } from "../../src/pages/AttendeeDetailPage.js";
import { mockMatchMedia, renderWithToast } from "../test-utils.js";
import { loadAttendeeDetailData } from "./attendeeDetailPageSetup.js";

const removeAttendee = vi.fn();

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
    removeAttendee: (...args: unknown[]) => removeAttendee(...args),
  };
});

const DIALOG = "Remove this person from the event?";
const NAME_LABEL = 'Type "Anna Alpha" to confirm';

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

async function openRemoveDialog() {
  await screen.findByRole("heading", { name: "Anna Alpha" });
  fireEvent.click(screen.getByRole("button", { name: "More actions" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: /Remove from event/ }));
  return screen.findByRole("dialog", { name: DIALOG });
}

function typeName(name = "Anna Alpha") {
  fireEvent.change(screen.getByLabelText(NAME_LABEL), { target: { value: name } });
}

function confirmButton() {
  return within(screen.getByRole("dialog", { name: DIALOG })).getByRole("button", { name: "Remove from event" });
}

function routerWithTwoAttendees() {
  return createMemoryRouter(
    [
      { path: "/admin/events/:eventId/attendees/:attendeeId", element: <AttendeeDetailPage /> },
      { path: "/admin/events/:eventId/attendees", element: <div>Attendees list marker</div> },
    ],
    { initialEntries: ["/admin/events/evt-1/attendees/att-1"] },
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

describe("AttendeeDetailPage: Remove from event", () => {
  it("keeps the confirm button disabled until the attendee's exact name is typed", async () => {
    mockLoad(baseDetail());
    renderPage();
    await openRemoveDialog();

    expect((confirmButton() as HTMLButtonElement).disabled).toBe(true);

    typeName("wrong name");
    expect((confirmButton() as HTMLButtonElement).disabled).toBe(true);

    typeName();
    expect((confirmButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it("offers the five reasons in order, with Duplicate entry chosen", async () => {
    mockLoad(baseDetail());
    renderPage();
    const dialog = await openRemoveDialog();

    const group = within(dialog).getByRole("group", { name: "Reason" });
    const radios = within(group).getAllByRole("radio") as HTMLInputElement[];
    expect(radios.map((radio) => radio.labels?.[0]?.textContent)).toEqual([
      "Duplicate entry",
      "Test person",
      "Wrong import file",
      "Added by mistake",
      "Other",
    ]);
    expect(radios.map((radio) => radio.checked)).toEqual([true, false, false, false, false]);
  });

  it("removes with the chosen reason, toasts and returns to the attendees list", async () => {
    removeAttendee.mockResolvedValueOnce({ removed: 1, not_found: 0 });
    mockLoad(baseDetail());
    renderPage();
    await openRemoveDialog();

    fireEvent.click(screen.getByRole("radio", { name: "Test person" }));
    typeName();
    fireEvent.click(confirmButton());

    await screen.findByText("Attendees list marker");
    expect(removeAttendee).toHaveBeenCalledWith("evt-1", "att-1", "test_person");
    expect(await screen.findByText("Attendee removed from the event")).toBeTruthy();
  });

  it("sends the default reason when none was changed", async () => {
    removeAttendee.mockResolvedValueOnce({ removed: 1, not_found: 0 });
    mockLoad(baseDetail());
    renderPage();
    await openRemoveDialog();

    typeName();
    fireEvent.click(confirmButton());

    await screen.findByText("Attendees list marker");
    expect(removeAttendee).toHaveBeenCalledWith("evt-1", "att-1", "duplicate");
  });

  it("starts from Duplicate entry each time the dialog opens", async () => {
    mockLoad(baseDetail());
    renderPage();
    await openRemoveDialog();

    fireEvent.click(screen.getByRole("radio", { name: "Other" }));
    expect((screen.getByRole("radio", { name: "Other" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: DIALOG })).toBeNull();

    await openRemoveDialog();
    expect((screen.getByRole("radio", { name: "Duplicate entry" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("radio", { name: "Other" }) as HTMLInputElement).checked).toBe(false);
  });

  it("shows an inline error and keeps the dialog open when the removal fails", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    removeAttendee.mockRejectedValueOnce(new ApiError(403, "forbidden", "forbidden"));
    mockLoad(baseDetail());
    renderPage();
    await openRemoveDialog();

    typeName();
    fireEvent.click(confirmButton());

    await screen.findByText("You do not have access.");
    expect(screen.getByText(DIALOG)).toBeTruthy();
    expect(screen.queryByText("Attendees list marker")).toBeNull();
  });

  it("Cancel closes the dialog without calling removeAttendee", async () => {
    mockLoad(baseDetail());
    renderPage();
    await openRemoveDialog();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByText(DIALOG)).toBeNull();
    expect(removeAttendee).not.toHaveBeenCalled();
  });

  it("says the check-in goes too, only for someone who has checked in", async () => {
    mockLoad(baseDetail());
    const { unmount } = renderPage();
    await openRemoveDialog();
    expect(screen.queryByText(/Already checked in/)).toBeNull();
    unmount();

    mockLoad(baseDetail({ admitted_at: "2026-06-01T09:30:00.000Z", check_in_status: "admitted" }));
    renderPage();
    await openRemoveDialog();
    expect(screen.getByText("Already checked in. The check-in is removed from Reports too.")).toBeTruthy();
  });

  it("points a privacy request to Erase, and Erase points back, each from a clean dialog", async () => {
    mockLoad(baseDetail());
    renderPage();
    await openRemoveDialog();
    typeName();

    fireEvent.click(screen.getByRole("button", { name: "Use Erase personal data" }));

    expect(screen.queryByRole("dialog", { name: DIALOG })).toBeNull();
    const erase = await screen.findByRole("dialog", { name: "Erase this person's personal data?" });
    expect(within(erase).getByText("A duplicate or a mistake?")).toBeTruthy();

    fireEvent.click(within(erase).getByRole("button", { name: "Use Remove from event" }));

    expect(screen.queryByRole("dialog", { name: "Erase this person's personal data?" })).toBeNull();
    await screen.findByRole("dialog", { name: DIALOG });
    // The name typed the first time is not carried over: the confirmation is typed again.
    expect((screen.getByLabelText(NAME_LABEL) as HTMLInputElement).value).toBe("");
    expect((confirmButton() as HTMLButtonElement).disabled).toBe(true);
    expect(removeAttendee).not.toHaveBeenCalled();
  });

  it("keeps the way across to Erase inert while the removal runs", async () => {
    removeAttendee.mockReturnValueOnce(new Promise<void>(() => undefined));
    mockLoad(baseDetail());
    renderPage();
    await openRemoveDialog();
    typeName();
    fireEvent.click(confirmButton());

    const link = screen.getByRole("button", { name: "Use Erase personal data" });
    expect(link.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(link);

    expect(screen.getByRole("dialog", { name: DIALOG })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Erase this person's personal data?" })).toBeNull();
  });

  it("locks the reason while the removal runs, as it does the typed name", async () => {
    removeAttendee.mockReturnValueOnce(new Promise<void>(() => undefined));
    mockLoad(baseDetail());
    renderPage();
    const dialog = await openRemoveDialog();
    typeName();
    fireEvent.click(confirmButton());

    const radios = within(dialog).getAllByRole("radio") as HTMLInputElement[];
    expect(radios).toHaveLength(5);
    expect(radios.every((radio) => radio.disabled)).toBe(true);
  });

  it("ignores a stale removal completion after navigating to a different attendee mid-request (CodeRabbit review)", async () => {
    let resolveRemoval!: (answer: { removed: number; not_found: number }) => void;
    removeAttendee.mockReturnValueOnce(
      new Promise<{ removed: number; not_found: number }>((resolve) => {
        resolveRemoval = resolve;
      }),
    );
    mockLoad(baseDetail());
    mockLoad(baseDetail({ id: "att-2", name: "Bob Beta" }));

    const router = routerWithTwoAttendees();
    renderWithToast(<RouterProvider router={router} />);
    await openRemoveDialog();

    typeName();
    fireEvent.click(confirmButton());

    // Navigate to a different attendee while the request is still in flight: the completion
    // below must not toast or navigate on behalf of a selection that's gone stale.
    await act(async () => router.navigate("/admin/events/evt-1/attendees/att-2"));
    await screen.findByRole("heading", { name: "Bob Beta" });

    await act(async () => {
      resolveRemoval({ removed: 1, not_found: 0 });
      // A macrotask, not one microtask: every continuation of the request has run before the assertions.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(screen.queryByText("Attendee removed from the event")).toBeNull();
    expect(screen.getByRole("heading", { name: "Bob Beta" })).toBeTruthy();
  });

  it("ignores a stale removal failure after navigating to a different attendee mid-request (CodeRabbit review)", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    let rejectRemoval!: (err: unknown) => void;
    removeAttendee.mockReturnValueOnce(
      new Promise<void>((_resolve, reject) => {
        rejectRemoval = reject;
      }),
    );
    mockLoad(baseDetail());
    mockLoad(baseDetail({ id: "att-2", name: "Bob Beta" }));

    const router = routerWithTwoAttendees();
    renderWithToast(<RouterProvider router={router} />);
    await openRemoveDialog();

    typeName();
    fireEvent.click(confirmButton());

    // Navigate away before the request rejects: the failure below must not set the (now
    // unmounted-for-this-attendee) dialog's inline error on behalf of Anna Alpha.
    await act(async () => router.navigate("/admin/events/evt-1/attendees/att-2"));
    await screen.findByRole("heading", { name: "Bob Beta" });

    await act(async () => {
      rejectRemoval(new ApiError(403, "forbidden", "forbidden"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(screen.queryByText("You do not have access.")).toBeNull();
    expect(screen.getByRole("heading", { name: "Bob Beta" })).toBeTruthy();
  });
});
