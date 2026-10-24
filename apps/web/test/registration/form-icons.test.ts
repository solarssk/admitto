import { GUEST_FORM_ICONS } from "@admitto/shared";
import { describe, expect, it } from "vitest";
import { FORM_ICON_PATHS, checkTick, icon, renderIconSprite, type GuestIcon } from "../../src/registration/form-icons.js";
import { documentOf, type Dom } from "../helpers/registration-form-fixtures.js";

/** The symbols the page draws for itself, which no question can name. */
const PAGE_ICONS = ["alert", "calendar-off", "check", "chevron-down", "hourglass", "info", "plus", "refresh", "send", "tick"];

/** A sorted copy: `toSorted` is not in the library TypeScript builds this package against. */
function sorted(list: readonly string[]): string[] {
  const copy = [...list];
  copy.sort();
  return copy;
}

const doc = documentOf(`<body>${renderIconSprite()}</body>`);
const symbols: Dom[] = [...doc.querySelectorAll("symbol")];
const ids = symbols.map((el: Dom) => el.id);

describe("the icons an organiser can give a question", () => {
  it.each([...GUEST_FORM_ICONS])("have a symbol for %s that is drawn from lines and has a size", (name) => {
    const symbol = doc.getElementById(`i-${name}`);
    expect(symbol, `no symbol for ${name}: add its paths to FORM_ICON_PATHS`).not.toBeNull();
    expect(symbol.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(symbol.children.length).toBeGreaterThan(0);
  });

  it("have a symbol each and no other symbol is a question's: the table is the list, and the list only grows", () => {
    expect(sorted(Object.keys(FORM_ICON_PATHS))).toEqual(sorted(GUEST_FORM_ICONS));
  });

  it("stand with the page's own symbols in one sprite, each id once", () => {
    expect(sorted(ids)).toEqual(sorted([...PAGE_ICONS, ...GUEST_FORM_ICONS].map((name) => `i-${name}`)));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("are fixed markup: only lines, circles and boxes, with nothing that could run or load", () => {
    const shapes = new Set(["path", "circle", "rect"]);
    const attributes = new Set(["d", "cx", "cy", "r", "x", "y", "width", "height", "rx"]);
    for (const symbol of symbols) {
      for (const shape of symbol.querySelectorAll("*") as Iterable<Dom>) {
        expect(shapes.has(shape.tagName), `${symbol.id} has <${shape.tagName}>`).toBe(true);
        for (const attribute of [...shape.attributes] as Array<{ name: string }>) {
          expect(attributes.has(attribute.name), `${symbol.id} has ${attribute.name}`).toBe(true);
        }
      }
      expect(sorted([...symbol.attributes].map((attribute: { name: string }) => attribute.name))).toEqual(["id", "viewBox"]);
    }
  });

  it("include the four that the mockup does not draw, in the same 24 by 24 line style", () => {
    for (const name of ["phone", "plane", "train", "shirt"] as const) {
      const symbol = doc.getElementById(`i-${name}`);
      expect(symbol.querySelectorAll("path").length, name).toBeGreaterThan(0);
      expect(symbol.querySelector("[fill], [stroke], [style]"), name).toBeNull();
    }
  });
});

describe("an icon in the page", () => {
  it("refers to its symbol inside the document, is hidden from assistive technology and takes a class", () => {
    const [plain, classed] = [icon("car"), icon("mail", "ic at-inputgroup__icon")].map((html) => documentOf(`<body>${html}</body>`).querySelector("svg"));
    expect(plain.getAttribute("class")).toBe("ic");
    expect(plain.getAttribute("aria-hidden")).toBe("true");
    expect(plain.getAttribute("focusable")).toBe("false");
    expect(plain.querySelector("use").getAttribute("href")).toBe("#i-car");
    expect(classed.getAttribute("class")).toBe("ic at-inputgroup__icon");
  });

  it("cannot leave its attribute, whatever name it is given, because a name comes from the organiser's rules", () => {
    const hostile = '"><script>alert(1)</script><svg onload="alert(1)';
    const page = documentOf(`<body>${icon(hostile as GuestIcon)}</body>`);
    expect(page.querySelectorAll("script, [onload]")).toHaveLength(0);
    expect(page.querySelectorAll("svg")).toHaveLength(1);
    expect(page.querySelector("use").getAttribute("href")).toBe(`#i-${hostile}`);
  });

  it("draws the tick of a checkbox from the sprite", () => {
    const page = documentOf(`<body>${checkTick()}</body>`);
    expect(page.querySelector("use").getAttribute("href")).toBe("#i-tick");
    expect(ids).toContain("i-tick");
  });
});
