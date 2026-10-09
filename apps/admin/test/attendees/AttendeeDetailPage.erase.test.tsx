// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RouterProvider } from "react-router/dom";
import { createMemoryRouter, MemoryRouter, Route, Routes } from "react-router";
import { AttendeeDetailPage } from "../../src/pages/AttendeeDetailPage.js";
import { mockMatchMedia, renderWithToast } from "../test-utils.js";
import { loadAttendeeDetailData } from "./attendeeDetailPageSetup.js";

const eraseAttendee = vi.fn();
const deleteAttendee = vi.fn();

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    fetchAttendeeDetail: vi.fn(),
    fetchEventMailSettings: vi.fn().mockResolvedValue({
      eventId: "evt-1",
      organizationId: "org-1",
      isProduction: false,
      hasEventOverride: false,
      fields: { provider: { value: "graph", source: "organization", locked: false } },
    }),
    fetchTicketTypes: vi.fn().mockResolvedValue([]),
    eraseAttendee: (...args: unknown[]) => eraseAttendee(...args),
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

/** What the API sends for an erased attendee: placeholders the page must never show. */
function erasedDetail(overrides: Partial<Record<string, unknown>> = {}) {
  return baseDetail({
    name: "Placeholder name from the server",
    email: "erased-att-1@erased.invalid",
    company: null,
    department: null,
    erased_at: "2026-10-08T12:00:00.000Z",
    admitted_at: "2026-09-01T10:00:00.000Z",
    check_in_status: "admitted" as const,
    deliveries: [{ id: "d-1", status: "delivered" }],
    ...overrides,
  });
}

const pass = (overrides: Partial<Record<string, unknown>> = {}) => ({
  status: "active",
  provider_removed_at: null,
  apple_active_registrations: 0,
  google_active_registrations: 0,
  samsung_active_registrations: 0,
  ...overrides,
});

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

const ERASE_TITLE = "Erase this person's personal data?";

async function openEraseDialog() {
  await screen.findByRole("heading", { name: "Anna Alpha" });
  fireEvent.click(screen.getByRole("button", { name: "More actions" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: /^Erase personal data/ }));
  return screen.findByRole("dialog", { name: ERASE_TITLE });
}

function typeName(dialog: HTMLElement) {
  fireEvent.change(within(dialog).getByLabelText('Type "Anna Alpha" to confirm'), { target: { value: "Anna Alpha" } });
}

const confirmErase = (dialog: HTMLElement) =>
  fireEvent.click(within(dialog).getByRole("button", { name: "Erase personal data" }));

beforeEach(() => {
  mockMatchMedia(true);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("AttendeeDetailPage: Erase personal data", () => {
  it("says what is erased and what stays, and keeps the button off until the name is typed", async () => {
    mockLoad(baseDetail());
    renderPage();
    const dialog = await openEraseDialog();

    expect(within(dialog).getByText("Use this for a privacy request. It cannot be undone.")).toBeTruthy();
    expect(within(dialog).getByText("Name, email, company, notes and answers")).toBeTruthy();
    expect(within(dialog).getByText("Their ticket, emails and wallet pass")).toBeTruthy();
    expect(within(dialog).getByText("An anonymous entry in Reports")).toBeTruthy();

    const confirm = within(dialog).getByRole("button", { name: "Erase personal data" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    const input = within(dialog).getByLabelText('Type "Anna Alpha" to confirm');
    fireEvent.change(input, { target: { value: "anna alpha" } });
    expect(confirm.disabled).toBe(true);
    fireEvent.change(input, { target: { value: "Anna Alpha" } });
    expect(confirm.disabled).toBe(false);
  });

  it.each([
    ["someone not checked in yet on an active event", {}, false, true],
    ["someone already checked in", { admitted_at: "2026-09-01T10:00:00.000Z" }, false, false],
    ["someone whose pass is already cancelled", { status: "cancelled" }, false, false],
    ["anyone on an archived event, whose numbers are final", {}, true, false],
  ])("%s: the place-freed line is shown only when it applies", async (_label, overrides, archived, shown) => {
    mockLoad(baseDetail(overrides));
    renderPage();
    if (archived) {
      // The event fixture is shared; archive it for this render only.
      const { baseAttendeeDetailEvent } = await import("../test-utils.js");
      baseAttendeeDetailEvent.archived_at = "2026-08-01T00:00:00.000Z";
    }
    try {
      const dialog = await openEraseDialog();
      const line = within(dialog).queryByText("Not checked in yet, so their place becomes free.");
      expect(line !== null).toBe(shown);
    } finally {
      const { baseAttendeeDetailEvent } = await import("../test-utils.js");
      baseAttendeeDetailEvent.archived_at = null;
    }
  });

  it("erases, toasts, and shows the read-only page of an erased attendee", async () => {
    eraseAttendee.mockResolvedValueOnce({ erased: 1, already_erased: 0, not_found: 0, wallet_pending: 0 });
    mockLoad(baseDetail());
    mockLoad(erasedDetail());
    renderPage();
    const dialog = await openEraseDialog();
    typeName(dialog);
    confirmErase(dialog);

    expect(await screen.findByText("Personal data erased")).toBeTruthy();
    expect(eraseAttendee).toHaveBeenCalledWith("evt-1", "att-1");
    expect(await screen.findByRole("heading", { name: /Erased attendee/ })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText("Anna Alpha")).toBeNull();
  });

  it("shows an operator-safe error inside the dialog and keeps it open when the erasure fails", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    eraseAttendee.mockRejectedValueOnce(new ApiError(403, "forbidden", "forbidden"));
    mockLoad(baseDetail());
    renderPage();
    const dialog = await openEraseDialog();
    typeName(dialog);
    confirmErase(dialog);

    await screen.findByText("You do not have access.");
    expect(screen.getByRole("dialog", { name: ERASE_TITLE })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Anna Alpha" })).toBeTruthy();
  });

  it("falls back to a plain message for an error that is not an API error", async () => {
    eraseAttendee.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    mockLoad(baseDetail());
    renderPage();
    const dialog = await openEraseDialog();
    typeName(dialog);
    confirmErase(dialog);

    expect(await screen.findByText("Could not erase personal data. Try again.")).toBeTruthy();
  });

  it("keeps the dialog open while the erasure runs: Escape does nothing until it has answered", async () => {
    let resolveErase!: (value: unknown) => void;
    eraseAttendee.mockReturnValueOnce(new Promise((resolve) => (resolveErase = resolve)));
    mockLoad(baseDetail());
    mockLoad(erasedDetail());
    renderPage();
    const dialog = await openEraseDialog();
    typeName(dialog);
    confirmErase(dialog);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: ERASE_TITLE })).toBeTruthy();

    resolveErase({ erased: 1, already_erased: 0, not_found: 0, wallet_pending: 0 });
    expect(await screen.findByRole("heading", { name: /Erased attendee/ })).toBeTruthy();
  });

  it("keeps the delete dialog open while the delete runs: Escape does nothing until it has answered", async () => {
    let resolveDelete!: () => void;
    deleteAttendee.mockReturnValueOnce(new Promise<void>((resolve) => (resolveDelete = resolve)));
    mockLoad(baseDetail());
    renderPage();
    await screen.findByRole("heading", { name: "Anna Alpha" });
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /^Delete attendee/ }));
    const dialog = await screen.findByRole("dialog", { name: "Permanently delete this attendee?" });
    fireEvent.change(within(dialog).getByLabelText(/Type the attendee's name to confirm/), { target: { value: "Anna Alpha" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "Permanently delete this attendee?" })).toBeTruthy();

    resolveDelete();
    await screen.findByText("Attendees list marker");
  });

  it("Cancel closes the dialog without erasing", async () => {
    mockLoad(baseDetail());
    renderPage();
    const dialog = await openEraseDialog();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(eraseAttendee).not.toHaveBeenCalled();
  });

  it("offers Try again when the wallet pass could not be deleted, instead of a toast", async () => {
    eraseAttendee.mockResolvedValueOnce({ erased: 1, already_erased: 0, not_found: 0, wallet_pending: 1 });
    mockLoad(baseDetail());
    mockLoad(erasedDetail({ wallet_pass: pass(), wallet_pass_delete_pending: true }));
    renderPage();
    const dialog = await openEraseDialog();
    typeName(dialog);
    confirmErase(dialog);

    const result = await screen.findByRole("dialog", { name: "Personal data erased" });
    expect(within(result).getByText("The wallet pass is still at the provider.")).toBeTruthy();
    expect(screen.queryByText("Personal data erased", { selector: "[role=status] *" })).toBeNull();

    eraseAttendee.mockResolvedValueOnce({ erased: 0, already_erased: 1, not_found: 0, wallet_pending: 0 });
    mockLoad(erasedDetail({ wallet_pass: pass({ provider_removed_at: "2026-10-08T12:05:00.000Z" }) }));
    fireEvent.click(within(result).getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Wallet pass deleted")).toBeTruthy();
    expect(eraseAttendee).toHaveBeenLastCalledWith("evt-1", "att-1");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByText(/^Deleted on .*2026/)).toBeTruthy();
  });

  it("ignores a stale erasure completion after navigating to a different attendee mid-request", async () => {
    let resolveErase!: (value: unknown) => void;
    eraseAttendee.mockReturnValueOnce(new Promise((resolve) => (resolveErase = resolve)));
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
    const dialog = await openEraseDialog();
    typeName(dialog);
    confirmErase(dialog);

    await act(async () => router.navigate("/admin/events/evt-1/attendees/att-2"));
    await screen.findByRole("heading", { name: "Bob Beta" });
    await act(async () => {
      resolveErase({ erased: 1, already_erased: 0, not_found: 0, wallet_pending: 0 });
      await Promise.resolve();
    });

    expect(screen.queryByText("Personal data erased")).toBeNull();
    expect(screen.getByRole("heading", { name: "Bob Beta" })).toBeTruthy();
  });

  it("ignores a stale erasure failure after navigating to a different attendee mid-request", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    let rejectErase!: (err: unknown) => void;
    eraseAttendee.mockReturnValueOnce(new Promise((_resolve, reject) => (rejectErase = reject)));
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
    const dialog = await openEraseDialog();
    typeName(dialog);
    confirmErase(dialog);

    await act(async () => router.navigate("/admin/events/evt-1/attendees/att-2"));
    await screen.findByRole("heading", { name: "Bob Beta" });
    await act(async () => {
      rejectErase(new ApiError(403, "forbidden", "forbidden"));
      await Promise.resolve();
    });

    expect(screen.queryByText("You do not have access.")).toBeNull();
    expect(screen.getByRole("heading", { name: "Bob Beta" })).toBeTruthy();
  });
});

describe("AttendeeDetailPage: the page of an erased attendee", () => {
  async function openErasedPage(overrides: Partial<Record<string, unknown>> = {}) {
    mockLoad(erasedDetail(overrides));
    renderPage();
    return screen.findByRole("heading", { name: /Erased attendee/ });
  }

  it("is read-only and says so, without a name, an address or a company", async () => {
    await openErasedPage({ company: "Should not show", email: "erased-att-1@erased.invalid" });

    expect(screen.getByText("This entry is kept for your counts. It has no personal details.")).toBeTruthy();
    expect(screen.getByText(/Personal data erased on .*2026\. This entry stays in your counts/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Edit" }) as HTMLButtonElement).disabled).toBe(true);
    for (const row of ["Name", "Email", "Company", "Custom fields", "Notes", "Message copies"]) {
      const label = screen.getByText(row);
      expect(within(label.parentElement as HTMLElement).getByText("Erased")).toBeTruthy();
    }
    expect(screen.getByText("The change history for this person was erased.")).toBeTruthy();
    expect(screen.queryByText("Placeholder name from the server")).toBeNull();
    expect(screen.queryByText(/erased\.invalid/)).toBeNull();
    // Nothing that sends, issues or edits is on the page.
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.queryByRole("button", { name: /Resend|Revoke/ })).toBeNull();
  });

  it("shows what the entry keeps: the check-in time to the hour and the ticket delivery", async () => {
    await openErasedPage();

    expect(screen.getByText(/^Around \d{2}:\d{2}/)).toBeTruthy();
    // The strip and the Delivery history card both say how the ticket email went.
    expect(screen.getAllByText("Sent")).toHaveLength(2);
  });

  it("has a More actions menu where Erase is off, with the date, and Delete stays", async () => {
    await openErasedPage();

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    const erase = await screen.findByRole("menuitem", { name: /^Erase personal data/ });
    expect((erase as HTMLButtonElement).disabled).toBe(true);
    expect(within(erase).getByText(/^Personal data was erased on .*2026\.$/)).toBeTruthy();

    deleteAttendee.mockResolvedValueOnce(undefined);
    fireEvent.click(screen.getByRole("menuitem", { name: /^Delete attendee/ }));
    const dialog = await screen.findByRole("dialog", { name: "Permanently delete this attendee?" });
    fireEvent.change(within(dialog).getByLabelText(/Type the attendee's name to confirm/), {
      target: { value: "Erased attendee" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    await screen.findByText("Attendees list marker");
    expect(deleteAttendee).toHaveBeenCalledWith("evt-1", "att-1");
  });

  it.each([
    ["deleted at the provider", { wallet_pass: pass({ provider_removed_at: "2026-10-08T12:05:00.000Z" }) }, /^Deleted on .*2026/],
    ["never at the provider", { wallet_pass: pass() }, "None"],
    ["no pass at all", { wallet_pass: null }, "None"],
  ])("tells what became of the pass: %s", async (_label, overrides, expected) => {
    await openErasedPage(overrides);

    const row = screen.getByText("Pass at the wallet provider").parentElement as HTMLElement;
    expect(within(row).getByText(expected)).toBeTruthy();
    expect(within(row).queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.getByText("No longer work")).toBeTruthy();
  });

  it("offers Try again for a pass that is still to be deleted, and repeats the erasure from the dialog", async () => {
    await openErasedPage({ wallet_pass: pass(), wallet_pass_delete_pending: true });

    const row = screen.getByText("Pass at the wallet provider").parentElement as HTMLElement;
    expect(within(row).getByText(/Not deleted yet/)).toBeTruthy();
    fireEvent.click(within(row).getByRole("button", { name: "Try again" }));

    const result = await screen.findByRole("dialog", { name: "Personal data erased" });
    eraseAttendee.mockResolvedValueOnce({ erased: 0, already_erased: 1, not_found: 0, wallet_pending: 1 });
    fireEvent.click(within(result).getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(eraseAttendee).toHaveBeenCalledWith("evt-1", "att-1"));
    await within(result).findByText("The wallet pass is still at the provider.");
  });

  it("names the pass in the status strip: removed, still to be deleted, or none", async () => {
    await openErasedPage({ wallet_pass: pass({ provider_removed_at: "2026-10-08T12:05:00.000Z" }) });
    const strip = document.querySelector(".attendee-status-strip") as HTMLElement;
    expect(within(strip).getByText("Pass removed")).toBeTruthy();
    cleanup();

    await openErasedPage({ wallet_pass: pass(), wallet_pass_delete_pending: true });
    expect(within(document.querySelector(".attendee-status-strip") as HTMLElement).getByText("To be deleted")).toBeTruthy();
    cleanup();

    await openErasedPage({ wallet_pass: null });
    expect(within(document.querySelector(".attendee-status-strip") as HTMLElement).getByText("No pass")).toBeTruthy();
  });

  it("says the ticket email was not sent for an erased entry that never had a delivery", async () => {
    await openErasedPage({ deliveries: [] });

    const row = screen.getByText("Ticket email").parentElement as HTMLElement;
    expect(within(row).getByText("Not sent")).toBeTruthy();
  });

  it("leaves out the Edit button on a phone, where the page has no room for a disabled one", async () => {
    mockMatchMedia(false);
    await openErasedPage();

    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.getByRole("button", { name: "More actions" })).toBeTruthy();
  });

  it("shows the Wallet card only when the event offers wallet passes or the entry still has one", async () => {
    const { baseAttendeeDetailEvent } = await import("../test-utils.js");
    const offered = baseAttendeeDetailEvent.wallet_enabled;
    baseAttendeeDetailEvent.wallet_enabled = false;
    try {
      await openErasedPage({ wallet_pass: null });
      expect(screen.queryByText("Ticket link and QR code")).toBeNull();
      cleanup();

      await openErasedPage({ wallet_pass: pass({ provider_removed_at: "2026-10-08T12:05:00.000Z" }) });
      expect(screen.getByText("Ticket link and QR code")).toBeTruthy();
    } finally {
      baseAttendeeDetailEvent.wallet_enabled = offered;
    }
  });

  it("says so above the page when a reload after Try again fails", async () => {
    await openErasedPage({ wallet_pass: pass(), wallet_pass_delete_pending: true });
    const row = screen.getByText("Pass at the wallet provider").parentElement as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Try again" }));
    const result = await screen.findByRole("dialog", { name: "Personal data erased" });

    eraseAttendee.mockResolvedValueOnce({ erased: 0, already_erased: 1, not_found: 0, wallet_pending: 0 });
    loadAttendeeDetailData.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    fireEvent.click(within(result).getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Could not load attendee.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Erased attendee/ })).toBeTruthy();
  });

  it("shows 'Not yet' for the check-in of an entry that was never admitted", async () => {
    await openErasedPage({ admitted_at: null, check_in_status: "not_admitted" });

    const strip = document.querySelector(".attendee-status-strip") as HTMLElement;
    expect(within(strip).getByText("Not yet")).toBeTruthy();
    expect(within(strip).queryByText(/^Around/)).toBeNull();
  });
});
