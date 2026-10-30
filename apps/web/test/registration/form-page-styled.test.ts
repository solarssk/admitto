import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PHONE_COUNTRIES } from "@admitto/shared/phone-countries";
import { REGISTRATION_STYLED_CONTROLS_SCRIPT } from "../../src/registration/form-controls-script.js";
import { renderStyledControls, wantsCountryPicker } from "../../src/registration/form-controls.js";
import { renderRegistrationFormPage } from "../../src/registration/form-page.js";
import { REGISTRATION_FORM_SCRIPT, renderFormScript } from "../../src/registration/form-script.js";
import { REGISTRATION_PAGE_CSS, REGISTRATION_STYLED_CONTROLS_CSS, buildRegistrationPageStyles } from "../../src/registration/form-style.js";
import type { FormQuestion, RegistrationFormModel } from "../../src/registration/form-model.js";
import { documentOf, formModel, panelModel, question, requiredNewKinds, type Dom } from "../helpers/registration-form-fixtures.js";
import { bootPage } from "../helpers/registration-script-page.js";

const NONCE = "bm9uY2U=";
/**
 * A fingerprint of a text, to see that generated page text did not change: the 64-bit FNV-1a hash of its bytes and its length.
 * It is not a cryptographic hash, and needs none: nothing here is secret, and a change that leaves both the hash and the length as
 * they were is not one a test can meet by accident. (A SHA-256 of a page that holds the box of the password gate is reported by
 * CodeQL as a password hashed with too little effort, which it is not.)
 */
const fingerprint = (text: string): string => {
  let hash = 0xcbf29ce484222325n;
  for (const byte of Buffer.from(text, "utf8")) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  return `${hash.toString(16).padStart(16, "0")}-${text.length}`;
};
const withoutStyle = (html: string): string => html.replace(/<style>[\s\S]*?<\/style>/, "");

const render = (model: RegistrationFormModel): string => renderRegistrationFormPage(model, { nonce: NONCE });

/** The guest's companion asked for a phone number and a time. */
const COMPANION = {
  max: 1,
  questions: [
    question({ key: "badge_phone", label: "Guest phone", type: "phone", required: true, rules: { example: "+48 600 100 200" } }),
    question({ key: "when", label: "Guest arrival", type: "datetime" }),
  ],
};

/** The models of the page of an event without the switch, as they were drawn before the styled boxes existed. */
const NATIVE_MODELS: ReadonlyArray<readonly [string, () => RegistrationFormModel]> = [
  ["default", () => formModel()],
  ["panels", () => panelModel()],
  ["gate", () => formModel({ needsPassword: true, mode: "automatic", verifyEmail: false, companion: COMPANION })],
  ["required", () => formModel({ questions: requiredNewKinds() })],
];

/**
 * Fingerprint of the fixed script of the page and of each model's page without its stylesheet (the stylesheet is tested apart, in
 * guest-page-css.test.ts, and follows the product's own CSS), as they were at the base of PR 113g-1, before the styled boxes
 * existed. The page of an event that has not switched them on is to stay byte for byte what it was: if one of these changes on
 * purpose, the PR that does it records the new value, and the reviewer sees the page it changed.
 */
const NATIVE_HASH = {
  script: "fd4e7e41d681d7b5-26848",
  default: "c3e1d32059ce9555-48952",
  panels: "30baf454f7d312f7-50176",
  gate: "85cee41b8e2d2591-53752",
  required: "46cc95506c591fd5-43727",
} as const;

describe("the page of an event that has not switched the styled boxes on", () => {
  it("has the fixed script it had, byte for byte", () => {
    expect(fingerprint(REGISTRATION_FORM_SCRIPT), "the fixed script of the registration page changed").toBe(NATIVE_HASH.script);
  });

  it.each(NATIVE_MODELS)("is the page it was, byte for byte (%s)", (name, build) => {
    const hash = fingerprint(withoutStyle(render(build())));
    expect(hash, `the page of an event without the styled boxes changed (${name}); the new value is ${hash}`).toBe(NATIVE_HASH[name as keyof typeof NATIVE_HASH]);
  });

  it.each(NATIVE_MODELS)("carries nothing of the styled boxes (%s)", (_name, build) => {
    const html = render(build());
    const doc = documentOf(html);
    expect(doc.querySelector("[data-controls], [data-styled], template, #reg-phone-countries, .reg-phone, .reg-phone__code")).toBeNull();
    expect(doc.querySelectorAll("script[nonce]")).toHaveLength(1);
    expect(doc.querySelector("script[nonce]").textContent).toBe(REGISTRATION_FORM_SCRIPT);
    expect(html).not.toContain("reg-phone");
    expect(html).not.toContain("data-phone");
  });

  it("writes one script element for the fixed script, whether or not the switch is asked about", () => {
    const one = `<script nonce="${NONCE}">${REGISTRATION_FORM_SCRIPT}</script>`;
    expect(renderFormScript(NONCE)).toBe(one);
    expect(renderFormScript(NONCE, false)).toBe(one);
  });

  it("has the stylesheet it had: none of the rules of the styled boxes", () => {
    expect(buildRegistrationPageStyles()).toBe(buildRegistrationPageStyles(undefined, false));
    expect(buildRegistrationPageStyles()).not.toContain(".reg-phone");
    expect(render(formModel())).not.toContain(REGISTRATION_STYLED_CONTROLS_CSS);
  });
});

/** The styled page without what the styled boxes add: it must be the page of the same event without the switch. */
function withoutStyledAdditions(html: string, model: RegistrationFormModel): string {
  const kit = renderStyledControls(model);
  const stripped = html
    .replace(' data-controls="styled"', "")
    .replaceAll(' data-styled="phone"', "")
    .replace(`\n  <script nonce="${NONCE}">${REGISTRATION_STYLED_CONTROLS_SCRIPT}</script>`, "")
    .replace(`\n${REGISTRATION_STYLED_CONTROLS_CSS}`, "");
  return kit === "" ? stripped : stripped.replace(`\n    ${kit}`, "");
}

describe("the page of an event that switched the styled boxes on", () => {
  it.each(NATIVE_MODELS)("is the same page with these additions and no other (%s)", (_name, build) => {
    const native = build();
    const styled = { ...native, styledControls: true };
    const html = render(styled);
    expect(html).not.toBe(render(native));
    expect(withoutStyledAdditions(html, styled)).toBe(render(native));
  });

  it("marks the form, and carries the second script after the first, under the same nonce", () => {
    const doc = documentOf(render(formModel({ styledControls: true })));
    expect(doc.getElementById("reg-form").getAttribute("data-controls")).toBe("styled");
    const scripts = [...doc.querySelectorAll("script")] as Dom[];
    expect(scripts.map((script) => script.getAttribute("nonce"))).toEqual([NONCE, NONCE, null]);
    expect(scripts[0].textContent).toBe(REGISTRATION_FORM_SCRIPT);
    expect(scripts[1].textContent).toBe(REGISTRATION_STYLED_CONTROLS_SCRIPT);
    expect(scripts[2].getAttribute("src")).toBe("https://challenges.cloudflare.com/turnstile/v0/api.js");
  });

  it("has the rules of the styled boxes after the form's own, in the one stylesheet", () => {
    const css = buildRegistrationPageStyles(undefined, true);
    expect(css.endsWith(REGISTRATION_STYLED_CONTROLS_CSS)).toBe(true);
    expect(css.indexOf(".reg-phone {")).toBeGreaterThan(css.indexOf(REGISTRATION_PAGE_CSS));
    expect(documentOf(render(formModel({ styledControls: true }))).querySelectorAll("style")).toHaveLength(1);
    expect(render(formModel({ styledControls: true }))).toContain(REGISTRATION_STYLED_CONTROLS_CSS);
  });

  it("keeps the browser's own number box in the page, with its id, name, type and label", () => {
    const doc = documentOf(render(formModel({ styledControls: true, questions: [question({ key: "mobile", label: "Mobile phone", type: "phone" })] })));
    const box = doc.querySelector('[data-custom="mobile"]');
    const input = box.querySelector("input");
    expect(box.getAttribute("data-styled")).toBe("phone");
    expect(box.getAttribute("data-kind")).toBe("phone");
    expect(input.id).toBe("f-q0");
    expect(input.getAttribute("type")).toBe("tel");
    expect(input.hasAttribute("data-control")).toBe(true);
    expect(box.querySelector("label").getAttribute("for")).toBe("f-q0");
    expect(doc.querySelectorAll(".reg-phone")).toHaveLength(0);
  });
});

describe("which phone questions the styled box takes", () => {
  const phone = (rules: FormQuestion["rules"]) => question({ key: "p", label: "Phone", type: "phone", rules });

  it.each([
    ["no rules", null, true],
    ["an example only", { example: "+1 555 0100" }, true],
    ["digits_only off", { digits_only: false }, true],
    ["digits only", { digits_only: true }, false],
    ["a shortest length", { min_length: 9 }, false],
    ["a longest length", { max_length: 12 }, false],
    ["digits only and lengths (a desk extension)", { digits_only: true, min_length: 3, max_length: 6 }, false],
  ] as const)("with %s", (_name, rules, wanted) => {
    expect(wantsCountryPicker(phone(rules as FormQuestion["rules"]))).toBe(wanted);
    const doc = documentOf(render(formModel({ styledControls: true, questions: [phone(rules as FormQuestion["rules"])] })));
    expect(doc.querySelector("[data-custom=p]").hasAttribute("data-styled")).toBe(wanted);
    expect(doc.getElementById("reg-phone-kit") !== null).toBe(wanted);
    expect(doc.getElementById("reg-phone-countries") !== null).toBe(wanted);
  });

  it("is not a text, a date or a time: only the phone is drawn in the product's style in this step", () => {
    const doc = documentOf(
      render(
        formModel({
          styledControls: true,
          questions: [
            question({ key: "t", label: "Text", type: "text" }),
            question({ key: "d", label: "Date", type: "date" }),
            question({ key: "dt", label: "Date and time", type: "datetime" }),
          ],
        }),
      ),
    );
    expect(doc.querySelector("[data-styled]")).toBeNull();
    expect(doc.getElementById("reg-phone-kit")).toBeNull();
  });

  it("takes the companion's phone question too, and writes the kit for it when the guest has none", () => {
    const doc = documentOf(render(formModel({ styledControls: true, questions: [], companion: COMPANION })));
    expect(doc.querySelector("[data-custom=badge_phone]").getAttribute("data-styled")).toBe("phone");
    expect(doc.getElementById("reg-phone-kit")).not.toBeNull();
  });

  it("writes neither the kit nor the countries when the form has no phone question, and still marks the form", () => {
    const html = render(formModel({ styledControls: true, questions: [question({ key: "t", label: "Text", type: "text" })], companion: null }));
    const doc = documentOf(html);
    expect(doc.getElementById("reg-form").getAttribute("data-controls")).toBe("styled");
    expect(doc.querySelectorAll("template, #reg-phone-countries")).toHaveLength(0);
    expect(doc.querySelectorAll("script[nonce]")).toHaveLength(2);
  });
});

describe("the countries in the page", () => {
  const doc = documentOf(render(formModel({ styledControls: true })));
  const data = doc.getElementById("reg-phone-countries");

  it("are a hidden list of data rows, the staff app's list in its order", () => {
    expect(data.hasAttribute("hidden")).toBe(true);
    const rows = [...data.children] as Dom[];
    expect(rows).toHaveLength(PHONE_COUNTRIES.length);
    expect(rows.map((row) => [row.getAttribute("data-iso"), row.getAttribute("data-dial"), row.textContent])).toEqual(
      PHONE_COUNTRIES.map((country) => [country.iso2, country.dialCode, country.name]),
    );
  });

  it("carry nothing but the code of the country, its dial code and its name", () => {
    for (const row of data.children as Iterable<Dom>) {
      expect(row.tagName).toBe("LI");
      expect(row.getAttributeNames().sort()).toEqual(["data-dial", "data-iso"]);
      expect(row.children).toHaveLength(0);
    }
  });

  it("are written as text: a name with a bracket, a hyphen or a letter of another alphabet reads back as it is", () => {
    for (const iso of ["CC", "GW", "TR", "UM"]) {
      const country = PHONE_COUNTRIES.find((entry) => entry.iso2 === iso)!;
      expect(data.querySelector(`[data-iso="${iso}"]`).textContent).toBe(country.name);
    }
    expect(PHONE_COUNTRIES.every((country) => !/[<>&"']/.test(country.name))).toBe(true);
    expect(render(formModel({ styledControls: true })).includes(">Türkiye</li>")).toBe(true);
  });

  it("are the same for every event", () => {
    const other = formModel({ styledControls: true, event: { ...formModel().event, slug: "other", title: "Another event" }, askCompany: false });
    expect(renderStyledControls(other)).toBe(renderStyledControls(formModel({ styledControls: true })));
  });

  it("come with a kit of markup for the script to clone, which has no id, no text of an organiser and no style", () => {
    const kit = doc.getElementById("reg-phone-kit");
    const part = kit.content.firstElementChild;
    expect(part.querySelector("button[type=button][aria-haspopup=listbox]")).not.toBeNull();
    expect(part.querySelector('input[role=combobox][aria-autocomplete=list]')).not.toBeNull();
    expect(part.querySelector("ul[role=listbox]")).not.toBeNull();
    // A list that scrolls is a stop of the Tab key in Chrome; this one is driven from the search box.
    expect(part.querySelector("ul[role=listbox]").getAttribute("tabindex")).toBe("-1");
    expect(part.querySelectorAll("[id]")).toHaveLength(0);
    expect(part.querySelectorAll("[style]")).toHaveLength(0);
    expect(part.querySelector("[data-phone-panel]").hasAttribute("hidden")).toBe(true);
    expect(part.querySelector("use").getAttribute("href")).toBe("#i-chevron-down");
  });
});

describe("the second script is a fixed text", () => {
  it("is the same for every event and every request: nothing of the database is put into it", () => {
    const first = formModel({ styledControls: true });
    const second = formModel({
      styledControls: true,
      event: { slug: "another-event", title: "A <b>different</b> event", when: "1 January 2030", venue: "Elsewhere", logoUrl: null, timezone: "Asia/Tokyo" },
      questions: [question({ key: "dietary", label: "Dietary needs", type: "text", suggestions: ["No pork"] }), question({ key: "ph", label: "Phone", type: "phone" })],
      consents: [{ key: "other", title: "Another consent", path: "/legal/another-event/consent-other" }],
    });
    const scriptOf = (model: RegistrationFormModel) => (documentOf(render(model)).querySelectorAll("script[nonce]")[1] as Dom).textContent;
    expect(scriptOf(first)).toBe(REGISTRATION_STYLED_CONTROLS_SCRIPT);
    expect(scriptOf(second)).toBe(REGISTRATION_STYLED_CONTROLS_SCRIPT);
    expect(renderFormScript("YQ==", true)).toContain(REGISTRATION_STYLED_CONTROLS_SCRIPT);
  });

  it("never writes HTML, styles, requests or storage, and has no interpolation left in it", () => {
    for (const forbidden of [
      "innerHTML",
      "outerHTML",
      "insertAdjacentHTML",
      "document.write",
      "eval(",
      "new Function",
      "setAttribute(\"style\"",
      ".style.",
      "cssText",
      "fetch(",
      "XMLHttpRequest",
      "sendBeacon",
      "localStorage",
      "sessionStorage",
      "document.cookie",
      "location.",
      "${",
    ]) {
      expect(REGISTRATION_STYLED_CONTROLS_SCRIPT, forbidden).not.toContain(forbidden);
    }
  });

  it("sets what it draws as text", () => {
    expect(REGISTRATION_STYLED_CONTROLS_SCRIPT).toContain("textContent");
    expect(REGISTRATION_STYLED_CONTROLS_SCRIPT).toContain("cloneNode(true)");
  });
});

/** Text an organiser (or a corrupt row) could put into any field the page prints. */
const PAYLOADS = [
  "<img src=x onerror=alert(1)>",
  '"><script>alert(1)</script>',
  "' onmouseover='alert(1)",
  '" autofocus onfocus="alert(1)',
  "</style><script>alert(1)</script>",
  "</script><script>alert(1)</script>",
  "<svg onload=alert(1)><use href=#x></svg>",
  "javascript:alert(1)",
  "${alert(1)} `x`",
  "&lt;b&gt;escaped already&lt;/b&gt; &amp; &#60;",
];

/** Elements and attributes that would be a script running, found in the parsed page. */
function injected(doc: Dom): string[] {
  const found: string[] = [];
  for (const el of doc.querySelectorAll("*") as Iterable<Dom>) {
    for (const name of el.getAttributeNames() as string[]) {
      if (name.startsWith("on") || name === "autofocus" || name === "srcdoc") found.push(`${el.tagName}[${name}]`);
    }
  }
  for (const tag of ["iframe", "object", "embed", "frame", "meta[http-equiv]", "base"]) if (doc.querySelector(tag)) found.push(tag);
  return found;
}

describe.each(PAYLOADS)("organiser text %j on a form with the styled boxes on", (payload) => {
  const questions = [
    question({ key: "mobile", label: payload, type: "phone", description: payload, icon: payload as never, rules: { example: payload } }),
    question({ key: payload, label: `${payload} 2`, type: "phone", description: payload }),
  ];
  const model = formModel({ styledControls: true, questions, companion: { max: 1, questions: [question({ key: "c", label: payload, type: "phone" })] } });

  it("stays text in the page the server writes", () => {
    const doc = documentOf(render(model));
    expect(injected(doc)).toEqual([]);
    expect(doc.querySelectorAll("script")).toHaveLength(3);
    expect(doc.querySelectorAll("style")).toHaveLength(1);
    for (const script of doc.querySelectorAll("script[nonce]") as Iterable<Dom>) expect(script.textContent).not.toContain(payload);
  });

  it("stays text once the script has drawn its boxes and opened a list", () => {
    const page = bootPage(questions, { model: { styledControls: true, companion: model.companion } });
    page.doc.getElementById("f-q0-country").click();
    expect(injected(page.doc)).toEqual([]);
    expect(page.doc.querySelectorAll("script")).toHaveLength(3);
    expect(page.doc.getElementById("f-q0-country").getAttribute("aria-label")).toBe(`${payload} country code, no code selected`);
    expect(page.doc.querySelectorAll("#f-q0-list [role=option]")).toHaveLength(PHONE_COUNTRIES.length);
  });
});

describe("the styles of the styled boxes", () => {
  const css = REGISTRATION_STYLED_CONTROLS_CSS;

  it("use the product's tokens and no colour of their own", () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/\b(?:rgb|rgba|hsl|hsla)\(/);
    expect(css).not.toContain("!important");
  });

  it("lay the phone out as the staff app does: the button keeps 8.5rem and the number takes the rest", () => {
    const staff = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../../admin/src/attendees/custom-data-field-input.css"),
      "utf8",
    );
    expect(staff).toContain("flex: 0 0 8.5rem;");
    expect(css).toContain(".reg-phone__code { position: relative; flex: 0 0 8.5rem; min-width: 0; }");
    expect(css).toContain(".reg-phone > .at-control, .reg-phone > .at-inputgroup { flex: 1; min-width: 0; }");
  });

  it("open the list under the button, over what follows, wider than the button and never wider than the screen", () => {
    expect(css).toContain(".reg-phone__panel { position: absolute; left: 0; top: calc(100% + 4px); width: 17.5rem; max-width: calc(100vw - 4.5rem); margin: 0; }");
  });

  it("keep the 16 px of the search box on a phone, which stops the zoom on focus", () => {
    expect(css).toContain("@media (pointer: coarse) {\n  .reg-phone .searchable-select__search { font-size: 16px; }\n}");
  });

  it("have a rule for every class the box and its list use, so that a misspelt class is caught", () => {
    const page = bootPage([question({ key: "mobile", label: "Mobile phone", type: "phone", required: true })], { model: { styledControls: true } });
    page.doc.getElementById("f-q0-country").click();
    const used = new Set<string>();
    for (const el of page.doc.querySelectorAll(".reg-phone, .reg-phone *") as Iterable<Dom>) {
      for (const name of (el.getAttribute("class") ?? "").split(/\s+/)) if (name) used.add(name);
    }
    expect(used.size).toBeGreaterThan(8);
    const everything = buildRegistrationPageStyles(undefined, true);
    for (const name of used) expect(everything, name).toMatch(new RegExp(String.raw`\.${name}(?![\w-])`));
  });
});
