// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_CUSTOM_FIELDS_PER_EVENT, SUGGESTED_EVENT_FIELDS, type SuggestedEventField } from "@admitto/shared";
import { ApiError } from "../../src/api/client.js";
import type { AddSuggestedFieldsResponse, EventCustomFieldDto } from "../../src/api/types.js";
import { SuggestedQuestionsDialog, type SuggestedQuestionsDialogProps } from "../../src/registration/SuggestedQuestionsDialog.js";
import { deferred, isOff } from "../test-utils.js";

const addSuggestedEventCustomFields = vi.fn();

vi.mock("../../src/api/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/api/client.js")>()),
  addSuggestedEventCustomFields: (...args: unknown[]) => addSuggestedEventCustomFields(...args),
}));

function field(source_field: string, label: string, extra: Partial<EventCustomFieldDto> = {}): EventCustomFieldDto {
  return {
    id: `id-${source_field}`,
    source_field,
    label,
    description: null,
    type: "text",
    required: false,
    show_on_form: true,
    display_order: null,
    options: null,
    rules: null,
    created_at: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

/** The field that adding the suggested question creates. */
function created(suggested: SuggestedEventField): EventCustomFieldDto {
  return field(suggested.source_field, suggested.label, {
    type: suggested.type,
    options: suggested.options ? [...suggested.options] : null,
    rules: suggested.rules ? { ...suggested.rules } : null,
  });
}

/** Fields of the organiser's own, none with a suggested key. */
const own = (count: number): EventCustomFieldDto[] => Array.from({ length: count }, (_, index) => field(`own_${index}`, `Own question ${index}`));

const ALL_FIELDS = SUGGESTED_EVENT_FIELDS.map((suggested) => created(suggested));
const ADDED_ALL: AddSuggestedFieldsResponse = { added: SUGGESTED_EVENT_FIELDS.map((suggested) => suggested.source_field), skipped: [] };

const onClose = vi.fn();
const onAdded = vi.fn();

function renderDialog(fields: EventCustomFieldDto[] = [], props: Partial<SuggestedQuestionsDialogProps> = {}) {
  return render(<SuggestedQuestionsDialog eventId="evt-1" fields={fields} onClose={onClose} onAdded={onAdded} {...props} />);
}

const dialog = () => screen.getByRole("dialog", { name: "Add suggested questions" });
const questions = () => within(dialog()).getByRole("list", { name: "Suggested questions" });
const rowOf = (label: string) => within(questions()).getByText(label).closest("li") as HTMLElement;
const badgeOf = (label: string) => (rowOf(label).querySelector(".at-badge") as HTMLElement).textContent;
const confirmButton = () => within(dialog()).getByRole("button", { name: /^Add (\d+ questions?|questions)$/ });

beforeEach(() => {
  addSuggestedEventCustomFields.mockResolvedValue(ADDED_ALL);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SuggestedQuestionsDialog: an event with none of the questions", () => {
  it("says that the questions can be changed afterwards, and lists the five, each one to be added", () => {
    renderDialog();

    expect(dialog().textContent).toContain("These questions go on the registration form. You can change or remove them afterwards.");
    const labels = within(questions())
      .getAllByRole("listitem")
      .map((item) => item.querySelector(".suggested-questions__title")?.textContent);
    expect(labels).toEqual(SUGGESTED_EVENT_FIELDS.map((suggested) => suggested.label));
    for (const suggested of SUGGESTED_EVENT_FIELDS) expect(badgeOf(suggested.label), suggested.label).toBe("Will be added");
    expect(confirmButton().textContent).toBe("Add 5 questions");
    expect(isOff(confirmButton())).toBe(false);
  });

  it("says what kind of answer each question takes, and that the registration number waits for a yes to parking", () => {
    renderDialog();

    expect(rowOf("Do you need a parking space?").textContent).toContain("Yes / No");
    expect(rowOf("Registration number").textContent).toContain("Text. Shown only when “Do you need a parking space?” is Yes");
    expect(rowOf("How will you get here?").textContent).toContain("Single choice: Car, Train, Plane, Other");
    expect(rowOf("Arrival (date and time)").textContent).toContain("Date and time");
    expect(rowOf("Do you need accommodation?").textContent).toContain("Yes / No");
  });

  it("starts on the safe choice: the focus is on Cancel, not on the button that adds", () => {
    renderDialog();

    expect(document.activeElement).toBe(within(dialog()).getByRole("button", { name: "Cancel" }));
  });

  it("is a labelled dialog, described by its sentence, with the list named", () => {
    renderDialog();

    expect(dialog().getAttribute("aria-modal")).toBe("true");
    expect(dialog().getAttribute("aria-describedby")).toBeTruthy();
    expect(document.getElementById(dialog().getAttribute("aria-describedby") ?? "")?.textContent).toContain("You can change or remove them afterwards.");
    expect(questions()).toBeTruthy();
  });
});

describe("SuggestedQuestionsDialog: a short screen", () => {
  it("starts the window at its title: it scrolls on a short screen, and the browser has scrolled it to the button that took the focus", () => {
    const writes: number[] = [];
    const original = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop");
    Object.defineProperty(Element.prototype, "scrollTop", {
      configurable: true,
      get: () => 0,
      set(this: Element, value: number) {
        if (this.classList.contains("confirm-dialog__panel")) writes.push(value);
      },
    });
    try {
      renderDialog();
    } finally {
      if (original) Object.defineProperty(Element.prototype, "scrollTop", original);
    }

    expect(writes).toEqual([0]);
  });
});

describe("SuggestedQuestionsDialog: an event that has some of them", () => {
  it("shows a question the event has as already in its list, and adds only the others", () => {
    renderDialog([created(SUGGESTED_EVENT_FIELDS[2]!), ...own(1)]);

    expect(badgeOf("How will you get here?")).toBe("Already in your list");
    for (const label of ["Do you need a parking space?", "Registration number", "Arrival (date and time)", "Do you need accommodation?"]) {
      expect(badgeOf(label), label).toBe("Will be added");
    }
    expect(confirmButton().textContent).toBe("Add 4 questions");
  });

  it("names the event's own question when the registration number waits for it", () => {
    renderDialog([field("parking", "Parking space", { type: "boolean" })]);

    expect(badgeOf("Do you need a parking space?")).toBe("Already in your list");
    expect(rowOf("Registration number").textContent).toContain("Shown only when “Parking space” is Yes");
    expect(badgeOf("Registration number")).toBe("Will be added");
    expect(confirmButton().textContent).toBe("Add 4 questions");
  });

  it("says that the registration number is not added when the event's own parking field cannot be what it waits for, and why", () => {
    renderDialog([field("parking", "Parking notes")]);

    expect(badgeOf("Registration number")).toBe("Not added");
    expect(rowOf("Registration number").textContent).toContain("It needs “Parking notes” to be a Yes / No question on the registration form.");
    expect(confirmButton().textContent).toBe("Add 3 questions");
    expect(isOff(confirmButton())).toBe(false);
  });

  it("says that every question is already there, and has nothing to confirm: Close in place of Cancel, and Add questions is off", () => {
    renderDialog(ALL_FIELDS);

    expect(dialog().textContent).toContain("Every suggested question is already in your list.");
    expect(dialog().textContent).not.toContain("You can change or remove them afterwards.");
    for (const suggested of SUGGESTED_EVENT_FIELDS) expect(badgeOf(suggested.label), suggested.label).toBe("Already in your list");
    expect(within(dialog()).getByRole("button", { name: "Close" })).toBeTruthy();
    expect(within(dialog()).queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(confirmButton().textContent).toBe("Add questions");
    expect(isOff(confirmButton())).toBe(true);
    fireEvent.click(confirmButton());
    expect(addSuggestedEventCustomFields).not.toHaveBeenCalled();
  });

  it("says that nothing can be added when the only question left cannot be", () => {
    const rest = SUGGESTED_EVENT_FIELDS.filter((suggested) => suggested.source_field !== "parking_plate").map((suggested) => created(suggested));
    renderDialog(rest.map((existing) => (existing.source_field === "parking" ? { ...existing, type: "text" as const, rules: null } : existing)));

    expect(dialog().textContent).toContain("None of the suggested questions can be added right now.");
    expect(badgeOf("Registration number")).toBe("Not added");
    expect(isOff(confirmButton())).toBe(true);
  });
});

describe("SuggestedQuestionsDialog: the limit on fields", () => {
  it("says how many fields the event has, what adding the questions would make, and how many to delete, and does not offer to add", () => {
    renderDialog(own(MAX_CUSTOM_FIELDS_PER_EVENT - 3));

    const notice = within(dialog()).getByText(/This event has 17 of 20 fields/);
    expect(notice.textContent).toBe(
      "This event has 17 of 20 fields, and adding 5 questions would take it to 22. Delete 2 fields first, or add the questions you want one at a time with Add field.",
    );
    for (const suggested of SUGGESTED_EVENT_FIELDS) expect(badgeOf(suggested.label), suggested.label).toBe("Would be added");
    expect(isOff(confirmButton())).toBe(true);
    expect(within(dialog()).getByRole("button", { name: "Close" })).toBeTruthy();
    fireEvent.click(confirmButton());
    expect(addSuggestedEventCustomFields).not.toHaveBeenCalled();
  });

  it("says it in the singular when one field has to go", () => {
    renderDialog(own(MAX_CUSTOM_FIELDS_PER_EVENT - 4));

    expect(within(dialog()).getByText(/This event has 16 of 20 fields/).textContent).toContain("adding 5 questions would take it to 21. Delete 1 field first");
  });

  it("offers to add when the questions fit exactly up to the limit", () => {
    renderDialog(own(MAX_CUSTOM_FIELDS_PER_EVENT - SUGGESTED_EVENT_FIELDS.length));

    expect(within(dialog()).queryByText(/This event has/)).toBeNull();
    expect(badgeOf("Registration number")).toBe("Will be added");
    expect(isOff(confirmButton())).toBe(false);
  });

  it("counts only the questions it would add: with two of them there, three fit in a list of 17", () => {
    renderDialog([created(SUGGESTED_EVENT_FIELDS[0]!), created(SUGGESTED_EVENT_FIELDS[2]!), ...own(MAX_CUSTOM_FIELDS_PER_EVENT - 5)]);

    expect(within(dialog()).queryByText(/This event has/)).toBeNull();
    expect(confirmButton().textContent).toBe("Add 3 questions");
  });
});

describe("SuggestedQuestionsDialog: adding", () => {
  it("asks the server once, for this event, and hands its answer to the host", async () => {
    renderDialog();

    fireEvent.click(confirmButton());

    await waitFor(() => expect(onAdded).toHaveBeenCalledWith(ADDED_ALL));
    expect(addSuggestedEventCustomFields).toHaveBeenCalledTimes(1);
    expect(addSuggestedEventCustomFields).toHaveBeenCalledWith("evt-1");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("is busy while the request is on its way: the button keeps its place and a second click, Escape and Cancel do nothing", async () => {
    const answer = deferred<AddSuggestedFieldsResponse>();
    addSuggestedEventCustomFields.mockReturnValueOnce(answer.promise);
    renderDialog();
    const button = confirmButton();

    fireEvent.click(button);
    fireEvent.click(button);

    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(addSuggestedEventCustomFields).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(isOff(within(dialog()).getByRole("button", { name: "Cancel" }))).toBe(true);
    await act(async () => {
      answer.resolve(ADDED_ALL);
      await answer.promise;
    });
    expect(onAdded).toHaveBeenCalledTimes(1);
  });

  it("says in the window what the server refused, and stays open to try again", async () => {
    addSuggestedEventCustomFields.mockRejectedValueOnce(new ApiError(422, "field_limit_reached", "field_limit_reached"));
    renderDialog();

    fireEvent.click(confirmButton());

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("This event has reached its custom field limit.");
    expect(dialog()).toBeTruthy();
    expect(onAdded).not.toHaveBeenCalled();
    expect(confirmButton().getAttribute("aria-busy")).toBeNull();
    expect(isOff(confirmButton())).toBe(false);

    fireEvent.click(confirmButton());
    await waitFor(() => expect(onAdded).toHaveBeenCalledWith(ADDED_ALL));
    expect(addSuggestedEventCustomFields).toHaveBeenCalledTimes(2);
  });

  it("does not show what a failure says that is not the server's own answer", async () => {
    addSuggestedEventCustomFields.mockRejectedValueOnce(new TypeError("Failed to fetch https://internal.example/api"));
    renderDialog();

    fireEvent.click(confirmButton());

    expect((await screen.findByRole("alert")).textContent).toBe("Could not add the suggested questions.");
  });

  it("clears the refusal when it tries again", async () => {
    addSuggestedEventCustomFields.mockRejectedValueOnce(new ApiError(422, "field_limit_reached", "field_limit_reached"));
    const answer = deferred<AddSuggestedFieldsResponse>();
    addSuggestedEventCustomFields.mockReturnValueOnce(answer.promise);
    renderDialog();
    fireEvent.click(confirmButton());
    await screen.findByRole("alert");

    fireEvent.click(confirmButton());

    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    await act(async () => {
      answer.resolve(ADDED_ALL);
      await answer.promise;
    });
  });
});

describe("SuggestedQuestionsDialog: leaving", () => {
  it("closes on Cancel and on Escape, and adds nothing", () => {
    renderDialog();

    fireEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(2);
    expect(addSuggestedEventCustomFields).not.toHaveBeenCalled();
  });

  it("closes on Close when there is nothing to add", () => {
    renderDialog(ALL_FIELDS);

    fireEvent.click(within(dialog()).getByRole("button", { name: "Close" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
