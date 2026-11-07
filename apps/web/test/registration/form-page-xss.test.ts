import { describe, expect, it } from "vitest";
import type { GuestFormIcon } from "@admitto/shared";
import { renderRegistrationClosedPage, renderRegistrationFormPage } from "../../src/registration/form-page.js";
import { closedModel, documentOf, formModel, question, type Dom } from "../helpers/registration-form-fixtures.js";

/** Text an organiser (or a corrupt row) could put into any field the page prints. */
const PAYLOADS = [
  "<img src=x onerror=alert(1)>",
  '"><script>alert(1)</script>',
  "' onmouseover='alert(1)",
  '" autofocus onfocus="alert(1)',
  "</style><script>alert(1)</script>",
  "</script><script>alert(1)</script>",
  "<svg onload=alert(1)><use href=#x></svg>",
  "<iframe src=javascript:alert(1)></iframe>",
  "javascript:alert(1)",
  "${alert(1)} `x`",
  "&lt;b&gt;escaped already&lt;/b&gt; &amp; &#60;",
  "<!-- comment --><b>bold</b>",
];

const NONCE = "bm9uY2U=";

/** Elements and attributes that would be a script running, found in the parsed page. */
function injected(html: string): string[] {
  const doc = documentOf(html);
  const found: string[] = [];
  for (const el of doc.querySelectorAll("*") as Iterable<Dom>) {
    for (const attribute of [...el.attributes]) {
      if (attribute.name.startsWith("on")) found.push(`${el.tagName}[${attribute.name}]`);
      if (["autofocus", "srcdoc"].includes(attribute.name)) found.push(`${el.tagName}[${attribute.name}]`);
    }
  }
  const scripts = doc.querySelectorAll("script").length;
  if (scripts !== 2) found.push(`${scripts} script elements`);
  for (const tag of ["iframe", "object", "embed", "frame", "meta[http-equiv]", "base"]) {
    if (doc.querySelector(tag)) found.push(tag);
  }
  if (doc.querySelectorAll("style").length !== 1) found.push("style count");
  return found;
}

describe.each(PAYLOADS)("organiser text %j on the form", (payload) => {
  const model = formModel({
    event: { slug: "northwind-summit", title: payload, when: payload, venue: payload, logoUrl: null, timezone: payload },
    questions: [
      question({ key: "k_select", label: payload, type: "select", options: [payload, `${payload} 2`], description: payload, required: true }),
      question({ key: payload, label: `${payload} flag`, type: "boolean", description: payload }),
      question({ key: "k_text", label: payload, type: "text", description: payload }),
      question({ key: "k_choice", label: payload, type: "boolean", required: true }),
      question({ key: "k_long", label: payload, type: "long_text", description: payload, rules: { example: payload } }),
      question({ key: payload, label: payload, type: "date", description: payload }),
      question({ key: "k_datetime", label: payload, type: "datetime", description: payload }),
      question({ key: `${payload} phone`, label: payload, type: "phone", description: payload, rules: { digits_only: true, min_length: 3, example: payload } }),
      // A row with an icon named by the payload, the questions that wait for it, a list of suggestions and a condition on a choice.
      question({ key: "k_row", label: payload, type: "boolean", description: payload, icon: payload as GuestFormIcon }),
      question({ key: "k_wait", label: payload, type: "text", description: payload, icon: payload as GuestFormIcon, showWhen: { field: "k_row", value: true } }),
      question({
        key: "k_list",
        label: payload,
        type: "text",
        description: payload,
        suggestions: [payload, `${payload} 2`],
        showWhen: { field: payload, value: true },
      }),
      question({ key: "k_choice", label: payload, type: "text", suggestions: [payload], showWhen: { field: "k_select", value: payload } }),
    ],
    consents: [{ key: payload, title: payload, path: `/legal/x/consent-${payload}` }],
    contact: { name: payload, email: payload },
    turnstileSiteKey: payload,
  });
  const html = renderRegistrationFormPage(model, { nonce: NONCE });
  const doc = documentOf(html);

  it("creates no script, handler or frame", () => {
    expect(injected(html)).toEqual([]);
  });

  it("keeps the style block closed by its own tag only", () => {
    expect(html.split("</style").length - 1).toBe(1);
    expect(html.split("<style").length - 1).toBe(1);
    expect(html.split("</script").length - 1).toBe(2);
  });

  it("prints the title, the date and the venue as text", () => {
    expect(doc.querySelector("h1.reg-hero__title").textContent).toBe(payload);
    expect([...doc.querySelectorAll(".reg-meta span")].map((el: Dom) => el.textContent)).toEqual([payload, payload]);
    expect(doc.querySelector("title").textContent).toBe(`Registration - ${payload}`);
  });

  it("prints a question's label, note and choices as text and keeps its key in an attribute", () => {
    const select = doc.querySelector("select.at-select");
    expect(select.closest(".at-field").querySelector(".at-label").textContent).toBe(`${payload}*`);
    expect([...select.querySelectorAll("option")].map((o: Dom) => o.textContent)).toEqual(["Choose one", payload, `${payload} 2`]);
    expect([...select.querySelectorAll("option")].map((o: Dom) => o.getAttribute("value"))).toEqual(["", payload, `${payload} 2`]);
    expect(select.closest(".at-field").querySelector(".reg-slot__hint").textContent).toBe(payload);
    expect(doc.querySelector("label.reg-opt").getAttribute("data-custom")).toBe(payload);
    expect(doc.querySelector("label.reg-opt small").textContent).toBe(payload);
  });

  it("prints the label, the note, the example and the time zone of a long text, a date, a time and a phone number as text", () => {
    const hint = (selector: string) => doc.querySelector(`${selector} .reg-slot__hint`).textContent;
    const label = (selector: string) => doc.querySelector(`${selector} .at-label`).textContent;
    expect(label("[data-custom=k_long]")).toBe(payload);
    expect(hint("[data-custom=k_long]")).toBe(`${payload}\nFor example: ${payload}`);
    expect(hint("[data-custom=k_datetime]")).toBe(`${payload}\nTime in the event's time zone (${payload}).`);
    const date = doc.querySelectorAll("input[type=date]");
    expect(date).toHaveLength(1);
    expect(date[0].closest(".at-field").getAttribute("data-custom")).toBe(payload);
    expect(date[0].closest(".at-field").querySelector(".reg-slot__hint").textContent).toBe(payload);
    const phone = doc.querySelector("input[type=tel]").closest(".at-field");
    expect(phone.getAttribute("data-custom")).toBe(`${payload} phone`);
    expect(phone.querySelector(".reg-slot__hint").textContent).toBe(`${payload}\nAt least 3 digits. For example: ${payload}`);
  });

  it("prints a suggestion twice, as the text of its row and as an attribute value, and makes no element of it", () => {
    for (const key of ["k_list", "k_choice"]) {
      const rows = [...doc.querySelectorAll(`[data-custom=${key}] [role=option][data-value]`)];
      expect(rows.map((el: Dom) => el.getAttribute("data-value")), key).toEqual(key === "k_list" ? [payload, `${payload} 2`] : [payload]);
      expect(rows.map((el: Dom) => el.textContent), key).toEqual(rows.map((el: Dom) => el.getAttribute("data-value")));
      for (const row of rows) {
        expect(row.querySelectorAll("*"), key).toHaveLength(1);
        expect(row.querySelector(".searchable-select__name").children, key).toHaveLength(0);
      }
    }
    expect(doc.querySelectorAll(".combo [role=listbox]")).toHaveLength(2);
  });

  it("prints a condition as two attribute values and never reads them as markup", () => {
    const list = doc.querySelector("[data-custom=k_list]");
    expect([list.getAttribute("data-show-when-field"), list.getAttribute("data-show-when-value")]).toEqual([payload, "true"]);
    const choice = doc.querySelector("[data-custom=k_choice]");
    expect([choice.getAttribute("data-show-when-field"), choice.getAttribute("data-show-when-value")]).toEqual(["k_select", payload]);
    expect(doc.querySelector("[data-custom=k_wait]").getAttribute("data-show-when-field")).toBe("k_row");
  });

  it("prints the name of an icon as an attribute value of a reference and draws nothing from it", () => {
    for (const selector of ["[data-custom=k_row] svg.ic use", "[data-custom=k_wait] .at-inputgroup__icon use"]) {
      expect(doc.querySelector(selector).getAttribute("href"), selector).toBe(`#i-${payload}`);
    }
    expect(doc.querySelector("[data-custom=k_row]").querySelectorAll("script, img, iframe")).toHaveLength(0);
  });

  it("prints a consent's title as text and its key and link as attributes", () => {
    const consent = doc.querySelector("input[data-consent]");
    expect(consent.getAttribute("data-consent")).toBe(payload);
    expect(consent.closest("label").textContent).toContain(payload);
    expect(consent.closest("label").querySelector("a").getAttribute("href")).toBe(`/legal/x/consent-${payload}`);
  });

  it("prints the contact as text, and the site key as an attribute", () => {
    expect(doc.querySelector(".reg-foot-line").textContent).toBe(`Questions? Contact ${payload} at ${payload}`);
    expect(doc.querySelector(".cf-turnstile").getAttribute("data-sitekey")).toBe(payload);
  });
});

describe.each(PAYLOADS)("organiser text %j on the closed page", (payload) => {
  const html = renderRegistrationClosedPage(
    closedModel({
      event: { slug: "x", title: payload, when: payload, venue: payload, logoUrl: null, timezone: payload },
      contact: { name: payload, email: payload },
    }),
  );

  it("creates nothing and has no script at all", () => {
    const doc = documentOf(html);
    expect(doc.querySelectorAll("script, iframe, object, embed")).toHaveLength(0);
    for (const el of doc.querySelectorAll("*") as Iterable<Dom>) {
      for (const attribute of [...el.attributes]) expect(attribute.name.startsWith("on")).toBe(false);
    }
    expect(doc.querySelector("h1").textContent).toBe("Registration is closed");
    expect(doc.querySelector(".reg-center p").textContent).toBe(`Registration for ${payload} has ended.`);
  });
});

describe("a logo address", () => {
  it("cannot leave its attribute", () => {
    const logoUrl = 'https://cdn.example.com/a.png" onerror="alert(1)';
    const html = renderRegistrationFormPage(formModel({ event: { ...formModel().event, logoUrl } }), { nonce: NONCE });
    expect(injected(html)).toEqual([]);
    expect(documentOf(html).querySelector(".ticket__brand img").getAttribute("src")).toBe(logoUrl);
  });
});

describe("a nonce", () => {
  it("is printed as an attribute value only", () => {
    const html = renderRegistrationFormPage(formModel(), { nonce: '"></script><script>alert(1)</script><x a="' });
    expect(injected(html)).toEqual([]);
    expect(documentOf(html).querySelector("script:not([src])").getAttribute("nonce")).toBe('"></script><script>alert(1)</script><x a="');
  });
});
