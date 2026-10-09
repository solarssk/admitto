// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { renderWithToast, mockMatchMedia } from "../test-utils.js";
import { AttendeesPage } from "../../src/pages/AttendeesPage.js";
import type { AttendeeRowDto } from "../../src/api/types.js";
import { setPreferredLocale } from "../../src/utils/locale-store.js";
import { bulkEraseAttendees, eventState, fetchEventAttendees, makeRow } from "./attendeesPageSetup.js";

/** What the API sends for an erased entry: placeholders the screen must never show. */
function erasedRow(id: string): AttendeeRowDto {
  return {
    ...makeRow(id, "Placeholder name from the server"),
    email: `erased-${id}@erased.invalid`,
    company: null,
    erased_at: "2026-10-08T12:00:00.000Z",
    admitted_at: "2026-10-08T10:00:00.000Z",
    check_in_status: "admitted",
  };
}

const rowA = { ...makeRow("att-1", "Jane Doe"), department: "Platform" };
const rowB = makeRow("att-2", "John Smith");
const gone1 = erasedRow("att-e1");
const gone2 = erasedRow("att-e2");

function listOf(items: AttendeeRowDto[], erasedCount: number) {
  return { items, total: items.length, erased_count: erasedCount, page: 1, pageSize: 25 };
}

/** The list page with a second route, to see where a click on an erased row goes. */
function renderListAndPage() {
  return renderWithToast(
    <MemoryRouter initialEntries={["/admin/events/evt-1/attendees"]}>
      <Routes>
        <Route path="/admin/events/:eventId/attendees" element={<AttendeesPage />} />
        <Route path="/admin/events/:eventId/attendees/:attendeeId" element={<div>Attendee page marker</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

function bulkBar() {
  const bar = document.querySelector(".attendees-bulkbar");
  if (!bar) throw new Error("Bulk bar not found");
  return within(bar as HTMLElement);
}

/** Selects the first `count` live rows and opens the erase dialog from the bulk bar's More actions menu. */
async function openEraseDialog(count = 2) {
  await screen.findByText("Jane Doe");
  for (const name of ["Jane Doe", "John Smith"].slice(0, count)) {
    fireEvent.click(screen.getByRole("checkbox", { name: `Select ${name}` }));
  }
  await waitFor(() => expect(bulkBar().getByText(String(count))).toBeTruthy());
  fireEvent.click(bulkBar().getByRole("button", { name: "More actions" }));
  fireEvent.click(bulkBar().getByRole("menuitem", { name: /^Erase personal data/ }));
  return screen.getByRole("dialog", { name: /^Erase personal data of / });
}

const confirmErase = (dialog: HTMLElement) =>
  fireEvent.click(within(dialog).getByRole("button", { name: "Erase personal data" }));

describe("AttendeesPage: erased entries", () => {
  it("leaves erased entries out, says how many, and fetches them only after Show erased", async () => {
    fetchEventAttendees.mockImplementation(async (_eventId: string, params: { includeErased?: boolean }) =>
      params.includeErased ? listOf([rowA, gone1, gone2], 2) : listOf([rowA], 2),
    );

    renderListAndPage();

    await screen.findByText("Jane Doe");
    expect(fetchEventAttendees.mock.calls[0]?.[1]).not.toHaveProperty("includeErased", true);
    expect(screen.getByText("Platform")).toBeTruthy();
    expect(screen.getByText("2 erased entries are hidden. Reports still count them.")).toBeTruthy();
    expect(screen.queryByText("Erased attendee")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show erased" }));

    await screen.findByText("Erased entries are included. Reports count them too.");
    expect(fetchEventAttendees).toHaveBeenLastCalledWith(
      "evt-1",
      expect.objectContaining({ includeErased: true, page: 1 }),
      expect.anything(),
    );
    expect(screen.getAllByText("Erased attendee")).toHaveLength(2);
    expect(screen.getAllByText("Erased")).toHaveLength(2);
    expect(screen.getAllByText(/^Erased on .*2026/)).toHaveLength(2);
    // The server's placeholders never reach the screen.
    expect(screen.queryByText("Placeholder name from the server")).toBeNull();
    expect(screen.queryByText(/erased\.invalid/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Hide erased" }));

    await screen.findByText("2 erased entries are hidden. Reports still count them.");
    expect(fetchEventAttendees).toHaveBeenLastCalledWith(
      "evt-1",
      expect.objectContaining({ includeErased: false }),
      expect.anything(),
    );
  });

  it("uses the singular for one erased entry and shows no line when there are none", async () => {
    fetchEventAttendees.mockResolvedValueOnce(listOf([rowA], 1));
    const first = renderListAndPage();
    await screen.findByText("Jane Doe");
    expect(screen.getByText("1 erased entry is hidden. Reports still count it.")).toBeTruthy();
    first.unmount();

    fetchEventAttendees.mockResolvedValueOnce(listOf([rowA], 0));
    renderListAndPage();
    await screen.findByText("Jane Doe");
    expect(screen.queryByText(/erased entr/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Show erased" })).toBeNull();
  });

  it("gives an erased entry a checkbox that stays off, and Select all skips it", async () => {
    fetchEventAttendees.mockResolvedValue(listOf([rowA, gone1], 1));

    renderListAndPage();

    await screen.findByText("Jane Doe");
    const erasedBox = screen.getByRole("checkbox", { name: "Erased entries cannot be selected" }) as HTMLInputElement;
    expect(erasedBox.disabled).toBe(true);

    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
    await waitFor(() => expect(bulkBar().getByText("1")).toBeTruthy());
    expect((screen.getByRole("checkbox", { name: "Select Jane Doe" }) as HTMLInputElement).checked).toBe(true);
    expect(erasedBox.checked).toBe(false);

    // The one selectable row is selected, so a second click clears it.
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
    await waitFor(() => expect(document.querySelector(".attendees-bulkbar")).toBeNull());
  });

  it("turns Select all off when every row on the page is erased", async () => {
    fetchEventAttendees.mockResolvedValue(listOf([gone1, gone2], 2));

    renderListAndPage();

    await screen.findAllByText("Erased attendee");
    const all = screen.getByRole("checkbox", { name: "Select all" }) as HTMLInputElement;
    expect(all.disabled).toBe(true);
    expect(all.checked).toBe(false);
  });

  it("opens the page of an erased entry from its row", async () => {
    fetchEventAttendees.mockResolvedValue(listOf([gone1], 1));

    renderListAndPage();

    fireEvent.click(await screen.findByRole("button", { name: /Erased attendee/ }));

    expect(await screen.findByText("Attendee page marker")).toBeTruthy();
  });

  it("marks an erased entry on a phone too", async () => {
    mockMatchMedia(false);
    fetchEventAttendees.mockResolvedValue(listOf([rowA, gone1], 1));

    renderListAndPage();

    await screen.findByText("Jane Doe");
    const card = screen.getByText("Erased attendee").closest(".attendees-card");
    expect(card?.classList.contains("attendees-card--erased")).toBe(true);
    expect(within(card as HTMLElement).getByText("Erased")).toBeTruthy();
    expect((screen.getByRole("checkbox", { name: "Erased entries cannot be selected" }) as HTMLInputElement).disabled).toBe(
      true,
    );
  });
});

describe("AttendeesPage: bulk Erase personal data", () => {
  it("lists what is erased and what stays, and does nothing on Cancel", async () => {
    fetchEventAttendees.mockResolvedValue(listOf([rowA, rowB], 0));

    renderListAndPage();
    const dialog = await openEraseDialog();

    expect(within(dialog).getByText("Use this for privacy requests. It cannot be undone.")).toBeTruthy();
    expect(within(dialog).getByText("Names, emails, companies, notes and answers")).toBeTruthy();
    expect(within(dialog).getByText("Their tickets, emails and wallet passes")).toBeTruthy();
    expect(within(dialog).getByText("2 anonymous entries in Reports")).toBeTruthy();
    expect(within(dialog).getByText("People who are already erased are skipped.")).toBeTruthy();
    // No typed name: there is no single name to type.
    expect(within(dialog).queryByRole("textbox")).toBeNull();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(bulkEraseAttendees).not.toHaveBeenCalled();
  });

  it("words the dialog for one selected person in the singular", async () => {
    fetchEventAttendees.mockResolvedValue(listOf([rowA, rowB], 0));

    renderListAndPage();
    const dialog = await openEraseDialog(1);

    expect(within(dialog).getByText("Erase personal data of 1 person?")).toBeTruthy();
    expect(within(dialog).getByText("Name, email, company, notes and answers")).toBeTruthy();
    expect(within(dialog).getByText("Their ticket, emails and wallet pass")).toBeTruthy();
    expect(within(dialog).getByText("1 anonymous entry in Reports")).toBeTruthy();
  });

  it("erases the selection, toasts, clears the selection and reloads the list", async () => {
    fetchEventAttendees.mockResolvedValue(listOf([rowA, rowB], 0));
    bulkEraseAttendees.mockResolvedValue({ erased: 2, already_erased: 0, not_found: 0, wallet_pending: 0, wallet_removed_ids: [] });

    renderListAndPage();
    confirmErase(await openEraseDialog());

    await waitFor(() => expect(bulkEraseAttendees).toHaveBeenCalledWith("evt-1", ["att-1", "att-2"]));
    expect(await screen.findByText("Personal data of 2 people erased")).toBeTruthy();
    await waitFor(() => expect(document.querySelector(".attendees-bulkbar")).toBeNull());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fetchEventAttendees.mock.calls.length).toBeGreaterThan(1);
  });

  it.each([
    ["two people who are not checked in yet", [rowA, rowB], false, "2 people are not checked in yet, so their places become free."],
    [
      "one who is checked in and one who is not",
      [{ ...rowA, admitted_at: "2026-07-01T09:00:00.000Z", check_in_status: "admitted" as const }, rowB],
      false,
      "1 person is not checked in yet, so their place becomes free.",
    ],
    ["people who are all checked in", [{ ...rowA, admitted_at: "2026-07-01T09:00:00.000Z" }, { ...rowB, admitted_at: "2026-07-01T09:05:00.000Z" }], false, null],
    ["people not checked in yet on an archived event", [rowA, rowB], true, null],
  ])("tells whose place becomes free before a bulk erasure: %s", async (_label, rows, archived, line) => {
    eventState.archived_at = archived ? "2026-08-01T00:00:00.000Z" : null;
    fetchEventAttendees.mockResolvedValue(listOf(rows as AttendeeRowDto[], 0));

    renderListAndPage();
    const dialog = await openEraseDialog();

    const warning = within(dialog).queryByText(/not checked in yet, so/);
    expect(warning?.textContent ?? null).toBe(line);
  });

  it("keeps the dialog open while the erasure runs: Escape does nothing until it has answered", async () => {
    let resolveErase!: (value: unknown) => void;
    fetchEventAttendees.mockResolvedValue(listOf([rowA, rowB], 0));
    bulkEraseAttendees.mockReturnValueOnce(new Promise((resolve) => (resolveErase = resolve)));

    renderListAndPage();
    confirmErase(await openEraseDialog());

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "Erase personal data of 2 people?" })).toBeTruthy();

    resolveErase({ erased: 2, already_erased: 0, not_found: 0, wallet_pending: 0, wallet_removed_ids: [] });
    expect(await screen.findByText("Personal data of 2 people erased")).toBeTruthy();
  });

  it("shows nothing of the erased people at once, while the list still waits for the server's version", async () => {
    fetchEventAttendees.mockResolvedValueOnce(listOf([rowA, rowB], 0));
    fetchEventAttendees.mockReturnValueOnce(new Promise(() => undefined));
    bulkEraseAttendees.mockResolvedValue({ erased: 2, already_erased: 0, not_found: 0, wallet_pending: 0, wallet_removed_ids: [] });

    renderListAndPage();
    confirmErase(await openEraseDialog());

    expect(await screen.findAllByText("Erased attendee")).toHaveLength(2);
    expect(screen.queryByText("Jane Doe")).toBeNull();
    expect(screen.queryByText("John Smith")).toBeNull();
    expect(screen.queryByText("att-1@example.com")).toBeNull();
    expect(screen.queryByText("Platform")).toBeNull();
    expect(screen.getAllByRole("checkbox", { name: "Erased entries cannot be selected" })).toHaveLength(2);
  });

  it("shows the check-in time of the erased people only to the hour at once", async () => {
    setPreferredLocale("en-GB");
    const admitted = (id: string, name: string): AttendeeRowDto => ({
      ...makeRow(id, name),
      check_in_status: "admitted",
      admitted_at: "2026-10-09T14:37:21.123Z",
    });
    fetchEventAttendees.mockResolvedValueOnce(listOf([admitted("att-1", "Jane Doe"), admitted("att-2", "John Smith")], 0));
    fetchEventAttendees.mockReturnValueOnce(new Promise(() => undefined));
    bulkEraseAttendees.mockResolvedValue({ erased: 2, already_erased: 0, not_found: 0, wallet_pending: 0, wallet_removed_ids: [] });

    renderListAndPage();
    try {
      confirmErase(await openEraseDialog());

      expect(await screen.findAllByText("Erased attendee")).toHaveLength(2);
      expect(screen.getAllByText(/^14:00/)).toHaveLength(2);
      expect(screen.queryByText(/14:37/)).toBeNull();
    } finally {
      setPreferredLocale(null);
    }
  });

  it.each([
    ["the answer says both passes were deleted", 0, ["att-1", "att-2"], ["Was registered", "Was registered"]],
    ["the answer says only the first pass was deleted", 1, ["att-1"], ["Was registered", "Registered"]],
    ["the answer says no pass was deleted now", 0, [], ["Registered", "Registered"]],
  ])("shows the Wallet column of the erased people at once: %s", async (_label, walletPending, removedIds, expected) => {
    eventState.appleWallet = true;
    const withPass = (id: string, name: string): AttendeeRowDto => ({
      ...makeRow(id, name),
      wallet_status: {
        apple_active_registrations: 1,
        apple_inactive_registrations: 0,
        google_active_registrations: 0,
        google_inactive_registrations: 0,
        samsung_active_registrations: 0,
        samsung_inactive_registrations: 0,
        provider_removed_at: null,
      },
    });
    fetchEventAttendees.mockResolvedValueOnce(listOf([withPass("att-1", "Jane Doe"), withPass("att-2", "John Smith")], 0));
    fetchEventAttendees.mockReturnValueOnce(new Promise(() => undefined));
    bulkEraseAttendees.mockResolvedValue({ erased: 2, already_erased: 0, not_found: 0, wallet_pending: walletPending, wallet_removed_ids: removedIds });

    renderListAndPage();
    confirmErase(await openEraseDialog());
    if (walletPending > 0) fireEvent.click(within(await screen.findByRole("dialog", { name: "Personal data erased" })).getByRole("button", { name: "Close" }));

    expect(await screen.findAllByText("Erased attendee")).toHaveLength(2);
    const labels = screen.getAllByLabelText(/^Apple Wallet: /).map((icon) => icon.getAttribute("aria-label"));
    expect(labels).toEqual(expected.map((label) => `Apple Wallet: ${label}`));
  });

  it("cancels the mail that was queued, in the rows, at once", async () => {
    const queued = (id: string, name: string): AttendeeRowDto => ({ ...makeRow(id, name), last_mail_status: "queued" });
    fetchEventAttendees.mockResolvedValueOnce(listOf([queued("att-1", "Jane Doe"), queued("att-2", "John Smith")], 0));
    fetchEventAttendees.mockReturnValueOnce(new Promise(() => undefined));
    bulkEraseAttendees.mockResolvedValue({ erased: 2, already_erased: 0, not_found: 0, wallet_pending: 0, wallet_removed_ids: [] });

    renderListAndPage();
    confirmErase(await openEraseDialog());

    expect(await screen.findAllByText("Erased attendee")).toHaveLength(2);
    // Each row says Cancelled twice: the pass (nobody was checked in) and the mail.
    expect(screen.getAllByText("Cancelled")).toHaveLength(4);
  });

  it("steps back to the last page that exists when the erasure emptied the page the list was on", async () => {
    const pageOne = Array.from({ length: 25 }, (_, i) => makeRow(`att-p1-${i}`, `Person ${i}`));
    let erased = false;
    fetchEventAttendees.mockImplementation(async (_eventId: string, params: { page?: number }) => {
      const page = params.page ?? 1;
      if (page === 1) return { items: pageOne, total: erased ? 25 : 26, erased_count: erased ? 1 : 0, page, pageSize: 25 };
      // Page 2 held the one row that was erased: the server now has nothing there.
      return { items: erased ? [] : [rowB], total: erased ? 25 : 26, erased_count: erased ? 1 : 0, page, pageSize: 25 };
    });
    bulkEraseAttendees.mockImplementation(async () => {
      erased = true;
      return { erased: 1, already_erased: 0, not_found: 0, wallet_pending: 0, wallet_removed_ids: [] };
    });

    renderListAndPage();
    await screen.findByText("Person 0");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("John Smith");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select John Smith" }));
    await waitFor(() => expect(bulkBar().getByText("1")).toBeTruthy());
    fireEvent.click(bulkBar().getByRole("button", { name: "More actions" }));
    fireEvent.click(bulkBar().getByRole("menuitem", { name: /^Erase personal data/ }));
    confirmErase(screen.getByRole("dialog", { name: "Erase personal data of 1 person?" }));

    await waitFor(() =>
      expect(fetchEventAttendees).toHaveBeenLastCalledWith("evt-1", expect.objectContaining({ page: 1 }), expect.anything()),
    );
    expect(await screen.findByText("Person 0")).toBeTruthy();
    expect(screen.queryByText("No matches")).toBeNull();
    expect(screen.getByText("Page 1 of 1")).toBeTruthy();
  });

  it("works on an archived event: privacy requests do not expire with it", async () => {
    eventState.archived_at = "2026-08-01T00:00:00.000Z";
    fetchEventAttendees.mockResolvedValue(listOf([rowA, rowB], 0));
    bulkEraseAttendees.mockResolvedValue({ erased: 2, already_erased: 0, not_found: 0, wallet_pending: 0, wallet_removed_ids: [] });

    renderListAndPage();
    confirmErase(await openEraseDialog());

    await waitFor(() => expect(bulkEraseAttendees).toHaveBeenCalledTimes(1));
  });

  it("shows an operator-safe error inside the dialog and keeps the selection when the erasure fails", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    fetchEventAttendees.mockResolvedValue(listOf([rowA, rowB], 0));
    bulkEraseAttendees.mockRejectedValueOnce(new ApiError(500, "secret_internal"));

    renderListAndPage();
    confirmErase(await openEraseDialog());

    await screen.findByText("Could not erase personal data. Try again.");
    expect(screen.queryByText("secret_internal")).toBeNull();
    expect(screen.queryByText("Personal data of 2 people erased")).toBeNull();
    expect(screen.getByRole("dialog", { name: "Erase personal data of 2 people?" })).toBeTruthy();
    expect(document.querySelector(".attendees-bulkbar")).toBeTruthy();
  });

  it("says so when nobody was erased because they already were", async () => {
    fetchEventAttendees.mockResolvedValue(listOf([rowA, rowB], 0));
    bulkEraseAttendees.mockResolvedValue({ erased: 0, already_erased: 2, not_found: 0, wallet_pending: 0, wallet_removed_ids: [] });

    renderListAndPage();
    confirmErase(await openEraseDialog());

    expect(await screen.findByText("Already erased")).toBeTruthy();
  });
});

describe("AttendeesPage: a wallet pass that is still at the provider", () => {
  const PENDING = { erased: 2, already_erased: 0, not_found: 0, wallet_pending: 2, wallet_removed_ids: [] };

  async function eraseWithPendingPasses() {
    fetchEventAttendees.mockResolvedValue(listOf([rowA, rowB], 0));
    bulkEraseAttendees.mockResolvedValueOnce(PENDING);
    renderListAndPage();
    confirmErase(await openEraseDialog());
    return screen.findByRole("dialog", { name: "Personal data erased" });
  }

  it("offers Try again instead of a toast, and finishes with a toast when the provider answers", async () => {
    const result = await eraseWithPendingPasses();

    expect(within(result).getByText("2 wallet passes are still at the provider.")).toBeTruthy();
    expect(within(result).getByText("Everything personal inside Admitto is gone.")).toBeTruthy();
    expect(screen.queryByText("Personal data of 2 people erased")).toBeNull();

    bulkEraseAttendees.mockResolvedValueOnce({ erased: 0, already_erased: 2, not_found: 0, wallet_pending: 0, wallet_removed_ids: [] });
    fireEvent.click(within(result).getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Wallet passes deleted")).toBeTruthy();
    expect(bulkEraseAttendees).toHaveBeenLastCalledWith("evt-1", ["att-1", "att-2"]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the dialog, with the new count, while the provider still fails", async () => {
    const result = await eraseWithPendingPasses();

    bulkEraseAttendees.mockResolvedValueOnce({ erased: 0, already_erased: 2, not_found: 0, wallet_pending: 1, wallet_removed_ids: [] });
    fireEvent.click(within(result).getByRole("button", { name: "Try again" }));

    await within(result).findByText("The wallet pass is still at the provider.");
    expect(screen.queryByText("Wallet passes deleted")).toBeNull();
  });

  it("shows an error inside the dialog when Try again itself fails, and Close ends it", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    const result = await eraseWithPendingPasses();

    bulkEraseAttendees.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    fireEvent.click(within(result).getByRole("button", { name: "Try again" }));

    await within(result).findByText("Could not try again. Try again in a moment.");
    // Close waits for the button that has just failed to stop being busy (400ms at least).
    const close = within(result).getByRole("button", { name: "Close" }) as HTMLButtonElement;
    await waitFor(() => expect(close.disabled).toBe(false));
    fireEvent.click(close);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
