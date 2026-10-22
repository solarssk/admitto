import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import { renderRegistrationClosedPage, renderRegistrationFormPage } from "../../src/registration/form-page.js";
import { REGISTRATION_FORM_SCRIPT } from "../../src/registration/form-script.js";
import { closedModel, formModel, requiredNewKinds } from "../helpers/registration-form-fixtures.js";

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

/** The page with its own script running, a fetch that answers `status` and `body`, and a fake widget. */
function running(html: string, answer: { status: number; body: unknown } = { status: 200, body: { ok: true } }) {
  const window = open(html);
  window.fetch = vi.fn(async () => ({ status: answer.status, json: async () => answer.body }));
  window.turnstile = { reset: vi.fn() };
  window.eval(REGISTRATION_FORM_SCRIPT);
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
