import { EVENT_CUSTOM_FIELD_TYPES } from "@admitto/shared";
import { describe, expect, it } from "vitest";
import type { EventCustomFieldDto } from "../../src/api/types.js";
import { createFieldBody, updateFieldPatch, type FieldSave } from "../../src/requirements/fieldRequests.js";

const save = (changes: Partial<FieldSave> = {}): FieldSave => ({
  type: "text",
  label: "Postcode",
  description: "",
  required: false,
  options: [],
  rules: null,
  ...changes,
});

const field = (changes: Partial<EventCustomFieldDto> = {}): EventCustomFieldDto => ({
  id: "field-1",
  source_field: "postcode",
  label: "Postcode",
  description: null,
  type: "text",
  required: false,
  show_on_form: false,
  display_order: null,
  options: null,
  rules: null,
  created_at: "2026-01-01T00:00:00.000Z",
  ...changes,
});

/** Every type the editor offers, with every type it can be changed to. */
const TYPE_PAIRS = EVENT_CUSTOM_FIELD_TYPES.flatMap((from) => EVENT_CUSTOM_FIELD_TYPES.map((to) => [from, to] as const));

describe("createFieldBody", () => {
  it("sends what a plain field has, and no rules and no show_on_form key when there are none", () => {
    const body = createFieldBody("postcode", save(), false);
    expect(body).toEqual({ source_field: "postcode", label: "Postcode", description: undefined, type: "text", required: false, options: undefined });
    expect(body).not.toHaveProperty("rules");
    expect(body).not.toHaveProperty("show_on_form");
  });

  it("sends the description, the options of a choice, the rules and the registration form flag when they are set", () => {
    expect(createFieldBody("size", save({ type: "select", label: "Size", description: "Pick one", options: ["S", "M"], required: true }), true)).toEqual({
      source_field: "size",
      label: "Size",
      description: "Pick one",
      type: "select",
      required: true,
      options: ["S", "M"],
      show_on_form: true,
    });
    expect(createFieldBody("postcode", save({ rules: { digits_only: true, max_length: 5 } }), false)).toMatchObject({
      rules: { digits_only: true, max_length: 5 },
    });
  });

  it("sends no options for a type that is not a choice, whatever the form still holds", () => {
    expect(createFieldBody("note", save({ type: "long_text", options: ["leftover"] }), false).options).toBeUndefined();
  });
});

describe("updateFieldPatch", () => {
  it("always sends the label, the description and required, and nothing else when nothing else changed", () => {
    const patch = updateFieldPatch(field(), save({ label: "Post code", description: "Where they live", required: true }));
    expect(patch).toEqual({ label: "Post code", description: "Where they live", required: true });
    for (const key of ["type", "options", "rules"]) expect(patch).not.toHaveProperty(key);
  });

  it("sends null to clear a description, so the server can tell it from a description that is left alone", () => {
    expect(updateFieldPatch(field({ description: "Old" }), save({ description: "" })).description).toBeNull();
  });

  it("names the type only when it changed", () => {
    expect(updateFieldPatch(field(), save({ type: "phone" }))).toMatchObject({ type: "phone" });
    expect(updateFieldPatch(field({ type: "date" }), save({ type: "date" }))).not.toHaveProperty("type");
  });

  it("does not name the type of a choice field whose options are left alone: the server refuses a choice that comes without them", () => {
    const shirt = field({ type: "select", options: ["S", "M"] });
    expect(updateFieldPatch(shirt, save({ type: "select", options: ["S", "M"], required: true }))).toEqual({
      label: "Postcode",
      description: null,
      required: true,
    });
  });

  it("sends the options of a choice only when they changed, and the type with them when it became a choice", () => {
    const shirt = field({ type: "select", options: ["S", "M"] });
    expect(updateFieldPatch(shirt, save({ type: "select", options: ["S", "M", "L"] }))).toMatchObject({ options: ["S", "M", "L"] });
    expect(updateFieldPatch(shirt, save({ type: "select", options: ["M", "S"] }))).toMatchObject({ options: ["M", "S"] });
    expect(updateFieldPatch(field(), save({ type: "select", options: ["A"] }))).toMatchObject({ type: "select", options: ["A"] });
  });

  it("sends null for the options of a choice that became another type, which clears them", () => {
    expect(updateFieldPatch(field({ type: "select", options: ["S"] }), save({ type: "text" }))).toMatchObject({ type: "text", options: null });
  });

  it("sends the rules only when they changed: an object replaces them, null clears them", () => {
    const ruled = field({ rules: { digits_only: true, max_length: 5 } });
    expect(updateFieldPatch(ruled, save({ rules: { digits_only: true, max_length: 5 } }))).not.toHaveProperty("rules");
    expect(updateFieldPatch(ruled, save({ rules: { digits_only: true, max_length: 6 } })).rules).toEqual({ digits_only: true, max_length: 6 });
    expect(updateFieldPatch(ruled, save({ rules: null })).rules).toBeNull();
    expect(updateFieldPatch(field(), save({ rules: { example: "01234" } })).rules).toEqual({ example: "01234" });
    expect(updateFieldPatch(field(), save({ rules: null }))).not.toHaveProperty("rules");
  });

  it("sends null for the rules of a field that becomes a type that takes none, with the new type: the server refuses the type while the rules stay", () => {
    expect(updateFieldPatch(field({ rules: { max_length: 5 } }), save({ type: "date", rules: null }))).toMatchObject({ type: "date", rules: null });
  });

  it("keeps the rules of a field that becomes another type that takes them, when they are the same", () => {
    const patch = updateFieldPatch(field({ rules: { max_length: 5 } }), save({ type: "long_text", rules: { max_length: 5 } }));
    expect(patch).toMatchObject({ type: "long_text" });
    expect(patch).not.toHaveProperty("rules");
  });

  describe("the rules the editor has no boxes for (an icon, a condition, suggestions)", () => {
    const condition = { field: "parking", value: true } as const;
    const stored = field({ rules: { max_length: 5, icon: "car", show_when: condition, suggestions: ["AB 123"] } });

    it("sends them again with the rules it edits, since a save with rules replaces all of them", () => {
      expect(updateFieldPatch(stored, save({ rules: { max_length: 6 } })).rules).toEqual({
        max_length: 6,
        icon: "car",
        show_when: condition,
        suggestions: ["AB 123"],
      });
    });

    it("sends the rules of the form on a field that has none of its own, and no rules when nothing changed", () => {
      expect(updateFieldPatch(stored, save({ rules: { max_length: 5 } }))).not.toHaveProperty("rules");
      expect(updateFieldPatch(field({ rules: { icon: "car", show_when: condition } }), save({ label: "Plate" }))).not.toHaveProperty("rules");
    });

    it("keeps the icon and the condition of a field that becomes a type with no format rules, and sends nothing of its format rules or suggestions", () => {
      expect(updateFieldPatch(stored, save({ type: "date", rules: null }))).toMatchObject({ type: "date", rules: { icon: "car", show_when: condition } });
    });

    it("leaves the suggestions out when a text field becomes another type that takes format rules, since they fit text fields only", () => {
      expect(updateFieldPatch(stored, save({ type: "long_text", rules: { max_length: 5 } })).rules).toEqual({
        max_length: 5,
        icon: "car",
        show_when: condition,
      });
    });

    it("sends null when nothing is left of the rules, and clears an icon that was the only rule only through a save that drops it", () => {
      expect(updateFieldPatch(field({ rules: { suggestions: ["a"] } }), save({ type: "boolean", rules: null })).rules).toBeNull();
      expect(updateFieldPatch(field({ rules: { icon: "car" } }), save({ rules: null }))).not.toHaveProperty("rules");
    });
  });

  it.each(TYPE_PAIRS)("never names a choice type without its options, whatever the field was (%s) and became (%s): the server's rule for a PATCH", (from, to) => {
    const before = field({ type: from, options: from === "select" ? ["S", "M"] : null });
    for (const options of [["S", "M"], ["S", "M", "L"]]) {
      const patch = updateFieldPatch(before, save({ type: to, options: to === "select" ? options : [] }));
      if (patch.type === "select") expect(patch.options).toEqual(options);
    }
  });
});
