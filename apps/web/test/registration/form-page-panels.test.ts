import { GUEST_FORM_ICONS } from "@admitto/shared";
import { REGISTRANT_TEXT_MAX, registrantRawLimit } from "@admitto/tickets";
import { describe, expect, it } from "vitest";
import { renderQuestions } from "../../src/registration/form-fields.js";
import { renderRegistrationFormPage } from "../../src/registration/form-page.js";
import { documentOf, formModel, panelModel, question, type Dom } from "../helpers/registration-form-fixtures.js";

const NONCE = "bm9uY2UtdmFsdWU=";
const render = (model = panelModel()) => renderRegistrationFormPage(model, { nonce: NONCE });
const textOf = (el: { textContent: string | null } | null) => (el?.textContent ?? "").replaceAll(/\s+/g, " ").trim();
const hrefs = (root: Dom): string[] => [...root.querySelectorAll("use")].map((el: Dom) => el.getAttribute("href"));
const keysIn = (root: Dom): string[] => [...root.querySelectorAll("[data-custom]")].map((el: Dom) => el.getAttribute("data-custom"));

describe("an icon on a question", () => {
  const doc = documentOf(render());

  it("is drawn before the text of a Yes/No row, between the box and the words, as in the mockup", () => {
    const row = doc.querySelector('[data-custom="parking"]');
    expect([...row.children].map((el: Dom) => el.tagName.toLowerCase() + (el.getAttribute("class") ? `.${el.getAttribute("class")}` : ""))).toEqual([
      "input",
      "span.at-check__box",
      "svg.ic",
      "span.reg-opt__text",
    ]);
    expect(hrefs(row.querySelector("svg.ic"))).toEqual(["#i-parking"]);
    expect(row.classList.contains("reg-opt--bare")).toBe(false);
  });

  it("is drawn inside the box of a one-line field, the way the fixed fields have theirs", () => {
    expect(hrefs(doc.querySelector('[data-custom="plate"] .at-inputgroup__icon'))).toEqual(["#i-car"]);
    expect(hrefs(doc.querySelector('[data-custom="hotel"] .at-inputgroup__icon'))).toEqual(["#i-bed"]);
    expect(hrefs(doc.querySelector('[data-custom="arrival"] .at-inputgroup__icon'))).toEqual(["#i-calendar"]);
    expect(doc.querySelector('[data-custom="plate"] .at-inputgroup > input.at-input')).not.toBeNull();
    expect(doc.querySelector('[data-custom="plate"] .at-control')).toBeNull();
  });

  it("is not drawn for a long text, a choice or a required Yes/No, which have no place for one", () => {
    const withIcons = documentOf(
      render(
        formModel({
          questions: [
            question({ key: "notes", label: "Notes", type: "long_text", icon: "mail" }),
            question({ key: "day", label: "Day", type: "select", options: ["A"], icon: "calendar" }),
            question({ key: "badge", label: "Badge", type: "boolean", required: true, icon: "users" }),
          ],
        }),
      ),
    );
    // What a choice draws is the arrow of its button, not the icon of its question.
    const drawn: Record<string, string[]> = { notes: ["#i-alert"], day: ["#i-chevron-down", "#i-alert"], badge: ["#i-chevron-down", "#i-alert"] };
    for (const key of ["notes", "day", "badge"]) {
      const field = withIcons.querySelector(`[data-custom="${key}"]`);
      expect(field.querySelector(".at-inputgroup__icon"), key).toBeNull();
      expect(hrefs(field), key).toEqual(drawn[key]);
    }
  });

  it("leaves a row without one as a plain box and its words, and a field without one as a plain box", () => {
    const row = doc.querySelector('[data-custom="shirt"]');
    expect(row.querySelector("svg.ic")).toBeNull();
    expect(row.classList.contains("reg-opt--bare")).toBe(true);
    const plain = documentOf(render(formModel({ questions: [question({ key: "a", label: "A", type: "text" })] })));
    expect(plain.querySelector('[data-custom="a"] .at-control > input.at-input')).not.toBeNull();
    expect(plain.querySelector('[data-custom="a"] .at-inputgroup')).toBeNull();
  });

  it("marks a run of rows in which some row has an icon, so that a bare row keeps its words in line, and no other run", () => {
    const runs = [...doc.querySelectorAll(".reg-opts")];
    expect(runs.map((run: Dom) => run.getAttribute("class"))).toEqual(["reg-opts reg-opts--icons"]);
    const bare = documentOf(
      render(formModel({ questions: [question({ key: "a", label: "A", type: "boolean" }), question({ key: "b", label: "B", type: "boolean" })] })),
    );
    expect(bare.querySelector(".reg-opts").getAttribute("class")).toBe("reg-opts");
  });

  it("is a symbol the page's sprite has, for every name an organiser can give, in a field and in a row", () => {
    const all = documentOf(
      render(
        formModel({
          questions: GUEST_FORM_ICONS.flatMap((name) => [
            question({ key: `row_${name}`, label: name, type: "boolean", icon: name }),
            question({ key: `field_${name}`, label: name, type: "text", icon: name }),
          ]),
        }),
      ),
    );
    const symbols = new Set([...all.querySelectorAll("symbol")].map((el: Dom) => `#${el.id}`));
    for (const name of GUEST_FORM_ICONS) {
      const row = hrefs(all.querySelector(`[data-custom="row_${name}"] svg.ic`));
      const input = hrefs(all.querySelector(`[data-custom="field_${name}"] .at-inputgroup__icon`));
      expect([row, input], name).toEqual([[`#i-${name}`], [`#i-${name}`]]);
      expect(symbols.has(`#i-${name}`), name).toBe(true);
    }
  });
});

describe("the questions that wait for another answer", () => {
  const doc = documentOf(render());
  const section = doc.querySelector(".reg-section");

  it("are not in the main run: the run holds the questions that are always asked, and each panel follows the question it waits for", () => {
    const main = [...section.children].filter((el: Dom) => !el.classList.contains("reg-section__label"));
    expect(main.map((el: Dom) => (el.classList.contains("reg-opts") ? "rows" : (el.getAttribute("data-custom") ?? el.id)))).toEqual([
      "day",
      "f-q0-reveal",
      "rows",
      "notes",
      "arrival",
    ]);
  });

  it("follow their row inside the same block of rows, which the panel does not break", () => {
    const rows = doc.querySelector(".reg-opts");
    expect([...rows.children].map((el: Dom) => el.getAttribute("data-custom") ?? el.getAttribute("id"))).toEqual([
      "parking",
      "f-q2-reveal",
      "diet",
      "f-q4-reveal",
      "access",
      "shirt",
    ]);
  });

  it("follow their field when the question they wait for is a choice", () => {
    const day = doc.querySelector('[data-custom="day"]');
    const panel = day.nextElementSibling;
    expect(panel.id).toBe("f-q0-reveal");
    expect(keysIn(panel)).toEqual(["hotel"]);
  });

  it("are in the panel in the organiser's order, which the model keeps even when they come before their row", () => {
    const model = formModel({
      questions: [
        question({ key: "second", label: "Second", type: "text", showWhen: { field: "row", value: true } }),
        question({ key: "row", label: "Row", type: "boolean" }),
        question({ key: "first", label: "First", type: "text", showWhen: { field: "row", value: true } }),
      ],
    });
    const page = documentOf(render(model));
    expect(keysIn(page.getElementById("f-q1-reveal"))).toEqual(["second", "first"]);
    expect(keysIn(page.querySelector(".reg-section")).slice(0, 3)).toEqual(["row", "second", "first"]);
    // Their controls are named by their place in the form, so the order of the ids is the order of the organiser.
    expect(["f-q0", "f-q2"].map((id) => page.getElementById(id).closest("[data-custom]").getAttribute("data-custom"))).toEqual(["second", "first"]);
  });

  it("wait hidden, as data: the condition is two attributes, the box is hidden and its control is disabled and not required", () => {
    const plate = doc.querySelector('[data-custom="plate"]');
    expect(plate.hasAttribute("hidden")).toBe(true);
    expect(plate.getAttribute("data-show-when-field")).toBe("parking");
    expect(plate.getAttribute("data-show-when-value")).toBe("true");
    const control = plate.querySelector("[data-control]");
    expect(control.hasAttribute("disabled")).toBe(true);
    expect(control.hasAttribute("required")).toBe(false);
    const hotel = doc.querySelector('[data-custom="hotel"]');
    expect(hotel.getAttribute("data-show-when-value")).toBe("Both days");
  });

  it("keep the mark of a required question and say it is required, though the browser is not asked to require it while it is hidden", () => {
    const model = formModel({
      questions: [
        question({ key: "row", label: "Row", type: "boolean" }),
        question({ key: "why", label: "Why?", type: "long_text", required: true, showWhen: { field: "row", value: true } }),
        question({ key: "when", label: "When?", type: "date", required: true, showWhen: { field: "row", value: true } }),
        question({ key: "pick", label: "Pick", type: "select", required: true, options: ["A"], showWhen: { field: "row", value: true } }),
        question({ key: "yn", label: "Yes or no", type: "boolean", required: true, showWhen: { field: "row", value: true } }),
        question({ key: "extra", label: "Extra", type: "boolean", showWhen: { field: "row", value: true } }),
      ],
    });
    const page = documentOf(render(model));
    for (const key of ["why", "when", "pick", "yn"]) {
      const box = page.querySelector(`[data-custom="${key}"]`);
      expect(box.hasAttribute("data-required"), key).toBe(true);
      expect(box.querySelector(".at-label .reg-req"), key).not.toBeNull();
      expect(box.querySelector("[data-control]").hasAttribute("required"), key).toBe(false);
      expect(box.querySelector("[data-control]").hasAttribute("disabled"), key).toBe(true);
      expect(box.hasAttribute("hidden"), key).toBe(true);
    }
    const extra = page.querySelector('[data-custom="extra"]');
    expect(extra.hasAttribute("hidden")).toBe(true);
    expect(extra.querySelector("input").hasAttribute("disabled")).toBe(true);
    expect(page.getElementById("f-q0-reveal").querySelector(".reg-opts")).not.toBeNull();
  });

  it("have a panel that is hidden and is named by the control of the question that shows it", () => {
    for (const [control, panel] of [["f-q2", "f-q2-reveal"], ["f-q4", "f-q4-reveal"], ["f-q0", "f-q0-reveal"]] as const) {
      expect(doc.getElementById(control).getAttribute("aria-controls"), control).toBe(panel);
      const element = doc.getElementById(panel);
      expect(element.hasAttribute("hidden"), panel).toBe(true);
      expect(element.hasAttribute("data-reveal"), panel).toBe(true);
      expect(element.getAttribute("class"), panel).toBe("reg-reveal");
    }
  });

  it("do not name a panel that is not there: a question nothing waits for has no aria-controls", () => {
    expect(doc.getElementById("f-q6").hasAttribute("aria-controls")).toBe(false);
    expect(doc.getElementById("f-q7").hasAttribute("aria-controls")).toBe(false);
    expect(doc.getElementById("f-q1").hasAttribute("aria-controls")).toBe(false);
  });

  it("are two questions under one row in one panel, and a panel under a required Yes/No as well", () => {
    const model = formModel({
      questions: [
        question({ key: "badge", label: "Badge", type: "boolean", required: true }),
        question({ key: "name", label: "Name", type: "text", showWhen: { field: "badge", value: true } }),
        question({ key: "size", label: "Size", type: "text", showWhen: { field: "badge", value: true } }),
      ],
    });
    const page = documentOf(render(model));
    expect(page.querySelectorAll(".reg-reveal")).toHaveLength(1);
    expect(keysIn(page.querySelector(".reg-reveal"))).toEqual(["name", "size"]);
    expect(page.querySelector('[data-custom="badge"]').nextElementSibling?.id).toBe("f-q0-reveal");
    expect(page.getElementById("f-q0").getAttribute("aria-controls")).toBe("f-q0-reveal");
  });

  it("are drawn once even when two questions have one key, which a form from the database never has", () => {
    const model = formModel({
      questions: [
        question({ key: "row", label: "First", type: "boolean" }),
        question({ key: "row", label: "Second", type: "boolean" }),
        question({ key: "plate", label: "Plate", type: "text", showWhen: { field: "row", value: true } }),
      ],
    });
    const page = documentOf(render(model));
    expect(page.querySelectorAll(".reg-reveal")).toHaveLength(1);
    expect(page.querySelectorAll('[data-custom="plate"]')).toHaveLength(1);
    expect(page.getElementById("f-q0").getAttribute("aria-controls")).toBe("f-q0-reveal");
    expect(page.getElementById("f-q1").hasAttribute("aria-controls")).toBe(false);
    const ids = [...page.querySelectorAll("[id]")].map((el: Dom) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("have ids that are all different, and keep the ids their place gives them", () => {
    const ids = [...doc.querySelectorAll("[id]")].map((el: Dom) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(["f-q0", "f-q1", "f-q2", "f-q3", "f-q4", "f-q5", "f-q6", "f-q7", "f-q8", "f-q9"].filter((id) => !ids.includes(id))).toEqual([]);
  });

  it("are not drawn at all when nothing can show them, and draw no section when nothing else is left", () => {
    const orphan = question({ key: "plate", label: "Plate", type: "text", required: true, showWhen: { field: "nothing", value: true } });
    const context = { timeZone: "UTC" };
    expect(renderQuestions([orphan], context)).toBe("");
    const withOthers = renderQuestions([question({ key: "a", label: "A", type: "text" }), orphan], context);
    expect(withOthers).not.toContain("plate");
    expect(withOthers).not.toContain("data-show-when-field");
    // A question that waits for a question that waits itself is not asked either, nor one that waits for a text.
    const chained = renderQuestions(
      [
        question({ key: "a", label: "A", type: "boolean" }),
        question({ key: "b", label: "B", type: "boolean", showWhen: { field: "a", value: true } }),
        question({ key: "c", label: "C", type: "text", showWhen: { field: "b", value: true } }),
        question({ key: "t", label: "T", type: "text" }),
        question({ key: "d", label: "D", type: "text", showWhen: { field: "t", value: true } }),
      ],
      context,
    );
    expect(keysIn(documentOf(`<body>${chained}</body>`))).toEqual(["a", "b", "t"]);
  });
});

describe("the list of suggestions under a text box", () => {
  const doc = documentOf(render());
  const field = doc.querySelector('[data-custom="diet_details"]');

  it("is an ARIA combobox on the box and a listbox for its rows", () => {
    const input = field.querySelector("input");
    expect(input.getAttribute("role")).toBe("combobox");
    expect(input.getAttribute("aria-autocomplete")).toBe("list");
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(input.getAttribute("aria-controls")).toBe("f-q5-list");
    expect(input.getAttribute("autocomplete")).toBe("off");
    expect(input.getAttribute("aria-describedby")).toBe("m-f-q5");
    const list = doc.getElementById("f-q5-list");
    expect(list.getAttribute("role")).toBe("listbox");
    expect(list.getAttribute("aria-label")).toBe("Suggestions");
  });

  it("is labelled by the question, as any box is, and is still a text box that takes any text", () => {
    const input = field.querySelector("input");
    expect(doc.querySelector('label[for="f-q5"]').textContent).toBe("What should we know?");
    expect(input.getAttribute("type")).toBe("text");
    expect(input.hasAttribute("pattern")).toBe(false);
    expect(input.getAttribute("maxlength")).toBe(String(registrantRawLimit(REGISTRANT_TEXT_MAX)));
    expect(input.closest(".combo")).not.toBeNull();
  });

  it("has a row for each suggestion, in the organiser's order, with the text twice: to read and to pick", () => {
    const rows = [...doc.querySelectorAll("#f-q5-list > li[data-value]")];
    expect(rows.map((el: Dom) => el.getAttribute("data-value"))).toEqual(["No pork", "Vegetarian", "Vegan"]);
    expect(rows.map(textOf)).toEqual(["No pork", "Vegetarian", "Vegan"]);
    expect(rows.map((el: Dom) => el.id)).toEqual(["f-q5-opt0", "f-q5-opt1", "f-q5-opt2"]);
    for (const row of rows) {
      expect(row.getAttribute("role")).toBe("option");
      expect(row.getAttribute("aria-selected")).toBe("false");
      expect(row.querySelector(".searchable-select__name")).not.toBeNull();
      expect(row.classList.contains("searchable-select__option")).toBe(true);
    }
  });

  it("has the offer of what was typed and the line for no match, both hidden until the script needs them", () => {
    const custom = doc.getElementById("f-q5-custom");
    expect(custom.getAttribute("role")).toBe("option");
    expect(custom.hasAttribute("hidden")).toBe(true);
    expect(custom.hasAttribute("data-value")).toBe(false);
    expect(hrefs(custom)).toEqual(["#i-plus"]);
    const empty = doc.querySelector("#f-q5-list [data-combo-empty]");
    expect(empty.hasAttribute("hidden")).toBe(true);
    expect(empty.getAttribute("role")).toBe("presentation");
    expect(textOf(empty)).toBe("Not on the list. That is fine.");
  });

  it("puts the panel beside the box, not inside it, because the box clips what is inside on a touch screen", () => {
    const combo = field.querySelector(".combo");
    const panel = combo.querySelector("[data-combo-panel]");
    expect(panel.hasAttribute("hidden")).toBe(true);
    expect(panel.parentElement).toBe(combo);
    expect(panel.closest(".at-inputgroup, .at-control")).toBeNull();
    expect(panel.getAttribute("class")).toBe("searchable-select__panel combo__panel");
    expect(combo.firstElementChild.className).toBe("at-inputgroup");
  });

  it("is on a text question only, and a question with no suggestions is the plain box it was", () => {
    const model = formModel({
      questions: [
        question({ key: "a", label: "A", type: "text" }),
        question({ key: "b", label: "B", type: "long_text", suggestions: ["No"] }),
        question({ key: "c", label: "C", type: "phone", suggestions: ["No"] }),
      ],
    });
    const page = documentOf(render(model));
    expect(page.querySelectorAll("[role=combobox], [role=listbox], .combo")).toHaveLength(0);
    expect(page.querySelector('[data-custom="a"] .at-control > input')).not.toBeNull();
  });

  it("is a field that waits with its question: hidden, disabled and not required until its row is ticked", () => {
    expect(field.hasAttribute("hidden")).toBe(true);
    expect(field.querySelector("input").hasAttribute("disabled")).toBe(true);
    expect(field.getAttribute("data-show-when-field")).toBe("diet");
  });

  it("carries the organiser's note and rules in the slot, like every other field", () => {
    expect(textOf(field.querySelector(".reg-slot__hint"))).toBe("Pick a suggestion, or write your own.");
  });
});

describe("the page with panels, icons and suggestions", () => {
  const html = render();
  const doc = documentOf(html);

  it("has no inline style, event handler or extra script: the data is markup and the one script is the page's own", () => {
    expect(doc.querySelectorAll("[style]")).toHaveLength(0);
    for (const el of doc.querySelectorAll("*") as Iterable<Dom>) {
      for (const attribute of [...el.attributes] as Array<{ name: string }>) expect(attribute.name.startsWith("on"), `${el.tagName} ${attribute.name}`).toBe(false);
    }
    expect(doc.querySelectorAll("script")).toHaveLength(2);
    expect(doc.querySelectorAll("script:not([src])")).toHaveLength(1);
  });

  it("is the same page for the same model, byte for byte, apart from the nonce", () => {
    const second = renderRegistrationFormPage(panelModel(), { nonce: "bm9uY2UtMg==" });
    expect(html.replaceAll(NONCE, "x")).toBe(second.replaceAll("bm9uY2UtMg==", "x"));
  });

  it("describes every field by its slot, which exists, for the questions in a panel too", () => {
    for (const el of doc.querySelectorAll("[data-custom] [data-control]") as Iterable<Dom>) {
      const described = el.getAttribute("aria-describedby");
      if (described) expect(doc.getElementById(described), described).not.toBeNull();
    }
    expect(doc.querySelectorAll('[data-custom="plate"] [data-slot]')).toHaveLength(1);
  });
});
