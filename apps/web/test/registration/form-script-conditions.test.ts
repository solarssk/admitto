import { isQuestionShown, type ShowWhen } from "@admitto/shared";
import { describe, expect, it } from "vitest";
import type { FormQuestion } from "../../src/registration/form-model.js";
import { question, type Dom } from "../helpers/registration-form-fixtures.js";
import {
  bootPage,
  boxOf,
  chooseOption,
  fillFixedFields,
  sendForm,
  sentBody,
  tickBox,
  typeInto,
  until,
  type ScriptPage,
} from "../helpers/registration-script-page.js";

// A question with a condition is shown and hidden by the page's own script, which compares two strings. The one
// definition of "is it asked" is `isQuestionShown` of `@admitto/shared`, which the server uses to decide what to read
// and what to require. These tests run the real script in a browser model for every case that matters and hold it to that
// function, so the two cannot drift apart: a guest is never shown a question the server ignores, nor hidden one it asks.

type ControllerKind = "checkbox" | "yesno" | "choice";

/** The way a guest can leave the controlling question, and the answer the form sends for it (none: no key at all). */
interface ControllerState {
  name: string;
  answer: string | undefined;
  apply: (page: ScriptPage) => void;
}

const CHOICES = ["Both days", "Day 1 only", "Day 2 only", "true", "True"];

function controllerQuestion(kind: ControllerKind, showWhen: ShowWhen | null = null): FormQuestion {
  if (kind === "checkbox") return question({ key: "c", label: "Controller", type: "boolean", showWhen });
  if (kind === "yesno") return question({ key: "c", label: "Controller", type: "boolean", required: true, showWhen });
  return question({ key: "c", label: "Controller", type: "select", options: CHOICES, showWhen });
}

/** The states of the controlling question's control, each with the answer that ends up in `custom_data` for it. */
function statesOf(kind: ControllerKind): ControllerState[] {
  if (kind === "checkbox") {
    return [
      { name: "unticked", answer: undefined, apply: (page) => tickBox(page, "f-q0", false) },
      { name: "ticked", answer: "true", apply: (page) => tickBox(page, "f-q0", true) },
    ];
  }
  const options = kind === "yesno" ? [["Yes", "true"], ["No", "false"]] : CHOICES.map((text) => [text, text]);
  return [
    { name: "Choose one", answer: undefined, apply: (page) => chooseOption(page, "f-q0", "") },
    ...options.map(([name, value]) => ({ name: name!, answer: value!, apply: (page: ScriptPage) => chooseOption(page, "f-q0", value!) })),
  ];
}

/** The conditions to try for a kind of controlling question: the right one in every spelling, and wrong ones. */
const CONDITIONS: Record<ControllerKind, ShowWhen["value"][]> = {
  checkbox: [true, "true", "false", "True", "yes"],
  yesno: [true, "true", "false", "True", "yes"],
  choice: [true, "true", "True", "Both days", "both days", "BOTH DAYS", "Day 1 only", "Day 1 only ", " Day 1 only", "Day 3"],
};

const dependent = (value: ShowWhen["value"], overrides: Partial<FormQuestion> = {}): FormQuestion =>
  question({ key: "d", label: "Dependent", type: "text", required: true, showWhen: { field: "c", value }, ...overrides });

/** The question of a parking row and the question that waits for it, the pair most tests below start from. */
const PARKING = question({ key: "parking", label: "Parking", type: "boolean" });
const plateWhen = (overrides: Partial<FormQuestion> = {}): FormQuestion =>
  dependent(true, { key: "plate", label: "Plate", showWhen: { field: "parking", value: true }, ...overrides });

/** What the page shows of the dependent question right now. */
function look(page: ScriptPage) {
  const box = boxOf(page, "d");
  const control = box.querySelector("[data-control]");
  return { shown: !box.hidden, enabled: !control.disabled, required: control.required, panelShown: !page.doc.getElementById("f-q0-reveal").hidden };
}

/** Whether `isQuestionShown` asks a question with this condition when the controlling question is in `state`. */
function askedBy(value: ShowWhen["value"], state: ControllerState): boolean {
  return isQuestionShown({ rules: { show_when: { field: "c", value } } }, state.answer === undefined ? {} : { c: state.answer });
}

describe.each<ControllerKind>(["checkbox", "yesno", "choice"])("a question that depends on a %s, held to isQuestionShown", (kind) => {
  it.each(CONDITIONS[kind].map((value) => [JSON.stringify(value), value] as const))("with the condition %s, in every state and every move between them", (_label, value) => {
    const page = bootPage([controllerQuestion(kind), dependent(value)]);
    const states = statesOf(kind);
    // Every state, then the same states again in the other order, so that a question that comes back is judged too.
    for (const state of [...states, ...[...states].reverse()]) {
      state.apply(page);
      const expected = askedBy(value, state);
      expect(look(page), state.name).toEqual({ shown: expected, enabled: expected, required: expected, panelShown: expected });
    }
  });

  it("starts with the question hidden, disabled and not required, before anything is answered", () => {
    const page = bootPage([controllerQuestion(kind), dependent(true)]);
    expect(look(page)).toEqual({ shown: false, enabled: false, required: false, panelShown: false });
  });
});

describe("the conditions that can be met are met, and only by the right answer", () => {
  const MET: Array<[ControllerKind, ShowWhen["value"], string]> = [
    ["checkbox", true, "ticked"],
    ["checkbox", "true", "ticked"],
    ["yesno", true, "Yes"],
    ["yesno", "false", "No"],
    ["choice", "Both days", "Both days"],
    ["choice", "Day 1 only", "Day 1 only"],
    ["choice", true, "true"],
    ["choice", "True", "True"],
  ];

  it.each(MET)("a %s asked for %j is shown when the answer is %s, and for no other answer", (kind, value, answer) => {
    const page = bootPage([controllerQuestion(kind), dependent(value)]);
    for (const state of statesOf(kind)) {
      state.apply(page);
      expect(look(page).shown, state.name).toBe(state.name === answer);
    }
  });

  it("is never shown for a condition that the wrong case, other spaces or no option can meet", () => {
    for (const value of ["both days", "BOTH DAYS", "Both days ", " Both days", "Day 3"]) {
      const page = bootPage([controllerQuestion("choice"), dependent(value)]);
      for (const state of statesOf("choice")) {
        state.apply(page);
        expect(look(page).shown, `${JSON.stringify(value)} with ${state.name}`).toBe(false);
      }
    }
  });
});

describe("each kind of question waits for its condition the same way", () => {
  const KINDS: Array<[string, FormQuestion]> = [
    ["a text", dependent(true, { type: "text" })],
    ["a text with suggestions", dependent(true, { type: "text", suggestions: ["No pork", "Vegan"] })],
    ["a long text", dependent(true, { type: "long_text" })],
    ["a date", dependent(true, { type: "date" })],
    ["a date and time", dependent(true, { type: "datetime" })],
    ["a phone number", dependent(true, { type: "phone" })],
    ["a choice", dependent(true, { type: "select", options: ["One", "Two"] })],
    ["a required Yes/No", dependent(true, { type: "boolean" })],
    ["an optional Yes/No", dependent(true, { type: "boolean", required: false })],
  ];

  it.each(KINDS)("%s is hidden and disabled, then asked, then hidden again", (_name, waiting) => {
    const page = bootPage([controllerQuestion("checkbox"), waiting]);
    const control = () => boxOf(page, "d").querySelector("[data-control]");
    expect([boxOf(page, "d").hidden, control().disabled, control().hasAttribute("required")]).toEqual([true, true, false]);
    tickBox(page, "f-q0", true);
    expect([boxOf(page, "d").hidden, control().disabled, control().hasAttribute("required")]).toEqual([false, false, waiting.required]);
    tickBox(page, "f-q0", false);
    expect([boxOf(page, "d").hidden, control().disabled, control().hasAttribute("required")]).toEqual([true, true, false]);
  });
});

describe("a question that is not asked", () => {
  const ready = () => {
    const page = bootPage([PARKING, plateWhen()]);
    fillFixedFields(page);
    return page;
  };

  it("does not stop the form, though it is required, and is not sent", async () => {
    const page = ready();
    sendForm(page);
    await until(() => expect(page.fetchMock).toHaveBeenCalledTimes(1));
    expect(page.doc.querySelectorAll(".has-error")).toHaveLength(0);
    expect(sentBody(page).custom_data).toBeUndefined();
  });

  it("is checked once it is asked: a required one left empty stops the form and takes the focus", () => {
    const page = ready();
    tickBox(page, "f-q0", true);
    sendForm(page);
    expect(page.fetchMock).not.toHaveBeenCalled();
    expect([...page.doc.querySelectorAll(".has-error")].map((el: Dom) => el.getAttribute("data-field"))).toEqual(["custom_data.plate"]);
    expect(page.doc.activeElement.id).toBe("f-q1");
    expect(page.doc.getElementById("reg-error-text").textContent).toBe("1 field needs your attention. It is marked in red.");
  });

  it("is sent when it is asked and answered, and not when the guest then takes the answer back, though its box still holds the text", async () => {
    const page = ready();
    tickBox(page, "f-q0", true);
    typeInto(page, "f-q1", "WA 12345");
    tickBox(page, "f-q0", false);
    expect(page.doc.getElementById("f-q1").value).toBe("WA 12345");
    sendForm(page);
    await until(() => expect(page.fetchMock).toHaveBeenCalledTimes(1));
    expect(sentBody(page).custom_data).toBeUndefined();
  });

  it("comes back with what the guest typed, and that is what is sent", async () => {
    const page = ready();
    tickBox(page, "f-q0", true);
    typeInto(page, "f-q1", "WA 12345");
    tickBox(page, "f-q0", false);
    tickBox(page, "f-q0", true);
    expect(page.doc.getElementById("f-q1").value).toBe("WA 12345");
    sendForm(page);
    await until(() => expect(page.fetchMock).toHaveBeenCalledTimes(1));
    expect(sentBody(page).custom_data).toEqual({ parking: "true", plate: "WA 12345" });
  });

  it("loses its error when it is hidden, so that nothing red is left behind a closed panel", () => {
    const page = ready();
    tickBox(page, "f-q0", true);
    sendForm(page);
    expect(page.doc.querySelectorAll(".has-error")).toHaveLength(1);
    tickBox(page, "f-q0", false);
    expect(page.doc.querySelectorAll(".has-error")).toHaveLength(0);
    expect(page.doc.getElementById("f-q1").hasAttribute("aria-invalid")).toBe(false);
  });

  it("takes its mark out of the count at the top when it is hidden, and the notice goes with the last mark", () => {
    const page = ready();
    tickBox(page, "f-q0", true);
    sendForm(page);
    expect(page.doc.getElementById("reg-error").hidden).toBe(false);
    tickBox(page, "f-q0", false);
    expect(page.doc.getElementById("reg-error").hidden).toBe(true);
  });

  it("lowers the count at the top when it is hidden and other fields are still marked", () => {
    const page = ready();
    typeInto(page, "f-last_name", "");
    tickBox(page, "f-q0", true);
    sendForm(page);
    expect(page.doc.getElementById("reg-error-text").textContent).toBe("2 fields need your attention. They are marked in red.");
    tickBox(page, "f-q0", false);
    expect(page.doc.getElementById("reg-error").hidden).toBe(false);
    expect(page.doc.getElementById("reg-error-text").textContent).toBe("1 field needs your attention. It is marked in red.");
  });

  it("leaves the count at the top as it was when a question without a mark is hidden, though the guest has fixed another field", () => {
    const page = ready();
    typeInto(page, "f-first_name", "");
    typeInto(page, "f-last_name", "");
    sendForm(page);
    typeInto(page, "f-first_name", "Anne");
    tickBox(page, "f-q0", true);
    tickBox(page, "f-q0", false);
    expect(page.doc.getElementById("reg-error").hidden).toBe(false);
    expect(page.doc.getElementById("reg-error-text").textContent).toBe("2 fields need your attention. They are marked in red.");
  });

  it("gets no error from the server while it is hidden, and the first error that is shown takes the focus", async () => {
    const page = ready();
    page.fetchMock.mockResolvedValueOnce({
      status: 422,
      json: async () => ({ errors: { "custom_data.plate": "Rejected.", last_name: "That name is not valid." } }),
    });
    sendForm(page);
    await until(() => expect(page.doc.querySelectorAll(".has-error")).toHaveLength(1));
    expect(boxOf(page, "plate").classList.contains("has-error")).toBe(false);
    expect(page.doc.activeElement.id).toBe("f-last_name");
    expect(page.doc.getElementById("reg-error-text").textContent).toBe("1 field needs your attention. It is marked in red.");
  });
});

describe("a panel", () => {
  const day = question({ key: "day", label: "Day", type: "select", options: ["Both days", "Day 1 only", "Day 2 only"] });
  const first = question({ key: "arrival", label: "Arrival", type: "text", showWhen: { field: "day", value: "Both days" } });
  const second = question({ key: "hotel", label: "Hotel", type: "text", showWhen: { field: "day", value: "Day 2 only" } });
  const third = question({ key: "meal", label: "Meal", type: "text", showWhen: { field: "day", value: "Both days" } });

  it("holds every question that depends on one answer and shows each for its own value", () => {
    const page = bootPage([day, first, second, third]);
    const panel = page.doc.getElementById("f-q0-reveal");
    expect([...panel.querySelectorAll("[data-custom]")].map((el: Dom) => el.getAttribute("data-custom"))).toEqual(["arrival", "hotel", "meal"]);
    const shown = () => ["arrival", "hotel", "meal"].filter((key) => !boxOf(page, key).hidden);
    expect([panel.hidden, shown()]).toEqual([true, []]);
    chooseOption(page, "f-q0", "Both days");
    expect([panel.hidden, shown()]).toEqual([false, ["arrival", "meal"]]);
    chooseOption(page, "f-q0", "Day 2 only");
    expect([panel.hidden, shown()]).toEqual([false, ["hotel"]]);
    chooseOption(page, "f-q0", "Day 1 only");
    expect([panel.hidden, shown()]).toEqual([true, []]);
  });

  it("is shown for a row of its own too: a Yes/No question under another one", () => {
    const row = question({ key: "extra", label: "Extra", type: "boolean", showWhen: { field: "parking", value: true } });
    const page = bootPage([question({ key: "parking", label: "Parking", type: "boolean" }), row]);
    const panel = page.doc.getElementById("f-q0-reveal");
    expect(panel.querySelector(".reg-opts")).not.toBeNull();
    expect(panel.hidden).toBe(true);
    tickBox(page, "f-q0", true);
    expect(panel.hidden).toBe(false);
    expect(boxOf(page, "extra").hidden).toBe(false);
    tickBox(page, "f-q0", false);
    expect(panel.hidden).toBe(true);
  });
});

describe("the state a browser restores into the form", () => {
  const questions = [PARKING, plateWhen({ required: false })];

  it("asks the question when the box was already ticked as the script starts (a reload, the way back)", () => {
    const page = bootPage(questions, { before: (doc) => (doc.getElementById("f-q0").checked = true) });
    expect(boxOf(page, "plate").hidden).toBe(false);
    expect(page.doc.getElementById("f-q1").disabled).toBe(false);
    expect(page.doc.getElementById("f-q0-reveal").hidden).toBe(false);
  });

  it("looks again when the page is shown again, which a browser does for the way back", () => {
    const page = bootPage(questions);
    page.doc.getElementById("f-q0").checked = true;
    expect(boxOf(page, "plate").hidden).toBe(true);
    page.win.dispatchEvent(new page.win.Event("pageshow"));
    expect(boxOf(page, "plate").hidden).toBe(false);
  });
});

describe("a page the server would not write is not trusted", () => {
  const questions = [PARKING, plateWhen({ required: false })];

  it("keeps a question hidden whose condition names a question that is not on the page", () => {
    const page = bootPage(questions, { edit: (html) => html.replace('data-show-when-field="parking"', 'data-show-when-field="nothing"') });
    tickBox(page, "f-q0", true);
    expect(boxOf(page, "plate").hidden).toBe(true);
  });

  it("keeps a question hidden whose controlling question has a condition of its own: there is no chain", () => {
    const chained = [
      question({ key: "a", label: "A", type: "boolean" }),
      question({ key: "b", label: "B", type: "boolean", showWhen: { field: "a", value: true } }),
      question({ key: "c", label: "C", type: "text", showWhen: { field: "a", value: true } }),
    ];
    // The page model leaves such a question out, so this page is written by hand: C names B, which is asked only when A is.
    const page = bootPage(chained, { edit: (html) => html.replace('data-custom="c" data-show-when-field="a"', 'data-custom="c" data-show-when-field="b"') });
    tickBox(page, "f-q0", true);
    expect([boxOf(page, "b").hidden, boxOf(page, "c").hidden]).toEqual([false, true]);
    // B is ticked, which is the answer C asks for, and C is still not asked: an answer to a question that has a condition of its own counts for nothing.
    tickBox(page, "f-q1", true);
    expect(boxOf(page, "c").hidden).toBe(true);
  });

  it("finds the controlling question even when its key is a name an object has", () => {
    const keyed = [
      question({ key: "constructor", label: "C", type: "boolean" }),
      question({ key: "__proto__", label: "P", type: "boolean" }),
      question({ key: "toString", label: "T", type: "text", showWhen: { field: "constructor", value: true } }),
      question({ key: "valueOf", label: "V", type: "text", showWhen: { field: "__proto__", value: true } }),
    ];
    const page = bootPage(keyed);
    tickBox(page, "f-q0", true);
    expect([boxOf(page, "toString").hidden, boxOf(page, "valueOf").hidden]).toEqual([false, true]);
    tickBox(page, "f-q1", true);
    expect([boxOf(page, "toString").hidden, boxOf(page, "valueOf").hidden]).toEqual([false, false]);
  });

  it("does not take a condition that names a name an object has, for a controlling question that is not there", () => {
    const page = bootPage([question({ key: "plate", label: "Plate", type: "text", showWhen: { field: "constructor", value: true } })]);
    expect(boxOf(page, "plate")).toBeNull();
    const handWritten = bootPage(questions, { edit: (html) => html.replace('data-show-when-field="parking"', 'data-show-when-field="constructor"') });
    tickBox(handWritten, "f-q0", true);
    expect(boxOf(handWritten, "plate").hidden).toBe(true);
  });
});
