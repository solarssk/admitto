// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventCustomFieldDto } from "../../src/api/types.js";
import { EventCustomFieldModal } from "../../src/requirements/EventCustomFieldModal.js";
import { renderWithToast } from "../test-utils.js";
import { answerField } from "../attendees/answerTypeFixtures.js";

/**
 * Whose answer a question asks for (D-E5): the "Applies to" choice of the field editor, what a new and an edited field send, the notice for
 * a move that leaves answers where they are, a move that the questions waiting for this one hold back, and the questions a condition may
 * wait for (those about the same person).
 */
const api = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), usage: vi.fn() }));
vi.mock("../../src/api/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/api/client.js")>()),
  createEventCustomField: api.create,
  updateEventCustomField: api.update,
  fetchEventCustomFieldOptionUsage: api.usage,
}));

beforeEach(() => {
  api.usage.mockResolvedValue({});
  api.create.mockResolvedValue({});
  api.update.mockResolvedValue({});
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const parking = answerField("parking", "Parking", "boolean", { show_on_form: true });
const plate = answerField("plate", "Plate number", "text", { show_on_form: true, rules: { show_when: { field: "parking", value: true } } });
const pet = answerField("pet", "Pet", "boolean", { show_on_form: true, applies_to: "companion" });
const badge = answerField("badge", "Badge name", "text", { show_on_form: true, applies_to: "companion" });
const notes = answerField("notes", "Notes", "long_text", { show_on_form: true });
const EVENT = [parking, plate, pet, badge, notes];

async function openEditor(field: EventCustomFieldDto | null, fields: readonly EventCustomFieldDto[] = EVENT, showOnForm = false) {
  renderWithToast(<EventCustomFieldModal eventId="evt-1" field={field} fields={fields} showOnForm={showOnForm} onClose={vi.fn()} onSaved={vi.fn()} />);
  await act(async () => {});
}

const recipients = () => screen.getByRole("group", { name: "Applies to" });
const recipientButton = (name: string) => within(recipients()).getByRole("button", { name, exact: true });
const pressed = () => within(recipients()).getAllByRole("button", { pressed: true }).map((button) => button.textContent);
const saveButton = () => screen.getByRole("button", { name: /^(Save|Create field)$/ }) as HTMLButtonElement;
const typeLabel = (label: string) => fireEvent.change(screen.getByLabelText("Display label"), { target: { value: label } });
const noticeText = () => Array.from(document.querySelectorAll(".at-notice")).map((notice) => notice.textContent ?? "");
const MOVE_NOTICE = "Answers already given stay where they are and are not moved to the other person.";

describe("EventCustomFieldModal: Applies to", { timeout: 30_000 }, () => {
  it("is a group of two buttons named Applies to, before the field type: Guest pressed for a new field", async () => {
    await openEditor(null, []);
    const group = recipients();
    expect(group.tagName).toBe("FIELDSET");
    expect(within(group).getAllByRole("button").map((button) => button.textContent)).toEqual(["Guest", "Companion"]);
    expect(pressed()).toEqual(["Guest"]);
    expect(within(group).getAllByRole("button").map((button) => button.querySelectorAll("i.ti").length)).toEqual([1, 1]);
    const types = screen.getByRole("group", { name: "Field type" });
    expect(Boolean(group.compareDocumentPosition(types) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });

  it("starts from the recipient of the field being edited: the guest's for a field that says nothing, the companion's for one that says so", async () => {
    await openEditor(notes);
    expect(pressed()).toEqual(["Guest"]);
    cleanup();
    await openEditor(badge);
    expect(pressed()).toEqual(["Companion"]);
  });

  it("says what each recipient means under the buttons, and changes it with the choice", async () => {
    await openEditor(null, []);
    expect(screen.getByText(/^Asked of the guest\./)).toBeTruthy();
    fireEvent.click(recipientButton("Companion"));
    expect(screen.getByText(/^Asked about the person the guest brings/)).toBeTruthy();
    expect(screen.queryByText(/^Asked of the guest\./)).toBeNull();
    expect(pressed()).toEqual(["Companion"]);
  });

  it("creates a question about the companion with applies_to, and one about the guest without it", async () => {
    await openEditor(null, [], true);
    typeLabel("Badge name");
    fireEvent.click(recipientButton("Companion"));
    fireEvent.click(saveButton());
    await act(async () => {});
    expect(api.create.mock.calls[0]![1]).toMatchObject({ source_field: "badge_name", applies_to: "companion", show_on_form: true });
    cleanup();

    await openEditor(null, [], true);
    typeLabel("Shirt");
    fireEvent.click(saveButton());
    await act(async () => {});
    expect(api.create.mock.calls[1]![1]).not.toHaveProperty("applies_to");
  });

  it("edits a question: moving it to the companion sends the move, with a notice that answers are not moved, and moving it back unsends it", async () => {
    await openEditor(notes);
    expect(saveButton().disabled).toBe(true);
    expect(noticeText().some((text) => text.includes(MOVE_NOTICE))).toBe(false);

    fireEvent.click(recipientButton("Companion"));
    expect(saveButton().disabled).toBe(false);
    expect(noticeText().some((text) => text.includes(MOVE_NOTICE))).toBe(true);

    fireEvent.click(recipientButton("Guest"));
    expect(saveButton().disabled).toBe(true);
    expect(noticeText().some((text) => text.includes(MOVE_NOTICE))).toBe(false);

    fireEvent.click(recipientButton("Companion"));
    fireEvent.click(saveButton());
    await act(async () => {});
    expect(api.update.mock.calls[0]![2]).toMatchObject({ applies_to: "companion" });
  });

  it("turns the choice off while the save runs, like every other control of the editor", async () => {
    let finish!: () => void;
    api.update.mockReturnValueOnce(new Promise((resolve) => (finish = () => resolve({}))));
    await openEditor(notes);
    fireEvent.click(recipientButton("Companion"));
    fireEvent.click(saveButton());
    await act(async () => {});

    expect((recipientButton("Guest") as HTMLButtonElement).disabled).toBe(true);
    expect((recipientButton("Companion") as HTMLButtonElement).disabled).toBe(true);
    await act(async () => finish());
  });

  it("sends no move for a save of something else, whichever recipient the question has", async () => {
    await openEditor(badge);
    typeLabel("Badge");
    fireEvent.click(saveButton());
    await act(async () => {});
    expect(api.update.mock.calls[0]![2]).not.toHaveProperty("applies_to");
  });

  it("holds back a move of a question that others are shown for, says which, and turns Save off, as the server refuses it", async () => {
    await openEditor(parking);
    fireEvent.click(recipientButton("Companion"));
    expect(noticeText().some((text) => text.includes("“Plate number” (for Yes) is shown only for an answer to this field, so this change can't be saved."))).toBe(true);
    expect(saveButton().disabled).toBe(true);
    fireEvent.click(recipientButton("Guest"));
    expect(noticeText().some((text) => text.includes("shown only for an answer to this field"))).toBe(false);
  });

  it("holds back a move of a question that waits for another to the other person, and says its condition cannot be kept", async () => {
    await openEditor(plate);
    fireEvent.click(recipientButton("Companion"));
    expect(screen.getByText("This condition can't be kept. Choose another question and answer, or remove the condition.")).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
  });
});

describe("EventCustomFieldModal: the questions a condition may wait for", { timeout: 30_000 }, () => {
  const offered = () => within(screen.getByRole("list", { name: "Question" })).getAllByRole("button").map((button) => button.textContent);
  const open = () => fireEvent.click(screen.getByRole("button", { name: "Question, none selected" }));

  it("are the questions about the guest for a question about the guest", async () => {
    await openEditor(notes);
    open();
    expect(offered()).toEqual(["No condition", "Parking"]);
  });

  it("are the questions about the companion for a question about the companion", async () => {
    await openEditor(badge);
    open();
    expect(offered()).toEqual(["No condition", "Pet"]);
  });

  it("follow the choice made in the editor, before it is saved", async () => {
    await openEditor(notes);
    fireEvent.click(recipientButton("Companion"));
    open();
    expect(offered()).toEqual(["No condition", "Pet"]);
  });

  it("say so, in the words of the companion, when there is no question about the companion to wait for", async () => {
    await openEditor(badge, [parking, badge]);
    const question = screen.getByRole("button", { name: "Question, none selected" }) as HTMLButtonElement;
    expect(question.disabled).toBe(true);
    expect(screen.getByText("This event has no yes/no or single choice question about the companion without a condition yet. Add one first.")).toBeTruthy();
  });

  it("are still those about the guest in the words that were always there, for a question about the guest", async () => {
    await openEditor(notes, [notes, pet]);
    expect(screen.getByText("This event has no yes/no or single choice question without a condition yet. Add one first.")).toBeTruthy();
  });
});
