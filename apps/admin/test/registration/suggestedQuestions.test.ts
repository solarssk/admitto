import { describe, expect, it } from "vitest";
import { MAX_CUSTOM_FIELDS_PER_EVENT, SUGGESTED_EVENT_FIELDS, planSuggestedFields } from "@admitto/shared";
import type { EventCustomFieldDto } from "../../src/api/types.js";
import { addedMessage, confirmLabel, dialogMessage, limitMessage, suggestedRows } from "../../src/registration/suggestedQuestions.js";

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

const own = (count: number): EventCustomFieldDto[] => Array.from({ length: count }, (_, index) => field(`own_${index}`, `Own ${index}`));

describe("confirmLabel", () => {
  it("counts the questions, in the singular for one, and has a label of its own for none", () => {
    expect(confirmLabel(5)).toBe("Add 5 questions");
    expect(confirmLabel(1)).toBe("Add 1 question");
    expect(confirmLabel(0)).toBe("Add questions");
  });
});

describe("addedMessage", () => {
  it("says how many were added, and that they are there already when none was", () => {
    expect(addedMessage(5)).toBe("Added 5 suggested questions.");
    expect(addedMessage(1)).toBe("Added 1 suggested question.");
    expect(addedMessage(0)).toBe("The suggested questions are already in your list.");
  });
});

describe("dialogMessage", () => {
  it("says the questions can be changed afterwards when some are to be added", () => {
    expect(dialogMessage(planSuggestedFields([]))).toBe("These questions go on the registration form. You can change or remove them afterwards.");
  });

  it("says that all are there when none is to be added, and that none can be when the rest are held back", () => {
    const everything = SUGGESTED_EVENT_FIELDS.map((suggested) => field(suggested.source_field, suggested.label, { type: suggested.type }));
    expect(dialogMessage(planSuggestedFields(everything))).toBe("Every suggested question is already in your list.");
    const heldBack = everything.filter((item) => item.source_field !== "parking_plate").map((item) => (item.source_field === "parking" ? { ...item, type: "text" as const } : item));
    expect(dialogMessage(planSuggestedFields(heldBack))).toBe("None of the suggested questions can be added right now.");
  });
});

describe("limitMessage", () => {
  it("is empty when the questions fit, and when there is nothing to add", () => {
    expect(limitMessage(planSuggestedFields(own(MAX_CUSTOM_FIELDS_PER_EVENT - 5)), MAX_CUSTOM_FIELDS_PER_EVENT - 5)).toBe("");
    const everything = SUGGESTED_EVENT_FIELDS.map((suggested) => field(suggested.source_field, suggested.label, { type: suggested.type }));
    expect(limitMessage(planSuggestedFields(everything), everything.length)).toBe("");
  });

  it("says what the event has, what adding would make and how many fields to delete", () => {
    expect(limitMessage(planSuggestedFields(own(18)), 18)).toBe(
      "This event has 18 of 20 fields, and adding 5 questions would take it to 23. Delete 3 fields first, or add the questions you want one at a time with Add field.",
    );
  });

  it("says it in the singular for one question and one field", () => {
    const four = SUGGESTED_EVENT_FIELDS.filter((suggested) => suggested.source_field !== "accommodation").map((suggested) => field(suggested.source_field, suggested.label, { type: suggested.type, options: suggested.options ? [...suggested.options] : null }));
    const existing = [...four, ...own(MAX_CUSTOM_FIELDS_PER_EVENT - 4)];
    expect(limitMessage(planSuggestedFields(existing), existing.length)).toBe(
      "This event has 20 of 20 fields, and adding 1 question would take it to 21. Delete 1 field first, or add the questions you want one at a time with Add field.",
    );
  });
});

describe("suggestedRows", () => {
  it("lists the questions in the order of the set, each with the state the plan gives it", () => {
    const existing = [field("travel", "Getting here", { type: "select", options: ["Bus"] })];

    const rows = suggestedRows(planSuggestedFields(existing), existing);

    expect(rows.map((row) => [row.key, row.state])).toEqual([
      ["parking", "add"],
      ["parking_plate", "add"],
      ["travel", "present"],
      ["arrival", "add"],
      ["accommodation", "add"],
    ]);
    expect(rows.map((row) => row.label)).toEqual(SUGGESTED_EVENT_FIELDS.map((suggested) => suggested.label));
    expect(rows.every((row) => row.note === "")).toBe(true);
  });

  it("names the question a conditional one waits for as the event calls it, or as the set does when it is still to be added", () => {
    const own = [field("parking", "Parking space", { type: "boolean" })];

    expect(suggestedRows(planSuggestedFields(own), own)[1]!.meta).toBe("Text. Shown only when “Parking space” is Yes");
    expect(suggestedRows(planSuggestedFields([]), [])[1]!.meta).toBe("Text. Shown only when “Do you need a parking space?” is Yes");
  });

  it("explains a question that cannot be added", () => {
    const own = [field("parking", "Parking notes")];

    const plate = suggestedRows(planSuggestedFields(own), own)[1]!;

    expect(plate.state).toBe("blocked");
    expect(plate.note).toBe("It needs “Parking notes” to be a Yes / No question on the registration form.");
  });
});
