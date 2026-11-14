import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PHONE_COUNTRIES } from "@admitto/shared/phone-countries";
import { REGISTRATION_STYLED_CONTROLS_SCRIPT, registrationStyledControlsScript } from "../../src/registration/form-controls-script.js";
import { renderStyledControls, styledKindOf, styledNeedsOf, wantsCountryPicker } from "../../src/registration/form-controls.js";
import { renderRegistrationFormPage } from "../../src/registration/form-page.js";
import { REGISTRATION_FORM_SCRIPT, renderFormScript } from "../../src/registration/form-script.js";
import {
  REGISTRATION_DATE_CONTROLS_CSS,
  REGISTRATION_PAGE_CSS,
  REGISTRATION_STYLED_CONTROLS_CSS,
  buildRegistrationPageStyles,
} from "../../src/registration/form-style.js";
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
    expect(renderFormScript(NONCE, null)).toBe(one);
  });

  it("has the stylesheet it had: none of the rules of the styled boxes", () => {
    expect(buildRegistrationPageStyles()).toBe(buildRegistrationPageStyles(undefined, null));
    expect(buildRegistrationPageStyles()).not.toContain(".reg-phone");
    expect(render(formModel())).not.toContain(REGISTRATION_STYLED_CONTROLS_CSS);
  });
});

/** What a form with the switch on and no date or time needs: the phone box and nothing else. */
const PHONE_ONLY = { date: false, time: false } as const;
const WITH_DATE = { date: true, time: false } as const;
const WITH_DATE_AND_TIME = { date: true, time: true } as const;

/** The guest's companion asked for a phone number and nothing else. */
const COMPANION_PHONE = {
  max: 1,
  questions: [question({ key: "badge_phone", label: "Guest phone", type: "phone", required: true, rules: { example: "+48 600 100 200" } })],
};

/** The models of the page of an event with the switch on and no date and no time in its form, as PR 113g-1 left them. */
const STYLED_PHONE_MODELS: ReadonlyArray<readonly [string, () => RegistrationFormModel]> = [
  ["phone", () => formModel({ styledControls: true, questions: [question({ key: "mobile", label: "Mobile phone", type: "phone" })] })],
  ["phoneRequired", () => formModel({ styledControls: true, questions: [question({ key: "mobile", label: "Mobile phone", type: "phone", required: true })] })],
  ["companionPhone", () => formModel({ styledControls: true, questions: [], companion: COMPANION_PHONE })],
  ["textOnly", () => formModel({ styledControls: true, questions: [question({ key: "t", label: "Text", type: "text" })], companion: null })],
  ["noQuestions", () => formModel({ styledControls: true, questions: [], companion: null })],
];

/**
 * Fingerprints of the text of the styled boxes and of the pages above (without their stylesheets) as they were at the end of PR 113g-1,
 * before the date and the time had a box of their own. PR 113g-2 adds the date and the time to the page of a form that asks them and to
 * no other, so these do not change: a form with the switch on and no date or time is to stay byte for byte what it was. If one of these
 * changes on purpose, the PR that does it records the new value, and the reviewer sees the page it changed.
 */
const STYLED_HASH = {
  script: "b43513313f458dd7-15862",
  css: "ab92d1d67262b09d-1322",
  styleSheet: "db5b1fbb446d60f5-58043",
  phoneKit: "d72fe234ef011226-13580",
  phone: "9588a1b1e01c3567-70908",
  phoneRequired: "673ae726e1e8afb2-70980",
  companionPhone: "d2a62d6d87bf7107-72698",
  textOnly: "85d835a6dccfa2c0-57242",
  noQuestions: "75534076b6334248-56594",
} as const;

describe("the page of an event with the switch on and no date or time in its form", () => {
  it("has the script, the rules and the kit of the styled boxes it had after PR 113g-1, byte for byte", () => {
    expect(fingerprint(REGISTRATION_STYLED_CONTROLS_SCRIPT), "the script of the phone box changed").toBe(STYLED_HASH.script);
    expect(fingerprint(REGISTRATION_STYLED_CONTROLS_CSS), "the rules of the phone box changed").toBe(STYLED_HASH.css);
    expect(fingerprint(buildRegistrationPageStyles(undefined, PHONE_ONLY)), "the stylesheet of the page changed").toBe(STYLED_HASH.styleSheet);
    expect(fingerprint(renderStyledControls(STYLED_PHONE_MODELS[0]![1]())), "the kit of the phone box changed").toBe(STYLED_HASH.phoneKit);
  });

  it("gets that script from the composition, and the same stylesheet and the same kit", () => {
    expect(registrationStyledControlsScript(PHONE_ONLY)).toBe(REGISTRATION_STYLED_CONTROLS_SCRIPT);
    expect(buildRegistrationPageStyles(undefined, PHONE_ONLY).endsWith(REGISTRATION_STYLED_CONTROLS_CSS)).toBe(true);
    expect(buildRegistrationPageStyles(undefined, PHONE_ONLY)).not.toContain(".reg-dt");
  });

  it.each(STYLED_PHONE_MODELS)("is the page it was after PR 113g-1, byte for byte (%s)", (name, build) => {
    const hash = fingerprint(withoutStyle(render(build())));
    expect(hash, `the page of an event with the styled boxes and no date or time changed (${name}); the new value is ${hash}`).toBe(
      STYLED_HASH[name as keyof typeof STYLED_HASH],
    );
  });

  it.each(STYLED_PHONE_MODELS)("carries nothing of the date and the time boxes (%s)", (_name, build) => {
    const html = render(build());
    const doc = documentOf(html);
    expect(doc.getElementById("reg-date-kit")).toBeNull();
    expect(doc.getElementById("reg-time-kit")).toBeNull();
    expect(html).not.toContain("reg-dt");
    expect(html).not.toContain("data-date");
    expect(html).not.toContain("data-time");
    expect(styledNeedsOf(build())).toEqual(PHONE_ONLY);
  });
});

/** The styled page without what the styled boxes add: it must be the page of the same event without the switch. */
function withoutStyledAdditions(html: string, model: RegistrationFormModel): string {
  const kit = renderStyledControls(model);
  const needs = styledNeedsOf(model)!;
  const stripped = html
    .replace(' data-controls="styled"', "")
    .replaceAll(/ data-styled="(?:phone|date|datetime)"/g, "")
    .replace(`\n  <script nonce="${NONCE}">${registrationStyledControlsScript(needs)}</script>`, "")
    .replace(`\n${REGISTRATION_STYLED_CONTROLS_CSS}`, "")
    .replace(needs.date ? `\n${REGISTRATION_DATE_CONTROLS_CSS}` : "", "");
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
    // The form of the fixture asks a phone, a date and a date and time.
    expect(scripts[1].textContent).toBe(registrationStyledControlsScript(WITH_DATE_AND_TIME));
    expect(scripts[2].getAttribute("src")).toBe("https://challenges.cloudflare.com/turnstile/v0/api.js");
  });

  it("has the rules of the styled boxes after the form's own, in the one stylesheet, and the rules of the date and the time last", () => {
    const css = buildRegistrationPageStyles(undefined, WITH_DATE_AND_TIME);
    expect(css.endsWith(REGISTRATION_DATE_CONTROLS_CSS)).toBe(true);
    expect(css.indexOf(".reg-phone {")).toBeGreaterThan(css.indexOf(REGISTRATION_PAGE_CSS));
    expect(css.indexOf(".reg-dt {")).toBeGreaterThan(css.indexOf(REGISTRATION_STYLED_CONTROLS_CSS));
    expect(buildRegistrationPageStyles(undefined, PHONE_ONLY).endsWith(REGISTRATION_STYLED_CONTROLS_CSS)).toBe(true);
    expect(documentOf(render(formModel({ styledControls: true }))).querySelectorAll("style")).toHaveLength(1);
    expect(render(formModel({ styledControls: true }))).toContain(REGISTRATION_STYLED_CONTROLS_CSS);
    expect(render(formModel({ styledControls: true }))).toContain(REGISTRATION_DATE_CONTROLS_CSS);
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

  it("is not a text, a choice, a yes or no or a long text: only the phone, the date and the date and time are drawn in the product's style", () => {
    const doc = documentOf(
      render(
        formModel({
          styledControls: true,
          questions: [
            question({ key: "t", label: "Text", type: "text", suggestions: ["a"] }),
            question({ key: "l", label: "Long", type: "long_text" }),
            question({ key: "s", label: "Choice", type: "select", options: ["a", "b"] }),
            question({ key: "b", label: "Yes or no", type: "boolean" }),
          ],
        }),
      ),
    );
    expect(doc.querySelector("[data-styled]")).toBeNull();
    for (const id of ["reg-phone-kit", "reg-date-kit", "reg-time-kit"]) expect(doc.getElementById(id), id).toBeNull();
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

describe("which date questions the styled boxes take", () => {
  const date = (type: "date" | "datetime", rules: FormQuestion["rules"], extra: Partial<FormQuestion> = {}) => question({ key: "d", label: "When", type, rules, ...extra });

  it.each([
    ["no rules", null],
    ["an example only", { example: "04/11/2026" }],
    ["an icon", { icon: "calendar" }],
    ["a condition", { show_when: { field: "x", value: true } }],
    ["every rule a date can carry", { example: "tomorrow", icon: "clock", show_when: { field: "x", value: "y" } }],
  ] as const)("takes a date and a date and time with %s", (_name, rules) => {
    for (const type of ["date", "datetime"] as const) {
      const q = date(type, rules as FormQuestion["rules"]);
      expect(styledKindOf(q)).toBe(type);
      const doc = documentOf(render(formModel({ styledControls: true, questions: [q] })));
      expect(doc.querySelector("[data-custom=d]").getAttribute("data-styled")).toBe(type);
    }
  });

  it("keeps the browser's own date box in the page, with its id, name, type and label", () => {
    const doc = documentOf(
      render(formModel({ styledControls: true, questions: [date("date", null, { required: true }), date("datetime", null, { key: "dt", description: "Roughly" })] })),
    );
    const day = doc.querySelector("[data-custom=d]");
    expect(day.querySelector("input").getAttribute("type")).toBe("date");
    expect(day.querySelector("input").id).toBe("f-q0");
    expect(day.querySelector("input").hasAttribute("data-control")).toBe(true);
    expect(day.querySelector("label").getAttribute("for")).toBe("f-q0");
    const both = doc.querySelector("[data-custom=dt]");
    expect(both.querySelector("input").getAttribute("type")).toBe("datetime-local");
    expect(both.querySelector("input").id).toBe("f-q1");
    expect(both.textContent).toContain("Time in the event's time zone (Europe/Warsaw).");
    expect(doc.querySelectorAll(".reg-dt, .reg-dt__pop, [data-date-pop], [data-time-root]")).toHaveLength(0);
  });

  it("writes the kit of the date for a date, and the kit of the time as well for a date and time, and neither for a form without them", () => {
    const only = (type: "date" | "datetime" | "phone") => documentOf(render(formModel({ styledControls: true, questions: [question({ key: "q", label: "Q", type })] })));
    const dateOnly = only("date");
    expect(dateOnly.getElementById("reg-date-kit")).not.toBeNull();
    expect(dateOnly.getElementById("reg-time-kit")).toBeNull();
    expect(dateOnly.getElementById("reg-phone-kit")).toBeNull();
    const both = only("datetime");
    expect(both.getElementById("reg-date-kit")).not.toBeNull();
    expect(both.getElementById("reg-time-kit")).not.toBeNull();
    expect(both.getElementById("reg-phone-kit")).toBeNull();
    const phone = only("phone");
    expect(phone.getElementById("reg-date-kit")).toBeNull();
    expect(phone.getElementById("reg-time-kit")).toBeNull();
    expect(phone.getElementById("reg-phone-kit")).not.toBeNull();
  });

  it("takes the companion's date and time, and writes the kits for them when the guest has none", () => {
    const doc = documentOf(render(formModel({ styledControls: true, questions: [], companion: COMPANION })));
    expect(doc.querySelector("[data-custom=when]").getAttribute("data-styled")).toBe("datetime");
    expect(doc.getElementById("reg-date-kit")).not.toBeNull();
    expect(doc.getElementById("reg-time-kit")).not.toBeNull();
  });

  it("puts the kits after the phone's markup and data, in the same place in the page", () => {
    const html = render(formModel({ styledControls: true }));
    const at = (id: string) => html.indexOf(`<template id="${id}">`);
    expect(at("reg-phone-kit")).toBeGreaterThan(html.indexOf("</form>"));
    expect(html.indexOf('<ul id="reg-phone-countries"')).toBeGreaterThan(at("reg-phone-kit"));
    expect(at("reg-date-kit")).toBeGreaterThan(html.indexOf('<ul id="reg-phone-countries"'));
    expect(at("reg-time-kit")).toBeGreaterThan(at("reg-date-kit"));
    expect(renderStyledControls(formModel({ styledControls: true, questions: [], companion: null }))).toBe("");
  });

  it("writes a native page for an event without the switch, whatever its date questions", () => {
    const model = formModel({ questions: [date("date", null), date("datetime", null, { key: "dt" })] });
    expect(styledNeedsOf(model)).toBeNull();
    const html = render(model);
    expect(html).not.toContain("reg-dt");
    expect(html).not.toContain("data-styled");
    expect(html).not.toContain("reg-date-kit");
  });
});

describe("the kits of the date and the time", () => {
  const doc = documentOf(render(formModel({ styledControls: true })));

  it("hold markup with no id, no text of an organiser and no style, and the words of the form in English", () => {
    for (const id of ["reg-date-kit", "reg-time-kit"]) {
      const kit = doc.getElementById(id);
      const part = kit.content.firstElementChild;
      expect(part.querySelectorAll("[id]"), id).toHaveLength(0);
      expect(part.querySelectorAll("[style]"), id).toHaveLength(0);
      expect(part.querySelectorAll("script, iframe, a, img"), id).toHaveLength(0);
    }
    const calendar = doc.getElementById("reg-date-kit").content.firstElementChild;
    expect(calendar.textContent.replace(/\s+/g, " ").trim()).toBe("ClearToday");
    expect(calendar.querySelector("[data-date-prev]").getAttribute("aria-label")).toBe("Previous month");
    expect(calendar.querySelector("[data-date-next]").getAttribute("aria-label")).toBe("Next month");
    const clock = doc.getElementById("reg-time-kit").content.firstElementChild;
    expect(clock.textContent.replace(/\s+/g, " ").trim()).toBe("HourMinuteAM/PM");
  });

  it("make a dialog of the month, a grid of its days, and a listbox of each column of the times, hidden until they are opened", () => {
    const calendar = doc.getElementById("reg-date-kit").content.firstElementChild;
    expect(calendar.querySelector("[data-date-panel]").getAttribute("role")).toBe("dialog");
    expect(calendar.querySelector("[data-date-panel]").hasAttribute("hidden")).toBe(true);
    expect(calendar.querySelector("[data-date-trigger]").getAttribute("aria-haspopup")).toBe("dialog");
    expect(calendar.querySelector("[data-date-trigger]").getAttribute("aria-expanded")).toBe("false");
    expect(calendar.querySelector("table").getAttribute("role")).toBe("grid");
    expect(calendar.querySelector("[data-date-month]").getAttribute("aria-live")).toBe("polite");
    expect(calendar.querySelector("use").getAttribute("href")).toBe("#i-calendar");
    const clock = doc.getElementById("reg-time-kit").content.firstElementChild;
    expect(clock.querySelector("[data-time-panel]").hasAttribute("hidden")).toBe(true);
    expect(clock.querySelectorAll("ul[role=listbox]")).toHaveLength(3);
    for (const list of clock.querySelectorAll("ul[role=listbox]") as Iterable<Dom>) {
      expect(list.getAttribute("aria-label")).toBeTruthy();
      expect(list.getAttribute("tabindex")).toBe("-1");
    }
    expect(clock.querySelector("[data-time-meridiem-col]").hasAttribute("hidden")).toBe(true);
    expect(clock.querySelector("[data-time-trigger] use").getAttribute("href")).toBe("#i-clock");
    expect(clock.querySelector("input[data-time-input]").getAttribute("type")).toBe("text");
  });

  it("use only symbols the page's sprite has, and leave the sprite alone", () => {
    const sprite = new Set([...doc.querySelectorAll("symbol")].map((symbol: Dom) => `#${symbol.id}`));
    for (const id of ["reg-date-kit", "reg-time-kit"]) {
      for (const use of doc.getElementById(id).content.querySelectorAll("use") as Iterable<Dom>) expect(sprite.has(use.getAttribute("href")), use.getAttribute("href")).toBe(true);
    }
    expect(documentOf(render(formModel())).querySelectorAll("symbol")).toHaveLength(sprite.size);
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

/** The second script as the page of each kind of form carries it. */
const ALL_SCRIPTS = [REGISTRATION_STYLED_CONTROLS_SCRIPT, registrationStyledControlsScript(WITH_DATE), registrationStyledControlsScript(WITH_DATE_AND_TIME)];

describe("the second script is a fixed text", () => {
  it("is the same for every event and every request: nothing of the database is put into it", () => {
    const first = formModel({ styledControls: true });
    const second = formModel({
      styledControls: true,
      event: { slug: "another-event", title: "A <b>different</b> event", when: "1 January 2030", venue: "Elsewhere", logoUrl: null, timezone: "Asia/Tokyo" },
      questions: [
        question({ key: "dietary", label: "Dietary needs", type: "text", suggestions: ["No pork"] }),
        question({ key: "ph", label: "Phone", type: "phone" }),
        question({ key: "day", label: "Arrival", type: "date", required: true }),
        question({ key: "at", label: "Departure", type: "datetime", description: "Late is fine" }),
      ],
      consents: [{ key: "other", title: "Another consent", path: "/legal/another-event/consent-other" }],
    });
    const scriptOf = (model: RegistrationFormModel) => (documentOf(render(model)).querySelectorAll("script[nonce]")[1] as Dom).textContent;
    // Both ask a phone, a date and a date and time; the second one does it with the words of another event.
    expect(scriptOf(first)).toBe(registrationStyledControlsScript(WITH_DATE_AND_TIME));
    expect(scriptOf(second)).toBe(scriptOf(first));
    expect(renderFormScript("YQ==", PHONE_ONLY)).toContain(REGISTRATION_STYLED_CONTROLS_SCRIPT);
  });

  it("is one fixed text for each combination of boxes: the phone alone, with a date, with a date and time", () => {
    const phoneOnly = registrationStyledControlsScript(PHONE_ONLY);
    const withDate = registrationStyledControlsScript(WITH_DATE);
    const withTime = registrationStyledControlsScript(WITH_DATE_AND_TIME);
    expect(phoneOnly).toBe(REGISTRATION_STYLED_CONTROLS_SCRIPT);
    expect(withDate.startsWith(phoneOnly.slice(0, phoneOnly.length - "})();\n".length))).toBe(true);
    expect(withTime.startsWith(phoneOnly.slice(0, phoneOnly.length - "})();\n".length))).toBe(true);
    expect(withDate.endsWith("})();\n")).toBe(true);
    expect(withTime.endsWith("})();\n")).toBe(true);
    expect(phoneOnly).not.toContain("reg-date-kit");
    expect(phoneOnly).not.toContain("reg-time-kit");
    expect(withDate).toContain("reg-date-kit");
    expect(withDate).not.toContain("makeTimeBox");
    expect(withDate).not.toContain("reg-time-kit");
    expect(withDate).not.toContain("readTime");
    expect(withTime).toContain("makeTimeBox");
    expect(withTime).toContain("reg-time-kit");
    // The weight of the addition: a form without a date or a time does not carry any of it.
    expect(withDate.length).toBeGreaterThan(phoneOnly.length);
    expect(withTime.length).toBeGreaterThan(withDate.length);
    expect([phoneOnly.length, withDate.length, withTime.length]).toEqual([15862, expect.any(Number), expect.any(Number)]);
  });

  it("is the same text every time it is made", () => {
    expect(registrationStyledControlsScript(WITH_DATE_AND_TIME)).toBe(registrationStyledControlsScript({ date: true, time: true }));
    expect(registrationStyledControlsScript(WITH_DATE)).toBe(registrationStyledControlsScript({ date: true, time: false }));
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
      for (const script of ALL_SCRIPTS) expect(script, forbidden).not.toContain(forbidden);
    }
  });

  it("sets what it draws as text", () => {
    for (const script of ALL_SCRIPTS) {
      expect(script).toContain("textContent");
      expect(script).toContain("cloneNode(true)");
    }
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

describe.each(PAYLOADS)("organiser text %j on a form with a date and a date and time with the styled boxes on", (payload) => {
  const questions = [
    question({ key: "d", label: payload, type: "date", description: payload, icon: payload as never, rules: { example: payload } }),
    question({ key: payload, label: `${payload} 2`, type: "datetime", description: payload }),
  ];
  const model = formModel({ styledControls: true, questions, companion: { max: 1, questions: [question({ key: "c", label: payload, type: "datetime" })] } });

  it("stays text in the page the server writes", () => {
    const doc = documentOf(render(model));
    expect(injected(doc)).toEqual([]);
    expect(doc.querySelectorAll("script")).toHaveLength(3);
    expect(doc.querySelectorAll("style")).toHaveLength(1);
    for (const script of doc.querySelectorAll("script[nonce]") as Iterable<Dom>) expect(script.textContent).not.toContain(payload);
    for (const id of ["reg-date-kit", "reg-time-kit"]) expect(doc.getElementById(id).innerHTML).not.toContain(payload);
  });

  it("stays text once the script has drawn its boxes and opened a calendar and a list of times", () => {
    const page = bootPage(questions, { model: { styledControls: true, companion: model.companion } });
    page.doc.getElementById("f-q0-cal").click();
    page.doc.getElementById("f-q1-clock").click();
    expect(injected(page.doc)).toEqual([]);
    expect(page.doc.querySelectorAll("script")).toHaveLength(3);
    expect(page.doc.getElementById("f-q0-cal").getAttribute("aria-label")).toBe(`${payload}, choose date`);
    expect(page.doc.getElementById("f-q0-calpanel").getAttribute("aria-label")).toBe(`${payload}, choose date`);
    expect(page.doc.getElementById("f-q1").getAttribute("aria-label")).toBe(`${payload} 2, date`);
    expect(page.doc.getElementById("f-q1-time").getAttribute("aria-label")).toBe(`${payload} 2, time`);
    expect(page.doc.getElementById("f-q1-clock").getAttribute("aria-label")).toBe(`${payload} 2, choose time`);
    expect(page.doc.querySelectorAll("#f-q1-clockpanel [role=option]").length).toBeGreaterThan(70);
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
    const everything = buildRegistrationPageStyles(undefined, PHONE_ONLY);
    for (const name of used) expect(everything, name).toMatch(new RegExp(String.raw`\.${name}(?![\w-])`));
  });
});

describe("the styles of the date and the time boxes", () => {
  const css = REGISTRATION_DATE_CONTROLS_CSS;
  const everything = buildRegistrationPageStyles(undefined, WITH_DATE_AND_TIME);

  it("use the product's tokens and no colour of their own", () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/\b(?:rgb|rgba|hsl|hsla)\(/);
    expect(css).not.toContain("!important");
  });

  it("use only custom properties that the page defines, so that a misspelt token is caught", () => {
    const used = new Set([...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((match) => match[1]!));
    expect(used.size).toBeGreaterThan(15);
    for (const name of used) expect(everything, name).toMatch(new RegExp(String.raw`${name}\s*:`));
  });

  it("lay the panel in the flow of the form, the width of the row and no wider than a calendar: the card clips what sticks out of it", () => {
    expect(css).toContain(".reg-dt__panel { grid-column: 1 / -1; box-sizing: border-box; width: 100%; max-width: 21rem;");
    expect(css).not.toMatch(/\.reg-dt__panel[^{]*\{[^}]*position:/);
    expect(css).not.toMatch(/\.reg-(?:date|time)[\w_-]*[^{]*\{[^}]*position: (?:absolute|fixed)/);
    expect(css).toContain(".reg-dt__pop, .reg-dt__time { display: contents; }");
  });

  it("put a date and time side by side on a wide screen and one under the other on a phone, where the form's own rows break", () => {
    expect(REGISTRATION_PAGE_CSS).toContain("@media (max-width: 480px) {\n  .reg-row { grid-template-columns: 1fr; }");
    expect(css).toContain("@media (min-width: 481px) {\n  .reg-dt--pair { grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr) auto; }");
    expect(css).not.toContain("max-width: 480px");
  });

  it("make the cells of the month and the options of the lists 44 px high, and the arrows 44 px square, unless a pointer is fine and the screen wide", () => {
    expect(css).toContain(".reg-date__day { height: 2.75rem;");
    expect(css).toContain(".reg-date__nav { flex: none; display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box; width: 2.75rem; height: 2.75rem;");
    expect(css).toContain(".reg-time__opt { display: flex; align-items: center; justify-content: center; min-height: 2.75rem;");
    expect(css).toContain(".reg-date__action { min-height: 2.75rem;");
    expect(css).toContain("@media (min-width: 481px) and (pointer: fine) {");
    expect(css).toContain("@media (pointer: coarse) {\n  .reg-dt__button { min-width: 2.75rem; }");
  });

  it("keep the 16 px of the text boxes of the product on a phone: the boxes are its own .at-control, which has the rule", () => {
    const page = bootPage([question({ key: "dt", label: "When", type: "datetime" })], { model: { styledControls: true } });
    for (const input of [page.doc.getElementById("f-q0"), page.doc.getElementById("f-q0-time")] as Dom[]) {
      expect(input.classList.contains("at-input")).toBe(true);
      expect(input.parentElement.matches(".at-control, .at-inputgroup")).toBe(true);
    }
    expect(buildRegistrationPageStyles(undefined, WITH_DATE_AND_TIME)).toContain(".at-control > .at-input, .at-control > .at-select { flex: none; font-size: 16px;");
  });

  it("stop their transitions for a guest who asks for less motion", () => {
    expect(css).toContain("@media (prefers-reduced-motion: reduce) {\n  .reg-dt__button, .reg-date__nav, .reg-date__day, .reg-time__opt { transition: none; }\n}");
    expect(css.match(/transition:/g)?.length).toBeGreaterThan(0);
    expect(css).not.toContain("animation");
  });

  it("show the picked day and the chosen option with the primary colour, and the text on it in the colour the page keeps readable", () => {
    expect(css).toContain('.reg-date__day[aria-selected="true"] { background: var(--primary); color: var(--text-on-primary);');
    expect(css).toContain('.reg-time__opt[aria-selected="true"] { background: var(--primary); color: var(--text-on-primary);');
    const light = buildRegistrationPageStyles({ primary: "#f5c400" }, WITH_DATE_AND_TIME);
    expect(light).toContain("--text-on-primary: #1d273b");
    expect(light.indexOf(".reg-dt {")).toBeGreaterThan(light.indexOf("--text-on-primary: #1d273b"));
  });

  it("have a rule for every class the boxes, the month and the lists use, so that a misspelt class is caught", () => {
    const page = bootPage(
      [question({ key: "d", label: "Day", type: "date", required: true }), question({ key: "dt", label: "When", type: "datetime" })],
      { model: { styledControls: true } },
    );
    page.doc.getElementById("f-q0-cal").click();
    page.doc.getElementById("f-q1-clock").click();
    const used = new Set<string>();
    for (const el of page.doc.querySelectorAll(".reg-dt, .reg-dt *") as Iterable<Dom>) {
      for (const name of (el.getAttribute("class") ?? "").split(/\s+/)) if (name) used.add(name);
    }
    expect(used.size).toBeGreaterThan(20);
    for (const name of used) expect(everything, name).toMatch(new RegExp(String.raw`\.${name}(?![\w-])`));
  });
});
