import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { EVENT_CUSTOM_FIELD_TYPES, GUEST_FORM_ICONS, guestFormDrawsIcon } from "@admitto/shared";
import { describe, expect, it } from "vitest";
import { CUSTOM_FIELD_TYPES } from "../../src/requirements/customFieldType.js";
import {
  GUEST_FORM_ICON_OPTIONS,
  guestFormIconGlyph,
  guestFormIconLabel,
  guestFormIconNamed,
  iconNotDrawnMessage,
} from "../../src/requirements/guestFormIcons.js";

const require = createRequire(import.meta.url);

describe("GUEST_FORM_ICON_OPTIONS", () => {
  it("offers every icon of the registration form, in the order of the shared list, and no other", () => {
    expect(GUEST_FORM_ICON_OPTIONS.map((icon) => icon.name)).toEqual([...GUEST_FORM_ICONS]);
    expect(GUEST_FORM_ICON_OPTIONS).toHaveLength(16);
  });

  it("names each icon in English, with a name of its own", () => {
    const labels = GUEST_FORM_ICON_OPTIONS.map((icon) => icon.label);
    for (const label of labels) expect(label).toMatch(/^[A-Z][A-Za-z -]+$/);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("never names an icon as a type of answer, so a button is never named twice in the editor", () => {
    const typeLabels = new Set(CUSTOM_FIELD_TYPES.map((type) => type.label));
    for (const icon of GUEST_FORM_ICON_OPTIONS) expect(typeLabels.has(icon.label), icon.label).toBe(false);
  });

  it("draws each icon with a glyph of the webfont: the Tabler name that differs from the stored one is mapped in one place", () => {
    const css = readFileSync(require.resolve("@tabler/icons-webfont/dist/tabler-icons.min.css"), "utf8");
    for (const icon of GUEST_FORM_ICON_OPTIONS) {
      expect(icon.tabler, icon.name).toBeTruthy();
      expect(css.includes(`.ti-${icon.tabler}:before`), `${icon.name} as ti-${icon.tabler}`).toBe(true);
    }
    const byName = new Map(GUEST_FORM_ICON_OPTIONS.map((icon) => [icon.name, icon.tabler]));
    expect(byName.get("food")).toBe("tools-kitchen-2");
    expect(byName.get("pin")).toBe("map-pin");
    expect(byName.get("parking")).toBe("parking");
    expect(byName.get("user-plus")).toBe("user-plus");
  });
});

describe("guestFormIconGlyph and guestFormIconLabel", () => {
  it("give the glyph and the name of an icon", () => {
    expect(guestFormIconGlyph("food")).toBe("tools-kitchen-2");
    expect(guestFormIconGlyph("car")).toBe("car");
    expect(guestFormIconLabel("food")).toBe("Food");
    expect(guestFormIconLabel("user-plus")).toBe("Extra guest");
  });

  it("give nothing for no icon, and for a name this version does not know", () => {
    expect(guestFormIconGlyph(undefined)).toBeUndefined();
    expect(guestFormIconLabel(undefined)).toBeUndefined();
    expect(guestFormIconGlyph("rocket")).toBeUndefined();
    expect(guestFormIconLabel("rocket")).toBeUndefined();
    expect(guestFormIconGlyph("")).toBeUndefined();
    expect(guestFormIconGlyph("constructor")).toBeUndefined();
  });
});

describe("guestFormIconNamed", () => {
  it("gives back the name of every icon of the list, typed as one", () => {
    for (const name of GUEST_FORM_ICONS) expect(guestFormIconNamed(name)).toBe(name);
  });

  it("gives null for no icon, and for a name that is not in the list, whatever it looks like", () => {
    for (const name of [null, "", "rocket", "Parking", "parking ", "car,food", "constructor", "__proto__", "toString"]) {
      expect(guestFormIconNamed(name), String(name)).toBeNull();
    }
  });
});

describe("iconNotDrawnMessage", () => {
  it("is empty for the kinds of question the form draws an icon for: one-line answers and an optional yes/no", () => {
    for (const type of ["text", "date", "datetime", "phone"]) {
      expect(iconNotDrawnMessage(type, false), type).toBe("");
      expect(iconNotDrawnMessage(type, true), `${type}, required`).toBe("");
    }
    expect(iconNotDrawnMessage("boolean", false)).toBe("");
  });

  it("says which kind of question shows no icon, and that the icon stays saved", () => {
    expect(iconNotDrawnMessage("select", false)).toBe("A Single choice question shows no icon on the registration form. The icon stays saved.");
    expect(iconNotDrawnMessage("select", true)).toBe("A Single choice question shows no icon on the registration form. The icon stays saved.");
    expect(iconNotDrawnMessage("long_text", false)).toBe("A Long text question shows no icon on the registration form. The icon stays saved.");
    expect(iconNotDrawnMessage("boolean", true)).toBe("A required Yes / No question shows no icon on the registration form. The icon stays saved.");
  });

  it("says nothing but the truth for a type this version does not know: no promise is made for it", () => {
    expect(iconNotDrawnMessage("mystery", false)).toBe("A mystery question shows no icon on the registration form. The icon stays saved.");
  });

  it("agrees with the rule of the registration form for every type and both settings of Required", () => {
    for (const type of EVENT_CUSTOM_FIELD_TYPES) {
      for (const required of [false, true]) {
        expect(iconNotDrawnMessage(type, required) === "", `${type}, required ${required}`).toBe(guestFormDrawsIcon({ type, required }));
      }
    }
  });
});
