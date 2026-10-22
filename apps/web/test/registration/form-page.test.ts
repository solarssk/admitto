import {
  REGISTRANT_EMAIL_MAX,
  REGISTRANT_LONG_TEXT_MAX,
  REGISTRANT_NAME_MAX,
  REGISTRANT_TEXT_MAX,
  buildRegistrantCustomData,
  normalizeRegistrantText,
  registrantRawLimit,
} from "@admitto/tickets";
import { describe, expect, it } from "vitest";
import { botChallengeCData } from "../../src/registration/bot-challenge.js";
import { renderRegistrationClosedPage, renderRegistrationFormPage } from "../../src/registration/form-page.js";
import { REGISTRATION_FORM_SCRIPT } from "../../src/registration/form-script.js";
import { closedModel, documentOf, formModel, question, requiredNewKinds, type Dom } from "../helpers/registration-form-fixtures.js";

const NONCE = "bm9uY2UtdmFsdWU=";

const render = (overrides: Parameters<typeof formModel>[0] = {}, nonce = NONCE) =>
  renderRegistrationFormPage(formModel(overrides), { nonce });

const textOf = (el: { textContent: string | null } | null) => (el?.textContent ?? "").replaceAll(/\s+/g, " ").trim();

describe("the form's structure follows the mockup, with the product's own classes", () => {
  const doc = documentOf(render());

  it("is the ticket card with the brand header, a hero, the form and the footer", () => {
    expect(doc.querySelector("main.ticket.ticket--registration")).not.toBeNull();
    expect(textOf(doc.querySelector(".ticket__top small"))).toBe("Registration");
    expect(textOf(doc.querySelector("h1.reg-hero__title"))).toBe("Northwind Partner Summit 2027");
    expect([...doc.querySelectorAll(".reg-meta span")].map(textOf)).toEqual(["14 May 2027, 09:00 - 17:00 CEST", "Expo Centre, Warsaw"]);
    expect(textOf(doc.querySelector(".reg-foot-line"))).toBe("Questions? Contact Anna Kowalska at events@northwind.example");
    expect(textOf(doc.querySelector(".ticket__foot > div"))).toBe("Powered by Admitto");
  });

  it("uses at-field, at-label, at-input, at-select, at-check, at-btn, at-notice and at-hint", () => {
    for (const selector of [
      ".at-field > .at-label",
      ".at-field .at-control > .at-input",
      ".at-field .at-inputgroup > .at-input",
      ".at-field .picker > button.searchable-select__trigger",
      ".at-field .picker > select.at-select",
      ".at-field > textarea.at-textarea",
      "label.at-check > input[type=checkbox] + .at-check__box",
      "button.at-btn.at-btn--primary.at-btn--block.at-btn--lg[type=submit]",
      ".at-notice.at-notice--info",
      ".at-notice.at-notice--error",
      "p.at-hint.reg-slot",
    ]) {
      expect(doc.querySelector(selector), selector).not.toBeNull();
    }
  });

  it("lays the fixed fields out in the mockup's order: names side by side, email, company and department", () => {
    const keys = [...doc.querySelectorAll("[data-field]")].map((el: Dom) => el.getAttribute("data-field"));
    expect(keys.slice(0, 5)).toEqual(["first_name", "last_name", "email", "company", "department"]);
    expect(doc.querySelectorAll(".reg-row")).toHaveLength(2);
    expect(doc.querySelector(".reg-row")?.querySelectorAll(".at-field")).toHaveLength(2);
  });

  it("gives the fields the mockup's icons: a mail, a building and a group; an option row has the icon its question names, else none", () => {
    const icons = (selector: string) => [...doc.querySelectorAll(`${selector} use`)].map((el: Dom) => el.getAttribute("href"));
    expect(icons("[data-field=email] .at-inputgroup__icon")).toEqual(["#i-mail"]);
    expect(icons("[data-field=company] .at-inputgroup__icon")).toEqual(["#i-building"]);
    expect(icons("[data-field=department] .at-inputgroup__icon")).toEqual(["#i-users"]);
    expect(icons(".reg-opt > svg.ic")).toEqual([]);
  });

  it("has one message slot under each field that can fail, holding the note and the error", () => {
    const email = doc.querySelector("[data-field=email]");
    expect(textOf(email?.querySelector(".reg-slot__hint") ?? null)).toBe("We send a confirmation link to this address.");
    expect(email?.querySelector(".reg-slot__err [data-msg-text]")).not.toBeNull();
    for (const field of doc.querySelectorAll(".at-field[data-field]")) {
      expect(field.querySelectorAll("[data-slot]"), field.getAttribute("data-field")).toHaveLength(1);
    }
  });

});

describe("the organiser's questions", () => {
  const doc = documentOf(render());
  const section = doc.querySelector(".reg-section");

  it("sit in an Additional details section, in the organiser's order", () => {
    expect(textOf(section?.querySelector(".reg-section__label") ?? null)).toBe("Additional details");
    const keys = [...section!.querySelectorAll("[data-custom]")].map((el: Dom) => el.getAttribute("data-custom"));
    expect(keys).toEqual(["day", "parking", "diet", "plate", "badge", "notes", "arrival_date", "arrival_time", "mobile"]);
  });

  it("draws a choice as a list with its options and an empty first one", () => {
    const select = doc.querySelector("[data-custom=day] select.at-select");
    expect([...select.querySelectorAll("option")].map((o: Dom) => [o.getAttribute("value"), o.textContent])).toEqual([
      ["", "Choose one"],
      ["Both days", "Both days"],
      ["Day 1 only", "Day 1 only"],
    ]);
    expect(select.hasAttribute("required")).toBe(true);
  });

  it("draws an optional Yes/No as an option row, and groups a run of them", () => {
    const rows = doc.querySelectorAll(".reg-opts > label.reg-opt.at-check");
    expect(rows).toHaveLength(2);
    expect(rows[0].getAttribute("data-kind")).toBe("flag");
    expect(rows[0].hasAttribute("data-required")).toBe(false);
    expect(textOf(rows[1].querySelector("small"))).toBe("Vegetarian, vegan or allergies.");
  });

  it("draws a required Yes/No as a list of Yes and No, so that a guest can answer no", () => {
    const select = doc.querySelector("[data-custom=badge] select.at-select");
    expect([...select.querySelectorAll("option")].map((o: Dom) => [o.getAttribute("value"), o.textContent])).toEqual([
      ["", "Choose one"],
      ["true", "Yes"],
      ["false", "No"],
    ]);
    expect(doc.querySelector("[data-custom=badge]").getAttribute("data-kind")).toBe("choice");
  });

  it("shows a question's note under its field, and gives a text question the product's input", () => {
    const plate = doc.querySelector("[data-custom=plate]");
    expect(textOf(plate.querySelector(".reg-slot__hint"))).toBe("The venue uses it at the gate.");
    // The browser counts UTF-16 units of the raw text, the server characters of the trimmed text: the cap is the server's raw limit.
    expect(plate.querySelector("input.at-input")?.getAttribute("maxlength")).toBe(String(registrantRawLimit(REGISTRANT_TEXT_MAX)));
  });

  it("caps every text input at the longest raw text the server looks at, the server holds the exact limits", () => {
    const doc2 = documentOf(render());
    expect(doc2.querySelector("input[name=first_name]")?.getAttribute("maxlength")).toBe(String(registrantRawLimit(REGISTRANT_NAME_MAX)));
    expect(doc2.querySelector("input[name=last_name]")?.getAttribute("maxlength")).toBe(String(registrantRawLimit(REGISTRANT_NAME_MAX)));
    expect(doc2.querySelector("input[name=email]")?.getAttribute("maxlength")).toBe(String(registrantRawLimit(REGISTRANT_EMAIL_MAX)));
  });

  it("does not block an answer padded with spaces that the server takes", () => {
    const doc2 = documentOf(render());
    const padded = (max: number) => `${" ".repeat(150)}${"x".repeat(max)}`;
    const capOf = (name: string) => Number(doc2.querySelector(`input[name=${name}]`)?.getAttribute("maxlength"));
    // The server trims the padding off and takes the 100 characters (and the 254 of an address)...
    expect(normalizeRegistrantText(padded(REGISTRANT_NAME_MAX), REGISTRANT_NAME_MAX)).toBe("x".repeat(REGISTRANT_NAME_MAX));
    expect(normalizeRegistrantText(padded(REGISTRANT_EMAIL_MAX), REGISTRANT_EMAIL_MAX)).toBe("x".repeat(REGISTRANT_EMAIL_MAX));
    // ... so the browser must let the whole padded text be typed.
    expect(padded(REGISTRANT_NAME_MAX).length).toBeLessThanOrEqual(capOf("first_name"));
    expect(padded(REGISTRANT_EMAIL_MAX).length).toBeLessThanOrEqual(capOf("email"));
  });

  it("has no section when the event asks nothing more", () => {
    expect(documentOf(render({ questions: [] })).querySelector(".reg-section__label")?.textContent).toBe("Before you send");
  });

  it("does not make an option row of a Yes/No that is split by another question", () => {
    const html = render({
      questions: [
        question({ key: "a", label: "A", type: "boolean" }),
        question({ key: "b", label: "B", type: "text" }),
        question({ key: "c", label: "C", type: "boolean" }),
      ],
    });
    expect(documentOf(html).querySelectorAll(".reg-opts")).toHaveLength(2);
  });

  it("draws a text question that is required with a star and the required attribute", () => {
    const doc2 = documentOf(render({ questions: [question({ key: "q", label: "Why?", type: "text", required: true })] }));
    expect(doc2.querySelector("[data-custom=q] input").hasAttribute("required")).toBe(true);
    expect(doc2.querySelector("[data-custom=q] .at-label .reg-req").getAttribute("aria-hidden")).toBe("true");
  });
});

describe("a long text, a date, a date and time and a phone number", () => {
  const doc = documentOf(render());
  const rawCap = (max: number) => String(registrantRawLimit(max));
  const kinds = [
    {
      type: "long_text",
      key: "notes",
      control: "textarea.at-textarea",
      attributes: { rows: "4", maxlength: rawCap(REGISTRANT_LONG_TEXT_MAX) },
      kind: "longtext",
      empty: "Answer this question.",
      refused: "Check your answer. Use up to 1000 characters.",
    },
    {
      type: "date",
      key: "arrival_date",
      control: "input.at-input[type=date]",
      attributes: {},
      kind: "date",
      empty: "Enter a date.",
      refused: "Enter a valid date.",
    },
    {
      type: "datetime",
      key: "arrival_time",
      control: "input.at-input[type=datetime-local]",
      attributes: {},
      kind: "datetime",
      empty: "Enter a date and time.",
      refused: "Enter a valid date and time.",
    },
    {
      type: "phone",
      key: "mobile",
      control: "input.at-input[type=tel]",
      attributes: { maxlength: rawCap(REGISTRANT_TEXT_MAX) },
      kind: "phone",
      empty: "Enter a phone number.",
      refused: "Enter a valid phone number.",
    },
  ];

  it.each(kinds)("draws $type as $control, with a sentence of the page's own for an empty answer and for a refused one", (row) => {
    const field = doc.querySelector(`[data-custom=${row.key}]`);
    const control = field.querySelector(row.control);
    expect(control, row.control).not.toBeNull();
    for (const [name, value] of Object.entries(row.attributes)) expect(control.getAttribute(name), name).toBe(value);
    expect(control.hasAttribute("data-control")).toBe(true);
    expect(control.getAttribute("autocomplete") ?? "off").toBe("off");
    expect(field.getAttribute("data-kind")).toBe(row.kind);
    expect(field.getAttribute("data-field")).toBe(`custom_data.${row.key}`);
    expect(field.getAttribute("data-message")).toBe(row.empty);
    expect(field.getAttribute("data-invalid")).toBe(row.refused);
    expect(field.hasAttribute("data-required")).toBe(false);
    expect(control.hasAttribute("required")).toBe(false);
  });

  it.each(kinds)("labels $type's control, names its message slot and gives it a place for an error", (row) => {
    const field = doc.querySelector(`[data-custom=${row.key}]`);
    const control = field.querySelector("[data-control]");
    const id = control.getAttribute("id");
    expect(id).toMatch(/^f-q\d+$/);
    expect(control.getAttribute("name")).toBe(id.slice(2));
    expect(field.querySelector(`label[for="${id}"]`)).not.toBeNull();
    expect(control.getAttribute("aria-describedby")).toBe(`m-${id}`);
    const slot = doc.getElementById(`m-${id}`);
    expect(slot.hasAttribute("data-slot")).toBe(true);
    expect(slot.querySelector(".reg-slot__err [data-msg-text]")).not.toBeNull();
    expect(field.querySelectorAll("[data-slot]")).toHaveLength(1);
  });

  it("marks a required one with a star and the required attribute, and keeps the other sentences", () => {
    const html = render({ questions: requiredNewKinds() });
    const required = documentOf(html);
    const controls = [...required.querySelectorAll("[data-custom] [data-control]")] as Dom[];
    expect(controls).toHaveLength(4);
    for (const control of controls) {
      const field = control.closest("[data-custom]");
      expect(control.hasAttribute("required"), field.getAttribute("data-custom")).toBe(true);
      expect(field.hasAttribute("data-required")).toBe(true);
      expect(field.querySelector(".at-label .reg-req").getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("has no pattern, length, range or step on any control, which would stop a send in a way the server does not", () => {
    const rules = { digits_only: true, min_length: 3, max_length: 6, example: "1234" };
    const questions = [
      question({ key: "a", label: "A", type: "text", rules }),
      question({ key: "b", label: "B", type: "long_text", rules }),
      question({ key: "c", label: "C", type: "phone", rules }),
      question({ key: "d", label: "D", type: "date" }),
      question({ key: "e", label: "E", type: "datetime" }),
    ];
    const controls = [...documentOf(render({ questions })).querySelectorAll("[data-custom] [data-control]")] as Dom[];
    expect(controls).toHaveLength(5);
    for (const control of controls) {
      for (const name of ["pattern", "minlength", "min", "max", "step"]) {
        expect(control.hasAttribute(name), `${control.tagName} ${control.getAttribute("type")} ${name}`).toBe(false);
      }
    }
  });

  it("caps a text control at the longest raw text the server looks at, whatever a rule says about the length", () => {
    const rules = { max_length: 5 };
    const questions = [
      question({ key: "a", label: "A", type: "text", rules }),
      question({ key: "b", label: "B", type: "long_text", rules }),
      question({ key: "c", label: "C", type: "phone", rules }),
    ];
    const caps = [...documentOf(render({ questions })).querySelectorAll("[data-custom] [data-control]")].map((el: Dom) => Number(el.getAttribute("maxlength")));
    expect(caps).toEqual([registrantRawLimit(REGISTRANT_TEXT_MAX), registrantRawLimit(REGISTRANT_LONG_TEXT_MAX), registrantRawLimit(REGISTRANT_TEXT_MAX)]);
  });

  it("lets a long text of 1000 emoji be typed in full, as the server takes it, and no more is taken", () => {
    const cap = Number(doc.querySelector("textarea").getAttribute("maxlength"));
    const fits = "\u{1F600}".repeat(REGISTRANT_LONG_TEXT_MAX);
    // The browser counts UTF-16 units, the server code points: 1000 emoji are 2000 units, and still an answer.
    expect([...fits]).toHaveLength(REGISTRANT_LONG_TEXT_MAX);
    expect(fits.length).toBeLessThanOrEqual(cap);
    const field = { label: "Notes", source_field: "notes", type: "long_text" as const, show_on_form: true };
    expect(buildRegistrantCustomData([field], { notes: fits })).toEqual({ notes: fits });
    expect(() => buildRegistrantCustomData([field], { notes: `${fits}\u{1F600}` })).toThrow();
  });

  describe("the rules of a question are hints under it, and the server judges", () => {
    const hintOf = (type: "text" | "long_text" | "phone", rules: object, description: string | null = null) => {
      const html = render({ questions: [question({ key: "q", label: "Q", type, rules, description })] });
      return documentOf(html).querySelector("[data-custom=q] .reg-slot__hint")?.textContent ?? null;
    };

    it.each([
      [{ min_length: 3, max_length: 6 }, "3 to 6 characters."],
      [{ min_length: 6, max_length: 6 }, "Exactly 6 characters."],
      [{ min_length: 1, max_length: 1 }, "Exactly 1 character."],
      [{ min_length: 20 }, "At least 20 characters."],
      [{ max_length: 12 }, "Up to 12 characters."],
      [{ digits_only: true }, "Digits only."],
      [{ digits_only: true, min_length: 3, max_length: 6 }, "3 to 6 digits."],
      [{ digits_only: true, min_length: 6, max_length: 6 }, "Exactly 6 digits."],
      [{ digits_only: true, min_length: 1, max_length: 1 }, "Exactly 1 digit."],
      [{ digits_only: true, max_length: 4 }, "Up to 4 digits."],
      [{ example: "WA 12345" }, "For example: WA 12345"],
      [{ digits_only: true, min_length: 3, max_length: 6, example: "1234" }, "3 to 6 digits. For example: 1234"],
    ])("says %j as %j, for a text, a long text and a phone number", (rules, hint) => {
      for (const type of ["text", "long_text", "phone"] as const) expect(hintOf(type, rules), type).toBe(hint);
    });

    it("has no hint for a question with no note and no rules, and leaves the slot for its error", () => {
      expect(hintOf("text", {})).toBeNull();
      const html = render({ questions: [question({ key: "q", label: "Q", type: "phone" })] });
      expect(documentOf(html).querySelector("[data-custom=q] .reg-slot__hint")).toBeNull();
      expect(documentOf(html).querySelector("[data-custom=q] [data-slot] [data-msg-text]")).not.toBeNull();
    });

    it("puts the organiser's own note first, then what the rules ask, each on a line of its own", () => {
      expect(hintOf("phone", { digits_only: true, min_length: 3, example: "123" }, "Dial it as you would inside the building.")).toBe(
        "Dial it as you would inside the building.\nAt least 3 digits. For example: 123",
      );
    });

    it("asks for a numeric keypad only for an answer that is digits only", () => {
      const inputMode = (type: "text" | "long_text" | "phone", rules: object) =>
        documentOf(render({ questions: [question({ key: "q", label: "Q", type, rules })] }))
          .querySelector("[data-custom=q] [data-control]")
          .getAttribute("inputmode");
      for (const type of ["text", "long_text", "phone"] as const) {
        expect(inputMode(type, { digits_only: true }), type).toBe("numeric");
        expect(inputMode(type, { min_length: 3 }), type).toBeNull();
        expect(inputMode(type, {}), type).toBeNull();
      }
    });

    it("tells a refused answer in the page's own words, with the length rule in them", () => {
      const refused = (type: "long_text" | "phone", rules: object) =>
        documentOf(render({ questions: [question({ key: "q", label: "Q", type, rules })] }))
          .querySelector("[data-custom=q]")
          .getAttribute("data-invalid");
      expect(refused("long_text", { min_length: 20, max_length: 500 })).toBe("Check your answer. Use 20 to 500 characters.");
      expect(refused("long_text", { min_length: 20 })).toBe("Check your answer. Use at least 20 characters.");
      expect(refused("long_text", { digits_only: true })).toBe("Check your answer. Use digits only.");
      expect(refused("phone", { digits_only: true, min_length: 3, max_length: 6 })).toBe("Enter a valid phone number. Use 3 to 6 digits.");
      expect(refused("phone", { example: "+1 555 0100" })).toBe("Enter a valid phone number.");
    });

    it("sets no sentence for a refused answer on a short text, a choice or a Yes/No: the server's own is shown for them", () => {
      const doc2 = documentOf(render({ questions: [question({ key: "t", label: "T", type: "text", rules: { max_length: 5 } }), ...formModel().questions.slice(0, 5)] }));
      expect(doc2.querySelectorAll("[data-invalid]")).toHaveLength(0);
    });
  });

  describe("a date and a time", () => {
    it("names the event's time zone under a time, after the organiser's note", () => {
      const doc2 = documentOf(render({ event: { ...formModel().event, timezone: "America/New_York" } }));
      expect(doc2.querySelector("[data-custom=arrival_time] .reg-slot__hint")?.textContent).toBe(
        "Roughly is fine.\nTime in the event's time zone (America/New_York).",
      );
    });

    it("says the zone alone when the time has no note, and says nothing of a zone under a date", () => {
      const html = render({
        questions: [question({ key: "t", label: "T", type: "datetime" }), question({ key: "d", label: "D", type: "date", description: "Any day." })],
      });
      const doc2 = documentOf(html);
      expect(doc2.querySelector("[data-custom=t] .reg-slot__hint")?.textContent).toBe("Time in the event's time zone (Europe/Warsaw).");
      expect(doc2.querySelector("[data-custom=d] .reg-slot__hint")?.textContent).toBe("Any day.");
    });
  });
});

describe("the fixed fields follow the event's settings", () => {
  const keys = (overrides: Parameters<typeof formModel>[0]) =>
    [...documentOf(render({ questions: [], ...overrides })).querySelectorAll("[data-field]")].map((el: Dom) => el.getAttribute("data-field"));

  it("asks for a company and a department only when the event does", () => {
    expect(keys({ askCompany: false, askDepartment: false })).toEqual(["first_name", "last_name", "email", "terms", "challenge"]);
    expect(keys({ askCompany: true, askDepartment: false })).toContain("company");
    expect(keys({ askCompany: true, askDepartment: false })).not.toContain("department");
    expect(keys({ askCompany: false, askDepartment: true })).toContain("department");
    expect(keys({ askCompany: false, askDepartment: true })).not.toContain("company");
  });

  it("lets the browser fill in the names, the address and the company", () => {
    const doc = documentOf(render());
    const autocomplete = (id: string) => doc.getElementById(id).getAttribute("autocomplete");
    expect([autocomplete("f-first_name"), autocomplete("f-last_name"), autocomplete("f-email"), autocomplete("f-company")]).toEqual([
      "given-name",
      "family-name",
      "email",
      "organization",
    ]);
    expect(autocomplete("f-department")).toBe("off");
    expect(autocomplete("f-q3")).toBe("off");
  });

  it("puts a lone profile field on its own line, not in a half-empty row", () => {
    expect(documentOf(render({ askCompany: true, askDepartment: false, questions: [] })).querySelectorAll(".reg-row")).toHaveLength(1);
  });

  it("says what happens next, by mode and by whether the address is confirmed first", () => {
    const note = (overrides: Parameters<typeof formModel>[0]) => textOf(documentOf(render(overrides)).querySelector(".at-notice--info .at-notice__body"));
    expect(note({ mode: "approval" })).toBe("The organisers review every registration. You will get an email with their decision.");
    expect(note({ mode: "automatic", verifyEmail: true })).toBe("We email your ticket as soon as you confirm your address.");
    expect(note({ mode: "automatic", verifyEmail: false })).toBe("We email your ticket as soon as you send this form.");
  });

  it("labels the button by mode", () => {
    expect(textOf(documentOf(render({ mode: "approval" })).querySelector("#reg-submit"))).toBe("Send registration");
    expect(textOf(documentOf(render({ mode: "automatic" })).querySelector("#reg-submit"))).toBe("Register");
  });

  it("describes the address field by how the address is used", () => {
    const hint = (verifyEmail: boolean) => textOf(documentOf(render({ verifyEmail })).querySelector("[data-field=email] .reg-slot__hint"));
    expect(hint(true)).toBe("We send a confirmation link to this address.");
    expect(hint(false)).toBe("We send our messages to this address.");
  });
});

describe("the terms, the consents and the links to the legal texts", () => {
  const doc = documentOf(render());

  it("has a required terms checkbox that links the event's terms", () => {
    const terms = doc.querySelector("[data-field=terms]");
    expect(terms.getAttribute("data-required")).toBe("");
    expect(terms.querySelector("input[type=checkbox]").hasAttribute("required")).toBe(true);
    expect(terms.querySelector("input").checked).toBe(false);
    expect(terms.querySelector("a").getAttribute("href")).toBe("/legal/northwind-summit/event-terms");
  });

  it("has an optional checkbox for each extra consent, labelled with its title and linking its text", () => {
    const consent = doc.querySelector("input[data-consent=photos]");
    expect(consent.hasAttribute("required")).toBe(false);
    expect(consent.checked).toBe(false);
    const label = consent.closest("label");
    expect(textOf(label)).toContain("Photos in the newsletter");
    expect(label.querySelector("a").getAttribute("href")).toBe("/legal/northwind-summit/consent-photos");
  });

  it("links the privacy notice below the button, with no checkbox of its own", () => {
    const fine = doc.querySelector(".reg-fine");
    expect(fine.querySelector("a").getAttribute("href")).toBe("/legal/northwind-summit/privacy-notice");
    expect(doc.querySelectorAll("input[type=checkbox]:not([data-control]):not([data-consent])")).toHaveLength(0);
  });

  it("opens every legal text in a new tab, so the form keeps what was typed, and says so", () => {
    const links = [...doc.querySelectorAll(".reg-checks a, .reg-fine a")] as Dom[];
    expect(links).toHaveLength(3);
    for (const link of links) {
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noopener noreferrer");
      expect(link.querySelector(".reg-sr")?.textContent).toBe(" (opens in a new tab)");
    }
  });

  it("has one consent checkbox per consent, none when the event asks for none", () => {
    expect(documentOf(render({ consents: [] })).querySelectorAll("input[data-consent]")).toHaveLength(0);
    const two = render({
      consents: [
        { key: "a", title: "A", path: "/legal/x/consent-a" },
        { key: "b", title: "B", path: "/legal/x/consent-b" },
      ],
    });
    expect([...documentOf(two).querySelectorAll("input[data-consent]")].map((el: Dom) => el.getAttribute("data-consent"))).toEqual(["a", "b"]);
  });
});

describe("the Turnstile widget", () => {
  const doc = documentOf(render());

  it("carries the public key and the cdata the server requires back", () => {
    const widget = doc.querySelector(".cf-turnstile");
    expect(widget.getAttribute("data-sitekey")).toBe("1x00000000000000000000AA");
    expect(widget.getAttribute("data-cdata")).toBe(botChallengeCData("northwind-summit"));
    expect(widget.getAttribute("data-cdata")).toBe("reg-northwind-summit");
  });

  it("gives the page script its three callbacks and keeps the token out of the form", () => {
    const widget = doc.querySelector(".cf-turnstile");
    expect(widget.getAttribute("data-callback")).toBe("admittoTurnstileDone");
    expect(widget.getAttribute("data-error-callback")).toBe("admittoTurnstileError");
    expect(widget.getAttribute("data-expired-callback")).toBe("admittoTurnstileExpired");
    expect(widget.getAttribute("data-response-field")).toBe("false");
  });

  it("is a required field with a message for a guest who has not solved it", () => {
    expect(doc.querySelector("[data-field=challenge]").getAttribute("data-message")).toBe("Complete the security check.");
  });
});

describe("scripts, nonce and what the page loads", () => {
  it("has one inline script, under the nonce of the response, and Cloudflare's widget script", () => {
    const scripts = [...documentOf(render()).querySelectorAll("script")] as Dom[];
    expect(scripts).toHaveLength(2);
    const inline = scripts.filter((s) => !s.hasAttribute("src"));
    expect(inline).toHaveLength(1);
    expect(inline[0]!.getAttribute("nonce")).toBe(NONCE);
    expect(inline[0]!.textContent).toBe(REGISTRATION_FORM_SCRIPT);
    const external = scripts.filter((s) => s.hasAttribute("src"));
    expect(external.map((s) => s.getAttribute("src"))).toEqual(["https://challenges.cloudflare.com/turnstile/v0/api.js"]);
  });

  it("uses the nonce it is given, and nothing else differs between two responses", () => {
    const first = render({}, "Zmlyc3Q=");
    const second = render({}, "c2Vjb25k");
    expect(first).not.toBe(second);
    expect(first.replaceAll("Zmlyc3Q=", "NONCE")).toBe(second.replaceAll("c2Vjb25k", "NONCE"));
  });

  it("has no inline event handler, no javascript:, data: or vbscript: link and no inline style", () => {
    const html = render();
    const doc = documentOf(html);
    for (const el of doc.querySelectorAll("*") as Iterable<Dom>) {
      for (const attribute of [...el.attributes]) {
        expect(attribute.name.startsWith("on"), `${el.tagName} ${attribute.name}`).toBe(false);
        if (["href", "src", "action"].includes(attribute.name)) {
          const value = attribute.value.trim().toLowerCase();
          for (const scheme of ["javascript:", "data:", "vbscript:"]) {
            expect(value.startsWith(scheme), `${el.tagName} ${attribute.name} ${scheme}`).toBe(false);
          }
        }
      }
    }
    expect(doc.querySelectorAll("[style]")).toHaveLength(0);
  });

  it("is a form that cannot send itself without the script: POST, a disabled button, and no GET", () => {
    const doc = documentOf(render());
    const form = doc.querySelector("form#reg-form");
    expect(form.getAttribute("method")).toBe("post");
    expect(form.getAttribute("action")).toBe("/r/northwind-summit");
    expect(form.hasAttribute("novalidate")).toBe(true);
    expect(doc.querySelector("#reg-submit").hasAttribute("disabled")).toBe(true);
    expect(doc.querySelector("noscript")?.textContent).toContain("This form needs JavaScript");
  });

  it("loads nothing from outside: no link, no image, no font and no frame apart from the first-party ones", () => {
    const doc = documentOf(render());
    const urls = [...doc.querySelectorAll("[src], link[href]")].map((el: Dom) => el.getAttribute("src") ?? el.getAttribute("href"));
    for (const url of urls) {
      expect(url?.startsWith("/") || url?.startsWith("https://challenges.cloudflare.com/"), url ?? "").toBe(true);
    }
    expect(doc.querySelectorAll("iframe, object, embed, form[action^=http]")).toHaveLength(0);
  });
});

describe("accessibility", () => {
  const doc = documentOf(render());
  // What a guest operates: the boxes and the buttons of the choices, not the hidden select a choice writes into, nor the search box of its panel, which has a name of its own.
  const controls = [
    ...doc.querySelectorAll("form input:not([type=hidden]):not([data-picker-search]), form select:not([aria-hidden=true]), form textarea, form [data-picker-trigger]"),
  ] as Dom[];

  it("gives every control a label that points at it with for and id", () => {
    expect(controls.length).toBeGreaterThan(8);
    for (const control of controls) {
      const id = control.getAttribute("id");
      expect(id, control.outerHTML).toBeTruthy();
      const labelled = doc.querySelector(`label[for="${id}"]`) ?? control.closest("label");
      expect(labelled, id ?? "").not.toBeNull();
      expect(textOf(labelled).length, id ?? "").toBeGreaterThan(0);
    }
  });

  it("has unique ids", () => {
    const ids = [...doc.querySelectorAll("[id]")].map((el: Dom) => el.getAttribute("id"));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("describes each field by its message slot, which exists and holds the error", () => {
    const described = [...doc.querySelectorAll("[aria-describedby]")] as Dom[];
    expect(described.length).toBeGreaterThan(8);
    for (const control of described) {
      const slot = doc.getElementById(control.getAttribute("aria-describedby"));
      expect(slot, control.getAttribute("id") ?? "").not.toBeNull();
      expect(slot.hasAttribute("data-slot")).toBe(true);
      expect(slot.querySelector("[data-msg-text]")).not.toBeNull();
    }
  });

  it("marks required fields for assistive technology and hides the decorative star", () => {
    for (const field of doc.querySelectorAll("[data-required]:not([data-kind=challenge])")) {
      expect(field.querySelector("[data-control]").hasAttribute("required"), field.getAttribute("data-field")).toBe(true);
    }
    for (const star of doc.querySelectorAll(".reg-req")) expect(star.getAttribute("aria-hidden")).toBe("true");
  });

  it("has an alert region for the summary, a focus target for the result, and a visible heading", () => {
    const summary = doc.querySelector("#reg-error");
    expect(summary.getAttribute("role")).toBe("alert");
    expect(summary.hasAttribute("hidden")).toBe(true);
    expect(summary.getAttribute("tabindex")).toBe("-1");
    expect(doc.querySelector("#reg-done-title").getAttribute("tabindex")).toBe("-1");
    expect(doc.querySelector("#reg-done").getAttribute("aria-labelledby")).toBe("reg-done-title");
    expect(doc.querySelector("#reg-done").hasAttribute("hidden")).toBe(true);
    expect(doc.querySelectorAll("h1")).toHaveLength(2);
  });

  it("hides decorative icons from assistive technology", () => {
    for (const svg of doc.querySelectorAll("svg")) expect(svg.getAttribute("aria-hidden"), svg.outerHTML.slice(0, 60)).toBe("true");
  });

  it("is English and fits a phone", () => {
    expect(doc.documentElement.getAttribute("lang")).toBe("en");
    expect(doc.querySelector("meta[name=viewport]").getAttribute("content")).toBe("width=device-width,initial-scale=1");
  });
});

describe("the brand and the footer", () => {
  it("shows the event's logo, else the Admitto mark", () => {
    const withLogo = documentOf(render({ event: { ...formModel().event, logoUrl: "https://cdn.example.com/logo.png" } }));
    expect(withLogo.querySelector(".ticket__brand img").getAttribute("src")).toBe("https://cdn.example.com/logo.png");
    expect(withLogo.querySelector(".ticket__brand img").getAttribute("alt")).toBe("Northwind Partner Summit 2027");
    const without = documentOf(render());
    expect(without.querySelector(".ticket__brand img").getAttribute("src")).toBe("/assets/admitto-mark.svg");
  });

  it("leaves the venue out when there is none, and the contact line out when there is no contact", () => {
    const doc = documentOf(render({ event: { ...formModel().event, venue: null }, contact: null }));
    expect(doc.querySelectorAll(".reg-meta span")).toHaveLength(1);
    expect(doc.querySelector(".reg-foot-line")).toBeNull();
    expect(textOf(doc.querySelector(".ticket__foot"))).toBe("Powered by Admitto");
  });

  it("names a contact that has no name by its address alone", () => {
    const doc = documentOf(render({ contact: { name: "", email: "events@northwind.example" } }));
    expect(textOf(doc.querySelector(".reg-foot-line"))).toBe("Questions? Contact events@northwind.example");
  });
});

describe("the page after a send", () => {
  const doc = documentOf(render());

  it("is the Check your inbox screen, hidden until the script shows it, with the address filled in by the script", () => {
    const done = doc.querySelector("#reg-done");
    expect(textOf(done.querySelector("h1"))).toBe("Check your inbox");
    expect(done.querySelector("#reg-done-email").textContent).toBe("");
    expect(textOf(done.querySelector("p"))).toBe(
      "We sent a message to . Open the link in it to confirm your address. The link works for 24 hours.",
    );
    expect([...done.querySelectorAll(".reg-facts span")].map(textOf)).toEqual(["It can take a few minutes", "Look in your spam folder too"]);
    expect(done.querySelector("button#reg-again").getAttribute("type")).toBe("button");
  });

  it("does not promise a link when the address is not confirmed first", () => {
    const text = textOf(documentOf(render({ verifyEmail: false })).querySelector("#reg-done p"));
    expect(text).toBe("We sent a message to . It tells you what happens next.");
  });

  it("marks the regions the script hides once the screen is shown", () => {
    expect([...doc.querySelectorAll("[data-hide-when-done]")].map((el: Dom) => el.className.split(" ")[0])).toEqual([
      "reg-hero",
      "reg-notices",
      "reg-form",
    ]);
  });
});

describe("a page for an event that is over", () => {
  const html = renderRegistrationClosedPage(closedModel());
  const doc = documentOf(html);

  it("says registration is closed, with the event and the contact, as in the mockup", () => {
    expect(textOf(doc.querySelector("h1"))).toBe("Registration is closed");
    expect(textOf(doc.querySelector(".reg-center p"))).toBe("Registration for Northwind Partner Summit 2027 has ended.");
    expect(doc.querySelector(".reg-badge--muted use").getAttribute("href")).toBe("#i-calendar-off");
    expect(textOf(doc.querySelector(".ticket__foot"))).toContain("Anna Kowalska");
  });

  it("has no form, no field, no widget and no script", () => {
    expect(doc.querySelectorAll("form, input, select, button, script, noscript, .cf-turnstile, iframe")).toHaveLength(0);
    expect(html).not.toContain("cloudflare");
  });

  it("is titled for the event", () => {
    expect(doc.querySelector("title").textContent).toBe("Registration closed - Northwind Partner Summit 2027");
  });
});

describe("the head of both pages", () => {
  it("asks iOS not to turn what looks like a phone number into a call link, as an example of a phone answer would become", () => {
    for (const html of [render(), renderRegistrationClosedPage(closedModel())]) {
      expect(documentOf(html).querySelector('meta[name="format-detection"]')?.getAttribute("content")).toBe("telephone=no");
    }
  });
});

describe("the form's title", () => {
  it("names the event", () => {
    expect(documentOf(render()).querySelector("title").textContent).toBe("Registration - Northwind Partner Summit 2027");
  });
});
