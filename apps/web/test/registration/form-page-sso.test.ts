/**
 * The page of an event whose way in is the company sign-in (D-C4), drawn from a model: the sign-in screen a guest sees first,
 * the form with the locked address they see after, the small script of this way in, and what neither of them may hold. Which
 * of the two a guest gets is decided by the route (registration-sso-submit.test.ts); here the renderer is told, and fails
 * closed when it is not.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import { renderRegistrationFormPage } from "../../src/registration/form-page.js";
import { REGISTRATION_SSO_SCRIPT } from "../../src/registration/sso-page-script.js";
import { SSO_NOTICES } from "../../src/registration/sso-identity.js";
import { formModel, type Dom } from "../helpers/registration-form-fixtures.js";

const AXE_SOURCE = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const NONCE = "bm9uY2U=";
const URL = "https://tickets.example.com/r/northwind-summit";

/** The model of an event with the company sign-in: no site key, and no link to confirm. */
const ssoModel = (overrides = {}) => formModel({ needsSso: true, needsChallenge: false, verifyEmail: false, turnstileSiteKey: "", ...overrides });

const signedOut = (notice: (typeof SSO_NOTICES)[number] | null = null) =>
  renderRegistrationFormPage(ssoModel(), { nonce: NONCE, sso: { signedInAs: null, notice } });
const signedIn = (email = "ada.lovelace@contoso.example") => renderRegistrationFormPage(ssoModel(), { nonce: NONCE, sso: { signedInAs: email } });
const open = (html: string) => new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: URL }).window;

async function violations(window: ReturnType<typeof open>): Promise<string[]> {
  const w = window as unknown as { eval: (code: string) => void; axe: { run: Function }; document: unknown };
  w.eval(AXE_SOURCE);
  const results = await w.axe.run(w.document, { rules: { "color-contrast": { enabled: false } } });
  return (results.violations as Array<{ id: string; help: string; nodes: Array<{ target: unknown }> }>).map(
    (violation) => `${violation.id}: ${violation.help} ${JSON.stringify(violation.nodes.slice(0, 3).map((node) => node.target))}`,
  );
}

describe("the sign-in screen", () => {
  it("is a page with the event, what to do, one button that leaves for the provider and the privacy notice: no form, no script, no widget", () => {
    const document = open(signedOut()).document;

    expect(document.querySelector("h1")?.textContent).toBe("Northwind Partner Summit 2027");
    expect(document.querySelector("#reg-sign-in h2")?.textContent).toBe("Sign in to register");
    const link = document.querySelector("#reg-sign-in-link");
    expect(link?.getAttribute("href")).toBe("/r/northwind-summit/sso/start");
    expect(link?.textContent).toBe("Sign in");
    expect(link?.classList.contains("at-btn")).toBe(true);
    expect(document.querySelector('#reg-sign-in a[href="/legal/northwind-summit/privacy-notice"]')?.textContent).toContain("privacy notice");
    expect(document.querySelector("form")).toBeNull();
    expect(document.querySelector("script")).toBeNull();
    expect(document.querySelector(".cf-turnstile")).toBeNull();
    expect(document.querySelector("input")).toBeNull();
    expect(document.querySelector("noscript")).toBeNull();
  });

  it("is what a page for this way in is, when the renderer is not told the guest signed in", () => {
    const told = renderRegistrationFormPage(ssoModel(), { nonce: NONCE });

    expect(told).toBe(signedOut());
  });

  it("is the same page whatever nonce the response has, since it carries no script", () => {
    expect(renderRegistrationFormPage(ssoModel(), { nonce: "b3RoZXI=", sso: { signedInAs: null, notice: null } })).toBe(signedOut());
  });

  it.each([
    ["failed", "We could not sign you in. Try again. If it keeps failing, ask the organisers."],
    ["no_email", "Your company account did not give us a verified email address, so we cannot register you with it."],
    ["not_allowed", "This event is not open to your company account."],
  ] as const)("says %s in a sentence of its own, as an alert, and says nothing else", (notice, sentence) => {
    const document = open(signedOut(notice)).document;

    const alert = document.querySelector("#reg-sso-notice");
    expect(alert?.getAttribute("role")).toBe("alert");
    expect(alert?.textContent).toBe(sentence);
    expect(document.querySelectorAll('[role="alert"]')).toHaveLength(1);
  });

  it("has a sentence for every word a refusal can come back with, and no other", () => {
    expect([...SSO_NOTICES]).toEqual(["failed", "no_email", "not_allowed"]);
  });

  it("escapes the title and the slug of the event", () => {
    const html = renderRegistrationFormPage(
      ssoModel({ event: { ...formModel().event, title: '<img src=x onerror=alert(1)> "Summit"', slug: 'a"><b>' } }),
      { nonce: NONCE },
    );
    const document = open(html).document;

    expect(document.querySelector("#reg-sign-in img")).toBeNull();
    expect(document.querySelector("img[src='x']")).toBeNull();
    expect(document.querySelector("#reg-sign-in-link")?.getAttribute("href")).toBe('/r/a"><b>/sso/start');
    // The structure is the page's own, not the slug's.
    expect(document.querySelector("#reg-sign-in-link")?.parentElement?.id).toBe("reg-sign-in");
  });

  it("has nothing for axe-core to report, with the notice and without", async () => {
    expect(await violations(open(signedOut()))).toEqual([]);
    for (const notice of SSO_NOTICES) expect(await violations(open(signedOut(notice))), notice).toEqual([]);
  });

  it("carries the rules of this way in and no other page does", () => {
    expect(signedOut()).toContain(".reg-center h2");
    expect(renderRegistrationFormPage(formModel(), { nonce: NONCE })).not.toContain(".reg-center h2");
  });
});

describe("the form of a guest who signed in", () => {
  it("shows the address the provider gave, locked, with a lock for its icon and a note that says where it is from", () => {
    const document = open(signedIn()).document;

    const email = document.querySelector("#f-email");
    expect(email?.getAttribute("value")).toBe("ada.lovelace@contoso.example");
    expect(email?.hasAttribute("readonly")).toBe(true);
    expect(email?.hasAttribute("disabled")).toBe(false);
    expect(email?.getAttribute("type")).toBe("email");
    expect(email?.closest(".at-inputgroup")?.querySelector("use")?.getAttribute("href")).toBe("#i-lock");
    expect(document.querySelector("#m-f-email")?.textContent).toContain("address from your company sign-in");
    expect(document.querySelector("#reg-sign-in")).toBeNull();
  });

  it("escapes the address into the value of the box", () => {
    const hostile = 'ada"><img src=x onerror=alert(1)>@example.com';
    const document = open(signedIn(hostile)).document;

    expect(document.querySelector("#f-email")?.getAttribute("value")).toBe(hostile);
    expect(document.querySelector("img[src='x']")).toBeNull();
    expect(document.querySelectorAll("#f-email")).toHaveLength(1);
  });

  it("has no bot check: no widget, no frame, no field for it, and no script of Cloudflare", () => {
    const document = open(signedIn()).document;

    expect(document.querySelector(".cf-turnstile")).toBeNull();
    expect(document.querySelector('[data-kind="challenge"]')).toBeNull();
    expect(document.querySelector("script[src]")).toBeNull();
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("says there is no confirmation link, in the note of the form and in the screen after the send", () => {
    const document = open(signedIn()).document;

    expect(document.querySelector(".reg-notices")?.textContent).not.toContain("confirm");
    expect(document.querySelector("#reg-done")?.textContent).not.toContain("24 hours");
    expect(document.querySelector("#reg-done")?.textContent).toContain("It tells you what happens next.");
  });

  it("carries the script of the form and then the small one of this way in, both under the nonce of the response", () => {
    const scripts = [...open(signedIn()).document.querySelectorAll("script")];

    expect(scripts.map((script) => script.getAttribute("nonce"))).toEqual([NONCE, NONCE]);
    expect(scripts[1]?.textContent).toBe(REGISTRATION_SSO_SCRIPT);
  });

  it("is a page of its own kind, whatever the fields: the page of an event of the link has none of it", () => {
    const link = renderRegistrationFormPage(formModel(), { nonce: NONCE });
    const document = open(link).document;

    expect(document.querySelector("#f-email")?.hasAttribute("readonly")).toBe(false);
    expect(document.querySelector(".cf-turnstile")).not.toBeNull();
    expect(document.querySelectorAll("script")).toHaveLength(2);
    expect(link).not.toContain("window.fetch = function");
    expect(link).not.toContain(".reg-center h2");
  });

  it("has nothing for axe-core to report", async () => {
    expect(await violations(open(signedIn()))).toEqual([]);
  });

  it("sends the form with the locked address and no challenge, once the terms are ticked", async () => {
    const window = open(signedIn());
    const fetchMock = vi.fn(async (_input: string, _init?: RequestInit) => ({ status: 200, json: async () => ({ ok: true }) }));
    (window as unknown as { fetch: unknown }).fetch = fetchMock;
    for (const script of window.document.querySelectorAll("script[nonce]")) (window as unknown as { eval: (code: string) => void }).eval(script.textContent ?? "");
    const doc = window.document as Dom;
    const set = (id: string, value: string) => {
      doc.getElementById(id).value = value;
    };
    set("f-first_name", "Ada");
    set("f-last_name", "Lovelace");
    doc.getElementById("f-terms").checked = true;
    // Questions the fixture asks that are required.
    set("f-q0", "Both days");
    set("f-q4", "true");

    doc.getElementById("reg-submit").click();

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1), { timeout: 4000, interval: 10 });
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ email: "ada.lovelace@contoso.example", first_name: "Ada", terms: true, challenge: "" });
    expect(Object.keys(body)).not.toContain("password");
  });
});

describe("the small script of this way in", () => {
  /** The script run against a window of its own, whose `fetch` answers `status`. */
  function run(status: number) {
    const answer = { status, ok: status === 200 };
    const original = vi.fn(async () => answer);
    const reload = vi.fn();
    const window = { fetch: original, location: { reload } };
    runInNewContext(REGISTRATION_SSO_SCRIPT, { window });
    return { window, original, reload, answer };
  }

  it("reloads the page when the server says the sign-in is gone (401), and passes the answer on unchanged", async () => {
    const { window, reload, answer } = run(401);

    const seen = await window.fetch();

    expect(reload).toHaveBeenCalledTimes(1);
    expect(seen).toBe(answer);
  });

  it.each([200, 400, 403, 404, 409, 422, 429, 500, 503])("does nothing for a %s", async (status) => {
    const { window, reload, answer } = run(status);

    expect(await window.fetch()).toBe(answer);
    expect(reload).not.toHaveBeenCalled();
  });

  it("passes the arguments of the call on to the fetch it wraps", async () => {
    const { window, original } = run(200);

    await (window.fetch as unknown as (...args: unknown[]) => Promise<unknown>)("/r/northwind-summit", { method: "POST" });

    expect(original).toHaveBeenCalledWith("/r/northwind-summit", { method: "POST" });
  });

  it("leaves a window without fetch alone", () => {
    const window: { fetch?: unknown; location: { reload: () => void } } = { location: { reload: vi.fn() } };

    expect(() => runInNewContext(REGISTRATION_SSO_SCRIPT, { window })).not.toThrow();
    expect(window.fetch).toBeUndefined();
  });

  it("reads nothing from the page and writes nothing to it", () => {
    expect(REGISTRATION_SSO_SCRIPT).not.toMatch(/document|localStorage|sessionStorage|cookie|innerHTML|eval\(/);
  });
});
