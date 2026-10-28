import { describe, expect, it } from "vitest";
import { renderRegistrationFormPage } from "../../src/registration/form-page.js";
import { REGISTRATION_PAGE_CSS } from "../../src/registration/form-style.js";
import { documentOf, formModel, type Dom } from "../helpers/registration-form-fixtures.js";

const NONCE = "bm9uY2U=";

/** The page of an event whose way in is the password (D-C3), or of one that is not, as a document. */
const page = (overrides: Parameters<typeof formModel>[0] = {}) =>
  documentOf(renderRegistrationFormPage(formModel({ needsPassword: true, ...overrides }), { nonce: NONCE }));
const text = (el: Dom) => el.textContent.replaceAll(/\s+/g, " ").trim();

describe("the password screen of the page", () => {
  it("is the mockup's: the lock, the name of the event, what to do, the field with its lock, and Continue", () => {
    const doc = page();
    const screen = doc.getElementById("reg-password");

    expect(screen.tagName).toBe("SECTION");
    expect(screen.className).toBe("reg-center");
    expect(screen.getAttribute("aria-labelledby")).toBe("reg-password-title");
    expect(screen.hasAttribute("hidden")).toBe(false);
    expect(screen.querySelector(".reg-badge use").getAttribute("href")).toBe("#i-lock");
    expect(text(doc.getElementById("reg-password-title"))).toBe("Northwind Partner Summit 2027");
    expect(doc.getElementById("reg-password-title").tagName).toBe("H1");
    expect(text(screen.querySelector(":scope > p"))).toBe("This registration needs the event password. You will find it in your invitation.");
    expect(text(screen.querySelector("label"))).toBe("Event password");
    expect(screen.querySelector("label").getAttribute("for")).toBe("f-password");
    expect(screen.querySelector(".at-inputgroup .at-inputgroup__icon use").getAttribute("href")).toBe("#i-lock");
    const button = doc.getElementById("reg-password-continue");
    expect(text(button)).toBe("Continue");
    expect(button.className).toBe("at-btn at-btn--primary at-btn--lg");
    expect(button.getAttribute("type")).toBe("button");
  });

  it("comes before everything else of the card, after its header, and the footer is the mockup's: Powered by Admitto", () => {
    const doc = page();
    const order = [...doc.querySelector("main").children].map((el: Dom) => el.id || el.className.split(" ")[0]);

    expect(order).toEqual(["ticket__top", "reg-password", "reg-hero", "reg-notices", "reg-form", "reg-done", "ticket__foot"]);
    expect(text(doc.querySelector(".ticket__foot"))).toContain("Powered by Admitto");
  });

  it("keeps the hero, the notices, the form and the contact behind it, written hidden for the script to show", () => {
    const doc = page();
    const behind = [...doc.querySelectorAll("[data-after-password]")];

    expect(behind.map((el: Dom) => el.className || el.tagName)).toEqual(["reg-hero", "reg-notices", "reg-form", "reg-foot-line"]);
    for (const el of behind) expect(el.hasAttribute("hidden"), el.className).toBe(true);
    // The form and its fields are in the page for anyone who knows its address: the password protects the registration, not the page.
    expect(doc.getElementById("reg-form").querySelectorAll("[data-field]").length).toBeGreaterThan(5);
    expect(doc.getElementById("reg-done").hasAttribute("hidden")).toBe(true);
  });

  it("writes a field that no browser or extension is asked to fill in or save, and that takes any text", () => {
    const input = page().getElementById("f-password");

    expect(input.getAttribute("type")).toBe("password");
    expect(input.getAttribute("autocomplete")).toBe("off");
    expect(input.getAttribute("autocapitalize")).toBe("none");
    expect(input.getAttribute("spellcheck")).toBe("false");
    for (const opt of ["data-1p-ignore", "data-lpignore", "data-bwignore"]) expect(input.getAttribute(opt), opt).toBe("true");
    // Twice the longest password, in UTF-16 units: only a stop for a huge paste. No `minlength`, `pattern` or `required`: the server judges.
    expect(input.getAttribute("maxlength")).toBe("256");
    for (const rule of ["minlength", "pattern", "required"]) expect(input.hasAttribute(rule), rule).toBe(false);
    expect(input.getAttribute("aria-describedby")).toBe("m-f-password");
    expect(input.hasAttribute("value")).toBe(false);
  });

  it("is not a field of the form, and is not in a form element: a browser that does not run the script cannot send it in an address", () => {
    const doc = page();
    const box = doc.querySelector("[data-password-field]");

    expect(box.hasAttribute("data-field")).toBe(false);
    expect(doc.getElementById("f-password").closest("form")).toBeNull();
    expect(doc.getElementById("reg-form").querySelector("input[type=password]")).toBeNull();
    expect(doc.querySelectorAll("form")).toHaveLength(1);
  });

  it("keeps room for its error under the field, and announces it to a reader as it appears", () => {
    const slot = page().getElementById("m-f-password");

    expect(slot.className).toBe("at-hint reg-slot");
    expect(slot.getAttribute("aria-live")).toBe("polite");
    expect(slot.getAttribute("aria-atomic")).toBe("true");
    expect(slot.querySelector(".reg-slot__err.at-hint--error [data-msg-text]").textContent).toBe("");
    expect(slot.querySelector(".reg-slot__hint")).toBeNull();
  });

  it("needs the script: the button is off until it has run, and a page without it says so on the screen", () => {
    const doc = page();

    expect(doc.getElementById("reg-password-continue").hasAttribute("disabled")).toBe(true);
    const noScript = doc.getElementById("reg-password").querySelector("noscript");
    expect(noScript.textContent).toContain("This form needs JavaScript");
  });

  it("writes the title of the event as text, whatever it holds", () => {
    const hostile = '<img src=x onerror="alert(1)"> & "quotes"';
    const doc = page({ event: { ...formModel().event, title: hostile } });

    expect(doc.getElementById("reg-password-title").textContent).toBe(hostile);
    expect(doc.getElementById("reg-password").querySelector("img")).toBeNull();
  });

  it("is not on the page of an event whose way in is the link, which is shown as it was: nothing hidden, no field for a password", () => {
    const doc = page({ needsPassword: false });

    expect(doc.getElementById("reg-password")).toBeNull();
    expect(doc.getElementById("f-password")).toBeNull();
    expect(doc.querySelectorAll("[data-after-password]")).toHaveLength(0);
    expect(doc.querySelector("input[type=password]")).toBeNull();
    expect(doc.getElementById("reg-form").closest("[hidden]")).toBeNull();
    expect(doc.querySelector(".reg-notices").closest("[hidden]")).toBeNull();
    // The error notice is hidden until it has something to say, and that is all that hides it.
    expect(doc.getElementById("reg-error").parentElement.closest("[hidden]")).toBeNull();
    expect(doc.querySelector(".reg-hero").hasAttribute("hidden")).toBe(false);
    expect(doc.querySelector(".reg-foot-line").hasAttribute("hidden")).toBe(false);
  });

  it("is set from the left, as wide as its button, in the stylesheet of the center screens, as the mockup has it", () => {
    expect(REGISTRATION_PAGE_CSS).toContain(".reg-center .at-field { width: 100%; max-width: 320px; text-align: left; }");
    expect(REGISTRATION_PAGE_CSS).toContain(".reg-center .at-btn { width: 100%; max-width: 320px; }");
  });

  it("keeps two lines of room under the field, which is what the sentence for a wrong password takes, so that the button does not move when it comes", () => {
    expect(REGISTRATION_PAGE_CSS).toContain(".reg-center .reg-slot { min-height: 2rem; }");
  });

  it("leaves the contact line out of the page only while the password is asked for, and has none to hide for an event without a contact", () => {
    const withoutContact = page({ contact: null });

    expect([...withoutContact.querySelectorAll("[data-after-password]")].map((el: Dom) => el.className || el.tagName)).toEqual(["reg-hero", "reg-notices", "reg-form"]);
    expect(withoutContact.querySelector(".reg-foot-line")).toBeNull();
  });
});
