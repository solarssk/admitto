import { EVENT_CUSTOM_FIELD_TYPES } from "@admitto/shared";
import { describe, expect, it } from "vitest";
import type { EventCustomFieldDto } from "../../src/api/types.js";
import { createFieldBody, fieldSaveOf, sameFieldSave, updateFieldPatch, type FieldSave } from "../../src/requirements/fieldRequests.js";

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

  describe("the complete rules of a field: format rules, an icon, a condition and suggestions", () => {
    const condition = { field: "parking", value: true } as const;
    const all = { max_length: 5, icon: "car", show_when: condition, suggestions: ["AB 123"] } as const;
    const stored = field({ rules: { ...all } });

    it("sends all of them when one changes, since a save with rules replaces all of them", () => {
      expect(updateFieldPatch(stored, save({ rules: { ...all, max_length: 6 } })).rules).toEqual({ ...all, max_length: 6 });
    });

    it("sends nothing about the rules when none changed, whatever the form rules are", () => {
      expect(updateFieldPatch(stored, save({ rules: { ...all } }))).not.toHaveProperty("rules");
      expect(updateFieldPatch(field({ rules: { icon: "car", show_when: condition } }), save({ label: "Plate", rules: { icon: "car", show_when: condition } }))).not.toHaveProperty("rules");
    });

    it("sends a change of the icon, the condition or the suggestions on its own", () => {
      expect(updateFieldPatch(stored, save({ rules: { ...all, icon: "pin" } })).rules).toMatchObject({ icon: "pin" });
      expect(updateFieldPatch(stored, save({ rules: { ...all, show_when: { field: "meal", value: "Vegan" } } })).rules).toMatchObject({
        show_when: { field: "meal", value: "Vegan" },
      });
      expect(updateFieldPatch(stored, save({ rules: { ...all, suggestions: ["AB 123", "CD 456"] } })).rules).toMatchObject({
        suggestions: ["AB 123", "CD 456"],
      });
      expect(updateFieldPatch(stored, save({ rules: { ...all, suggestions: ["CD 456", "AB 123"] } })).rules).toMatchObject({
        suggestions: ["CD 456", "AB 123"],
      });
    });

    it("sends only what the editor leaves on a field that becomes another type: the icon and the condition stay, and what the type does not take goes", () => {
      expect(updateFieldPatch(stored, save({ type: "date", rules: { icon: "car", show_when: condition } }))).toMatchObject({
        type: "date",
        rules: { icon: "car", show_when: condition },
      });
      expect(updateFieldPatch(stored, save({ type: "long_text", rules: { max_length: 5, icon: "car", show_when: condition } })).rules).toEqual({
        max_length: 5,
        icon: "car",
        show_when: condition,
      });
    });

    it("sends null when nothing is left of the rules", () => {
      expect(updateFieldPatch(field({ rules: { suggestions: ["a"] } }), save({ type: "boolean", rules: null })).rules).toBeNull();
      expect(updateFieldPatch(field({ rules: { icon: "car" } }), save({ rules: null })).rules).toBeNull();
    });

    it("sends the rules in the form the server stores them in: no key for a rule that is off", () => {
      expect(updateFieldPatch(field({ rules: { digits_only: false } }), save({ rules: null }))).not.toHaveProperty("rules");
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

describe("fieldSaveOf and sameFieldSave", () => {
  const choice = field({ type: "select", options: ["S", "M"], description: "Pick one", required: true, rules: { icon: "shirt" } });

  it("is the save that leaves a field as it is: a save of the stored values is no edit", () => {
    expect(fieldSaveOf(choice)).toEqual({
      type: "select",
      label: "Postcode",
      description: "Pick one",
      required: true,
      options: ["S", "M"],
      rules: { icon: "shirt" },
    });
    expect(sameFieldSave(fieldSaveOf(choice), fieldSaveOf(choice))).toBe(true);
    expect(fieldSaveOf(field()).description).toBe("");
    expect(fieldSaveOf(field()).options).toEqual([]);
    expect(fieldSaveOf(field({ type: "text", options: ["left over"] })).options).toEqual([]);
  });

  it("sees a difference in each part of the save", () => {
    const base = fieldSaveOf(choice);
    expect(sameFieldSave(base, { ...base, type: "text" })).toBe(false);
    expect(sameFieldSave(base, { ...base, label: "Size" })).toBe(false);
    expect(sameFieldSave(base, { ...base, description: "" })).toBe(false);
    expect(sameFieldSave(base, { ...base, required: false })).toBe(false);
    expect(sameFieldSave(base, { ...base, options: ["M", "S"] })).toBe(false);
    expect(sameFieldSave(base, { ...base, rules: { icon: "car" } })).toBe(false);
    expect(sameFieldSave(base, { ...base, rules: null })).toBe(false);
  });

  it("takes no rules, an empty object and rules that are off as the same", () => {
    const plain = fieldSaveOf(field());
    expect(sameFieldSave(plain, { ...plain, rules: null })).toBe(true);
    expect(sameFieldSave(plain, { ...plain, rules: {} })).toBe(true);
    expect(sameFieldSave(fieldSaveOf(field({ rules: { digits_only: false } })), plain)).toBe(true);
  });
});
