// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RouterProvider } from "react-router/dom";
import { createMemoryRouter, MemoryRouter, Route, Routes } from "react-router";
import { AttendeeDetailPage } from "../../src/pages/AttendeeDetailPage.js";
import { mockMatchMedia, renderWithToast } from "../test-utils.js";
import { setPreferredLocale } from "../../src/utils/locale-store.js";
import { loadAttendeeDetailData } from "./attendeeDetailPageSetup.js";

const eraseAttendee = vi.fn();
const removeAttendee = vi.fn();
const addAttendeeNote = vi.fn();

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
    removeAttendee: (...args: unknown[]) => removeAttendee(...args),
    addAttendeeNote: (...args: unknown[]) => addAttendeeNote(...args),
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

function renderNotesTab() {
  return renderWithToast(
    <MemoryRouter initialEntries={["/admin/events/evt-1/attendees/att-1?tab=notes"]}>
      <Routes>
        <Route path="/admin/events/:eventId/attendees/:attendeeId" element={<AttendeeDetailPage />} />
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
  setPreferredLocale(null);
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
    eraseAttendee.mockResolvedValueOnce({ erased: 1, already_erased: 0, not_found: 0, wallet_pending: 0, wallet_removed_ids: [] });
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

  it("shows nothing of the person at once, while the page still waits for the server's version", async () => {
    eraseAttendee.mockResolvedValueOnce({ erased: 1, already_erased: 0, not_found: 0, wallet_pending: 0, wallet_removed_ids: [] });
    mockLoad(baseDetail({ notes: [{ id: "n-1", body: "Private note" }], notes_total: 1 }));
    loadAttendeeDetailData.mockReturnValueOnce(new Promise(() => undefined));
    renderPage();
    const dialog = await openEraseDialog();
    typeName(dialog);
    confirmErase(dialog);

    expect(await screen.findByRole("heading", { name: /Erased attendee/ })).toBeTruthy();
    expect(screen.queryByText("Anna Alpha")).toBeNull();
    expect(screen.queryByText("anna@example.com")).toBeNull();
    expect(screen.queryByText("Private note")).toBeNull();
    expect((screen.getByRole("button", { name: "Edit" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("does not let a read that started before the erasure bring the person back when it answers late", async () => {
    eraseAttendee.mockResolvedValueOnce({ erased: 1, already_erased: 0, not_found: 0, wallet_pending: 0, wallet_removed_ids: [] });
    mockLoad(baseDetail({ notes_total: 51, notes_page: 1, notes_page_size: 50 }));
    let answerOlderRead!: (value: unknown) => void;
    // The second page of notes: a read that is still on its way when the erasure is confirmed.
    loadAttendeeDetailData.mockReturnValueOnce(new Promise((resolve) => (answerOlderRead = resolve)));
    mockLoad(erasedDetail());
    renderNotesTab();
    await screen.findByRole("heading", { name: "Anna Alpha" });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    const dialog = await openEraseDialog();
    typeName(dialog);
    confirmErase(dialog);
    expect(await screen.findByRole("heading", { name: /Erased attendee/ })).toBeTruthy();

    await act(async () => {
      answerOlderRead({ detail: baseDetail({ notes_total: 51, notes_page: 2, notes_page_size: 50 }), attributeFields: [], itemsWarning: null });
      await Promise.resolve();
    });

    expect(screen.getByRole("heading", { name: /Erased attendee/ })).toBeTruthy();
    expect(screen.queryByText("Anna Alpha")).toBeNull();
  });

  it("does not let a note saved just before the erasure bring the person back when its answer arrives late", async () => {
    eraseAttendee.mockResolvedValueOnce({ erased: 1, already_erased: 0, not_found: 0, wallet_pending: 0, wallet_removed_ids: [] });
    mockLoad(baseDetail());
    mockLoad(erasedDetail());
    let answerNote!: (value: unknown) => void;
    addAttendeeNote.mockReturnValueOnce(new Promise((resolve) => (answerNote = resolve)));
    renderNotesTab();
    await screen.findByRole("heading", { name: "Anna Alpha" });
    fireEvent.change(screen.getByPlaceholderText("Add a note about this attendee…"), { target: { value: "Private note" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(addAttendeeNote).toHaveBeenCalledOnce());

    const dialog = await openEraseDialog();
    typeName(dialog);
    confirmErase(dialog);
    expect(await screen.findByRole("heading", { name: /Erased attendee/ })).toBeTruthy();

    // The server saved the note before it erased the person, so its answer still shows them.
    await act(async () => {
      answerNote(
        baseDetail({
          notes: [{ id: "n-1", body: "Private note", author_display: "Admin", created_at: "2026-10-09T11:59:00.000Z" }],
          notes_total: 1,
          notes_page: 1,
        }),
      );
      await Promise.resolve();
    });

    expect(screen.getByRole("heading", { name: /Erased attendee/ })).toBeTruthy();
    expect(screen.queryByText("Anna Alpha")).toBeNull();
    expect(screen.queryByText("anna@example.com")).toBeNull();
    expect(screen.queryByText("Private note")).toBeNull();
  });

  it("shows the check-in time only to the hour of the event's zone at once, while the page still waits", async () => {
    setPreferredLocale("en-GB");
    const { baseAttendeeDetailEvent } = await import("../test-utils.js");
    // India is half an hour off the UTC hour: 10:37 UTC is 16:07 there, and the hour that began at 16:00 there began at 10:30 UTC.
    baseAttendeeDetailEvent.timezone = "Asia/Kolkata";
    try {
      eraseAttendee.mockResolvedValueOnce({ erased: 1, already_erased: 0, not_found: 0, wallet_pending: 0, wallet_removed_ids: [] });
      mockLoad(baseDetail({ admitted_at: "2026-09-01T10:37:21.123Z", check_in_status: "admitted" }));
      loadAttendeeDetailData.mockReturnValueOnce(new Promise(() => undefined));
      renderPage();
      const dialog = await openEraseDialog();
      typeName(dialog);
      confirmErase(dialog);

      expect(await screen.findByRole("heading", { name: /Erased attendee/ })).toBeTruthy();
      expect(screen.getByText("Around 16:00")).toBeTruthy();
      expect(screen.queryByText(/16:07|15:30/)).toBeNull();
    } finally {
      baseAttendeeDetailEvent.timezone = "Europe/Warsaw";
    }
  });

  it.each([
    ["on a live event someone not checked in is cancelled, as the server does", false, "Cancelled"],
    ["on an archived event nobody is, because the numbers there are final", true, "Active"],
  ])("shows the pass at once as the server will hold it: %s", async (_label, archived, passStatus) => {
    const { baseAttendeeDetailEvent } = await import("../test-utils.js");
    baseAttendeeDetailEvent.archived_at = archived ? "2026-08-01T00:00:00.000Z" : null;
    try {
      eraseAttendee.mockResolvedValueOnce({ erased: 1, already_erased: 0, not_found: 0, wallet_pending: 0, wallet_removed_ids: [] });
      mockLoad(baseDetail());
      loadAttendeeDetailData.mockReturnValueOnce(new Promise(() => undefined));
      renderPage();
      const dialog = await openEraseDialog();
      typeName(dialog);
      confirmErase(dialog);

      expect(await screen.findByRole("heading", { name: /Erased attendee/ })).toBeTruthy();
      const strip = document.querySelector(".attendee-status-strip") as HTMLElement;
      expect(within(strip).getByText(passStatus)).toBeTruthy();
    } finally {
      baseAttendeeDetailEvent.archived_at = null;
    }
  });

  it("shows the pass as deleted at once when the erasure deleted it at the provider, while the page still waits", async () => {
    eraseAttendee.mockResolvedValueOnce({ erased: 1, already_erased: 0, not_found: 0, wallet_pending: 0, wallet_removed_ids: ["att-1"] });
    mockLoad(baseDetail({ wallet_pass: pass() }));
    loadAttendeeDetailData.mockReturnValueOnce(new Promise(() => undefined));
    renderPage();
    const dialog = await openEraseDialog();
    typeName(dialog);
    confirmErase(dialog);

    expect(await screen.findByRole("heading", { name: /Erased attendee/ })).toBeTruthy();
    const row = screen.getByText("Pass at the wallet provider").parentElement as HTMLElement;
    expect(within(row).getByText(/^Deleted on .*2026/)).toBeTruthy();
    expect(screen.getByText("Pass removed")).toBeTruthy();
    expect(screen.queryByText(/Not deleted yet/)).toBeNull();
  });

  it("does not call a pass deleted that the erasure did not delete: one that never reached the provider, one removed before", async () => {
    setPreferredLocale("en-GB");
    eraseAttendee.mockResolvedValueOnce({ erased: 1, already_erased: 0, not_found: 0, wallet_pending: 0, wallet_removed_ids: [] });
    mockLoad(baseDetail({ wallet_pass: pass({ provider_removed_at: "2026-08-01T09:00:00.000Z" }) }));
    loadAttendeeDetailData.mockReturnValueOnce(new Promise(() => undefined));
    renderPage();
    const dialog = await openEraseDialog();
    typeName(dialog);
    confirmErase(dialog);

    expect(await screen.findByRole("heading", { name: /Erased attendee/ })).toBeTruthy();
    // The date of the earlier removal stays; it is not overwritten with the time of the erasure.
    expect(screen.getByText("Deleted on 01 Aug 2026")).toBeTruthy();
  });

  it("says None for a pass that the erasure did not delete and that was never removed", async () => {
    eraseAttendee.mockResolvedValueOnce({ erased: 1, already_erased: 0, not_found: 0, wallet_pending: 0, wallet_removed_ids: [] });
    mockLoad(baseDetail({ wallet_pass: pass() }));
    loadAttendeeDetailData.mockReturnValueOnce(new Promise(() => undefined));
    renderPage();
    const dialog = await openEraseDialog();
    typeName(dialog);
    confirmErase(dialog);

    expect(await screen.findByRole("heading", { name: /Erased attendee/ })).toBeTruthy();
    const row = screen.getByText("Pass at the wallet provider").parentElement as HTMLElement;
    expect(within(row).getByText("None")).toBeTruthy();
    expect(screen.queryByText(/^Deleted on/)).toBeNull();
  });

  it.each([
    ["queued", null, "Cancelled"],
    ["failed", true, "Cancelled"],
    ["failed", false, "Failed"],
    ["sent", null, "Sent"],
  ])("shows mail that was %s (retryable %s) as %s at once, as the server leaves it", async (status, retryable, label) => {
    eraseAttendee.mockResolvedValueOnce({ erased: 1, already_erased: 0, not_found: 0, wallet_pending: 0, wallet_removed_ids: [] });
    mockLoad(baseDetail({ deliveries: [{ id: "d-1", status, retryable, attendee_name: "Anna Alpha", recipient_email: "anna@example.com" }] }));
    loadAttendeeDetailData.mockReturnValueOnce(new Promise(() => undefined));
    renderPage();
    const dialog = await openEraseDialog();
    typeName(dialog);
    confirmErase(dialog);

    expect(await screen.findByRole("heading", { name: /Erased attendee/ })).toBeTruthy();
    const chip = screen.getByText("Ticket delivery").closest(".attendee-status-chip") as HTMLElement;
    expect(within(chip).getByText(label)).toBeTruthy();
    // The Delivery history card says the same about the delivery.
    const history = screen.getByText("Delivery history").closest(".at-card") as HTMLElement;
    expect(within(history).getByText(label)).toBeTruthy();
  });

  it("offers a Retry when the page cannot read the server's version afterwards, and the Retry reads it again", async () => {
    eraseAttendee.mockResolvedValueOnce({ erased: 1, already_erased: 0, not_found: 0, wallet_pending: 0, wallet_removed_ids: [] });
    mockLoad(baseDetail());
    loadAttendeeDetailData.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    renderPage();
    const dialog = await openEraseDialog();
    typeName(dialog);
    confirmErase(dialog);

    const warning = (await screen.findByText("Could not load attendee.")).closest(".at-notice") as HTMLElement;
    expect(screen.getByRole("heading", { name: /Erased attendee/ })).toBeTruthy();
    mockLoad(erasedDetail());
    fireEvent.click(within(warning).getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(screen.queryByText("Could not load attendee.")).toBeNull());
    expect(loadAttendeeDetailData).toHaveBeenCalledTimes(3);
    expect(screen.getByRole("heading", { name: /Erased attendee/ })).toBeTruthy();
  });

  it("keeps the Try again for a pass that is still at the provider when the page cannot read the server's version", async () => {
    eraseAttendee.mockResolvedValueOnce({ erased: 1, already_erased: 0, not_found: 0, wallet_pending: 1, wallet_removed_ids: [] });
    mockLoad(baseDetail({ wallet_pass: pass() }));
    loadAttendeeDetailData.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    renderPage();
    const dialog = await openEraseDialog();
    typeName(dialog);
    confirmErase(dialog);

    // The warning dialog comes first. Closing it leaves the page, which has to go on offering the retry.
    const warning = await screen.findByRole("dialog", { name: "Personal data erased" });
    fireEvent.click(within(warning).getByRole("button", { name: "Close" }));
    expect(await screen.findByText("Could not load attendee.")).toBeTruthy();
    const row = screen.getByText("Pass at the wallet provider").parentElement as HTMLElement;
    expect(within(row).getByText(/Not deleted yet/)).toBeTruthy();
    expect(within(row).getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("keeps the newest read when an older one answers last: a pass that was deleted stays deleted", async () => {
    eraseAttendee.mockResolvedValueOnce({ erased: 1, already_erased: 0, not_found: 0, wallet_pending: 1, wallet_removed_ids: [] });
    mockLoad(baseDetail({ wallet_pass: pass() }));
    let answerFirstRead!: (value: unknown) => void;
    // The read right after the erasure is slow, and says the pass is still at the provider.
    loadAttendeeDetailData.mockReturnValueOnce(new Promise((resolve) => (answerFirstRead = resolve)));
    renderPage();
    const dialog = await openEraseDialog();
    typeName(dialog);
    confirmErase(dialog);

    const result = await screen.findByRole("dialog", { name: "Personal data erased" });
    // Try again works, and the read it starts answers first: the pass is gone from the provider.
    eraseAttendee.mockResolvedValueOnce({ erased: 0, already_erased: 1, not_found: 0, wallet_pending: 0, wallet_removed_ids: ["att-1"] });
    mockLoad(erasedDetail({ wallet_pass: pass({ provider_removed_at: "2026-10-08T12:05:00.000Z" }) }));
    fireEvent.click(within(result).getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(/^Deleted on .*2026/)).toBeTruthy();

    await act(async () => {
      answerFirstRead({
        detail: erasedDetail({ wallet_pass: pass(), wallet_pass_delete_pending: true }),
        attributeFields: [],
        itemsWarning: null,
      });
      await Promise.resolve();
    });

    expect(screen.getByText(/^Deleted on .*2026/)).toBeTruthy();
    expect(screen.queryByText(/Not deleted yet/)).toBeNull();
  });

  it("keeps the person off the screen when the page cannot read the server's version afterwards", async () => {
    eraseAttendee.mockResolvedValueOnce({ erased: 1, already_erased: 0, not_found: 0, wallet_pending: 0, wallet_removed_ids: [] });
    mockLoad(baseDetail({ wallet_pass: pass({ apple_url: "https://wallet.example.com/a", android_url: "https://wallet.example.com/g" }) }));
    loadAttendeeDetailData.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    renderPage();
    const dialog = await openEraseDialog();
    typeName(dialog);
    confirmErase(dialog);

    expect(await screen.findByText("Could not load attendee.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Erased attendee/ })).toBeTruthy();
    expect(screen.queryByText("Anna Alpha")).toBeNull();
    expect(screen.queryByText("anna@example.com")).toBeNull();
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

    resolveErase({ erased: 1, already_erased: 0, not_found: 0, wallet_pending: 0, wallet_removed_ids: [] });
    expect(await screen.findByRole("heading", { name: /Erased attendee/ })).toBeTruthy();
  });

  it("keeps the remove dialog open while the removal runs: Escape does nothing until it has answered", async () => {
    let resolveRemoval!: (value: unknown) => void;
    removeAttendee.mockReturnValueOnce(new Promise((resolve) => (resolveRemoval = resolve)));
    mockLoad(baseDetail());
    renderPage();
    await screen.findByRole("heading", { name: "Anna Alpha" });
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /^Remove from event/ }));
    const dialog = await screen.findByRole("dialog", { name: "Remove this person from the event?" });
    fireEvent.change(within(dialog).getByLabelText('Type "Anna Alpha" to confirm'), { target: { value: "Anna Alpha" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove from event" }));

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "Remove this person from the event?" })).toBeTruthy();

    resolveRemoval({ removed: 1, not_found: 0 });
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
    eraseAttendee.mockResolvedValueOnce({ erased: 1, already_erased: 0, not_found: 0, wallet_pending: 1, wallet_removed_ids: [] });
    mockLoad(baseDetail());
    mockLoad(erasedDetail({ wallet_pass: pass(), wallet_pass_delete_pending: true }));
    renderPage();
    const dialog = await openEraseDialog();
    typeName(dialog);
    confirmErase(dialog);

    const result = await screen.findByRole("dialog", { name: "Personal data erased" });
    expect(within(result).getByText("The wallet pass is still at the provider.")).toBeTruthy();
    expect(screen.queryByText("Personal data erased", { selector: "[role=status] *" })).toBeNull();

    eraseAttendee.mockResolvedValueOnce({ erased: 0, already_erased: 1, not_found: 0, wallet_pending: 0, wallet_removed_ids: ["att-1"] });
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
      resolveErase({ erased: 1, already_erased: 0, not_found: 0, wallet_pending: 0, wallet_removed_ids: [] });
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

  it("has a More actions menu where Erase is off, with the date, and Remove from event stays", async () => {
    await openErasedPage();

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    const erase = await screen.findByRole("menuitem", { name: /^Erase personal data/ });
    expect((erase as HTMLButtonElement).disabled).toBe(true);
    expect(within(erase).getByText(/^Personal data was erased on .*2026\.$/)).toBeTruthy();

    removeAttendee.mockResolvedValueOnce({ removed: 1, not_found: 0 });
    fireEvent.click(screen.getByRole("menuitem", { name: /^Remove from event/ }));
    const dialog = await screen.findByRole("dialog", { name: "Remove this person from the event?" });
    // There is nothing left to erase, so the dialog has no way across to Erase.
    expect(within(dialog).queryByRole("button", { name: "Use Erase personal data" })).toBeNull();
    fireEvent.change(within(dialog).getByLabelText('Type "Erased attendee" to confirm'), {
      target: { value: "Erased attendee" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove from event" }));

    await screen.findByText("Attendees list marker");
    expect(removeAttendee).toHaveBeenCalledWith("evt-1", "att-1", "duplicate");
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
    eraseAttendee.mockResolvedValueOnce({ erased: 0, already_erased: 1, not_found: 0, wallet_pending: 1, wallet_removed_ids: [] });
    fireEvent.click(within(result).getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(eraseAttendee).toHaveBeenCalledWith("evt-1", "att-1"));
    await within(result).findByText("The wallet pass is still at the provider.");
  });

  it("shows the pass as deleted at once when Try again worked, even if the reload that follows fails", async () => {
    await openErasedPage({ wallet_pass: pass(), wallet_pass_delete_pending: true });
    const row = screen.getByText("Pass at the wallet provider").parentElement as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Try again" }));
    const result = await screen.findByRole("dialog", { name: "Personal data erased" });
    eraseAttendee.mockResolvedValueOnce({ erased: 0, already_erased: 1, not_found: 0, wallet_pending: 0, wallet_removed_ids: ["att-1"] });
    loadAttendeeDetailData.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    fireEvent.click(within(result).getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Wallet pass deleted")).toBeTruthy();
    expect(await screen.findByText("Could not load attendee.")).toBeTruthy();
    expect(screen.getByText(/^Deleted on .*2026/)).toBeTruthy();
    expect(screen.queryByText(/Not deleted yet/)).toBeNull();
  });

  it("keeps showing the pass as to be deleted when Try again got an answer that says it still is", async () => {
    await openErasedPage({ wallet_pass: pass(), wallet_pass_delete_pending: true });
    const row = screen.getByText("Pass at the wallet provider").parentElement as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Try again" }));
    const result = await screen.findByRole("dialog", { name: "Personal data erased" });
    eraseAttendee.mockResolvedValueOnce({ erased: 0, already_erased: 1, not_found: 0, wallet_pending: 1, wallet_removed_ids: [] });
    loadAttendeeDetailData.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    fireEvent.click(within(result).getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Could not load attendee.")).toBeTruthy();
    expect(screen.getByText(/Not deleted yet/)).toBeTruthy();
    expect(screen.queryByText(/^Deleted on/)).toBeNull();
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

    eraseAttendee.mockResolvedValueOnce({ erased: 0, already_erased: 1, not_found: 0, wallet_pending: 0, wallet_removed_ids: [] });
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
