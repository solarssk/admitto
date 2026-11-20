// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventCustomFieldRules } from "@admitto/shared";
import type { EventCustomFieldDto } from "../../src/api/types.js";
import { EventCustomFieldModal } from "../../src/requirements/EventCustomFieldModal.js";
import { deferred, renderWithToast } from "../test-utils.js";
import { answerField } from "../attendees/answerTypeFixtures.js";

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

const WHEN_PARKING = { field: "parking", value: true } as const;
const parking = answerField("parking", "Parking", "boolean", { show_on_form: true });
const meal = answerField("meal", "Meal", "select", { options: ["Standard", "Vegetarian", "Vegan"], show_on_form: true });
const plate = answerField("plate", "Plate number", "text", { show_on_form: true, rules: { icon: "car", show_when: WHEN_PARKING, max_length: 12 } });
const diet = answerField("diet", "Diet", "text", {
  show_on_form: true,
  rules: { icon: "food", max_length: 40, suggestions: ["Vegan", "Vegetarian", "Halal"] },
});
const notes = answerField("notes", "Notes", "long_text", { show_on_form: true });
const EVENT = [parking, meal, plate, diet, notes];

interface EditorOptions {
  fields?: readonly EventCustomFieldDto[];
  showOnForm?: boolean;
}

/** Opens the editor for `field` (null: a new field) in an event whose fields are `fields`. */
async function openEditor(field: EventCustomFieldDto | null, { fields = EVENT, showOnForm = false }: EditorOptions = {}) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  renderWithToast(<EventCustomFieldModal eventId="evt-1" field={field} fields={fields} showOnForm={showOnForm} onClose={onClose} onSaved={onSaved} />);
  // The counts of a choice field are read as the editor opens: Save waits for them.
  await act(async () => {});
  return { onClose, onSaved };
}

const group = (name: string) => screen.getByRole("group", { name });
const saveButton = () => screen.getByRole("button", { name: /^(Save|Create field)$/ }) as HTMLButtonElement;
const press = (name: string) => fireEvent.click(screen.getByRole("button", { name, exact: true }));
const typeLabel = (label: string) => fireEvent.change(screen.getByLabelText("Display label"), { target: { value: label } });
const suggestionInputs = () => screen.queryAllByLabelText("Suggestion text") as HTMLInputElement[];
const addSuggestion = (text: string) => {
  fireEvent.click(screen.getByRole("button", { name: "+ Add suggestion" }));
  const inputs = suggestionInputs();
  fireEvent.change(inputs[inputs.length - 1]!, { target: { value: text } });
};
const openSelect = (trigger: string | RegExp) => fireEvent.click(screen.getByRole("button", { name: trigger }));
/** The list a select has open: the question or the answer, named as its trigger is ("Question, none selected" opens "Question"). */
const openList = (name: "Question" | "Answer") => within(screen.getByRole("list", { name }));
/** Opens the select whose trigger is called `trigger` and picks `option` from its list. */
const choose = (trigger: string, option: string) => {
  openSelect(trigger);
  fireEvent.click(openList(trigger.startsWith("Question") ? "Question" : "Answer").getByRole("button", { name: option, exact: true }));
};
const patchSent = () => api.update.mock.calls[0]![2] as Record<string, unknown>;
const bodySent = () => api.create.mock.calls[0]![1] as Record<string, unknown>;
const noticeText = () => Array.from(document.querySelectorAll(".at-notice")).map((notice) => notice.textContent ?? "");

describe("EventCustomFieldModal: the registration form group", { timeout: 30_000 }, () => {
  it("sets the group apart under a labelled break, in a fieldset named by it, after the format rules", async () => {
    await openEditor(diet);
    const form = group("Registration form");
    expect(form.tagName).toBe("FIELDSET");
    const label = within(form).getByText("Registration form");
    expect(label.classList.contains("attendees-section-label")).toBe(true);
    const follows = (before: Node, after: Node) => Boolean(before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(group("Format rules"), form)).toBe(true);
  });

  it("is there for every type of field: an icon and a condition, and the suggestions for a text field only", async () => {
    for (const type of ["text", "long_text", "date", "datetime", "phone", "select", "boolean"] as const) {
      const field = answerField("f", "Field", type, { options: type === "select" ? ["A"] : null });
      await openEditor(field, { fields: [field] });
      expect(group("Registration form"), type).toBeTruthy();
      expect(group("Icon"), type).toBeTruthy();
      expect(group("Show only when"), type).toBeTruthy();
      expect(screen.queryByRole("button", { name: "+ Add suggestion" }) !== null, type).toBe(type === "text");
      cleanup();
    }
  });
});

describe("EventCustomFieldModal: the icon", { timeout: 30_000 }, () => {
  it("is a group of 17 buttons named Icon: no icon, and the 16 icons of the form, with the empty choice pressed for a field with none", async () => {
    await openEditor(notes);
    const picker = group("Icon");
    expect(picker.tagName).toBe("FIELDSET");
    const buttons = within(picker).getAllByRole("button");
    expect(buttons).toHaveLength(17);
    expect(buttons[0]!.getAttribute("aria-label")).toBe("No icon");
    expect(buttons[0]!.getAttribute("aria-pressed")).toBe("true");
    expect(buttons.slice(1).map((button) => button.getAttribute("aria-label"))).toEqual([
      "Parking",
      "Car",
      "Food",
      "Accessibility",
      "Accommodation",
      "Extra guest",
      "Group",
      "Company",
      "Calendar",
      "Clock",
      "Telephone",
      "Email",
      "Location",
      "Flight",
      "Train",
      "T-shirt",
    ]);
    expect(buttons.slice(1).every((button) => button.getAttribute("aria-pressed") === "false")).toBe(true);
  });

  it("presses the icon the field has, and says what it is for", async () => {
    await openEditor(diet);
    expect(within(group("Icon")).getByRole("button", { name: "Food" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(group("Icon")).getByRole("button", { name: "No icon" }).getAttribute("aria-pressed")).toBe("false");
    expect(
      screen.getByText("Drawn on the registration form next to optional Yes / No questions and next to one-line answers (Text, Date, Date and time, Phone)."),
    ).toBeTruthy();
  });

  it("is the one editor that draws an icon of the form with its Tabler glyph: food is tools-kitchen-2 and a location is map-pin", async () => {
    await openEditor(notes);
    const glyph = (name: string) => within(group("Icon")).getByRole("button", { name }).querySelector("i")?.className;
    expect(glyph("Food")).toBe("ti ti-tools-kitchen-2");
    expect(glyph("Location")).toBe("ti ti-map-pin");
  });

  it("changes the icon: the button is pressed, the one before it is not, and Save turns on", async () => {
    await openEditor(diet);
    expect(saveButton().disabled).toBe(true);
    press("Car");
    expect(within(group("Icon")).getByRole("button", { name: "Car" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(group("Icon")).getByRole("button", { name: "Food" }).getAttribute("aria-pressed")).toBe("false");
    expect(saveButton().disabled).toBe(false);
  });

  it("saves the new icon with every other rule the field has", async () => {
    await openEditor(diet);
    press("Car");
    fireEvent.click(saveButton());
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    expect(api.update).toHaveBeenCalledWith("evt-1", diet.id, {
      label: "Diet",
      description: null,
      required: false,
      rules: { max_length: 40, icon: "car", suggestions: ["Vegan", "Vegetarian", "Halal"] },
    });
  });

  it("takes the icon away with 'No icon': the field keeps its other rules, or has none when the icon was the only one", async () => {
    await openEditor(diet);
    press("No icon");
    fireEvent.click(saveButton());
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    expect(patchSent().rules).toEqual({ max_length: 40, suggestions: ["Vegan", "Vegetarian", "Halal"] });

    cleanup();
    vi.clearAllMocks();
    api.update.mockResolvedValue({});
    const onlyIcon = answerField("shirt", "Shirt", "boolean", { rules: { icon: "shirt" } });
    await openEditor(onlyIcon, { fields: [onlyIcon] });
    press("No icon");
    fireEvent.click(saveButton());
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    expect(patchSent().rules).toBeNull();
  });

  it("is saved with a new field, and a new field without one sends no rules at all", async () => {
    await openEditor(null);
    typeLabel("Plate");
    press("Car");
    fireEvent.click(saveButton());
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
    expect(bodySent().rules).toEqual({ icon: "car" });

    cleanup();
    vi.clearAllMocks();
    api.create.mockResolvedValue({});
    await openEditor(null);
    typeLabel("Plate");
    fireEvent.click(saveButton());
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
    expect(bodySent()).not.toHaveProperty("rules");
  });

  it("is not an edit when it is picked again, so a field that is opened and not changed has Save off", async () => {
    await openEditor(diet);
    press("Food");
    expect(saveButton().disabled).toBe(true);
  });

  it("does not pretend to change what an answer may be: an icon alone does not warn about saved answers", async () => {
    await openEditor(diet);
    press("Car");
    expect(noticeText().some((text) => /already saved/.test(text))).toBe(false);
  });

  it("is a plain button group that a keyboard can use: each icon is a button in the tab order, pressed with Enter or Space", async () => {
    await openEditor(notes);
    const buttons = within(group("Icon")).getAllByRole("button");
    for (const button of buttons) {
      expect(button.getAttribute("type")).toBe("button");
      expect((button as HTMLButtonElement).tabIndex).toBe(0);
      expect(button.getAttribute("aria-pressed")).not.toBeNull();
    }
  });
});

describe("EventCustomFieldModal: an icon that the form does not draw", { timeout: 30_000 }, () => {
  const iconNotice = (kind: string) => `${kind} shows no icon on the registration form. The icon stays saved.`;
  const withIcon = (type: EventCustomFieldDto["type"], extra: Partial<EventCustomFieldDto> = {}) =>
    answerField("pick", "Pick", type, { options: type === "select" ? ["A", "B"] : null, rules: { icon: "car" }, ...extra });
  const iconNotices = () => noticeText().filter((text) => text.includes("shows no icon"));

  it("says it for a single choice question that has an icon, and for a long text", async () => {
    const choice = withIcon("select");
    await openEditor(choice, { fields: [choice] });
    expect(iconNotices()).toEqual([iconNotice("A Single choice question")]);

    cleanup();
    const long = withIcon("long_text");
    await openEditor(long, { fields: [long] });
    expect(iconNotices()).toEqual([iconNotice("A Long text question")]);
  });

  it("says it for a required yes/no question, and stops saying it when the question is not required", async () => {
    const yesNo = withIcon("boolean", { required: true });
    await openEditor(yesNo, { fields: [yesNo] });
    expect(iconNotices()).toEqual([iconNotice("A required Yes / No question")]);
    fireEvent.click(screen.getByRole("button", { name: "Required" }));
    expect(iconNotices()).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Required" }));
    expect(iconNotices()).toEqual([iconNotice("A required Yes / No question")]);
  });

  it("says nothing for the questions the form draws an icon for: one-line answers and an optional yes/no", async () => {
    for (const type of ["text", "date", "datetime", "phone", "boolean"] as const) {
      const field = withIcon(type);
      await openEditor(field, { fields: [field] });
      expect(iconNotices(), type).toEqual([]);
      cleanup();
    }
    for (const type of ["text", "date", "datetime", "phone"] as const) {
      const field = withIcon(type, { required: true });
      await openEditor(field, { fields: [field] });
      expect(iconNotices(), `${type}, required`).toEqual([]);
      cleanup();
    }
  });

  it("says nothing while no icon is chosen, even for a kind of question the form draws none for", async () => {
    const choice = answerField("pick", "Pick", "select", { options: ["A"] });
    await openEditor(choice, { fields: [choice] });
    expect(iconNotices()).toEqual([]);
  });

  it("says it as soon as an icon is chosen for such a question, and not any more after 'No icon'", async () => {
    const choice = answerField("pick", "Pick", "select", { options: ["A"] });
    await openEditor(choice, { fields: [choice] });
    press("Car");
    expect(iconNotices()).toEqual([iconNotice("A Single choice question")]);
    press("No icon");
    expect(iconNotices()).toEqual([]);
  });

  it("follows the type that is chosen: a text field has none to say, and a choice has", async () => {
    const text = answerField("pick", "Pick", "text", { rules: { icon: "car" } });
    await openEditor(text, { fields: [text] });
    expect(iconNotices()).toEqual([]);
    press("Single choice");
    expect(iconNotices()).toEqual([iconNotice("A Single choice question")]);
    press("Long text");
    expect(iconNotices()).toEqual([iconNotice("A Long text question")]);
    press("Phone");
    expect(iconNotices()).toEqual([]);
  });

  it("holds nothing back: Save stays on, and the icon the field has is left as it is", async () => {
    const choice = withIcon("select");
    await openEditor(choice, { fields: [choice] });
    fireEvent.change(screen.getByLabelText("Display label"), { target: { value: "Pick one" } });
    expect(saveButton().disabled).toBe(false);
    fireEvent.click(saveButton());
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    expect(patchSent()).toEqual({ label: "Pick one", description: null, required: false });
    expect(iconNotices()).toEqual([iconNotice("A Single choice question")]);
  });

  it("is a status in the group of the icon, under the line that says what the form draws an icon for", async () => {
    const choice = withIcon("select");
    await openEditor(choice, { fields: [choice] });
    const notice = document.querySelector(".at-notice")!;
    expect(notice.tagName).toBe("OUTPUT");
    expect(group("Registration form").contains(notice)).toBe(true);
    const hint = screen.getByText(/Drawn on the registration form next to optional Yes/);
    expect(hint.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("creates a field whose icon the form does not draw, as the server allows", async () => {
    await openEditor(null);
    typeLabel("Pick");
    press("Single choice");
    addOption("A");
    press("Car");
    expect(iconNotices()).toEqual([iconNotice("A Single choice question")]);
    fireEvent.click(saveButton());
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
    expect(bodySent().rules).toEqual({ icon: "car" });
  });
});

describe("EventCustomFieldModal: the condition", { timeout: 30_000 }, () => {
  it("offers as the question the yes/no and choice questions of the event that have no condition, and not the field itself", async () => {
    await openEditor(diet);
    openSelect("Question, none selected");
    const options = within(screen.getByRole("list", { name: "Question" })).getAllByRole("button");
    expect(options.map((option) => option.getAttribute("aria-label"))).toEqual(["No condition", "Parking", "Meal"]);
  });

  it("does not offer the field itself, a question that has a condition or any other type", async () => {
    await openEditor(meal);
    openSelect("Question, none selected");
    const options = within(screen.getByRole("list", { name: "Question" })).getAllByRole("button");
    expect(options.map((option) => option.getAttribute("aria-label"))).toEqual(["No condition", "Parking"]);
  });

  it("names the question and the answer by their own controls: a group named Show only when, a question and an answer", async () => {
    await openEditor(diet);
    const condition = group("Show only when");
    expect(condition.tagName).toBe("FIELDSET");
    expect(within(condition).getByRole("button", { name: "Question, none selected" })).toBeTruthy();
    expect(within(condition).getByRole("button", { name: "Answer, none selected" })).toBeTruthy();
  });

  it("has no condition for a field that has none, and the answer is off until a question is chosen", async () => {
    await openEditor(diet);
    expect((screen.getByRole("button", { name: "Answer, none selected" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Question, none selected" }).textContent).toContain("No condition");
    expect(screen.getByRole("button", { name: "Answer, none selected" }).textContent).toContain("Choose a question first");
  });

  it("makes the answer Yes for a yes/no question, with nothing to choose, and saves it as true", async () => {
    await openEditor(diet);
    choose("Question, none selected", "Parking");
    const answer = screen.getByRole("button", { name: "Answer, Yes" }) as HTMLButtonElement;
    expect(answer.disabled).toBe(true);
    expect(screen.getByText("Asked only when the answer to that question is Yes. Leave it empty to ask everyone.")).toBeTruthy();
    fireEvent.click(saveButton());
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    expect(patchSent().rules).toEqual({ max_length: 40, icon: "food", suggestions: ["Vegan", "Vegetarian", "Halal"], show_when: { field: "parking", value: true } });
  });

  it("asks for the option of a choice question, holds Save back and says so in text until one is chosen, then saves it", async () => {
    await openEditor(diet);
    choose("Question, none selected", "Meal");
    const answer = screen.getByRole("button", { name: "Answer, none selected" }) as HTMLButtonElement;
    expect(answer.disabled).toBe(false);
    expect(screen.getByRole("alert").textContent).toBe("Choose the answer that shows this question.");
    expect(saveButton().disabled).toBe(true);
    // The server is never asked while the answer is missing, not even by Enter in a field.
    fireEvent.submit(screen.getByLabelText("Display label").closest("form")!);
    expect(api.update).not.toHaveBeenCalled();

    choose("Answer, none selected", "Vegan");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(saveButton().disabled).toBe(false);
    fireEvent.click(saveButton());
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    expect((patchSent().rules as EventCustomFieldRules).show_when).toEqual({ field: "meal", value: "Vegan" });
  });

  it("lists the options of the chosen question as the answers, in its order, with a first entry that clears the choice", async () => {
    await openEditor(diet);
    choose("Question, none selected", "Meal");
    openSelect("Answer, none selected");
    const options = within(screen.getByRole("list", { name: "Answer" })).getAllByRole("button");
    expect(options.map((option) => option.getAttribute("aria-label"))).toEqual(["Choose an answer", "Standard", "Vegetarian", "Vegan"]);
  });

  it("opens with the condition the field has: the question and the answer chosen, and Save off", async () => {
    await openEditor(plate);
    expect(screen.getByRole("button", { name: "Question, Parking" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Answer, Yes" })).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
  });

  it("opens with the option of a choice question chosen", async () => {
    const dependent = answerField("vegan_note", "Vegan note", "text", { rules: { show_when: { field: "meal", value: "Vegan" } } });
    await openEditor(dependent, { fields: [...EVENT, dependent] });
    expect(screen.getByRole("button", { name: "Question, Meal" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Answer, Vegan" })).toBeTruthy();
  });

  it("clears the condition with 'No condition', and saves the rest of the rules, or none when it was the only rule", async () => {
    await openEditor(plate);
    choose("Question, Parking", "No condition");
    expect(screen.getByRole("button", { name: "Question, none selected" })).toBeTruthy();
    fireEvent.click(saveButton());
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    expect(patchSent().rules).toEqual({ icon: "car", max_length: 12 });

    cleanup();
    vi.clearAllMocks();
    api.update.mockResolvedValue({});
    const onlyCondition = answerField("badge", "Badge", "text", { rules: { show_when: WHEN_PARKING } });
    await openEditor(onlyCondition, { fields: [...EVENT, onlyCondition] });
    choose("Question, Parking", "No condition");
    fireEvent.click(saveButton());
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    expect(patchSent().rules).toBeNull();
  });

  it("starts the answer again when another question is chosen, and keeps it when the same question is chosen again", async () => {
    const dependent = answerField("vegan_note", "Vegan note", "text", { rules: { show_when: { field: "meal", value: "Vegan" } } });
    await openEditor(dependent, { fields: [...EVENT, dependent] });
    choose("Question, Meal", "Meal");
    expect(screen.getByRole("button", { name: "Answer, Vegan" })).toBeTruthy();
    choose("Question, Meal", "Parking");
    expect(screen.getByRole("button", { name: "Answer, Yes" })).toBeTruthy();
    choose("Question, Parking", "Meal");
    expect(screen.getByRole("button", { name: "Answer, none selected" })).toBeTruthy();
  });

  it("creates a field with a condition", async () => {
    await openEditor(null);
    typeLabel("Allergy details");
    choose("Question, none selected", "Meal");
    choose("Answer, none selected", "Vegetarian");
    fireEvent.click(saveButton());
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
    expect(bodySent().rules).toEqual({ show_when: { field: "meal", value: "Vegetarian" } });
  });

  it("offers any field of the event to a field of any type: a condition fits every type", async () => {
    for (const type of ["text", "long_text", "date", "datetime", "phone", "select", "boolean"] as const) {
      const field = answerField("f", "Field", type, { options: type === "select" ? ["A"] : null });
      await openEditor(field, { fields: [parking, field] });
      choose("Question, none selected", "Parking");
      expect(screen.getByRole("button", { name: "Answer, Yes" }), type).toBeTruthy();
      cleanup();
    }
  });
});

describe("EventCustomFieldModal: a field that others are shown for", { timeout: 30_000 }, () => {
  it("cannot have a condition itself: the question is off, and the reason is in text, tied to the control", async () => {
    await openEditor(parking);
    const question = screen.getByRole("button", { name: "Question, none selected" }) as HTMLButtonElement;
    expect(question.disabled).toBe(true);
    const reason = "“Plate number” is shown only for an answer to this field, so it can't have a condition itself.";
    expect(screen.getByText(reason)).toBeTruthy();
    expect(document.getElementById(question.getAttribute("aria-describedby")!)?.textContent).toBe(reason);
    expect((screen.getByRole("button", { name: "Answer, none selected" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("names every field that is shown for it", async () => {
    const second = answerField("second", "Second", "text", { rules: { show_when: WHEN_PARKING } });
    await openEditor(parking, { fields: [...EVENT, second] });
    expect(
      screen.getByText("“Plate number” and “Second” are shown only for an answer to this field, so it can't have a condition itself."),
    ).toBeTruthy();
  });

  it("holds back a new type: it names the fields and what to do, Save is off, and the server is not asked", async () => {
    const { onSaved } = await openEditor(parking);
    press("Text");
    const text =
      "“Plate number” (for Yes) is shown only for an answer to this field, so this change can't be saved. Remove its condition first, or undo the change.";
    expect(noticeText()).toContain(text);
    expect(saveButton().disabled).toBe(true);
    fireEvent.submit(screen.getByLabelText("Display label").closest("form")!);
    expect(api.update).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("holds back every other type as well, and lets go when the type is set back", async () => {
    await openEditor(parking);
    for (const type of ["Long text", "Date", "Date and time", "Phone"]) {
      press(type);
      expect(noticeText().some((text) => text.includes("can't be saved")), type).toBe(true);
      expect(saveButton().disabled, type).toBe(true);
    }
    press("Yes / No");
    expect(noticeText().some((text) => text.includes("can't be saved"))).toBe(false);
  });

  it("holds back a change to a choice type too: a yes/no question and a choice question are different answers", async () => {
    await openEditor(parking);
    press("Single choice");
    addOption("Yes");
    expect(noticeText().some((text) => text.includes("can't be saved"))).toBe(true);
    expect(saveButton().disabled).toBe(true);
  });

  it("lets a change through that leaves the answers they are shown for: a new label, a required flag, a description", async () => {
    await openEditor(parking);
    fireEvent.change(screen.getByLabelText("Display label"), { target: { value: "Parking space" } });
    fireEvent.click(screen.getByRole("button", { name: "Required" }));
    expect(noticeText().some((text) => text.includes("can't be saved"))).toBe(false);
    expect(saveButton().disabled).toBe(false);
    fireEvent.click(saveButton());
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    expect(patchSent()).toEqual({ label: "Parking space", description: null, required: true });
  });

  describe("a choice question with fields shown for an option", () => {
    const veganNote = answerField("vegan_note", "Vegan note", "text", { rules: { show_when: { field: "meal", value: "Vegan" } } });
    const halalNote = answerField("halal_note", "Halal note", "text", { rules: { show_when: { field: "meal", value: "Standard" } } });
    const fields = [parking, meal, veganNote, halalNote];

    it("holds back the removal of an option a field is shown for, names that field and its option, and not the other", async () => {
      await openEditor(meal, { fields });
      fireEvent.click(screen.getAllByRole("button", { name: "Remove option" })[2]!);
      await waitFor(() => expect(noticeText().some((text) => text.includes("Vegan note"))).toBe(true));
      const text = noticeText().find((item) => item.includes("can't be saved"))!;
      expect(text).toContain("“Vegan note” (for “Vegan”)");
      expect(text).not.toContain("Halal note");
      expect(saveButton().disabled).toBe(true);
    });

    it("holds back the rename of an option a field is shown for, as a removal", async () => {
      await openEditor(meal, { fields });
      fireEvent.change(screen.getAllByLabelText("Option text")[2]!, { target: { value: "Vegan food" } });
      expect(noticeText().some((text) => text.includes("“Vegan note” (for “Vegan”)"))).toBe(true);
      expect(saveButton().disabled).toBe(true);
    });

    it("names every field when several options go at once", async () => {
      await openEditor(meal, { fields });
      fireEvent.click(screen.getAllByRole("button", { name: "Remove option" })[2]!);
      fireEvent.click(screen.getAllByRole("button", { name: "Remove option" })[0]!);
      const text = noticeText().find((item) => item.includes("can't be saved"))!;
      expect(text).toContain("“Halal note” (for “Standard”)");
      expect(text).toContain("“Vegan note” (for “Vegan”)");
      expect(text).toContain("are shown only for an answer to this field");
      expect(text).toContain("Remove their conditions first");
    });

    it("lets an option go that no field is shown for, and lets an option be added", async () => {
      await openEditor(meal, { fields });
      fireEvent.click(screen.getAllByRole("button", { name: "Remove option" })[1]!);
      expect(noticeText().some((text) => text.includes("can't be saved"))).toBe(false);
      addOption("Halal");
      expect(noticeText().some((text) => text.includes("can't be saved"))).toBe(false);
      expect(saveButton().disabled).toBe(false);
    });

    it("lets go when the option is back, whatever way it came back", async () => {
      await openEditor(meal, { fields });
      const options = screen.getAllByLabelText("Option text") as HTMLInputElement[];
      fireEvent.change(options[2]!, { target: { value: "Vegan food" } });
      expect(saveButton().disabled).toBe(true);
      fireEvent.change(options[2]!, { target: { value: "Vegan" } });
      expect(noticeText().some((text) => text.includes("can't be saved"))).toBe(false);
    });

    it("does not ask the server for a save it holds back, and does for the one it lets through", async () => {
      await openEditor(meal, { fields });
      fireEvent.change(screen.getAllByLabelText("Option text")[2]!, { target: { value: "Vegan food" } });
      fireEvent.submit(screen.getByLabelText("Display label").closest("form")!);
      expect(api.update).not.toHaveBeenCalled();
      fireEvent.change(screen.getAllByLabelText("Option text")[2]!, { target: { value: "Vegan" } });
      fireEvent.change(screen.getAllByLabelText("Option text")[1]!, { target: { value: "Vegetarian (eggs)" } });
      fireEvent.click(saveButton());
      await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
      expect(patchSent()).toMatchObject({ options: ["Standard", "Vegetarian (eggs)", "Vegan"] });
      expect(patchSent()).not.toHaveProperty("rules");
    });
  });
});

describe("EventCustomFieldModal: a condition on a question that is not on the registration form", { timeout: 30_000 }, () => {
  const offForm = answerField("parking", "Parking", "boolean", { show_on_form: false });
  const fields = [offForm, meal];

  it("marks such a question in the list when the field is on the form", async () => {
    await openEditor(null, { fields, showOnForm: true });
    openSelect("Question, none selected");
    const options = within(screen.getByRole("list", { name: "Question" })).getAllByRole("button");
    expect(options.map((option) => option.getAttribute("aria-label"))).toEqual(["No condition", "Parking (not on the form)", "Meal"]);
  });

  it("holds Save back when it is chosen, and says in text which question to put on the form, before anything is sent", async () => {
    await openEditor(null, { fields, showOnForm: true });
    typeLabel("Plate");
    choose("Question, none selected", "Parking (not on the form)");
    expect(screen.getByRole("alert").textContent).toBe(
      "“Parking” is not on the registration form. A question with a condition can be on the form only when the question it depends on is too. Put “Parking” on the form first, or choose another question.",
    );
    expect(saveButton().disabled).toBe(true);
    fireEvent.submit(screen.getByLabelText("Display label").closest("form")!);
    expect(api.create).not.toHaveBeenCalled();
    // Another question, or none, lets it go.
    choose("Question, Parking (not on the form)", "Meal");
    choose("Answer, none selected", "Vegan");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(saveButton().disabled).toBe(false);
  });

  it("takes no notice of it for a field that is not on the form: it can depend on any question", async () => {
    await openEditor(null, { fields, showOnForm: false });
    typeLabel("Plate");
    openSelect("Question, none selected");
    expect(within(screen.getByRole("list", { name: "Question" })).getByRole("button", { name: "Parking" })).toBeTruthy();
    fireEvent.click(openList("Question").getByRole("button", { name: "Parking" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(saveButton().disabled).toBe(false);
  });

  it("goes by the form flag a field has when it is edited, not by the page it is edited from", async () => {
    const onForm = answerField("plate", "Plate", "text", { show_on_form: true });
    await openEditor(onForm, { fields: [...fields, onForm], showOnForm: false });
    choose("Question, none selected", "Parking (not on the form)");
    expect(screen.getByRole("alert").textContent).toContain("is not on the registration form");

    cleanup();
    const offFormField = answerField("plate", "Plate", "text", { show_on_form: false });
    await openEditor(offFormField, { fields: [...fields, offFormField], showOnForm: true });
    openSelect("Question, none selected");
    expect(within(screen.getByRole("list", { name: "Question" })).getByRole("button", { name: "Parking" })).toBeTruthy();
  });
});

describe("EventCustomFieldModal: a condition with no question to depend on", { timeout: 30_000 }, () => {
  it("says so in text, tied to the control, and turns the choice off", async () => {
    await openEditor(diet, { fields: [diet, notes] });
    const question = screen.getByRole("button", { name: "Question, none selected" }) as HTMLButtonElement;
    expect(question.disabled).toBe(true);
    const reason = "This event has no yes/no or single choice question without a condition yet. Add one first.";
    expect(screen.getByText(reason)).toBeTruthy();
    expect(document.getElementById(question.getAttribute("aria-describedby")!)?.textContent).toBe(reason);
  });
});

describe("EventCustomFieldModal: the suggestions", { timeout: 30_000 }, () => {
  it("is a list for a text field, with its suggestions in order, and says that they only suggest", async () => {
    await openEditor(diet);
    expect(suggestionInputs().map((input) => input.value)).toEqual(["Vegan", "Vegetarian", "Halal"]);
    expect(screen.getByText(/They only suggest: a guest can still type any text\. Up to 30, each up to 100 characters\./)).toBeTruthy();
    expect(screen.getByText("Suggestions")).toBeTruthy();
  });

  it("is for a text field only: a field of any other type has no list, and a type change takes it away and gives it back", async () => {
    await openEditor(diet);
    for (const type of ["Long text", "Date", "Date and time", "Phone", "Single choice", "Yes / No"]) {
      press(type);
      expect(screen.queryByRole("button", { name: "+ Add suggestion" }), type).toBeNull();
      expect(screen.queryByText("Suggestions"), type).toBeNull();
    }
    press("Text");
    expect(suggestionInputs().map((input) => input.value)).toEqual(["Vegan", "Vegetarian", "Halal"]);
  });

  it("shows no count of attendees and no option wording", async () => {
    await openEditor(diet);
    expect(screen.queryByText("Unused")).toBeNull();
    expect(screen.queryByText("Unknown")).toBeNull();
    expect(screen.queryByLabelText("Option text")).toBeNull();
  });

  it("adds a suggestion and saves the list in order, trimmed, with a row left empty dropped", async () => {
    await openEditor(notesAsText());
    addSuggestion("  Vegan ");
    fireEvent.click(screen.getByRole("button", { name: "+ Add suggestion" }));
    addSuggestion("Halal");
    fireEvent.click(saveButton());
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    expect(patchSent().rules).toEqual({ suggestions: ["Vegan", "Halal"] });
  });

  it("is saved with a new field", async () => {
    await openEditor(null);
    typeLabel("Diet");
    addSuggestion("Vegan");
    addSuggestion("Vegetarian");
    fireEvent.click(saveButton());
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
    expect(bodySent().rules).toEqual({ suggestions: ["Vegan", "Vegetarian"] });
  });

  it("removes a suggestion at once, and sends no rules when the last one goes and no other rule is left", async () => {
    const onlySuggestions = answerField("diet2", "Diet", "text", { rules: { suggestions: ["Vegan"] } });
    await openEditor(onlySuggestions, { fields: [onlySuggestions] });
    fireEvent.click(screen.getByRole("button", { name: "Remove suggestion" }));
    expect(suggestionInputs()).toHaveLength(0);
    fireEvent.click(saveButton());
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    expect(patchSent().rules).toBeNull();
  });

  it("keeps the order of the list that the editor is given, and saves the order a keyboard sets", async () => {
    await openEditor(diet);
    fireEvent.keyDown(screen.getAllByLabelText(/Drag to reorder/)[0]!, { key: "ArrowDown" });
    expect(suggestionInputs().map((input) => input.value)).toEqual(["Vegetarian", "Vegan", "Halal"]);
    fireEvent.click(saveButton());
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    expect((patchSent().rules as EventCustomFieldRules).suggestions).toEqual(["Vegetarian", "Vegan", "Halal"]);
  });

  it("stops adding at 30, as the server takes no more, and starts again when one is removed", async () => {
    const thirty = Array.from({ length: 30 }, (_, index) => `Suggestion ${index}`);
    const full = answerField("diet3", "Diet", "text", { rules: { suggestions: thirty } });
    await openEditor(full, { fields: [full] });
    expect((screen.getByRole("button", { name: "+ Add suggestion" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getAllByRole("button", { name: "Remove suggestion" })[0]!);
    expect((screen.getByRole("button", { name: "+ Add suggestion" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("says that a suggestion is listed twice, whatever its capital letters, marks both rows and holds Save back until it is fixed", async () => {
    await openEditor(diet);
    addSuggestion("vegan");
    const message = "“Vegan” is there more than once. Capital letters do not make a suggestion different.";
    expect(screen.getByRole("alert").textContent).toBe(message);
    const marked = suggestionInputs().filter((input) => input.getAttribute("aria-invalid") === "true");
    expect(marked.map((input) => input.value)).toEqual(["Vegan", "vegan"]);
    expect(marked.every((input) => document.getElementById(input.getAttribute("aria-describedby")!)?.textContent === message)).toBe(true);
    expect(saveButton().disabled).toBe(true);
    fireEvent.submit(screen.getByLabelText("Display label").closest("form")!);
    expect(api.update).not.toHaveBeenCalled();

    fireEvent.change(suggestionInputs()[3]!, { target: { value: "Vegan food" } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(suggestionInputs().every((input) => input.getAttribute("aria-invalid") === null)).toBe(true);
    expect(saveButton().disabled).toBe(false);
  });

  it("takes up to 100 characters as a person counts them, and says so past that", async () => {
    await openEditor(notesAsText());
    addSuggestion(String.fromCodePoint(0x1f600).repeat(100));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(saveButton().disabled).toBe(false);
    addSuggestion("x".repeat(101));
    expect(screen.getByRole("alert").textContent).toBe("A suggestion is longer than 100 characters.");
    expect(saveButton().disabled).toBe(true);
    expect(suggestionInputs().map((input) => input.getAttribute("aria-invalid"))).toEqual([null, "true"]);
    fireEvent.change(suggestionInputs()[1]!, { target: { value: "x".repeat(100) } });
    expect(saveButton().disabled).toBe(false);
  });

  it("refuses an invisible or control character, and says what to do", async () => {
    await openEditor(notesAsText());
    addSuggestion(`Ve${String.fromCodePoint(0x200b)}gan`);
    expect(screen.getByRole("alert").textContent).toBe("A suggestion has an invisible or control character. Use plain text on one line.");
    expect(saveButton().disabled).toBe(true);
    fireEvent.change(suggestionInputs()[0]!, { target: { value: "Vegan" } });
    expect(saveButton().disabled).toBe(false);
  });

  it("does not hold Save back for a row that is left empty, or for text that only has spaces around it", async () => {
    await openEditor(notesAsText());
    addSuggestion("   ");
    addSuggestion("  Halal  ");
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(saveButton());
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    expect(patchSent().rules).toEqual({ suggestions: ["Halal"] });
  });

  it("keeps the room of the line under the list, so that the dialog does not jump when an error comes and goes", async () => {
    await openEditor(diet);
    const note = document.getElementById("cf-suggestions-note")!;
    expect(note.classList.contains("form-rules__note")).toBe(true);
    expect(note.textContent).toContain("They only suggest");
    addSuggestion("vegan");
    expect(document.getElementById("cf-suggestions-note")).toBe(note);
    expect(note.textContent).toContain("is there more than once");
  });

  function notesAsText() {
    return answerField("notes_text", "Notes", "text", { show_on_form: true });
  }
});

describe("EventCustomFieldModal: a save never deletes a rule the editor does not show", { timeout: 30_000 }, () => {
  const everything = answerField("badge", "Badge", "text", {
    show_on_form: true,
    rules: { min_length: 2, max_length: 20, digits_only: false, example: "Alex", icon: "user-plus", show_when: WHEN_PARKING, suggestions: ["Alex", "Sam"] },
  });
  const fields = [parking, everything];

  it("keeps the icon, the condition and the suggestions when a length is changed", async () => {
    await openEditor(everything, { fields });
    fireEvent.change(screen.getByLabelText("Longest answer"), { target: { value: "25" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    expect(patchSent().rules).toEqual({
      min_length: 2,
      max_length: 25,
      example: "Alex",
      icon: "user-plus",
      show_when: WHEN_PARKING,
      suggestions: ["Alex", "Sam"],
    });
  });

  it("keeps the format rules, the icon and the condition of a long text, and leaves the suggestions out, when the type changes", async () => {
    await openEditor(everything, { fields });
    press("Long text");
    fireEvent.click(saveButton());
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    expect(patchSent()).toMatchObject({ type: "long_text" });
    expect(patchSent().rules).toEqual({ min_length: 2, max_length: 20, example: "Alex", icon: "user-plus", show_when: WHEN_PARKING });
  });

  it("keeps the icon and the condition and leaves the format rules and the suggestions out, for a type that takes neither", async () => {
    for (const [type, expected] of [["Date", "date"], ["Date and time", "datetime"], ["Yes / No", "boolean"]] as const) {
      await openEditor(everything, { fields });
      press(type);
      fireEvent.click(saveButton());
      await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1), { timeout: 10_000 });
      expect(patchSent(), type).toMatchObject({ type: expected });
      expect(patchSent().rules, type).toEqual({ icon: "user-plus", show_when: WHEN_PARKING });
      cleanup();
      vi.clearAllMocks();
      api.update.mockResolvedValue({});
    }
  });

  it("gives everything back when the type is set to text again before the save, which is no edit at all", async () => {
    await openEditor(everything, { fields });
    press("Date");
    press("Text");
    expect(suggestionInputs().map((input) => input.value)).toEqual(["Alex", "Sam"]);
    expect((screen.getByLabelText("Longest answer") as HTMLInputElement).value).toBe("20");
    expect(saveButton().disabled).toBe(true);
  });

  it("asks the server for no rules when only the label changed", async () => {
    await openEditor(everything, { fields });
    fireEvent.change(screen.getByLabelText("Display label"), { target: { value: "Name on the badge" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    expect(patchSent()).toEqual({ label: "Name on the badge", description: null, required: false });
  });

  it("sends a rule that only a newer server knows again with every save that carries rules", async () => {
    const withFuture = answerField("badge", "Badge", "text", {
      rules: { max_length: 20, icon: "car", shiny_new_rule: { level: 3 } } as unknown as EventCustomFieldRules,
    });
    await openEditor(withFuture, { fields: [withFuture] });
    fireEvent.change(screen.getByLabelText("Longest answer"), { target: { value: "25" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    expect(patchSent().rules).toEqual({ max_length: 25, icon: "car", shiny_new_rule: { level: 3 } });
  });

  it("does not take a rule that only a newer server knows for an edit, so that opening and closing changes nothing", async () => {
    const withFuture = answerField("badge", "Badge", "text", {
      rules: { shiny_new_rule: { level: 3 } } as unknown as EventCustomFieldRules,
    });
    await openEditor(withFuture, { fields: [withFuture] });
    expect(saveButton().disabled).toBe(true);
    press("Car");
    press("No icon");
    expect(saveButton().disabled).toBe(true);
  });
});

describe("EventCustomFieldModal: the format-rules notice", { timeout: 30_000 }, () => {
  it("warns about saved answers for a change of type or of format rules, and for nothing the registration form group changes", async () => {
    await openEditor(diet);
    press("Car");
    choose("Question, none selected", "Parking");
    addSuggestion("Kosher");
    expect(noticeText().some((text) => /already saved/.test(text))).toBe(false);
    fireEvent.change(screen.getByLabelText("Longest answer"), { target: { value: "30" } });
    expect(noticeText().some((text) => /already saved/.test(text))).toBe(true);
  });
});

describe("EventCustomFieldModal: while it saves and with the keyboard", { timeout: 30_000 }, () => {
  it("keeps every control of the group on screen with what it holds, and takes no change, while the save runs", async () => {
    const saved = deferred<EventCustomFieldDto>();
    api.update.mockReturnValueOnce(saved.promise);
    await openEditor(diet);
    press("Car");
    fireEvent.click(saveButton());
    await waitFor(() => expect(saveButton().getAttribute("aria-busy")).toBe("true"));
    for (const button of within(group("Icon")).getAllByRole("button")) expect((button as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Question, none selected" }) as HTMLButtonElement).disabled).toBe(true);
    for (const input of suggestionInputs()) {
      expect(input.readOnly).toBe(true);
      expect(input.disabled).toBe(false);
    }
    expect((screen.getByRole("button", { name: "+ Add suggestion" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(group("Icon")).getByRole("button", { name: "Car" }).getAttribute("aria-pressed")).toBe("true");
    await act(async () => {
      saved.resolve(diet);
    });
  });

  it("puts a failed save back in the editor with what was typed, and says so", async () => {
    api.update.mockRejectedValueOnce(new Error("boom"));
    await openEditor(diet);
    press("Car");
    fireEvent.click(saveButton());
    expect(await screen.findByText("Failed to save field.")).toBeTruthy();
    expect(within(group("Icon")).getByRole("button", { name: "Car" }).getAttribute("aria-pressed")).toBe("true");
    expect(saveButton().disabled).toBe(false);
  });

  it("closes an open list of the condition on Escape and keeps the dialog, with what was chosen in it, until Escape is pressed again", async () => {
    const { onClose } = await openEditor(diet);
    press("Car");
    openSelect("Question, none selected");
    expect(screen.getByRole("list", { name: "Question" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("list", { name: "Question" })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(within(group("Icon")).getByRole("button", { name: "Car" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("opens a list and picks from it with the keyboard alone: the trigger and every entry are buttons", async () => {
    await openEditor(diet);
    const trigger = screen.getByRole("button", { name: "Question, none selected" });
    trigger.focus();
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    const options = within(screen.getByRole("list", { name: "Question" })).getAllByRole("button");
    for (const option of options) expect(option.getAttribute("type")).toBe("button");
    fireEvent.click(options[1]!);
    expect(screen.getByRole("button", { name: "Question, Parking" })).toBeTruthy();
  });

  it("keeps the whole editor inside the dialog: every control of the group is within the dialog", async () => {
    await openEditor(diet);
    const dialog = screen.getByRole("dialog");
    for (const name of ["Registration form", "Icon", "Show only when"]) expect(dialog.contains(group(name))).toBe(true);
    expect(dialog.contains(screen.getByRole("button", { name: "+ Add suggestion" }))).toBe(true);
  });
});

/** Adds an option to the list of a choice field. */
function addOption(text: string) {
  fireEvent.click(screen.getByRole("button", { name: "+ Add option" }));
  const inputs = screen.getAllByLabelText("Option text") as HTMLInputElement[];
  fireEvent.change(inputs[inputs.length - 1]!, { target: { value: text } });
}
