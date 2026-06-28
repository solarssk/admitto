import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { DEFAULT_EVENT_ITEM_ICON, ITEM_ICONS, normalizeEventItemIconForForm } from "../../src/requirements/IconPicker.js";

const require = createRequire(import.meta.url);

describe("IconPicker ITEM_ICONS", () => {
  it("maps every picker entry to an outline webfont glyph", () => {
    const cssPath = require.resolve("@tabler/icons-webfont/dist/tabler-icons.min.css");
    const css = readFileSync(cssPath, "utf8");
    const names = ITEM_ICONS.map((icon) => icon.name);
    const missing = names.filter((name) => !css.includes(`.ti-${name}:before`));
    expect(missing, `Missing from ${cssPath}`).toEqual([]);
  });

  it("does not list the default package icon as a selectable grid entry", () => {
    expect(ITEM_ICONS.some((icon) => icon.name === DEFAULT_EVENT_ITEM_ICON)).toBe(false);
  });
});

describe("normalizeEventItemIconForForm", () => {
  it("treats null and package as the default picker value", () => {
    expect(normalizeEventItemIconForForm(null)).toBeNull();
    expect(normalizeEventItemIconForForm("package")).toBeNull();
    expect(normalizeEventItemIconForForm("crown")).toBe("crown");
  });
});
