import { REGISTRANT_EMAIL_MAX, REGISTRANT_NAME_MAX, REGISTRANT_TEXT_MAX, normalizeRegistrantText, registrantRawLimit } from "@admitto/tickets";
import { describe, expect, it } from "vitest";
import { botChallengeCData } from "../../src/registration/bot-challenge.js";
import { renderRegistrationClosedPage, renderRegistrationFormPage } from "../../src/registration/form-page.js";
import { REGISTRATION_FORM_SCRIPT } from "../../src/registration/form-script.js";
import { closedModel, documentOf, formModel, question, type Dom } from "../helpers/registration-form-fixtures.js";

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
      ".at-field .at-control > .at-select",
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

  it("gives the fields the mockup's icons: a mail, a building and a group, and a plus on an option row", () => {
    const icons = (selector: string) => [...doc.querySelectorAll(`${selector} use`)].map((el: Dom) => el.getAttribute("href"));
    expect(icons("[data-field=email] .at-inputgroup__icon")).toEqual(["#i-mail"]);
    expect(icons("[data-field=company] .at-inputgroup__icon")).toEqual(["#i-building"]);
    expect(icons("[data-field=department] .at-inputgroup__icon")).toEqual(["#i-users"]);
    expect(icons(".reg-opt > svg.ic")).toEqual(["#i-plus", "#i-plus"]);
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
    expect(keys).toEqual(["day", "parking", "diet", "plate", "badge"]);
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
  const controls = [...doc.querySelectorAll("form input:not([type=hidden]), form select")] as Dom[];

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

describe("the form's title", () => {
  it("names the event", () => {
    expect(documentOf(render()).querySelector("title").textContent).toBe("Registration - Northwind Partner Summit 2027");
  });
});
