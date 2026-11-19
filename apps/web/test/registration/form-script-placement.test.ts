import { describe, expect, it } from "vitest";
import { question, type Dom } from "../helpers/registration-form-fixtures.js";
import { bootPage, type ScriptPage } from "../helpers/registration-script-page.js";
import { bootDates, DATETIME, calendar, calendarButton, click, clockButton, clockPanel } from "../helpers/registration-date-page.js";

/**
 * The panels of the own boxes float over the form: fixed, placed by the script under the box or above it, inside the screen.
 * jsdom has no layout, so the sizes that a browser measures are given here, and what is checked is the arithmetic of the placement
 * and when it runs. The real layout (the text under the box does not move) is checked in a browser, see the pull request.
 */
const SCREEN = { width: 400, height: 600 };

function size(page: ScriptPage, el: Dom, width: number, height: number): void {
  Object.defineProperty(el, "offsetWidth", { value: width, configurable: true });
  // A panel with a max-height is as tall as that, as in a browser.
  Object.defineProperty(el, "offsetHeight", {
    configurable: true,
    get: () => (el.style.maxHeight ? Math.min(height, Number.parseFloat(el.style.maxHeight)) : height),
  });
}

function screen(page: ScriptPage): void {
  Object.defineProperty(page.doc.documentElement, "clientWidth", { value: SCREEN.width, configurable: true });
  Object.defineProperty(page.win, "innerHeight", { value: SCREEN.height, configurable: true });
}

function anchorAt(el: Dom, left: number, top: number, width = 200, height = 40): void {
  el.getBoundingClientRect = () => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) });
}

const phone = () => bootPage([question({ key: "mobile", label: "Mobile phone", type: "phone" })]);
const scopeOf = (page: ScriptPage): Dom => page.doc.querySelector(".reg-phone__code");
const phonePanel = (page: ScriptPage): Dom => page.doc.getElementById("f-q0-panel");
const openPhone = (page: ScriptPage): void => click(page, page.doc.getElementById("f-q0-country"));
const moved = (el: Dom): string => el.style.transform;

describe("the placement of the list of countries", { timeout: 30_000 }, () => {
  it("puts the list under the box, four pixels below it, in line with its left edge", () => {
    const page = phone();
    screen(page);
    anchorAt(scopeOf(page), 20, 100);
    size(page, phonePanel(page), 280, 300);
    openPhone(page);
    expect(moved(phonePanel(page))).toBe("translate(20px, 144px)");
    expect(phonePanel(page).style.maxHeight).toBe("");
  });

  it("puts the list above the box when the room below is smaller and the room above is larger", () => {
    const page = phone();
    screen(page);
    anchorAt(scopeOf(page), 20, 400);
    size(page, phonePanel(page), 280, 300);
    openPhone(page);
    // 400 - 4 - 300
    expect(moved(phonePanel(page))).toBe("translate(20px, 96px)");
  });

  it("keeps it under the box when it fits there, and also when neither side has room but below has more", () => {
    const page = phone();
    screen(page);
    anchorAt(scopeOf(page), 20, 250);
    size(page, phonePanel(page), 280, 500);
    openPhone(page);
    // below: 600 - 290 - 12 = 298, above: 250 - 12 = 238: stays below, and is no taller than that
    expect(moved(phonePanel(page))).toBe("translate(20px, 294px)");
    expect(phonePanel(page).style.maxHeight).toBe("298px");
    expect(phonePanel(page).style.overflowY).toBe("auto");
  });

  it("is no taller than the room above when it goes up and does not fit, and never under 120 pixels", () => {
    const page = phone();
    screen(page);
    anchorAt(scopeOf(page), 20, 330, 200, 40);
    size(page, phonePanel(page), 280, 500);
    openPhone(page);
    // below: 600 - 370 - 12 = 218, above: 330 - 12 = 318: goes up, 318 high, from y = 330 - 4 - 318
    expect(phonePanel(page).style.maxHeight).toBe("318px");
    expect(moved(phonePanel(page))).toBe("translate(20px, 8px)");

    const small = phone();
    screen(small);
    anchorAt(scopeOf(small), 20, 100, 200, 400);
    size(small, phonePanel(small), 280, 500);
    openPhone(small);
    // below: 600 - 500 - 12 = 88, above: 88: no better side, below is kept, and the list is given at least 120
    expect(small.doc.getElementById("f-q0-panel").style.maxHeight).toBe("120px");
  });

  it("keeps a list that fits under the box there, whatever room there is above", () => {
    const page = phone();
    screen(page);
    anchorAt(scopeOf(page), 20, 300);
    size(page, phonePanel(page), 280, 100);
    openPhone(page);
    expect(moved(phonePanel(page))).toBe("translate(20px, 344px)");
  });

  it("places the list again once the box has filled it, because that changes its height", () => {
    const page = phone();
    screen(page);
    anchorAt(scopeOf(page), 20, 400);
    const panel = phonePanel(page);
    Object.defineProperty(panel, "offsetWidth", { value: 280, configurable: true });
    // Empty until the box opens it and fills it with the rows of the countries.
    Object.defineProperty(panel, "offsetHeight", { configurable: true, get: () => (panel.querySelector("[role=option]") ? 300 : 50) });
    openPhone(page);
    expect(moved(panel)).toBe("translate(20px, 96px)");
  });

  it("is moved in from the right edge of the screen, and from the left one", () => {
    const right = phone();
    screen(right);
    anchorAt(scopeOf(right), 330, 100);
    size(right, phonePanel(right), 280, 300);
    openPhone(right);
    // 400 - 280 - 8
    expect(moved(phonePanel(right))).toBe("translate(112px, 144px)");

    const left = phone();
    screen(left);
    anchorAt(scopeOf(left), -30, 100);
    size(left, phonePanel(left), 280, 300);
    openPhone(left);
    expect(moved(phonePanel(left))).toBe("translate(8px, 144px)");
  });

  it("measures the visual viewport where the browser has one", () => {
    const page = phone();
    screen(page);
    Object.defineProperty(page.win, "visualViewport", { value: { offsetLeft: 10, offsetTop: 50, width: 300, height: 300 }, configurable: true });
    anchorAt(scopeOf(page), 0, 60);
    size(page, phonePanel(page), 280, 100);
    openPhone(page);
    // x: from 10 + 8; y: below the box, 60 + 40 + 4
    expect(moved(phonePanel(page))).toBe("translate(18px, 104px)");
  });

  it("follows the box when the page scrolls or the window is resized, and not when its own list scrolls", () => {
    const page = phone();
    screen(page);
    anchorAt(scopeOf(page), 20, 100);
    size(page, phonePanel(page), 280, 300);
    openPhone(page);
    anchorAt(scopeOf(page), 20, 60);
    phonePanel(page).querySelector("[role=listbox]").dispatchEvent(new page.win.Event("scroll"));
    expect(moved(phonePanel(page))).toBe("translate(20px, 144px)");
    page.doc.dispatchEvent(new page.win.Event("scroll"));
    expect(moved(phonePanel(page))).toBe("translate(20px, 104px)");
    anchorAt(scopeOf(page), 20, 80);
    page.win.dispatchEvent(new page.win.Event("resize"));
    expect(moved(phonePanel(page))).toBe("translate(20px, 124px)");
  });

  it("stops following when the list is closed", () => {
    const page = phone();
    screen(page);
    anchorAt(scopeOf(page), 20, 100);
    size(page, phonePanel(page), 280, 300);
    openPhone(page);
    page.doc.getElementById("f-q0-search").dispatchEvent(new page.win.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(phonePanel(page).hidden).toBe(true);
    anchorAt(scopeOf(page), 20, 10);
    page.doc.dispatchEvent(new page.win.Event("scroll"));
    page.win.dispatchEvent(new page.win.Event("resize"));
    expect(moved(phonePanel(page))).toBe("translate(20px, 144px)");
  });

  it("places it again when its own size changes, where the browser reports that", () => {
    const page = phone();
    let report: (() => void) | undefined;
    screen(page);
    // The page script reads the global of the window it runs in.
    Object.defineProperty(page.win, "ResizeObserver", {
      configurable: true,
      value: class {
        constructor(callback: () => void) {
          report = callback;
        }
        observe() {}
        disconnect() {
          report = undefined;
        }
      },
    });
    anchorAt(scopeOf(page), 20, 100);
    size(page, phonePanel(page), 280, 300);
    openPhone(page);
    expect(report).toBeDefined();
    size(page, phonePanel(page), 280, 200);
    report!();
    expect(moved(phonePanel(page))).toBe("translate(20px, 144px)");
    anchorAt(scopeOf(page), 20, 120);
    report!();
    expect(moved(phonePanel(page))).toBe("translate(20px, 164px)");
    page.doc.getElementById("f-q0-search").dispatchEvent(new page.win.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(report).toBeUndefined();
  });
});

describe("the placement of the calendar and the list of times", { timeout: 30_000 }, () => {
  it("anchor the calendar to the date box before the button, and the list of times to the time box", () => {
    const page = bootDates([DATETIME]);
    screen(page);
    const row = page.doc.querySelector(".reg-dt");
    const [dateBox, , timePart] = [...row.children] as Dom[];
    const timeBox = timePart.querySelector(".at-control");
    anchorAt(dateBox, 12, 200, 150, 40);
    anchorAt(timeBox, 100, 200, 150, 40);
    size(page, calendar(page), 336, 300);
    size(page, clockPanel(page), 240, 200);
    click(page, calendarButton(page));
    expect(moved(calendar(page))).toBe("translate(12px, 244px)");
    click(page, clockButton(page));
    expect(moved(clockPanel(page))).toBe("translate(100px, 244px)");
  });

  it("is moved in from the right edge, so that the list of times stays inside a narrow screen", () => {
    const page = bootDates([DATETIME]);
    screen(page);
    const timeBox = page.doc.querySelector(".reg-dt__time .at-control");
    anchorAt(timeBox, 300, 200, 90, 40);
    size(page, clockPanel(page), 240, 200);
    click(page, clockButton(page));
    expect(moved(clockPanel(page))).toBe("translate(152px, 244px)");
  });
});
