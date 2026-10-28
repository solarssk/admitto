import { describe, expect, it } from "vitest";
import type { GuestFormIcon } from "@admitto/shared";
import { registrantRawLimit } from "@admitto/tickets";
import { renderRegistrationFormPage } from "../../src/registration/form-page.js";
import { documentOf, formModel, question, type Dom } from "../helpers/registration-form-fixtures.js";

const NONCE = "bm9uY2U=";

/** The form page of an event that takes a companion, with these questions about the companion (and the guest's own). */
function pageOf(companionQuestions = [question({ key: "badge", label: "Badge name", type: "text", required: true })], overrides = {}) {
  const model = formModel({ companion: { max: 1, questions: companionQuestions }, ...overrides });
  return documentOf(renderRegistrationFormPage(model, { nonce: NONCE }));
}

const panelOf = (doc: Dom): Dom => doc.getElementById("f-companion-panel");

describe("the form page of an event that takes no companion", () => {
  it("has no row, no panel and no word of a companion: it is the page it was", () => {
    const html = renderRegistrationFormPage(formModel(), { nonce: NONCE });
    const doc = documentOf(html);
    expect(doc.querySelector("[data-companion-toggle], [data-companion-panel], [data-field='companions'], #f-companion")).toBeNull();
    expect(html).not.toContain("bringing a guest");
    expect(html).not.toContain("Your guest");
  });
});

describe("the form page of an event that takes a companion", () => {
  it("draws the row after the guest's own questions and before the agreement, in a section of its own", () => {
    const doc = pageOf();
    const sections = [...doc.querySelectorAll(".reg-section")] as Dom[];
    const labels = sections.map((section) => section.querySelector(".reg-section__label").textContent);
    expect(labels).toEqual(["Additional details", "Your guest", "Before you send"]);
    expect(sections[1].querySelector("#f-companion")).not.toBeNull();
  });

  it("draws the section even when the guest has no question of their own", () => {
    const doc = pageOf(undefined, { questions: [] });
    const labels = [...doc.querySelectorAll(".reg-section__label")].map((el: Dom) => el.textContent);
    expect(labels).toEqual(["Your guest", "Before you send"]);
  });

  it("makes the row a tick box that names the panel it opens, with a label, an icon and one error slot of its own", () => {
    const doc = pageOf();
    const box = doc.getElementById("f-companion");
    expect(box.getAttribute("type")).toBe("checkbox");
    expect(box.getAttribute("aria-controls")).toBe("f-companion-panel");
    expect(box.getAttribute("aria-describedby")).toBe("m-f-companion");
    expect(box.hasAttribute("data-companion-toggle")).toBe(true);
    const row = box.closest("label");
    expect(row.textContent).toContain("I am bringing a guest");
    expect(row.textContent).toContain("You can bring one guest.");
    expect([...row.querySelectorAll("use")].map((use: Dom) => use.getAttribute("href"))).toEqual(["#i-tick", "#i-user-plus"]);
    expect(box.checked).toBe(false);
    // The row is a field of the form, so a refusal of the number of companions has a place to show.
    const wrapper = box.closest("[data-field]");
    expect(wrapper.getAttribute("data-field")).toBe("companions");
    expect(wrapper.querySelector("#m-f-companion[data-slot]")).not.toBeNull();
    expect(doc.getElementById("f-companion-panel")).not.toBeNull();
  });

  it("starts the panel closed, with every field in it hidden, disabled and not required", () => {
    const doc = pageOf([
      question({ key: "badge", label: "Badge name", type: "text", required: true }),
      question({ key: "diet", label: "Diet", type: "select", options: ["Vegan", "None"], required: true }),
      question({ key: "car", label: "Needs parking", type: "boolean" }),
      question({ key: "needs_ok", label: "Needs a ramp", type: "boolean", required: true }),
      question({ key: "notes", label: "Notes", type: "long_text", required: true }),
      question({ key: "when", label: "When", type: "datetime", required: true }),
      question({ key: "phone", label: "Phone", type: "phone", required: true }),
    ]);
    const panel = panelOf(doc);
    expect(panel.hidden).toBe(true);
    const boxes = [...panel.querySelectorAll("[data-field]")] as Dom[];
    expect(boxes.length).toBe(8);
    for (const box of boxes) {
      expect(box.hidden, box.getAttribute("data-field")).toBe(true);
      const control = box.querySelector("[data-control]");
      expect(control.disabled, box.getAttribute("data-field")).toBe(true);
      expect(control.hasAttribute("required"), box.getAttribute("data-field")).toBe(false);
    }
    // A picker's button is a control too, and it is as shut.
    for (const trigger of panel.querySelectorAll("[data-picker-trigger]") as Iterable<Dom>) expect(trigger.disabled).toBe(true);
    // What each says about being required is for the script to apply once the field is asked.
    expect(boxes.filter((box) => box.hasAttribute("data-required")).length).toBe(7);
  });

  it("asks for the name in one box, 'Full name', required once asked, as long as the schema takes", () => {
    const doc = pageOf();
    const box = doc.querySelector("[data-field='companion_name']");
    expect(box.getAttribute("data-kind")).toBe("name");
    expect(box.hasAttribute("data-required")).toBe(true);
    expect(box.getAttribute("data-message")).toBe("Enter your guest's full name.");
    const input = box.querySelector("input");
    expect(input.id).toBe("f-companion_name");
    expect(input.getAttribute("maxlength")).toBe(String(registrantRawLimit(100)));
    expect(input.getAttribute("autocomplete")).toBe("off");
    expect(box.querySelector("label").getAttribute("for")).toBe("f-companion_name");
    expect(box.querySelector("label").textContent).toContain("Full name");
    expect(box.querySelector("label .reg-req")).not.toBeNull();
    expect(panelOf(doc).contains(box)).toBe(true);
    // One box for the name: not two, as there are for the guest.
    expect(panelOf(doc).querySelectorAll("[data-kind='name']").length).toBe(1);
  });

  it("draws the questions about the companion in the panel, in their order, under ids and names of error that are theirs", () => {
    const doc = pageOf([
      question({ key: "badge", label: "Badge name", type: "text" }),
      question({ key: "diet", label: "Diet", type: "select", options: ["Vegan"] }),
    ]);
    const panel = panelOf(doc);
    expect([...panel.querySelectorAll("[data-custom]")].map((box: Dom) => [box.getAttribute("data-custom"), box.getAttribute("data-field")])).toEqual([
      ["badge", "companion_badge"],
      ["diet", "companion_diet"],
    ]);
    expect(doc.getElementById("f-c0")).not.toBeNull();
    expect(doc.getElementById("f-c1")).not.toBeNull();
    expect(doc.getElementById("f-c0").closest("[data-field]").querySelector("label").textContent).toBe("Badge name");
  });

  it("keeps the guest's questions and the companion's apart when they have one key, and every id once", () => {
    const doc = pageOf([question({ key: "size", label: "Shirt size of the guest", type: "select", options: ["S", "M"] })], {
      questions: [question({ key: "size", label: "Your shirt size", type: "select", options: ["S", "M"] })],
    });
    const guest = [...doc.querySelectorAll("[data-custom='size']")] as Dom[];
    expect(guest.map((box) => box.getAttribute("data-field"))).toEqual(["custom_data.size", "companion_size"]);
    expect(panelOf(doc).contains(guest[0])).toBe(false);
    expect(panelOf(doc).contains(guest[1])).toBe(true);
    const ids = [...doc.querySelectorAll("[id]")].map((el: Dom) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const reference of doc.querySelectorAll("[aria-controls], [aria-describedby], label[for]") as Iterable<Dom>) {
      const names = (reference.getAttribute("aria-controls") ?? reference.getAttribute("aria-describedby") ?? reference.getAttribute("for") ?? "").split(" ");
      for (const name of names) expect(doc.getElementById(name), `${reference.tagName} refers to #${name}`).not.toBeNull();
    }
  });

  it("holds the panel of the questions that wait for an answer about the companion inside its own panel, shut", () => {
    const doc = pageOf([
      question({ key: "car", label: "Needs parking", type: "boolean" }),
      question({ key: "plate", label: "Plate", type: "text", showWhen: { field: "car", value: true } }),
    ]);
    const plate = panelOf(doc).querySelector("[data-custom='plate']");
    expect(plate.getAttribute("data-show-when-field")).toBe("car");
    expect(plate.getAttribute("data-show-when-value")).toBe("true");
    expect(plate.hidden).toBe(true);
    const reveal = plate.closest("[data-reveal]");
    expect(reveal.id).toBe("f-c0-reveal");
    expect(reveal.hidden).toBe(true);
    expect(panelOf(doc).contains(reveal)).toBe(true);
    expect(doc.getElementById("f-c0").getAttribute("aria-controls")).toBe("f-c0-reveal");
  });

  it("does not change the guest's part of the form", () => {
    const withCompanion = documentOf(renderRegistrationFormPage(formModel({ companion: { max: 1, questions: [question({ key: "badge", label: "Badge", type: "text" })] } }), { nonce: NONCE }));
    const without = documentOf(renderRegistrationFormPage(formModel(), { nonce: NONCE }));
    const guestPart = (doc: Dom) => [...doc.querySelectorAll(".reg-form > *")].filter((el: Dom) => !el.textContent.includes("Your guest")).map((el: Dom) => el.outerHTML);
    expect(guestPart(withCompanion)).toEqual(guestPart(without));
  });

  it("sits inside the form, so that it is sent with it and hidden with it behind the password of an event that has one", () => {
    const doc = pageOf(undefined, { needsPassword: true });
    const form = doc.getElementById("reg-form");
    expect(form.contains(doc.getElementById("f-companion"))).toBe(true);
    expect(form.hasAttribute("data-after-password")).toBe(true);
  });

  it("holds nothing of the companion's in the page of a guest: no name, no answer, no address", () => {
    const html = renderRegistrationFormPage(formModel({ companion: { max: 1, questions: [] } }), { nonce: NONCE });
    for (const control of documentOf(html).querySelectorAll("#f-companion_name, #f-companion") as Iterable<Dom>) {
      expect(control.hasAttribute("value")).toBe(false);
    }
  });
});

/** What an organiser could put into the label, the note, the choices and the key of a question about the companion. */
const PAYLOADS = [
  "<img src=x onerror=alert(1)>",
  '"><script>alert(1)</script>',
  "' onmouseover='alert(1)",
  '" autofocus onfocus="alert(1)',
  "</script><script>alert(1)</script>",
  "<svg onload=alert(1)><use href=#x></svg>",
  "javascript:alert(1)",
  "&lt;b&gt;escaped already&lt;/b&gt; &amp; &#60;",
];

describe.each(PAYLOADS)("organiser text %j in a question about the companion", (payload) => {
  const questions = [
    question({ key: "k_text", label: payload, type: "text", description: payload, suggestions: [payload, `${payload} 2`], icon: payload as GuestFormIcon }),
    question({ key: payload, label: `${payload} flag`, type: "boolean", description: payload, icon: payload as GuestFormIcon }),
    question({ key: "k_select", label: payload, type: "select", options: [payload, `${payload} 2`], required: true, description: payload }),
    question({ key: "k_wait", label: payload, type: "text", showWhen: { field: payload, value: true } }),
  ];
  const doc = pageOf(questions);

  it("puts no element, no attribute that runs and no script into the page", () => {
    for (const el of doc.querySelectorAll("*") as Iterable<Dom>) {
      for (const attribute of [...el.attributes] as Array<{ name: string }>) {
        expect(attribute.name.startsWith("on") || ["autofocus", "srcdoc"].includes(attribute.name), `${el.tagName}[${attribute.name}]`).toBe(false);
      }
    }
    expect(doc.querySelectorAll("script").length).toBe(2);
    expect(doc.querySelector("iframe, object, embed, base, meta[http-equiv]")).toBeNull();
  });

  it("prints the label and the note as text, whatever they hold", () => {
    const label = doc.querySelector("[data-field='companion_k_text'] label");
    expect(label.textContent).toBe(payload);
    const note = doc.querySelector("[data-field='companion_k_text'] .reg-slot__hint");
    expect(note.textContent).toBe(payload);
  });

  it("keeps the key of a question in the attribute it is written to, and the options as the text of their rows", () => {
    const flag = doc.querySelector(`[data-custom="${CSS_ESCAPE(payload)}"]`) ?? [...doc.querySelectorAll("[data-custom]")].find((el: Dom) => el.getAttribute("data-custom") === payload);
    expect(flag?.getAttribute("data-custom")).toBe(payload);
    const rows = [...doc.querySelectorAll("#f-c2-panel .searchable-select__name")].map((el: Dom) => el.textContent);
    expect(rows).toEqual(expect.arrayContaining([payload, `${payload} 2`]));
  });
});

/** An attribute value as a selector would need it: a double quote and a backslash are the two that end or bend the string. */
function CSS_ESCAPE(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}
