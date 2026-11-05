// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router";
import type { EventCustomFieldDto, RoleAssignment } from "../../src/api/types.js";
import { WRITE_ONLY_NEW_NOTE, WRITE_ONLY_REPLACE_NOTE } from "../../src/attendees/CustomDataFieldInput.js";
import { AttendeeDetailPage } from "../../src/pages/AttendeeDetailPage.js";
import { baseAttendeeDetailEvent, deferred, makeOrgAdminAssignment, mockMatchMedia, renderWithToast } from "../test-utils.js";
import { answerField } from "./answerTypeFixtures.js";

/**
 * The sensitive questions on the attendee's page (D-E6): the masks and the one button for each person, and the boxes that are write-only
 * in the edit form of the guest and of the companion.
 */
const loadAttendeeDetailData = vi.fn();
const updateAttendee = vi.fn();
const updateAttendeeCompanion = vi.fn();
const revealAttendeeSensitive = vi.fn();

let assignments: RoleAssignment[] = [];

vi.mock("../../src/attendees/attendeeDetailForm.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/attendees/attendeeDetailForm.js")>()),
  loadAttendeeDetailData: (...args: unknown[]) => loadAttendeeDetailData(...args),
}));
vi.mock("../../src/auth/AuthProvider.js", () => ({
  useAuth: () => ({ assignments, user: { id: "user-1" } }),
}));
vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router")>()),
  useOutletContext: () => ({ event: { ...baseAttendeeDetailEvent, organization_id: "org-1" }, refreshEvent: vi.fn() }),
}));
vi.mock("../../src/api/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/api/client.js")>()),
  fetchAttendeeDetail: vi.fn(),
  updateAttendee: (...args: unknown[]) => updateAttendee(...args),
  updateAttendeeCompanion: (...args: unknown[]) => updateAttendeeCompanion(...args),
  revealAttendeeSensitive: (...args: unknown[]) => revealAttendeeSensitive(...args),
  fetchEventCustomFields: vi.fn().mockResolvedValue([]),
  fetchTicketTypes: vi.fn().mockResolvedValue([]),
}));

const SECRET = "uses a wheelchair";
const STORED = "stored value that must never come back into a box";
const GUEST_FIELDS: EventCustomFieldDto[] = [
  answerField("shirt", "Shirt size", "text"),
  answerField("access", "Accessibility needs", "long_text", { sensitive: true }),
  answerField("badge", "Name on badge", "text", { sensitive: true, required: true }),
];
const COMPANION_FIELDS: EventCustomFieldDto[] = [
  answerField("diet", "Diet", "text", { applies_to: "companion" }),
  answerField("allergy", "Allergies", "text", { applies_to: "companion", sensitive: true, required: true }),
];

function detail(overrides: Record<string, unknown> = {}) {
  return {
    id: "att-1",
    name: "Anna Baseline",
    first_name: "Anna",
    last_name: "Baseline",
    email: "anna@example.com",
    company: null,
    department: null,
    ticket_type: null,
    custom_data: { shirt: "M" },
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
    companion: { slot: 1, name: "Piotr Companion", custom_data: { diet: "vegan" } },
    ...overrides,
  };
}

function load(overrides: Record<string, unknown> = {}) {
  loadAttendeeDetailData.mockResolvedValue({ detail: detail(overrides), attributeFields: GUEST_FIELDS, companionFields: COMPANION_FIELDS, itemsWarning: null });
}

async function renderPage() {
  renderWithToast(
    <MemoryRouter initialEntries={["/admin/events/evt-1/attendees/att-1"]}>
      <Routes>
        <Route path="/admin/events/:eventId/attendees/:attendeeId" element={<AttendeeDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByRole("heading", { name: "Anna Baseline" });
}

const cardOf = (title: string) => screen.getByText(title, { selector: ".at-card__title" }).closest(".at-card") as HTMLElement;
const showOf = (who: string) => screen.getByRole("button", { name: `Show sensitive answers of ${who}` });
async function reveal(who: string) {
  fireEvent.click(showOf(who));
  fireEvent.click(within(screen.getByRole("group", { name: `Show sensitive answers of ${who}?` })).getByRole("button", { name: "Show" }));
  await act(async () => {});
}

beforeEach(() => {
  mockMatchMedia(true);
  assignments = [makeOrgAdminAssignment()];
  load();
  revealAttendeeSensitive.mockResolvedValue({ guest: { access: SECRET }, companions: [{ slot: 1, answers: { allergy: "peanuts" } }] });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  loadAttendeeDetailData.mockReset();
  vi.unstubAllGlobals();
});

describe("the masks on the attendee's page", { timeout: 30_000 }, () => {
  it("shows an ordinary answer and the sensitive questions as hidden, for the guest and for the companion", async () => {
    await renderPage();

    const info = cardOf("Additional information");
    expect(within(info).getByText("M")).toBeTruthy();
    expect(within(info).getByText("Accessibility needs").parentElement?.textContent).toContain("Hidden");
    expect(within(info).queryByText("Shirt size", { selector: "dt" })).toBeNull();
    const companion = cardOf("Companion");
    expect(within(companion).getByText("vegan")).toBeTruthy();
    expect(within(companion).getByText("Allergies").parentElement?.textContent).toContain("Hidden");
    expect(revealAttendeeSensitive).not.toHaveBeenCalled();
  });

  it("gives an administrator one button for the guest and one for the companion, and an operator none", async () => {
    await renderPage();
    expect(showOf("guest")).toBeTruthy();
    expect(showOf("companion")).toBeTruthy();
    cleanup();

    assignments = [{ role: "operator", scope_type: "event", scope_id: "evt-1" } as RoleAssignment];
    await renderPage();
    expect(screen.queryByRole("button", { name: /Show sensitive answers/ })).toBeNull();
    expect(within(cardOf("Additional information")).getByText("Accessibility needs").parentElement?.textContent).toContain("Hidden");
  });

  it("gives an administrator of another organization no button", async () => {
    assignments = [makeOrgAdminAssignment({ scope_id: "org-other" })];
    await renderPage();

    expect(screen.queryByRole("button", { name: /Show sensitive answers/ })).toBeNull();
  });

  it("gives a superadmin the buttons", async () => {
    assignments = [{ role: "superadmin", scope_type: "instance", scope_id: null } as RoleAssignment];
    await renderPage();

    expect(showOf("guest")).toBeTruthy();
  });

  it("shows the guest's answers after the confirmation, and the companion's only when its own button is used", async () => {
    await renderPage();

    await reveal("guest");

    const info = cardOf("Additional information");
    expect(within(info).getByText(SECRET)).toBeTruthy();
    expect(within(info).getByText("Name on badge").parentElement?.textContent).toContain("No answer");
    expect(revealAttendeeSensitive).toHaveBeenCalledWith("evt-1", "att-1");
    expect(within(cardOf("Companion")).queryByText("peanuts")).toBeNull();

    await reveal("companion");

    expect(within(cardOf("Companion")).getByText("peanuts")).toBeTruthy();
    expect(revealAttendeeSensitive).toHaveBeenCalledTimes(2);
  });

  it("shows the masks when the guest has no other answer, instead of 'No additional information'", async () => {
    load({ custom_data: {} });
    await renderPage();

    expect(screen.queryByText("No additional information")).toBeNull();
    expect(screen.getByText("Accessibility needs")).toBeTruthy();
  });
});

describe("the boxes of the edit form are write-only", { timeout: 30_000 }, () => {
  async function openEdit() {
    await renderPage();
    // The first Edit is the page's own, in its header; the companion's is in its card.
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]!);
  }
  const box = (label: string) => screen.getByLabelText(new RegExp(`^${label}`)) as HTMLInputElement;

  it("starts empty, whatever the detail carries, and says it is hidden after saving and what an empty box does", async () => {
    load({ custom_data: { shirt: "M", access: STORED, badge: STORED } });
    await openEdit();

    expect(box("Accessibility needs").value).toBe("");
    expect(box("Name on badge").value).toBe("");
    expect(box("Shirt size").value).toBe("M");
    expect(screen.getAllByText(WRITE_ONLY_REPLACE_NOTE)).toHaveLength(2);
    expect(screen.queryByText(WRITE_ONLY_NEW_NOTE)).toBeNull();
    expect(document.body.textContent).not.toContain(STORED);
  });

  it("is no change while the boxes are empty, and saves an ordinary change without a sensitive key, though one is required", async () => {
    // A detail that carried the stored answers would still send nothing for the empty boxes: an empty box is never "clear".
    load({ custom_data: { shirt: "M", access: STORED, badge: STORED } });
    updateAttendee.mockResolvedValue(detail({ custom_data: { shirt: "L" } }));
    await openEdit();
    const save = screen.getByRole("button", { name: "Save" });
    expect(save.getAttribute("aria-disabled") === "true" || (save as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(box("Shirt size"), { target: { value: "L" } });
    fireEvent.click(save);

    await waitFor(() => expect(updateAttendee).toHaveBeenCalled());
    expect(updateAttendee.mock.calls[0]![2]).toMatchObject({ custom_data_fields: { shirt: "L" } });
    expect(JSON.stringify(updateAttendee.mock.calls[0])).not.toContain("badge");
    expect(JSON.stringify(updateAttendee.mock.calls[0])).not.toContain("access");
  });

  it("sends a sensitive box that was typed in, and only that one", async () => {
    updateAttendee.mockResolvedValue(detail());
    await openEdit();

    fireEvent.change(box("Accessibility needs"), { target: { value: "needs a quiet room" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateAttendee).toHaveBeenCalled());
    expect(updateAttendee.mock.calls[0]![2]).toMatchObject({ custom_data_fields: { access: "needs a quiet room" } });
  });

  it("does not block the save for a required sensitive question that is left empty", async () => {
    updateAttendee.mockResolvedValue(detail({ first_name: "Anne" }));
    await openEdit();

    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Anne" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateAttendee).toHaveBeenCalled());
    expect(screen.queryByText("Name on badge is required.")).toBeNull();
  });
});

describe("the companion's edit dialog is write-only too", { timeout: 30_000 }, () => {
  async function openDialog() {
    await renderPage();
    fireEvent.click(within(cardOf("Companion")).getByRole("button", { name: "Edit" }));
    return screen.getByRole("dialog", { name: "Edit companion" });
  }

  it("starts the sensitive box empty, with the note, and saves the name without the sensitive key when it stays empty", async () => {
    load({ companion: { slot: 1, name: "Piotr Companion", custom_data: { diet: "vegan", allergy: STORED } } });
    updateAttendeeCompanion.mockResolvedValue(detail());
    const dialog = await openDialog();

    expect((within(dialog).getByLabelText(/^Allergies/) as HTMLInputElement).value).toBe("");
    expect(within(dialog).getByText(WRITE_ONLY_REPLACE_NOTE)).toBeTruthy();
    expect(dialog.textContent).not.toContain(STORED);
    fireEvent.change(within(dialog).getByLabelText("Full name"), { target: { value: "Piotr K." } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateAttendeeCompanion).toHaveBeenCalled());
    expect(updateAttendeeCompanion.mock.calls[0]![2]).toEqual({ name: "Piotr K.", custom_data: { diet: "vegan" } });
  });

  it("is no change while the box is empty, and sends the box that was typed in", async () => {
    updateAttendeeCompanion.mockResolvedValue(detail());
    const dialog = await openDialog();
    const save = within(dialog).getByRole("button", { name: "Save" });
    expect(save.getAttribute("aria-disabled") === "true" || (save as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(within(dialog).getByLabelText(/^Allergies/), { target: { value: "nuts" } });
    fireEvent.click(save);

    await waitFor(() => expect(updateAttendeeCompanion).toHaveBeenCalled());
    expect(updateAttendeeCompanion.mock.calls[0]![2]).toEqual({ name: "Piotr Companion", custom_data: { diet: "vegan", allergy: "nuts" } });
  });
});

describe("the answers on screen when the page changes under them", { timeout: 30_000 }, () => {
  it("hides the guest's answers again once the attendee is saved, because they were shown before the change", async () => {
    updateAttendee.mockResolvedValue(detail({ first_name: "Anne", name: "Anne Baseline", updated_at: "2026-02-02T00:00:00.000Z" }));
    await renderPage();
    await reveal("guest");
    expect(screen.getByText(SECRET)).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]!);
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Anne" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateAttendee).toHaveBeenCalled());

    await waitFor(() => expect(screen.queryByText(SECRET)).toBeNull());
    expect(showOf("guest")).toBeTruthy();
  });

  it("hides the companion's answers again once the companion is saved, and not while an edit is open and not saved", async () => {
    updateAttendeeCompanion.mockResolvedValue(
      detail({ updated_at: "2026-02-02T00:00:00.000Z", companion: { slot: 1, name: "Piotr K.", custom_data: { diet: "vegan" } } }),
    );
    await renderPage();
    await reveal("companion");
    expect(within(cardOf("Companion")).getByText("peanuts")).toBeTruthy();
    fireEvent.click(within(cardOf("Companion")).getByRole("button", { name: "Edit" }));
    const dialog = screen.getByRole("dialog", { name: "Edit companion" });
    fireEvent.change(within(dialog).getByLabelText("Full name"), { target: { value: "Piotr K." } });
    expect(within(cardOf("Companion")).getByText("peanuts")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateAttendeeCompanion).toHaveBeenCalled());

    await waitFor(() => expect(screen.queryByText("peanuts")).toBeNull());
    expect(showOf("companion")).toBeTruthy();
  });

  function Goto({ to }: Readonly<{ to: string }>) {
    const navigate = useNavigate();
    return (
      <button type="button" onClick={() => void navigate(to)}>
        Go to the next attendee
      </button>
    );
  }
  const nextAttendee = () => ({
    detail: detail({ id: "att-2", name: "Bea Baseline", first_name: "Bea", email: "bea@example.com" }),
    attributeFields: GUEST_FIELDS,
    companionFields: COMPANION_FIELDS,
    itemsWarning: null,
  });
  async function renderWithNavigation() {
    renderWithToast(
      <MemoryRouter initialEntries={["/admin/events/evt-1/attendees/att-1"]}>
        <Goto to="/admin/events/evt-1/attendees/att-2" />
        <Routes>
          <Route path="/admin/events/:eventId/attendees/:attendeeId" element={<AttendeeDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { name: "Anna Baseline" });
  }

  it("takes the answers off the screen and offers no Show while the page still holds the previous attendee and the address is another's", async () => {
    await renderWithNavigation();
    await reveal("guest");
    expect(screen.getByText(SECRET)).toBeTruthy();
    const next = deferred<ReturnType<typeof nextAttendee>>();
    loadAttendeeDetailData.mockReturnValueOnce(next.promise);

    fireEvent.click(screen.getByRole("button", { name: "Go to the next attendee" }));

    // The previous attendee is still the one on screen, so this is the case: nothing of theirs is revealed or can be.
    expect(screen.getByRole("heading", { name: "Anna Baseline" })).toBeTruthy();
    expect(screen.queryByText(SECRET)).toBeNull();
    expect(screen.queryByRole("button", { name: /Show sensitive answers/ })).toBeNull();
    await act(async () => next.resolve(nextAttendee()));
    await screen.findByRole("heading", { name: "Bea Baseline" });
    expect(showOf("guest")).toBeTruthy();
    expect(screen.queryByText(SECRET)).toBeNull();
  });

  it("drops an answer that was asked for the previous attendee and comes after the address has moved", async () => {
    await renderWithNavigation();
    const late = deferred<{ guest: Record<string, string>; companions: [] }>();
    revealAttendeeSensitive.mockReturnValueOnce(late.promise);
    fireEvent.click(showOf("guest"));
    fireEvent.click(within(screen.getByRole("group", { name: "Show sensitive answers of guest?" })).getByRole("button", { name: "Show" }));
    const next = deferred<ReturnType<typeof nextAttendee>>();
    loadAttendeeDetailData.mockReturnValueOnce(next.promise);
    fireEvent.click(screen.getByRole("button", { name: "Go to the next attendee" }));

    await act(async () => late.resolve({ guest: { access: SECRET }, companions: [] }));
    await act(async () => next.resolve(nextAttendee()));
    await screen.findByRole("heading", { name: "Bea Baseline" });

    expect(screen.queryByText(SECRET)).toBeNull();
    expect(showOf("guest")).toBeTruthy();
  });
});
