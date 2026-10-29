// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, MemoryRouter, Route, RouterProvider, Routes } from "react-router";
import { ApiError } from "../../src/api/client.js";
import type { AttendeeCompanionDto, EventCustomFieldDto } from "../../src/api/types.js";
import { ARCHIVED_ACTION_TOOLTIP } from "../../src/components/ArchivedGuard.js";
import { AttendeeDetailPage } from "../../src/pages/AttendeeDetailPage.js";
import { baseAttendeeDetailEvent, deferred, getTooltipText, makeOrgAdminAssignment, mockMatchMedia, renderWithToast } from "../test-utils.js";
import { answerField } from "./answerTypeFixtures.js";

/**
 * The card of a guest's companion on the attendee's page (D-E5): what it shows, the Edit dialog (what it sends, what it checks first,
 * what it says when the server refuses), the Remove confirmation (what it tells, what it does, what it says when it fails), the archived
 * event, a page whose questions could not be read, and a read that started before a change.
 */
const loadAttendeeDetailData = vi.fn();
const updateAttendeeCompanion = vi.fn();
const removeAttendeeCompanion = vi.fn();
const refreshEvent = vi.fn();
const addToast = vi.fn();

let outletEvent: typeof baseAttendeeDetailEvent = { ...baseAttendeeDetailEvent };

vi.mock("../../src/attendees/attendeeDetailForm.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/attendees/attendeeDetailForm.js")>()),
  loadAttendeeDetailData: (...args: unknown[]) => loadAttendeeDetailData(...args),
}));
vi.mock("../../src/auth/AuthProvider.js", () => ({
  useAuth: () => ({ assignments: [makeOrgAdminAssignment()], user: { id: "user-admin-1" } }),
}));
vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router")>()),
  useOutletContext: () => ({ event: outletEvent, refreshEvent }),
}));
vi.mock("../../src/api/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/api/client.js")>()),
  updateAttendee: vi.fn(),
  fetchAttendeeDetail: vi.fn(),
  updateAttendeeCompanion: (...args: unknown[]) => updateAttendeeCompanion(...args),
  removeAttendeeCompanion: (...args: unknown[]) => removeAttendeeCompanion(...args),
}));
vi.mock("@admitto/ui", async (importOriginal) => ({ ...(await importOriginal<typeof import("@admitto/ui")>()), useToast: () => ({ addToast }) }));

const COMPANION: AttendeeCompanionDto = { slot: 1, name: "Piotr Companion", custom_data: { diet: "vegan", plate: "WA 12345" } };
const FIELDS: EventCustomFieldDto[] = [
  answerField("diet", "Diet", "select", { options: ["vegan", "none"], applies_to: "companion" }),
  answerField("plate", "Plate", "text", { applies_to: "companion" }),
  answerField("pet", "Pet", "boolean", { applies_to: "companion" }),
  answerField("leash", "Leash", "text", { applies_to: "companion", rules: { show_when: { field: "pet", value: true } } }),
];

function detailOf(companion: AttendeeCompanionDto | null | undefined, overrides: Record<string, unknown> = {}) {
  return {
    id: "att-1",
    name: "Anna",
    email: "anna@example.com",
    company: null,
    department: null,
    ticket_type: null,
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
    notes: [],
    notes_total: 0,
    notes_page: 1,
    notes_page_size: 50,
    ...(companion === undefined ? {} : { companion }),
    ...overrides,
  };
}

function mockLoad(companion: AttendeeCompanionDto | null | undefined, options: { fields?: EventCustomFieldDto[]; itemsWarning?: string | null; detail?: Record<string, unknown> } = {}) {
  loadAttendeeDetailData.mockResolvedValueOnce({
    detail: detailOf(companion, options.detail),
    attributeFields: [],
    companionFields: options.fields ?? FIELDS,
    itemsWarning: options.itemsWarning ?? null,
  });
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

const pageLoaded = () => screen.findByRole("heading", { name: "Anna" });
const card = () => screen.getByText("Companion", { selector: ".at-card__title" }).closest(".at-card") as HTMLElement;
const editButton = () => within(card()).getByRole("button", { name: "Edit" }) as HTMLButtonElement;
const removeButton = () => within(card()).getByRole("button", { name: "Remove" }) as HTMLButtonElement;
const dialog = () => screen.getByRole("dialog", { name: "Edit companion" });
const nameBox = () => within(dialog()).getByLabelText("Full name") as HTMLInputElement;
const saveButton = () => within(dialog()).getByRole("button", { name: "Save" }) as HTMLButtonElement;
const typeName = (value: string) => fireEvent.change(nameBox(), { target: { value } });
const alerts = () => within(dialog()).queryAllByRole("alert").map((alert) => alert.textContent);
const REMOVE_TITLE = "Remove the companion?";
const confirmRemove = () => screen.getByRole("button", { name: "Remove companion" });

async function openEdit() {
  renderPage();
  await pageLoaded();
  fireEvent.click(editButton());
  return dialog();
}

beforeEach(() => {
  mockMatchMedia(true);
  outletEvent = { ...baseAttendeeDetailEvent };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  loadAttendeeDetailData.mockReset();
  vi.unstubAllGlobals();
});

describe("the companion card", () => {
  it.each([["null", null], ["absent", undefined]])("is not on the page of a guest who brings nobody (%s)", async (_label, companion) => {
    mockLoad(companion);
    renderPage();
    await pageLoaded();

    expect(screen.queryByText("Companion", { selector: ".at-card__title" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
  });

  it("shows the name and the answers under the words of their questions, with Edit and Remove", async () => {
    mockLoad(COMPANION);
    renderPage();
    await pageLoaded();

    const rows = Array.from(card().querySelectorAll(".attendee-detail-row")).map((row) => Array.from(row.children).map((cell) => cell.textContent));
    expect(rows).toEqual([
      ["Name", "Piotr Companion"],
      ["Diet", "vegan"],
      ["Plate", "WA 12345"],
    ]);
    expect(editButton().disabled).toBe(false);
    expect(removeButton().disabled).toBe(false);
  });

  it("lists the answers in the order of the event's questions, whatever order the database holds them in", async () => {
    mockLoad({ slot: 1, name: "Piotr Companion", custom_data: { plate: "WA 12345", diet: "vegan" } });
    renderPage();
    await pageLoaded();

    const labels = Array.from(card().querySelectorAll(".attendee-detail-row > span:first-child")).map((cell) => cell.textContent);
    expect(labels).toEqual(["Name", "Diet", "Plate"]);
  });

  it("reads the answer to a question with a long label under it, and the answer to a short one beside it", async () => {
    const longQuestion = answerField("long_question", "Registration number of the companion's car", "text", { applies_to: "companion" });
    mockLoad({ slot: 1, name: "Piotr Companion", custom_data: { long_question: "WA 12345", diet: "vegan" } }, { fields: [longQuestion, ...FIELDS] });
    renderPage();
    await pageLoaded();

    const rowOf = (label: string) => within(card()).getByText(label).closest(".attendee-detail-row")!;
    expect(rowOf("Registration number of the companion's car").classList.contains("attendee-detail-row--long")).toBe(true);
    expect(rowOf("Diet").classList.contains("attendee-detail-row--long")).toBe(false);
    expect(rowOf("Name").classList.contains("attendee-detail-row--long")).toBe(false);
  });

  it("names an answer whose question is gone by its key, and reads a long one under its label", async () => {
    mockLoad({ slot: 1, name: "Piotr Companion", custom_data: { gone_question: "kept", plate: "x".repeat(80) } });
    renderPage();
    await pageLoaded();

    expect(within(card()).getByText("Gone question")).toBeTruthy();
    expect(card().querySelectorAll(".attendee-detail-row--long")).toHaveLength(1);
  });

  it("shows a companion with no answers by the name alone", async () => {
    mockLoad({ slot: 1, name: "Piotr Companion", custom_data: null });
    renderPage();
    await pageLoaded();

    expect(card().querySelectorAll(".attendee-detail-row")).toHaveLength(1);
  });

  it("shows the words of the person, not a placeholder, even if the name is long: the row wraps it", async () => {
    mockLoad({ slot: 1, name: "A".repeat(100), custom_data: null });
    renderPage();
    await pageLoaded();

    expect(within(card()).getByText("A".repeat(100))).toBeTruthy();
  });
});

describe("the Edit dialog", () => {
  it("opens over the page, named, with the name and the answers of the companion and the focus on the name", async () => {
    mockLoad(COMPANION);
    const open = await openEdit();

    expect(open.getAttribute("aria-modal")).toBe("true");
    expect(nameBox().value).toBe("Piotr Companion");
    expect(document.activeElement).toBe(nameBox());
    expect((within(open).getByLabelText("Plate") as HTMLInputElement).value).toBe("WA 12345");
    expect(within(open).getByRole("button", { name: /Diet/ })).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
  });

  it("asks the questions about the companion only, none of the guest's", async () => {
    mockLoad(COMPANION, { fields: FIELDS.slice(0, 2) });
    const open = await openEdit();

    expect(within(open).queryByLabelText("Shirt")).toBeNull();
    expect(within(open).getByLabelText("Plate")).toBeTruthy();
  });

  it("sends the whole companion: the trimmed name and the answers, and nothing the card did not change as a surprise", async () => {
    const saved = { slot: 1, name: "Anna Companion", custom_data: { diet: "vegan", plate: "WA 12345" } };
    updateAttendeeCompanion.mockResolvedValueOnce(detailOf(saved));
    mockLoad(COMPANION);
    await openEdit();

    typeName("  Anna Companion  ");
    expect(saveButton().disabled).toBe(false);
    fireEvent.click(saveButton());

    await waitFor(() => expect(updateAttendeeCompanion).toHaveBeenCalledTimes(1));
    expect(updateAttendeeCompanion).toHaveBeenCalledWith("evt-1", "att-1", { name: "Anna Companion", custom_data: { diet: "vegan", plate: "WA 12345" } });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit companion" })).toBeNull());
    expect(addToast).toHaveBeenCalledWith("Companion saved", "success");
    expect(within(card()).getByText("Anna Companion")).toBeTruthy();
    expect(within(card()).queryByText("Piotr Companion")).toBeNull();
  });

  it("leaves an answer that was cleared out of the body, which is how the server clears it", async () => {
    updateAttendeeCompanion.mockResolvedValueOnce(detailOf({ slot: 1, name: "Piotr Companion", custom_data: { diet: "vegan" } }));
    mockLoad(COMPANION);
    await openEdit();

    fireEvent.change(within(dialog()).getByLabelText("Plate"), { target: { value: "   " } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(updateAttendeeCompanion).toHaveBeenCalled());
    expect(updateAttendeeCompanion.mock.calls[0]![2]).toEqual({ name: "Piotr Companion", custom_data: { diet: "vegan" } });
    await waitFor(() => expect(within(card()).queryByText("WA 12345")).toBeNull());
  });

  it("asks a question with a condition only when the condition holds, and sends no answer to one that is hidden", async () => {
    updateAttendeeCompanion.mockResolvedValueOnce(detailOf({ slot: 1, name: "Piotr Companion", custom_data: { diet: "vegan", plate: "WA 12345" } }));
    mockLoad({ slot: 1, name: "Piotr Companion", custom_data: { diet: "vegan", pet: "true", leash: "short" } });
    await openEdit();
    expect((within(dialog()).getByLabelText("Leash") as HTMLInputElement).value).toBe("short");

    fireEvent.click(within(dialog()).getByRole("button", { name: /Pet/ }));
    fireEvent.click(within(screen.getByRole("list", { name: "Pet" })).getByRole("button", { name: "No" }));

    expect(within(dialog()).queryByLabelText("Leash")).toBeNull();
    fireEvent.click(saveButton());
    await waitFor(() => expect(updateAttendeeCompanion).toHaveBeenCalled());
    expect(updateAttendeeCompanion.mock.calls[0]![2]).toEqual({ name: "Piotr Companion", custom_data: { diet: "vegan", pet: "false" } });
  });

  it("does not count what is typed for a question that a condition hides as an edit", async () => {
    mockLoad({ slot: 1, name: "Piotr Companion", custom_data: { diet: "vegan" } });
    await openEdit();

    expect(within(dialog()).queryByLabelText("Leash")).toBeNull();
    expect(saveButton().disabled).toBe(true);
  });

  it("says that the name is needed and sends nothing, without waiting for the server", async () => {
    mockLoad(COMPANION);
    await openEdit();

    typeName("   ");
    fireEvent.click(saveButton());

    expect(alerts()).toEqual(["Enter the companion's name."]);
    expect(updateAttendeeCompanion).not.toHaveBeenCalled();
  });

  it("says which required question is not answered, and sends nothing", async () => {
    const required = answerField("badge", "Badge name", "text", { applies_to: "companion", required: true });
    mockLoad({ slot: 1, name: "Piotr Companion", custom_data: null }, { fields: [required] });
    await openEdit();

    typeName("Anna Companion");
    // Blank is not empty to the browser's own check, which would otherwise stop the form first.
    fireEvent.change(within(dialog()).getByLabelText(/Badge name/), { target: { value: "   " } });
    fireEvent.click(saveButton());

    expect(alerts()).toEqual(["Badge name is required."]);
    expect(updateAttendeeCompanion).not.toHaveBeenCalled();
  });

  it("keeps what was typed and says in a sentence that the server did not accept the name or an answer", async () => {
    updateAttendeeCompanion.mockRejectedValueOnce(new ApiError(400, "validation_failed"));
    mockLoad(COMPANION);
    await openEdit();

    typeName("someone@example.com");
    fireEvent.click(saveButton());

    await waitFor(() => expect(alerts()).toEqual(["The name or an answer was not accepted. A name cannot be a link or an address, and an answer has to be what its question takes."]));
    expect(nameBox().value).toBe("someone@example.com");
    expect(saveButton().getAttribute("aria-busy")).not.toBe("true");
    expect(screen.queryByRole("dialog", { name: "Edit companion" })).not.toBeNull();
    expect(addToast).not.toHaveBeenCalled();
  });

  it("says the fallback for a failure that has no words of its own, in the dialog", async () => {
    updateAttendeeCompanion.mockRejectedValueOnce(new ApiError(500, ""));
    mockLoad(COMPANION);
    await openEdit();

    typeName("Anna Companion");
    fireEvent.click(saveButton());

    await waitFor(() => expect(alerts()).toEqual(["Could not save the companion. Try again."]));
  });

  it("tells the shell that the event is archived, and says so in the dialog", async () => {
    updateAttendeeCompanion.mockRejectedValueOnce(new ApiError(403, "event_archived"));
    mockLoad(COMPANION);
    await openEdit();

    typeName("Anna Companion");
    fireEvent.click(saveButton());

    await waitFor(() => expect(alerts()).toEqual(["This event is archived."]));
    expect(refreshEvent).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["attendee_erased", 409, "This person's data has been erased, so nothing here can be changed."],
    ["companion_not_found", 404, "This guest has no companion any more. Reload the page."],
  ])("closes the dialog on %s, says so in a toast, and reads the page again", async (code, status, message) => {
    updateAttendeeCompanion.mockRejectedValueOnce(new ApiError(status, code));
    mockLoad(COMPANION);
    mockLoad(null);
    await openEdit();

    typeName("Anna Companion");
    fireEvent.click(saveButton());

    await waitFor(() => expect(addToast).toHaveBeenCalledWith(message, "warning"));
    await waitFor(() => expect(loadAttendeeDetailData).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText("Companion", { selector: ".at-card__title" })).toBeNull());
    expect(screen.queryByRole("dialog", { name: "Edit companion" })).toBeNull();
  });

  it("is busy while the request runs: the button works, and Cancel and Escape do nothing", async () => {
    const pending = deferred<ReturnType<typeof detailOf>>();
    updateAttendeeCompanion.mockReturnValueOnce(pending.promise);
    mockLoad(COMPANION);
    await openEdit();

    typeName("Anna Companion");
    fireEvent.click(saveButton());

    await waitFor(() => expect(saveButton().getAttribute("aria-disabled")).toBe("true"));
    expect((within(dialog()).getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Edit companion" })).not.toBeNull();
    fireEvent.click(saveButton());
    // Enter in a box submits the form without going through the button.
    fireEvent.submit(nameBox().closest("form")!);
    expect(updateAttendeeCompanion).toHaveBeenCalledTimes(1);

    await act(() => Promise.resolve(pending.resolve(detailOf({ slot: 1, name: "Anna Companion", custom_data: null }))));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit companion" })).toBeNull());
  });

  it("closes on Cancel and on Escape without sending anything, and starts again from the companion next time", async () => {
    mockLoad(COMPANION);
    await openEdit();
    typeName("Typed and dropped");

    fireEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Edit companion" })).toBeNull();
    fireEvent.click(editButton());
    expect(nameBox().value).toBe("Piotr Companion");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Edit companion" })).toBeNull();
    expect(updateAttendeeCompanion).not.toHaveBeenCalled();
  });

  it("does not forget an error of the last time when it is opened again", async () => {
    updateAttendeeCompanion.mockRejectedValueOnce(new ApiError(500, "server error"));
    mockLoad(COMPANION);
    await openEdit();
    typeName("Anna Companion");
    fireEvent.click(saveButton());
    await waitFor(() => expect(alerts()).toHaveLength(1));

    fireEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    fireEvent.click(editButton());

    expect(alerts()).toEqual([]);
  });

  it("does not put the answer of a save on the page of another attendee that was opened meanwhile", async () => {
    const pending = deferred<ReturnType<typeof detailOf>>();
    updateAttendeeCompanion.mockReturnValueOnce(pending.promise);
    mockLoad(COMPANION);
    // The other guest brings someone too, so the card (and the request in flight) stays on the page when it opens.
    mockLoad({ slot: 1, name: "Bob Companion", custom_data: null }, { detail: { id: "att-2", name: "Bob Beta" } });
    const router = createMemoryRouter(
      [{ path: "/admin/events/:eventId/attendees/:attendeeId", element: <AttendeeDetailPage /> }],
      { initialEntries: ["/admin/events/evt-1/attendees/att-1"] },
    );
    renderWithToast(<RouterProvider router={router} />);
    await pageLoaded();
    fireEvent.click(editButton());
    typeName("Anna Companion");
    fireEvent.click(saveButton());
    await waitFor(() => expect(updateAttendeeCompanion).toHaveBeenCalled());

    await act(async () => router.navigate("/admin/events/evt-1/attendees/att-2"));
    await screen.findByRole("heading", { name: "Bob Beta" });
    await act(() => Promise.resolve(pending.resolve(detailOf({ slot: 1, name: "Anna Companion", custom_data: null }))));

    expect(screen.getByRole("heading", { name: "Bob Beta" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Anna" })).toBeNull();
    // The companion on the page is Bob's own, not the one the answer was about.
    expect(within(card()).getByText("Bob Companion")).toBeTruthy();
    expect(within(card()).queryByText("Anna Companion")).toBeNull();
  });

  it("keeps the dialog's busy and error state to its own attendee: an answer that comes after the page left is not applied", async () => {
    const pending = deferred<ReturnType<typeof detailOf>>();
    updateAttendeeCompanion.mockReturnValueOnce(pending.promise);
    mockLoad(COMPANION);
    renderPage();
    await pageLoaded();
    fireEvent.click(editButton());
    typeName("Anna Companion");
    fireEvent.click(saveButton());
    await waitFor(() => expect(updateAttendeeCompanion).toHaveBeenCalled());
    cleanup();

    await act(() => Promise.resolve(pending.resolve(detailOf({ slot: 1, name: "Anna Companion", custom_data: null }))));

    expect(addToast).not.toHaveBeenCalled();
  });
});

describe("where the keyboard goes when a dialog closes", () => {
  it("is back on the Edit button after Escape, after Cancel and after a save", async () => {
    updateAttendeeCompanion.mockResolvedValueOnce(detailOf({ slot: 1, name: "Anna Companion", custom_data: null }));
    mockLoad(COMPANION);
    renderPage();
    await pageLoaded();
    expect(document.activeElement).not.toBe(editButton());

    fireEvent.click(editButton());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.activeElement).toBe(editButton());

    fireEvent.click(editButton());
    fireEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    expect(document.activeElement).toBe(editButton());

    fireEvent.click(editButton());
    typeName("Anna Companion");
    fireEvent.click(saveButton());
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit companion" })).toBeNull());
    expect(document.activeElement).toBe(editButton());
  });

  it("is back on the Remove button after the confirmation is cancelled, and on the open tab after a removal that worked", async () => {
    removeAttendeeCompanion.mockResolvedValueOnce(detailOf(null));
    mockLoad(COMPANION);
    renderPage();
    await pageLoaded();

    fireEvent.click(removeButton());
    fireEvent.click(within(screen.getByRole("dialog", { name: REMOVE_TITLE })).getByRole("button", { name: "Cancel" }));
    expect(document.activeElement).toBe(removeButton());

    fireEvent.click(removeButton());
    fireEvent.click(confirmRemove());
    await waitFor(() => expect(screen.queryByText("Companion", { selector: ".at-card__title" })).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Overview" }));
  });
});

describe("the Remove confirmation", () => {
  it("says what it removes and what it frees, in those words, and does nothing until it is confirmed", async () => {
    mockLoad(COMPANION);
    renderPage();
    await pageLoaded();

    fireEvent.click(removeButton());

    const confirmation = screen.getByRole("dialog", { name: REMOVE_TITLE });
    expect(confirmation.textContent).toContain("deletes the companion's name and answers");
    expect(confirmation.textContent).toContain("including any copy in the guest's registration");
    expect(confirmation.textContent).toContain("frees the place they held");
    expect(confirmation.textContent).toContain("cannot be undone");
    expect(removeAttendeeCompanion).not.toHaveBeenCalled();
    fireEvent.click(within(confirmation).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: REMOVE_TITLE })).toBeNull();
    expect(removeAttendeeCompanion).not.toHaveBeenCalled();
  });

  it("removes the companion, drops the card, and says so", async () => {
    removeAttendeeCompanion.mockResolvedValueOnce(detailOf(null));
    mockLoad(COMPANION);
    renderPage();
    await pageLoaded();

    fireEvent.click(removeButton());
    fireEvent.click(confirmRemove());

    await waitFor(() => expect(removeAttendeeCompanion).toHaveBeenCalledWith("evt-1", "att-1"));
    await waitFor(() => expect(screen.queryByText("Companion", { selector: ".at-card__title" })).toBeNull());
    expect(addToast).toHaveBeenCalledWith("Companion removed", "success");
    expect(screen.queryByRole("dialog", { name: REMOVE_TITLE })).toBeNull();
  });

  it("says in the dialog what went wrong, and keeps it open for another try", async () => {
    removeAttendeeCompanion.mockRejectedValueOnce(new ApiError(500, ""));
    mockLoad(COMPANION);
    renderPage();
    await pageLoaded();

    fireEvent.click(removeButton());
    fireEvent.click(confirmRemove());

    const confirmation = await screen.findByRole("dialog", { name: REMOVE_TITLE });
    await waitFor(() => expect(within(confirmation).getByText("Could not remove the companion. Try again.")).toBeTruthy());
    expect(screen.queryByText("Companion", { selector: ".at-card__title" })).not.toBeNull();
    expect(addToast).not.toHaveBeenCalled();
  });

  it("tells the shell that the event is archived, and says so in the dialog", async () => {
    removeAttendeeCompanion.mockRejectedValueOnce(new ApiError(403, "event_archived"));
    mockLoad(COMPANION);
    renderPage();
    await pageLoaded();

    fireEvent.click(removeButton());
    fireEvent.click(confirmRemove());

    await waitFor(() => expect(within(screen.getByRole("dialog", { name: REMOVE_TITLE })).getByText("This event is archived.")).toBeTruthy());
    expect(refreshEvent).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["attendee_erased", 409],
    ["companion_not_found", 404],
  ])("closes on %s with a toast, and reads the page again", async (code, status) => {
    removeAttendeeCompanion.mockRejectedValueOnce(new ApiError(status, code));
    mockLoad(COMPANION);
    mockLoad(null);
    renderPage();
    await pageLoaded();

    fireEvent.click(removeButton());
    fireEvent.click(confirmRemove());

    await waitFor(() => expect(addToast).toHaveBeenCalledWith(expect.any(String), "warning"));
    await waitFor(() => expect(loadAttendeeDetailData).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("dialog", { name: REMOVE_TITLE })).toBeNull();
  });

  it("is busy while the request runs: Cancel and Escape do nothing", async () => {
    const pending = deferred<ReturnType<typeof detailOf>>();
    removeAttendeeCompanion.mockReturnValueOnce(pending.promise);
    mockLoad(COMPANION);
    renderPage();
    await pageLoaded();

    fireEvent.click(removeButton());
    fireEvent.click(confirmRemove());
    await waitFor(() => expect(confirmRemove().getAttribute("aria-disabled") ?? String((confirmRemove() as HTMLButtonElement).disabled)).toBe("true"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: REMOVE_TITLE })).not.toBeNull();

    await act(() => Promise.resolve(pending.resolve(detailOf(null))));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: REMOVE_TITLE })).toBeNull());
  });
});

describe("an archived event", () => {
  it("turns Edit and Remove off, each with the reason", async () => {
    outletEvent = { ...baseAttendeeDetailEvent, archived_at: "2026-01-01T00:00:00.000Z" };
    mockLoad(COMPANION);
    renderPage();
    await pageLoaded();

    for (const button of [editButton(), removeButton()]) {
      expect(button.disabled).toBe(true);
      expect(getTooltipText(button)).toBe(ARCHIVED_ACTION_TOOLTIP);
    }
    fireEvent.click(editButton());
    expect(screen.queryByRole("dialog", { name: "Edit companion" })).toBeNull();
    // What is on the card is still read.
    expect(within(card()).getByText("Piotr Companion")).toBeTruthy();
  });

  it("keeps the dialog's explanation on screen when the event turns out to be archived while it is open, and turns Save off", async () => {
    updateAttendeeCompanion.mockRejectedValueOnce(new ApiError(403, "event_archived"));
    mockLoad(COMPANION);
    renderPage();
    await pageLoaded();
    fireEvent.click(editButton());
    typeName("Anna Companion");
    fireEvent.click(saveButton());
    await waitFor(() => expect(alerts()).toEqual(["This event is archived."]));

    expect(screen.queryByRole("dialog", { name: "Edit companion" })).not.toBeNull();
  });
});

describe("a page whose questions could not be read", () => {
  it("turns Edit off, with the reason, because a save would clear the answers it does not know; Remove still works", async () => {
    mockLoad(COMPANION, { fields: [], itemsWarning: "Attribute fields could not be loaded. Core fields are still editable." });
    renderPage();
    await pageLoaded();

    expect(editButton().disabled).toBe(true);
    expect(getTooltipText(editButton())).toBe("The questions about the companion could not be loaded. Reload the page to edit.");
    expect(removeButton().disabled).toBe(false);
  });
});

describe("a read that started before a change", () => {
  it("does not put back the companion that the change corrected", async () => {
    // Page one of the notes is read first; page two is read again later, and the answer comes after the edit.
    const manyNotes = { notes_total: 120, notes_page: 1, notes_page_size: 50 };
    mockLoad(COMPANION, { detail: manyNotes });
    const olderRead = deferred<{ detail: ReturnType<typeof detailOf>; attributeFields: never[]; companionFields: EventCustomFieldDto[]; itemsWarning: null }>();
    loadAttendeeDetailData.mockReturnValueOnce(olderRead.promise);
    updateAttendeeCompanion.mockResolvedValueOnce(detailOf({ slot: 1, name: "Anna Companion", custom_data: null }, manyNotes));
    renderPage();
    await pageLoaded();

    fireEvent.click(screen.getByRole("tab", { name: /Notes/ }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(loadAttendeeDetailData).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("tab", { name: "Overview" }));
    fireEvent.click(editButton());
    typeName("Anna Companion");
    fireEvent.click(saveButton());
    await waitFor(() => expect(within(card()).getByText("Anna Companion")).toBeTruthy());

    await act(() => {
      olderRead.resolve({ detail: detailOf(COMPANION, { ...manyNotes, notes_page: 2 }), attributeFields: [], companionFields: FIELDS, itemsWarning: null });
      return Promise.resolve();
    });

    expect(within(card()).getByText("Anna Companion")).toBeTruthy();
    expect(within(card()).queryByText("Piotr Companion")).toBeNull();
  });
});
