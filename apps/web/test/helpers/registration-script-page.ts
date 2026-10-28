import { JSDOM } from "jsdom";
import { vi } from "vitest";
import { renderRegistrationFormPage } from "../../src/registration/form-page.js";
import type { FormQuestion, RegistrationFormModel } from "../../src/registration/form-model.js";
import { REGISTRATION_FORM_SCRIPT } from "../../src/registration/form-script.js";
import { formModel, type Dom } from "./registration-form-fixtures.js";

export const PAGE_URL = "https://tickets.example.com/r/northwind-summit";
const NONCE = "bm9uY2U=";

export type ScriptPage = ReturnType<typeof bootPage>;

/** A `fetch` that answers 200 `{ ok: true }` and records what it was asked. */
function stubFetch() {
  return vi.fn(
    async (_input: string | URL, _init?: RequestInit): Promise<{ status: number; json: () => Promise<unknown> }> => ({
      status: 200,
      json: async () => ({ ok: true }),
    }),
  );
}

/**
 * The form page of `questions` (the fixed fields and one consent come with the fixture) in a window of its own, with
 * its real script run, a fetch that records, and a fake Turnstile. `edit` can change the page's HTML first, to build a
 * page the server would not write (a condition that names no question, say). `before` runs on the document before the
 * script does, the way a browser restores what a guest had ticked. `model` changes the form's model, to ask for the password
 * of the event, say.
 */
export function bootPage(
  questions: readonly FormQuestion[],
  options: { edit?: (html: string) => string; before?: (doc: Dom) => void; model?: Partial<RegistrationFormModel> } = {},
) {
  const html = renderRegistrationFormPage(formModel({ questions: [...questions], ...options.model }), { nonce: NONCE });
  const dom = new JSDOM(options.edit ? options.edit(html) : html, { runScripts: "outside-only", pretendToBeVisual: true, url: PAGE_URL });
  const win = dom.window;
  const fetchMock = stubFetch();
  win.fetch = fetchMock;
  win.turnstile = { reset: vi.fn() };
  options.before?.(win.document);
  win.eval(REGISTRATION_FORM_SCRIPT);
  return { win, doc: win.document as Dom, fetchMock };
}

/** Waits for what a promise chain or a short timer of the page script will do. The limit only catches a hang. */
export const until = (assertion: () => void) => vi.waitFor(assertion, { timeout: 4000, interval: 10 });

export function typeInto(page: ScriptPage, id: string, value: string): void {
  const el = page.doc.getElementById(id);
  el.value = value;
  el.dispatchEvent(new page.win.Event("input", { bubbles: true }));
}

export function tickBox(page: ScriptPage, id: string, checked = true): void {
  const el = page.doc.getElementById(id);
  el.checked = checked;
  el.dispatchEvent(new page.win.Event("change", { bubbles: true }));
}

export function chooseOption(page: ScriptPage, id: string, value: string): void {
  const el = page.doc.getElementById(id);
  el.value = value;
  el.dispatchEvent(new page.win.Event("change", { bubbles: true }));
}

/** The names, the address, the terms and the check: everything the fixed part of the form needs. */
export function fillFixedFields(page: ScriptPage): void {
  typeInto(page, "f-first_name", "Anna");
  typeInto(page, "f-last_name", "Kowalska");
  typeInto(page, "f-email", "anna.kowalska@contoso.example");
  tickBox(page, "f-terms");
  page.win.admittoTurnstileDone("token");
}

export const sendForm = (page: ScriptPage): void => page.doc.getElementById("reg-submit").click();

/** The body of the first request the page sent. */
export const sentBody = (page: ScriptPage) => JSON.parse(page.fetchMock.mock.calls[0]![1]!.body as string);

/** The field wrapper of the question with this key. */
export const boxOf = (page: ScriptPage, key: string): Dom => page.doc.querySelector(`[data-custom="${key}"]`);
