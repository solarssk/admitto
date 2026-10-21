import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import { renderRegistrationFormPage } from "../../src/registration/form-page.js";
import { REGISTRATION_FORM_SCRIPT } from "../../src/registration/form-script.js";
import { formModel, question, type Dom } from "../helpers/registration-form-fixtures.js";

const NONCE = "bm9uY2U=";
const PAGE_URL = "https://tickets.example.com/r/northwind-summit";

type Answer = { status: number; body?: unknown; unreadable?: boolean };

/** A `fetch` that records each call and answers with `answer`. */
function stubFetch(answer: Answer | (() => Promise<Answer>) = { status: 200, body: { ok: true } }) {
  return vi.fn(async (_input: string | URL, _init?: RequestInit) => {
    const { status, body, unreadable } = typeof answer === "function" ? await answer() : answer;
    return {
      status,
      json: async () => {
        if (unreadable) throw new SyntaxError("not json");
        return body;
      },
    };
  });
}

/** The page of `overrides`, with its script run in a window that has `fetchMock` and a fake Turnstile. */
function boot(
  options: { model?: Parameters<typeof formModel>[0]; fetchMock?: ReturnType<typeof stubFetch>; script?: string } = {},
) {
  const html = renderRegistrationFormPage(formModel(options.model), { nonce: NONCE });
  const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: PAGE_URL });
  const win = dom.window;
  const fetchMock = options.fetchMock ?? stubFetch();
  win.fetch = fetchMock;
  win.turnstile = { reset: vi.fn() };
  win.eval(options.script ?? REGISTRATION_FORM_SCRIPT);
  return { win, doc: win.document, fetchMock, reset: win.turnstile.reset as ReturnType<typeof vi.fn> };
}

type Page = ReturnType<typeof boot>;

/** Waits for what a promise chain or a short timer of the page script will do. The limit only catches a hang, so a slow runner is fine. */
const until = (assertion: () => void) => vi.waitFor(assertion, { timeout: 4000, interval: 10 });

function type(page: Page, id: string, value: string) {
  const el = page.doc.getElementById(id);
  el.value = value;
  el.dispatchEvent(new page.win.Event("input", { bubbles: true }));
}

function tick(page: Page, id: string, checked = true) {
  const el = page.doc.getElementById(id);
  el.checked = checked;
  el.dispatchEvent(new page.win.Event("change", { bubbles: true }));
}

function solve(page: Page, token = "token-1") {
  page.win.admittoTurnstileDone(token);
}

/** Every required thing answered: the names, the address, the two required questions, the terms, the check. */
function fillValid(page: Page) {
  type(page, "f-first_name", "  Anna ");
  type(page, "f-last_name", "Kowalska");
  type(page, "f-email", "anna.kowalska@contoso.example");
  type(page, "f-q0", "Both days");
  type(page, "f-q4", "false");
  tick(page, "f-terms");
  solve(page);
}

const send = (page: Page) => page.doc.getElementById("reg-submit").click();
const slotText = (page: Page, field: string) => page.doc.querySelector(`[data-field="${field}"] [data-msg-text]`).textContent;
const invalidFields = (page: Page): string[] =>
  [...page.doc.querySelectorAll(".has-error")].map((el: Dom) => el.getAttribute("data-field") ?? "");
const body = (page: Page) => JSON.parse(page.fetchMock.mock.calls[0]![1]!.body as string);

describe("starting", () => {
  it("enables the send button once the script has run", () => {
    const html = renderRegistrationFormPage(formModel(), { nonce: NONCE });
    const dom = new JSDOM(html, { runScripts: "outside-only", url: PAGE_URL });
    expect(dom.window.document.getElementById("reg-submit").disabled).toBe(true);
    dom.window.fetch = stubFetch();
    dom.window.eval(REGISTRATION_FORM_SCRIPT);
    expect(dom.window.document.getElementById("reg-submit").disabled).toBe(false);
  });

  it("is plain browser JavaScript: no eval, no innerHTML, no document.write", () => {
    expect(REGISTRATION_FORM_SCRIPT).not.toMatch(/\beval\(|new Function|innerHTML|outerHTML|insertAdjacentHTML|document\.write|\bimport\(/);
    expect(REGISTRATION_FORM_SCRIPT).not.toContain("</script");
    expect(REGISTRATION_FORM_SCRIPT).not.toContain("`");
  });
});

describe("checking the form in the browser", () => {
  it("sends nothing from an empty form, marks every field that needs an answer, and focuses the first", () => {
    const page = boot();
    send(page);
    expect(page.fetchMock).not.toHaveBeenCalled();
    expect(invalidFields(page)).toEqual(["first_name", "last_name", "email", "custom_data.day", "custom_data.badge", "terms", "challenge"]);
    expect(page.doc.activeElement.id).toBe("f-first_name");
    expect(slotText(page, "first_name")).toBe("Enter your first name.");
    expect(slotText(page, "email")).toBe("Enter a full address, like name@company.com.");
    expect(slotText(page, "custom_data.day")).toBe("Choose one option.");
    expect(slotText(page, "custom_data.badge")).toBe("Choose Yes or No.");
    expect(slotText(page, "terms")).toBe("Accept the event terms to continue.");
    expect(slotText(page, "challenge")).toBe("Complete the security check.");
  });

  it("says how many fields need attention, in an alert, and marks the controls", () => {
    const page = boot();
    send(page);
    const summary = page.doc.getElementById("reg-error");
    expect(summary.hidden).toBe(false);
    expect(summary.getAttribute("role")).toBe("alert");
    expect(page.doc.getElementById("reg-error-text").textContent).toBe("7 fields need your attention. They are marked in red.");
    expect(page.doc.getElementById("f-first_name").getAttribute("aria-invalid")).toBe("true");
    expect(page.doc.getElementById("f-first_name").classList.contains("at-input--invalid")).toBe(true);
    expect(page.doc.getElementById("f-q0").classList.contains("at-select--invalid")).toBe(true);
    expect(page.doc.getElementById("f-terms").getAttribute("aria-invalid")).toBe("true");
  });

  it("uses the singular for one field", () => {
    const page = boot();
    fillValid(page);
    type(page, "f-last_name", "  ");
    send(page);
    expect(page.doc.getElementById("reg-error-text").textContent).toBe("1 field needs your attention. It is marked in red.");
    expect(page.doc.activeElement.id).toBe("f-last_name");
  });

  it("does not send a form whose terms are not accepted, however well the rest is filled in", () => {
    const page = boot();
    fillValid(page);
    tick(page, "f-terms", false);
    tick(page, "f-consent-0", true);
    send(page);
    expect(page.fetchMock).not.toHaveBeenCalled();
    expect(invalidFields(page)).toEqual(["terms"]);
    expect(page.doc.activeElement.id).toBe("f-terms");
  });

  it("does not send a form whose security check is not solved", () => {
    const page = boot();
    fillValid(page);
    page.win.admittoTurnstileExpired();
    send(page);
    expect(page.fetchMock).not.toHaveBeenCalled();
    expect(invalidFields(page)).toEqual(["challenge"]);
  });

  it("does not take an address with no dot in its domain, or with a space", () => {
    for (const bad of ["anna", "anna@", "anna@contoso", "anna kowalska@contoso.example", "@contoso.example"]) {
      const page = boot();
      fillValid(page);
      type(page, "f-email", bad);
      send(page);
      expect(page.fetchMock, bad).not.toHaveBeenCalled();
      expect(invalidFields(page), bad).toEqual(["email"]);
    }
  });

  it("does not move anything: an error appears in the slot that was already there", () => {
    const page = boot();
    const before = page.doc.querySelectorAll("[data-slot]").length;
    send(page);
    expect(page.doc.querySelectorAll("[data-slot]")).toHaveLength(before);
    for (const slot of page.doc.querySelectorAll("[data-slot]")) expect(slot.querySelector("[data-msg-text]")).not.toBeNull();
  });

  it("clears a field's error when the guest edits it", () => {
    const page = boot();
    send(page);
    type(page, "f-first_name", "Anna");
    expect(invalidFields(page)).not.toContain("first_name");
    expect(slotText(page, "first_name")).toBe("");
    expect(page.doc.getElementById("f-first_name").hasAttribute("aria-invalid")).toBe(false);
    expect(page.doc.getElementById("f-first_name").classList.contains("at-input--invalid")).toBe(false);
  });

  it("clears every error before it checks again", () => {
    const page = boot();
    send(page);
    fillValid(page);
    send(page);
    expect(invalidFields(page)).toEqual([]);
    expect(page.doc.getElementById("reg-error").hidden).toBe(true);
  });
});

describe("what is sent", () => {
  it("posts one JSON body to the page's own path, with only what the guest answered", async () => {
    const page = boot();
    fillValid(page);
    type(page, "f-company", "Contoso Ltd");
    tick(page, "f-q1", true);
    type(page, "f-q3", " WA 12345 ");
    tick(page, "f-consent-0", true);
    send(page);
    await until(() => expect(page.fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = page.fetchMock.mock.calls[0]!;
    expect(url).toBe("/r/northwind-summit");
    expect(init!.method).toBe("POST");
    expect(init!.headers).toEqual({ "Content-Type": "application/json", Accept: "application/json" });
    expect(init!.credentials).toBe("same-origin");
    expect(JSON.parse(init!.body as string)).toEqual({
      first_name: "Anna",
      last_name: "Kowalska",
      email: "anna.kowalska@contoso.example",
      company: "Contoso Ltd",
      custom_data: { day: "Both days", parking: "true", plate: "WA 12345", badge: "false" },
      terms: true,
      consents: ["photos"],
      challenge: "token-1",
    });
  });

  it("leaves out a question that was not answered and a profile field that was left empty", async () => {
    const page = boot();
    fillValid(page);
    send(page);
    await until(() => expect(page.fetchMock).toHaveBeenCalledTimes(1));
    const sent = body(page);
    expect(Object.keys(sent)).toEqual(["first_name", "last_name", "email", "custom_data", "terms", "consents", "challenge"]);
    expect(sent.custom_data).toEqual({ day: "Both days", badge: "false" });
    expect(sent.consents).toEqual([]);
  });

  it("does not record a Yes/No that was left unticked as a no", async () => {
    const page = boot();
    fillValid(page);
    tick(page, "f-q2", false);
    send(page);
    await until(() => expect(page.fetchMock).toHaveBeenCalledTimes(1));
    expect(Object.keys(body(page).custom_data)).not.toContain("diet");
    expect(Object.keys(body(page).custom_data)).not.toContain("parking");
  });

  it("sends no custom_data at all when no question was answered", async () => {
    const page = boot({ model: { questions: [question({ key: "plate", label: "Plate", type: "text" })] } });
    type(page, "f-first_name", "Anna");
    type(page, "f-last_name", "Kowalska");
    type(page, "f-email", "anna@contoso.example");
    tick(page, "f-terms");
    solve(page);
    send(page);
    await until(() => expect(page.fetchMock).toHaveBeenCalledTimes(1));
    expect(Object.keys(body(page))).toEqual(["first_name", "last_name", "email", "terms", "consents", "challenge"]);
  });

  it("sends only the consents that are ticked, by key", async () => {
    const page = boot({
      model: {
        consents: [
          { key: "a", title: "A", path: "/legal/x/consent-a" },
          { key: "b", title: "B", path: "/legal/x/consent-b" },
          { key: "c", title: "C", path: "/legal/x/consent-c" },
        ],
      },
    });
    fillValid(page);
    tick(page, "f-consent-0");
    tick(page, "f-consent-2");
    send(page);
    await until(() => expect(page.fetchMock).toHaveBeenCalledTimes(1));
    expect(body(page).consents).toEqual(["a", "c"]);
  });

  it("puts nothing the guest typed in the address, and posts instead of getting", async () => {
    const page = boot();
    fillValid(page);
    send(page);
    await until(() => expect(page.fetchMock).toHaveBeenCalledTimes(1));
    expect(page.win.location.href).toBe(PAGE_URL);
    expect(page.win.location.search).toBe("");
    expect(page.doc.getElementById("reg-form").method).toBe("post");
    expect(page.fetchMock.mock.calls[0]![0]).not.toContain("?");
  });

  it("keeps a question key that is called like an object property as an answer", async () => {
    const page = boot({
      model: { questions: [question({ key: "constructor", label: "Q", type: "text" }), question({ key: "__proto__", label: "R", type: "text" })] },
    });
    type(page, "f-first_name", "Anna");
    type(page, "f-last_name", "Kowalska");
    type(page, "f-email", "anna@contoso.example");
    type(page, "f-q0", "one");
    type(page, "f-q1", "two");
    tick(page, "f-terms");
    solve(page);
    send(page);
    await until(() => expect(page.fetchMock).toHaveBeenCalledTimes(1));
    const text = page.fetchMock.mock.calls[0]![1]!.body as string;
    expect(text).toContain('"constructor":"one"');
    expect(text).toContain('"__proto__":"two"');
    expect(({} as Record<string, unknown>)["x"]).toBeUndefined();
  });

  it("sends once, whatever the guest clicks while it waits, and says it is sending", async () => {
    let release: (answer: Answer) => void = () => undefined;
    const pending = new Promise<Answer>((resolve) => {
      release = resolve;
    });
    const page = boot({ fetchMock: stubFetch(() => pending) });
    fillValid(page);
    send(page);
    send(page);
    page.doc.getElementById("reg-form").dispatchEvent(new page.win.Event("submit", { cancelable: true, bubbles: true }));
    expect(page.fetchMock).toHaveBeenCalledTimes(1);
    const button = page.doc.getElementById("reg-submit");
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(page.doc.getElementById("reg-submit-label").textContent).toBe("Sending…");
    release({ status: 200, body: { ok: true } });
    await until(() => expect(page.doc.getElementById("reg-done").hidden).toBe(false));
    expect(button.getAttribute("aria-busy")).toBeNull();
    expect(page.doc.getElementById("reg-submit-label").textContent).toBe("Send registration");
  });
});

describe("what the server answers", () => {
  it("shows Check your inbox for ok, with the address as text, and moves focus there", async () => {
    const page = boot();
    fillValid(page);
    send(page);
    await until(() => expect(page.doc.getElementById("reg-done").hidden).toBe(false));
    expect(page.doc.getElementById("reg-done-email").textContent).toBe("anna.kowalska@contoso.example");
    expect(page.doc.activeElement.id).toBe("reg-done-title");
    for (const region of page.doc.querySelectorAll("[data-hide-when-done]")) expect(region.hidden).toBe(true);
    expect(page.doc.getElementById("reg-error").hidden).toBe(true);
    expect(page.reset).toHaveBeenCalledTimes(1);
  });

  it("does not run an address that looks like markup", async () => {
    const page = boot();
    fillValid(page);
    type(page, "f-email", "a<img/src=x/onerror=alert(1)>@contoso.example");
    send(page);
    await until(() => expect(page.doc.getElementById("reg-done").hidden).toBe(false));
    expect(page.doc.getElementById("reg-done-email").querySelector("*")).toBeNull();
    expect(page.doc.querySelectorAll("img[onerror]")).toHaveLength(0);
  });

  it("lets the guest start again: the form comes back with what was typed, and a fresh check", async () => {
    const page = boot();
    fillValid(page);
    send(page);
    await until(() => expect(page.doc.getElementById("reg-done").hidden).toBe(false));
    page.doc.getElementById("reg-again").click();
    expect(page.doc.getElementById("reg-done").hidden).toBe(true);
    for (const region of page.doc.querySelectorAll("[data-hide-when-done]")) expect(region.hidden).toBe(false);
    expect(page.doc.getElementById("f-first_name").value).toBe("  Anna ");
    expect(page.doc.activeElement.id).toBe("f-first_name");
    send(page);
    expect(page.fetchMock).toHaveBeenCalledTimes(1);
    expect(invalidFields(page)).toEqual(["challenge"]);
  });

  it("puts a field error under its field, as text, focuses the first, and keeps what was typed", async () => {
    const answer = {
      status: 422,
      body: {
        errors: {
          last_name: "That name is not valid.",
          "custom_data.day": "<b>Pick</b> a day.",
          not_a_field: "ignored",
        },
      },
    };
    const page = boot({ fetchMock: stubFetch(answer) });
    fillValid(page);
    send(page);
    await until(() => expect(invalidFields(page)).toEqual(["last_name", "custom_data.day"]));
    expect(slotText(page, "last_name")).toBe("That name is not valid.");
    expect(slotText(page, "custom_data.day")).toBe("<b>Pick</b> a day.");
    expect(page.doc.querySelector("[data-field='custom_data.day'] b")).toBeNull();
    expect(page.doc.activeElement.id).toBe("f-last_name");
    expect(page.doc.getElementById("reg-error-text").textContent).toBe("2 fields need your attention. They are marked in red.");
    expect(page.doc.getElementById("f-last_name").value).toBe("Kowalska");
    expect(page.doc.getElementById("reg-submit").disabled).toBe(false);
    expect(page.reset).toHaveBeenCalledTimes(1);
  });

  it("takes a 400 with errors the same way", async () => {
    const page = boot({ fetchMock: stubFetch({ status: 400, body: { errors: { email: "Use another address." } } }) });
    fillValid(page);
    send(page);
    await until(() => expect(invalidFields(page)).toEqual(["email"]));
    expect(slotText(page, "email")).toBe("Use another address.");
  });

  it("says Try again in a moment for 429 and for 503, and marks no field", async () => {
    for (const status of [429, 503]) {
      const page = boot({ fetchMock: stubFetch({ status, body: { error: "try_again" } }) });
      fillValid(page);
      send(page);
      await until(() => expect(page.doc.getElementById("reg-error").hidden).toBe(false));
      expect(page.doc.getElementById("reg-error-text").textContent).toBe("Try again in a moment.");
      expect(invalidFields(page)).toEqual([]);
      expect(page.doc.getElementById("reg-submit").disabled).toBe(false);
      expect(page.doc.activeElement.id).toBe("reg-error");
      expect(page.reset).toHaveBeenCalledTimes(1);
    }
  });

  it("says Try again in a moment when the request fails or hangs", async () => {
    const failing = boot({ fetchMock: vi.fn(async (_input: string | URL) => Promise.reject(new TypeError("network"))) as never });
    fillValid(failing);
    send(failing);
    await until(() => expect(failing.doc.getElementById("reg-error-text").textContent).toBe("Try again in a moment."));
    expect(failing.doc.getElementById("reg-submit").disabled).toBe(false);

    const slow = boot({
      script: REGISTRATION_FORM_SCRIPT.replace("var TIMEOUT_MS = 30000;", "var TIMEOUT_MS = 20;"),
      fetchMock: vi.fn(
        (_input: string | URL, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init!.signal!.addEventListener("abort", () => reject(new Error("aborted")));
          }),
      ) as never,
    });
    fillValid(slow);
    send(slow);
    await until(() => expect(slow.doc.getElementById("reg-error-text").textContent).toBe("Try again in a moment."));
  });

  it("shows a general message for any other answer, including one that is not JSON", async () => {
    for (const answer of [{ status: 500, body: { error: "x" } }, { status: 413, unreadable: true }, { status: 200, body: { ok: false } }, { status: 422, body: { errors: { unknown: "x" } } }]) {
      const page = boot({ fetchMock: stubFetch(answer) });
      fillValid(page);
      send(page);
      await until(() => expect(page.doc.getElementById("reg-error").hidden).toBe(false));
      expect(page.doc.getElementById("reg-error-text").textContent).toBe("Something went wrong. Check your details and try again.");
      expect(page.doc.getElementById("reg-done").hidden).toBe(true);
    }
  });

  it("does not take a 200 without ok:true for a success", async () => {
    const page = boot({ fetchMock: stubFetch({ status: 200, body: { errors: { email: "no" } } }) });
    fillValid(page);
    send(page);
    await until(() => expect(page.doc.getElementById("reg-error").hidden).toBe(false));
    expect(page.doc.getElementById("reg-done").hidden).toBe(true);
  });
});

describe("the security check", () => {
  it("holds the token a solved check gives, and drops it when it expires or fails", () => {
    const page = boot();
    fillValid(page);
    page.win.admittoTurnstileExpired();
    send(page);
    expect(invalidFields(page)).toEqual(["challenge"]);
    solve(page, "fresh");
    expect(invalidFields(page)).toEqual([]);
    page.win.admittoTurnstileError();
    expect(slotText(page, "challenge")).toContain("The security check did not load");
    expect(page.fetchMock).not.toHaveBeenCalled();
  });

  it("sends the current token, not an earlier one", async () => {
    const page = boot();
    fillValid(page);
    solve(page, "second");
    send(page);
    await until(() => expect(page.fetchMock).toHaveBeenCalledTimes(1));
    expect(body(page).challenge).toBe("second");
  });

  it("says so when the widget never loads", async () => {
    const page = boot({ script: REGISTRATION_FORM_SCRIPT.replace("var WIDGET_WAIT_MS = 10000;", "var WIDGET_WAIT_MS = 20;") });
    page.win.turnstile = undefined;
    await until(() => expect(slotText(page, "challenge")).toContain("allow challenges.cloudflare.com"));
  });

  it("stays quiet when the widget has loaded", async () => {
    const page = boot({ script: REGISTRATION_FORM_SCRIPT.replace("var WIDGET_WAIT_MS = 10000;", "var WIDGET_WAIT_MS = 20;") });
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(slotText(page, "challenge")).toBe("");
  });
});
