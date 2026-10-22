import { describe, expect, it } from "vitest";
import { REGISTRATION_PAGE_CSS } from "../../src/registration/form-style.js";
import { question, type Dom } from "../helpers/registration-form-fixtures.js";
import { bootPage, fillFixedFields, sendForm, tickBox, typeInto, type ScriptPage } from "../helpers/registration-script-page.js";

// "Before you send": the terms, the optional consents, the security check and the button stand as the mockup has them, one
// line apart, with no room kept for an error that is not there. The error of the terms opens under its row when there is
// one. (The spacing itself is measured in a real browser; here the page's own stylesheet is read by the browser model.)

const page = (): ScriptPage => bootPage([question({ key: "a", label: "A", type: "text" })]);
const display = (p: ScriptPage, el: Dom): string => p.win.getComputedStyle(el).display;
const visibility = (p: ScriptPage, el: Dom): string => p.win.getComputedStyle(el).visibility;

describe("the ticks of Before you send, while there is no error", () => {
  it("have no element between them that keeps room: the slot under the terms takes none until there is an error", () => {
    const p = page();
    const checks = p.doc.querySelector(".reg-checks");
    const [terms, consent] = [...checks.children];
    expect(terms.getAttribute("data-field")).toBe("terms");
    expect(consent.tagName).toBe("LABEL");
    const slot = terms.querySelector("[data-slot]");
    expect(slot.classList.contains("reg-slot--collapsed")).toBe(true);
    expect(display(p, slot)).toBe("none");
    // Everything the terms box holds is the tick itself: the message is not drawn.
    const drawn = [...terms.children].filter((el: Dom) => display(p, el) !== "none");
    expect(drawn.map((el: Dom) => el.tagName)).toEqual(["LABEL"]);
  });

  it("stand in a grid, the box of the terms being one of its rows as a tick is, so no line of text height is added under it", () => {
    const p = page();
    const terms = p.doc.querySelector('.reg-checks [data-field="terms"]');
    expect(display(p, terms)).toBe("grid");
    expect(display(p, p.doc.querySelector(".reg-checks"))).toBe("grid");
    // A tick of another consent is a row of the same grid, a child of it as the box of the terms is.
    expect(p.doc.getElementById("f-consent-0").closest("label").parentElement).toBe(p.doc.querySelector(".reg-checks"));
    expect(terms.parentElement).toBe(p.doc.querySelector(".reg-checks"));
  });

  it("are followed by the security check with no room kept for its error either", () => {
    const p = page();
    const slot = p.doc.querySelector('[data-kind="challenge"] [data-slot]');
    expect(slot.classList.contains("reg-slot--collapsed")).toBe(true);
    expect(display(p, slot)).toBe("none");
  });

  it("leave the slot of a text box as it was: a box keeps a line for its note or its error, so an error does not move the fields", () => {
    const p = page();
    for (const id of ["m-f-first_name", "m-f-email", "m-f-q0"]) {
      const slot = p.doc.getElementById(id);
      expect(slot.classList.contains("reg-slot--collapsed"), id).toBe(false);
      expect(display(p, slot), id).toBe("grid");
    }
  });

  it("have no message in the way of a screen reader: the slot is not drawn and holds no text", () => {
    const p = page();
    const slot = p.doc.getElementById("m-f-terms");
    expect(slot.querySelector("[data-msg-text]").textContent).toBe("");
    expect(p.doc.getElementById("f-terms").getAttribute("aria-describedby")).toBe("m-f-terms");
    expect(p.doc.getElementById("f-terms").hasAttribute("aria-invalid")).toBe(false);
  });
});

describe("the error of the terms", () => {
  /** A form that is right except that the terms are not ticked. */
  function withoutTerms(): ScriptPage {
    const p = page();
    fillFixedFields(p);
    tickBox(p, "f-terms", false);
    sendForm(p);
    return p;
  }

  it("opens under the tick, where the guest looks: shown, in the colour of an error, with its words", () => {
    const p = withoutTerms();
    const slot = p.doc.getElementById("m-f-terms");
    expect(display(p, slot)).toBe("grid");
    expect(visibility(p, slot.querySelector(".reg-slot__err"))).toBe("visible");
    expect(slot.querySelector("[data-msg-text]").textContent).toBe("Accept the event terms to continue.");
    expect(slot.classList.contains("at-hint")).toBe(true);
    expect(slot.querySelector(".reg-slot__err").classList.contains("at-hint--error")).toBe(true);
    const box = slot.closest("[data-field]");
    expect([...box.children].map((el: Dom) => el.tagName)).toEqual(["LABEL", "P"]);
    expect(box.classList.contains("has-error")).toBe(true);
  });

  it("is told to a screen reader: the tick is invalid and described by it, the notice that counts the problems is an alert, and the tick has the focus", () => {
    const p = withoutTerms();
    const tick = p.doc.getElementById("f-terms");
    expect(tick.getAttribute("aria-invalid")).toBe("true");
    expect(tick.getAttribute("aria-describedby")).toBe("m-f-terms");
    expect(p.doc.getElementById(tick.getAttribute("aria-describedby")).textContent).toContain("Accept the event terms to continue.");
    const notice = p.doc.getElementById("reg-error");
    expect(notice.getAttribute("role")).toBe("alert");
    expect(notice.hidden).toBe(false);
    expect(p.doc.getElementById("reg-error-text").textContent).toBe("1 field needs your attention. It is marked in red.");
    expect(p.doc.activeElement).toBe(tick);
    expect(p.fetchMock).not.toHaveBeenCalled();
  });

  it("is also there for a guest who has more to fix, in the order of the form", () => {
    const p = page();
    sendForm(p);
    const shown = [...p.doc.querySelectorAll("[data-slot]")].filter((el: Dom) => display(p, el) !== "none" && el.closest(".has-error"));
    expect(shown.map((el: Dom) => el.id).slice(-2)).toEqual(["m-f-terms", "m-challenge"]);
    expect(display(p, p.doc.getElementById("m-challenge"))).toBe("grid");
  });

  it("goes when the guest ticks the box, and the slot takes no room again", () => {
    const p = withoutTerms();
    tickBox(p, "f-terms", true);
    const slot = p.doc.getElementById("m-f-terms");
    expect(slot.querySelector("[data-msg-text]").textContent).toBe("");
    expect(p.doc.getElementById("f-terms").hasAttribute("aria-invalid")).toBe(false);
    expect(display(p, slot)).toBe("none");
  });

  it("goes when the guest edits another field and comes back only when the form is sent again", () => {
    const p = withoutTerms();
    typeInto(p, "f-first_name", "Anne");
    expect(display(p, p.doc.getElementById("m-f-terms"))).toBe("grid");
    sendForm(p);
    expect(display(p, p.doc.getElementById("m-f-terms"))).toBe("grid");
  });
});

describe("the stylesheet that does it", () => {
  it("collapses a slot until its box has an error, and makes the box of the terms a grid like the ticks next to it", () => {
    for (const rule of [
      ".reg-slot--collapsed { display: none; }",
      ".has-error .reg-slot--collapsed { display: grid; }",
      ".reg-checks > [data-field] { display: grid; }",
      ".reg-checks { display: grid; gap: 10px; }",
    ]) {
      expect(REGISTRATION_PAGE_CSS, rule).toContain(rule);
    }
  });

  it("puts the collapse after the rule of the slot, which would otherwise win, and keeps the indent of the message under the words of the tick", () => {
    expect(REGISTRATION_PAGE_CSS.indexOf(".reg-slot--collapsed {")).toBeGreaterThan(REGISTRATION_PAGE_CSS.indexOf(".reg-slot { display: grid;"));
    expect(REGISTRATION_PAGE_CSS).toContain(".reg-checks .reg-slot { margin-top: 2px; padding-left: calc(1rem + var(--space-2)); }");
  });
});
