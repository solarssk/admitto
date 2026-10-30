import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import { renderRegistrationClosedPage, renderRegistrationFormPage } from "../../src/registration/form-page.js";
import { closedModel, formModel, panelModel, question, requiredNewKinds, type Dom } from "../helpers/registration-form-fixtures.js";

// axe-core checks the markup of the page the way an audit tool does: labels, ARIA attributes and
// their targets, landmarks, headings, duplicate ids. jsdom has no layout, so the colour contrast
// rule is off here; the contrast of the tokens is tested in guest-page-css.test.ts.
const AXE_SOURCE = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const NONCE = "bm9uY2U=";

async function violations(window: { eval: (code: string) => void; axe: { run: Function }; document: unknown }) {
  window.eval(AXE_SOURCE);
  const results = await window.axe.run(window.document, { rules: { "color-contrast": { enabled: false } } });
  return (results.violations as Array<{ id: string; help: string; nodes: Array<{ target: unknown }> }>).map(
    (violation) => `${violation.id}: ${violation.help} ${JSON.stringify(violation.nodes.slice(0, 3).map((node) => node.target))}`,
  );
}

function open(html: string) {
  const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://tickets.example.com/r/northwind-summit" });
  return dom.window;
}

/** The page with its own scripts running (the first, and the second of an event with the styled boxes), a fetch that answers
 * `status` and `body`, and a fake widget. */
function running(html: string, answer: { status: number; body: unknown } = { status: 200, body: { ok: true } }) {
  const window = open(html);
  window.fetch = vi.fn(async () => ({ status: answer.status, json: async () => answer.body }));
  window.turnstile = { reset: vi.fn() };
  for (const script of window.document.querySelectorAll("script[nonce]")) window.eval(script.textContent ?? "");
  return window;
}

function fillValid(window: ReturnType<typeof open>) {
  const set = (id: string, value: string) => {
    window.document.getElementById(id).value = value;
  };
  set("f-first_name", "Anna");
  set("f-last_name", "Kowalska");
  set("f-email", "anna.kowalska@contoso.example");
  set("f-q0", "Both days");
  set("f-q4", "true");
  window.document.getElementById("f-terms").checked = true;
  window.admittoTurnstileDone("token");
}

describe("axe-core finds nothing to report", () => {
  const html = renderRegistrationFormPage(formModel(), { nonce: NONCE });

  it("on the form", async () => {
    expect(await violations(open(html))).toEqual([]);
  });

  it("on a form with only the fixed fields, in the other mode", async () => {
    const plain = renderRegistrationFormPage(
      formModel({ mode: "automatic", verifyEmail: false, askCompany: false, askDepartment: false, questions: [], consents: [] }),
      { nonce: NONCE },
    );
    expect(await violations(open(plain))).toEqual([]);
  });

  it("on the form with the page script running and every field marked as an error", async () => {
    const window = running(html);
    window.document.getElementById("reg-submit").click();
    expect(window.document.querySelectorAll(".has-error").length).toBeGreaterThan(5);
    expect(window.document.getElementById("reg-error").hidden).toBe(false);
    expect(await violations(window)).toEqual([]);
  });

  it("on the form with the errors the server named", async () => {
    const window = running(html, { status: 422, body: { errors: { last_name: "That name is not valid.", "custom_data.day": "Pick a day." } } });
    fillValid(window);
    window.document.getElementById("reg-submit").click();
    await vi.waitFor(() => expect(window.document.querySelectorAll(".has-error")).toHaveLength(2), { timeout: 4000, interval: 10 });
    expect(await violations(window)).toEqual([]);
  });

  it("on a form whose choices are opened one after the other, the short one and the one with a search box, with one marked as an error", async () => {
    const choices = [
      question({ key: "day", label: "Which days will you attend?", type: "select", required: true, options: ["Both days", "Day 1 only"] }),
      question({ key: "city", label: "City", type: "select", options: ["Amsterdam", "Berlin", "Copenhagen", "Dublin", "Edinburgh", "Frankfurt", "Geneva"] }),
    ];
    const window = running(renderRegistrationFormPage(formModel({ questions: choices }), { nonce: NONCE }));
    window.document.getElementById("reg-submit").click();
    // Opening a choice moves the focus into its panel, which shuts the one that was open: one panel is open at a time.
    window.document.getElementById("f-q0-trigger").click();
    expect(await violations(window)).toEqual([]);
    window.document.getElementById("f-q1-trigger").click();
    expect(window.document.querySelectorAll("[data-picker-panel]:not([hidden])")).toHaveLength(1);
    expect(await violations(window)).toEqual([]);
  });

  it("on a form whose long text, date, time and phone questions are required, with every one of them left empty", async () => {
    const window = running(renderRegistrationFormPage(formModel({ questions: requiredNewKinds() }), { nonce: NONCE }));
    window.document.getElementById("reg-submit").click();
    for (const id of ["f-q0", "f-q1", "f-q2", "f-q3"]) expect(window.document.getElementById(id).getAttribute("aria-invalid"), id).toBe("true");
    expect(await violations(window)).toEqual([]);
  });

  it("on a form whose newer questions the server refused, with the page's own sentences under them", async () => {
    const errors = { "custom_data.why": "x", "custom_data.checkin": "x", "custom_data.flight": "x", "custom_data.extension": "x" };
    const window = running(renderRegistrationFormPage(formModel({ questions: requiredNewKinds() }), { nonce: NONCE }), {
      status: 422,
      body: { errors },
    });
    const set = (id: string, value: string) => {
      window.document.getElementById(id).value = value;
    };
    set("f-first_name", "Anna");
    set("f-last_name", "Kowalska");
    set("f-email", "anna.kowalska@contoso.example");
    set("f-q0", "A reason of more than twenty characters");
    set("f-q1", "2027-05-13");
    set("f-q2", "2027-05-15T07:45");
    set("f-q3", "12");
    window.document.getElementById("f-terms").checked = true;
    window.admittoTurnstileDone("token");
    window.document.getElementById("reg-submit").click();
    await vi.waitFor(() => expect(window.document.querySelectorAll(".has-error")).toHaveLength(4), { timeout: 4000, interval: 10 });
    expect(await violations(window)).toEqual([]);
  });

  it("on the Check your inbox screen", async () => {
    const window = running(html);
    fillValid(window);
    window.document.getElementById("reg-submit").click();
    await vi.waitFor(() => expect(window.document.getElementById("reg-done").hidden).toBe(false), { timeout: 4000, interval: 10 });
    expect(await violations(window)).toEqual([]);
  });

  it("on the page of an event that is over", async () => {
    expect(await violations(open(renderRegistrationClosedPage(closedModel())))).toEqual([]);
  });
});

describe("axe-core finds nothing to report on the password screen of an event whose way in is the password", () => {
  const html = renderRegistrationFormPage(formModel({ needsPassword: true, questions: [] }), { nonce: NONCE });
  const type = (window: ReturnType<typeof open>, value: string) => {
    window.document.getElementById("f-password").value = value;
  };
  const goOn = (window: ReturnType<typeof open>) => window.document.getElementById("reg-password-continue").click();

  it("as the server writes it, with the form behind it", async () => {
    expect(await violations(open(html))).toEqual([]);
  });

  it("with the page script running, and the field marked as an error because Continue was pressed with nothing typed", async () => {
    const window = running(html);
    goOn(window);
    expect(window.document.querySelector("[data-password-field]").classList.contains("has-error")).toBe(true);
    expect(window.document.getElementById("f-password").getAttribute("aria-invalid")).toBe("true");
    expect(await violations(window)).toEqual([]);
  });

  it("on the form, once a password is typed and Continue is pressed", async () => {
    const window = running(html);
    type(window, "test-password");
    goOn(window);
    expect(window.document.getElementById("reg-password").hidden).toBe(true);
    expect(await violations(window)).toEqual([]);
  });

  it("back on the screen, after the server turned the password away, with the sentence under the field and the form out of sight", async () => {
    const window = running(html, { status: 403, body: { error: "access_denied" } });
    type(window, "wrong-password");
    goOn(window);
    window.document.getElementById("f-first_name").value = "Anna";
    window.document.getElementById("f-last_name").value = "Kowalska";
    window.document.getElementById("f-email").value = "anna.kowalska@contoso.example";
    window.document.getElementById("f-terms").checked = true;
    window.admittoTurnstileDone("token");
    window.document.getElementById("reg-submit").click();
    await vi.waitFor(() => expect(window.document.getElementById("reg-password").hidden).toBe(false), { timeout: 4000, interval: 10 });
    expect(window.document.querySelector("[data-password-field] [data-msg-text]").textContent).toBe(
      "That password did not work. Check it and try again.",
    );
    expect(window.document.activeElement).toBe(window.document.getElementById("f-password"));
    expect(await violations(window)).toEqual([]);
  });
});

describe("axe-core finds nothing to report on the form with icons, panels and suggestions", { timeout: 30_000 }, () => {
  const html = renderRegistrationFormPage(panelModel(), { nonce: NONCE });
  const change = (window: ReturnType<typeof open>, id: string, set: (el: Dom) => void) => {
    const el = window.document.getElementById(id);
    set(el);
    el.dispatchEvent(new window.Event("change", { bubbles: true }));
  };

  it("with every panel closed, as the server writes it", async () => {
    expect(await violations(open(html))).toEqual([]);
  });

  it("with the script running and every panel open", async () => {
    const window = running(html);
    change(window, "f-q0", (el) => (el.value = "Both days"));
    change(window, "f-q2", (el) => (el.checked = true));
    change(window, "f-q4", (el) => (el.checked = true));
    expect(window.document.querySelectorAll(".reg-reveal:not([hidden])")).toHaveLength(3);
    expect(await violations(window)).toEqual([]);
  });

  it("with the list of suggestions open, a row active and the box described by what it says", async () => {
    const window = running(html);
    change(window, "f-q4", (el) => (el.checked = true));
    const box = window.document.getElementById("f-q5");
    box.focus();
    box.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    expect(box.getAttribute("aria-expanded")).toBe("true");
    expect(box.getAttribute("aria-activedescendant")).toBe("f-q5-opt0");
    expect(await violations(window)).toEqual([]);
  });

  it("with the list showing what was typed, the offer of it as written and no match", async () => {
    const window = running(html);
    change(window, "f-q4", (el) => (el.checked = true));
    const box = window.document.getElementById("f-q5");
    box.focus();
    box.value = "zzz";
    box.dispatchEvent(new window.Event("input", { bubbles: true }));
    expect(window.document.querySelector("[data-combo-empty]").hidden).toBe(false);
    expect(await violations(window)).toEqual([]);
  });

  it("with the questions in a panel left empty and marked as errors", async () => {
    const model = formModel({
      questions: [
        question({ key: "parking", label: "Parking", type: "boolean", icon: "parking" }),
        question({ key: "plate", label: "Plate", type: "text", required: true, icon: "car", suggestions: ["WA 1"], showWhen: { field: "parking", value: true } }),
        question({ key: "note", label: "Note", type: "long_text", required: true, showWhen: { field: "parking", value: true } }),
      ],
    });
    const window = running(renderRegistrationFormPage(model, { nonce: NONCE }));
    change(window, "f-q0", (el) => (el.checked = true));
    window.document.getElementById("reg-submit").click();
    expect(window.document.querySelectorAll(".reg-reveal .has-error")).toHaveLength(2);
    expect(await violations(window)).toEqual([]);
  });
});

describe("axe-core finds nothing to report on the part of the form for a guest's companion", () => {
  const companion = {
    max: 1,
    questions: [
      question({ key: "badge", label: "Badge name", type: "text", required: true, icon: "user-plus" }),
      question({ key: "diet", label: "Diet", type: "select", options: ["Vegan", "None"], required: true }),
      question({ key: "car", label: "Needs parking", type: "boolean", icon: "car" }),
      question({ key: "plate", label: "Plate", type: "text", required: true, showWhen: { field: "car", value: true } }),
      question({ key: "notes", label: "Notes", type: "long_text" }),
    ],
  };
  const html = renderRegistrationFormPage(formModel({ companion }), { nonce: NONCE });
  const tick = (window: ReturnType<typeof open>, id: string) => {
    const el = window.document.getElementById(id);
    el.checked = true;
    el.dispatchEvent(new window.Event("change", { bubbles: true }));
  };

  it("with the row not ticked, as the server writes it", async () => {
    expect(await violations(open(html))).toEqual([]);
  });

  it("with the row ticked and the panel open, with the script running", async () => {
    const window = running(html);
    tick(window, "f-companion");
    expect(window.document.getElementById("f-companion-panel").hidden).toBe(false);
    expect(await violations(window)).toEqual([]);
  });

  it("with the panel open and a question under a condition showing", async () => {
    const window = running(html);
    tick(window, "f-companion");
    tick(window, "f-c2");
    expect(window.document.querySelector("[data-field='companion_plate']").hidden).toBe(false);
    expect(await violations(window)).toEqual([]);
  });

  it("with the companion's fields left empty and marked as errors", async () => {
    const window = running(html);
    fillValid(window);
    tick(window, "f-companion");
    window.document.getElementById("reg-submit").click();
    expect(window.document.querySelectorAll("#f-companion-panel .has-error").length).toBeGreaterThanOrEqual(3);
    expect(await violations(window)).toEqual([]);
  });

  it("with the row marked as an error, for a refusal of the number of guests", async () => {
    const window = running(html, { status: 422, body: { errors: { companions: "This event does not take that many guests." } } });
    fillValid(window);
    tick(window, "f-companion");
    (window.document.getElementById("f-companion_name") as Dom).value = "Piotr";
    (window.document.getElementById("f-c0") as Dom).value = "Piotr";
    (window.document.getElementById("f-c1") as Dom).value = "Vegan";
    window.document.getElementById("reg-submit").click();
    await vi.waitFor(() => expect(window.document.querySelector("[data-field='companions']").classList.contains("has-error")).toBe(true), { timeout: 4000 });
    expect(await violations(window)).toEqual([]);
  });
});

describe("axe-core finds nothing to report on the styled phone box of an event that switched the styled boxes on", () => {
  const phones = [
    question({ key: "mobile", label: "Mobile phone", type: "phone", required: true, icon: "phone", rules: { example: "+1 555 0100" } }),
    question({ key: "office", label: "Office phone", type: "phone" }),
  ];
  const styled = (overrides = {}) => renderRegistrationFormPage(formModel({ styledControls: true, questions: phones, ...overrides }), { nonce: NONCE });
  const listOf = (window: ReturnType<typeof open>, id: string): Dom => window.document.getElementById(id);

  it("in the page as the server writes it, before the script runs", async () => {
    expect(await violations(open(styled()))).toEqual([]);
  });

  it("with the script running and the lists closed", async () => {
    expect(await violations(running(styled()))).toEqual([]);
  });

  it("with the list of countries open, its rows built and one of them active", async () => {
    const window = running(styled());
    listOf(window, "f-q0-country").click();
    const search = listOf(window, "f-q0-search");
    search.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    expect(search.getAttribute("aria-activedescendant")).toBe("f-q0-opt-AF");
    expect(window.document.querySelectorAll("#f-q0-list [role=option]").length).toBeGreaterThan(200);
    expect(await violations(window)).toEqual([]);
  });

  it("with a country picked and the number box marked as an error", async () => {
    const window = running(styled());
    listOf(window, "f-q0-country").click();
    listOf(window, "f-q0-opt-PL").click();
    window.document.getElementById("reg-submit").click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(listOf(window, "f-q0").getAttribute("aria-invalid")).toBe("true");
    expect(listOf(window, "f-q0-country").getAttribute("aria-label")).toBe("Mobile phone country code, Poland +48");
    expect(await violations(window)).toEqual([]);
  });

  it("in the companion's panel", async () => {
    const companion = { max: 1, questions: [question({ key: "guest_phone", label: "Guest phone", type: "phone" })] };
    const window = running(styled({ companion }));
    const toggle = listOf(window, "f-companion");
    toggle.checked = true;
    toggle.dispatchEvent(new window.Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    listOf(window, "f-c0-country").click();
    expect(await violations(window)).toEqual([]);
  });
});
