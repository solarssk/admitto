import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { EVENT_CUSTOM_FIELD_TYPES } from "@admitto/shared";
import { describe, expect, it } from "vitest";
import {
  CUSTOM_FIELD_TYPES,
  customFieldTypeIcon,
  customFieldTypeLabel,
} from "../../src/requirements/customFieldType.js";

const require = createRequire(import.meta.url);

describe("customFieldType helpers", () => {
  it("maps each built-in type to its operator-facing label and icon", () => {
    for (const entry of CUSTOM_FIELD_TYPES) {
      expect(customFieldTypeLabel(entry.value)).toBe(entry.label);
      expect(customFieldTypeIcon(entry.value)).toBe(entry.icon);
    }
  });

  it("falls back to the raw type string for unknown values", () => {
    expect(customFieldTypeLabel("mystery")).toBe("mystery");
    expect(customFieldTypeIcon("mystery")).toBe("ti-letter-case");
  });

  it("lists every answer type of the shared list, once and in its order, each with a name, an icon and a hint of its own", () => {
    expect(CUSTOM_FIELD_TYPES.map((entry) => entry.value)).toEqual([...EVENT_CUSTOM_FIELD_TYPES]);
    expect(CUSTOM_FIELD_TYPES.map((entry) => entry.value)).toEqual(["text", "long_text", "date", "datetime", "phone", "select", "boolean"]);
    for (const key of ["label", "icon", "hint"] as const) {
      const values = CUSTOM_FIELD_TYPES.map((entry) => entry[key]);
      expect(values.every((value) => value.trim().length > 0), key).toBe(true);
      expect(new Set(values).size, `${key} of every type is different`).toBe(CUSTOM_FIELD_TYPES.length);
    }
  });

  it.each([
    ["text", "Text", "ti-letter-case"],
    ["long_text", "Long text", "ti-align-left"],
    ["date", "Date", "ti-calendar"],
    ["datetime", "Date and time", "ti-calendar-time"],
    ["phone", "Phone", "ti-phone"],
    ["select", "Single choice", "ti-list"],
    ["boolean", "Yes / No", "ti-checkbox"],
  ])("draws %s as %s with %s", (type, label, icon) => {
    expect(customFieldTypeLabel(type)).toBe(label);
    expect(customFieldTypeIcon(type)).toBe(icon);
  });

  it("uses only icons that the bundled icon font has", () => {
    const css = readFileSync(require.resolve("@tabler/icons-webfont/dist/tabler-icons.min.css"), "utf8");
    const missing = CUSTOM_FIELD_TYPES.map((entry) => entry.icon).filter((icon) => !css.includes(`.${icon}:before`));
    expect(missing).toEqual([]);
  });
});
