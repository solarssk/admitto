import { describe, expect, it } from "vitest";
import type { FormQuestion } from "../../src/registration/form-model.js";
import { question, type Dom } from "../helpers/registration-form-fixtures.js";
import { bootPage, chooseOption, fillFixedFields, sendForm, sentBody, tickBox, until, type ScriptPage } from "../helpers/registration-script-page.js";

const DAYS = question({ key: "day", label: "Which days will you attend?", type: "select", required: true, options: ["Both days", "Day 1 only", "Day 2 only"] });
const CITIES = ["Amsterdam", "Berlin", "Copenhagen", "Dublin", "Edinburgh", "Frankfurt", "Geneva"];

/** The page with one choice as f-q0, and what it is drawn with. */
const boot = (choice: FormQuestion = DAYS) => bootPage([choice]);

const trigger = (page: ScriptPage, id = "f-q0"): Dom => page.doc.getElementById(`${id}-trigger`);
const panel = (page: ScriptPage, id = "f-q0"): Dom => page.doc.getElementById(`${id}-panel`);
const select = (page: ScriptPage, id = "f-q0"): Dom => page.doc.getElementById(id);
const rows = (page: ScriptPage, id = "f-q0"): Dom[] => [...panel(page, id).querySelectorAll(".searchable-select__option")];
const shownRows = (page: ScriptPage, id = "f-q0"): string[] =>
  rows(page, id)
    .filter((row) => !row.parentNode.hidden)
    .map((row) => row.textContent);
const rowOf = (page: ScriptPage, text: string, id = "f-q0"): Dom => rows(page, id).find((row) => row.textContent === text)!;
const words = (page: ScriptPage, id = "f-q0"): string => page.doc.getElementById(`${id}-text`).textContent;

function click(page: ScriptPage, el: Dom): void {
  el.dispatchEvent(new page.win.MouseEvent("click", { bubbles: true, cancelable: true }));
}

/** A key on `el`; the answer is false when a listener called preventDefault. */
function press(page: ScriptPage, el: Dom, key: string): boolean {
  return !el.dispatchEvent(new page.win.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

describe("a choice drawn as the product's searchable select", () => {
  it("shows a button with the words of the empty row while nothing is chosen, keeps the panel shut, and hides the real select", () => {
    const page = boot();
    expect(words(page)).toBe("Choose one");
    expect(page.doc.getElementById("f-q0-text").className).toBe("searchable-select__placeholder");
    expect(trigger(page).getAttribute("aria-expanded")).toBe("false");
    expect(panel(page).hidden).toBe(true);
    const real = select(page);
    expect(real.tagName).toBe("SELECT");
    expect(real.classList.contains("reg-sr")).toBe(true);
    expect(real.getAttribute("aria-hidden")).toBe("true");
    expect(real.getAttribute("tabindex")).toBe("-1");
    expect(real.hasAttribute("data-control")).toBe(true);
    expect(trigger(page).hasAttribute("data-control")).toBe(false);
  });

  it("has a row for the empty choice and one for each option, in the organiser's order", () => {
    expect(shownRows(boot())).toEqual(["Choose one", "Both days", "Day 1 only", "Day 2 only"]);
  });

  it("is labelled by its question and its answer, and the label points at the button, not at the hidden select", () => {
    const page = boot();
    const label = page.doc.getElementById("f-q0-label");
    expect(label.getAttribute("for")).toBe("f-q0-trigger");
    expect(trigger(page).getAttribute("aria-labelledby")).toBe("f-q0-label f-q0-text");
    expect(trigger(page).getAttribute("aria-describedby")).toBe("m-f-q0");
    expect(trigger(page).getAttribute("aria-controls")).toBe("f-q0-panel");
    expect(page.doc.querySelector('label[for="f-q0"]')).toBeNull();
  });

  it("opens on a press of the button and shuts on the next, and tells assistive technology", () => {
    const page = boot();
    click(page, trigger(page));
    expect(panel(page).hidden).toBe(false);
    expect(trigger(page).getAttribute("aria-expanded")).toBe("true");
    expect(trigger(page).classList.contains("searchable-select__trigger--open")).toBe(true);
    click(page, trigger(page));
    expect(panel(page).hidden).toBe(true);
    expect(trigger(page).getAttribute("aria-expanded")).toBe("false");
    expect(trigger(page).classList.contains("searchable-select__trigger--open")).toBe(false);
  });

  it("moves the focus into the panel when it opens: to the chosen row, or to the first", () => {
    const page = boot();
    click(page, trigger(page));
    expect(page.doc.activeElement).toBe(rowOf(page, "Choose one"));
    click(page, trigger(page));
    chooseOption(page, "f-q0", "Day 1 only");
    click(page, trigger(page));
    expect(page.doc.activeElement).toBe(rowOf(page, "Day 1 only"));
  });

  it("writes a pick into the real select, shows it on the button, shuts the panel, gives the focus back and tells the form", () => {
    const page = boot();
    let changes = 0;
    page.doc.getElementById("reg-form").addEventListener("change", () => (changes += 1));
    click(page, trigger(page));
    click(page, rowOf(page, "Day 1 only"));
    expect(select(page).value).toBe("Day 1 only");
    expect(words(page)).toBe("Day 1 only");
    expect(page.doc.getElementById("f-q0-text").className).toBe("searchable-select__label");
    expect(rowOf(page, "Day 1 only").getAttribute("aria-current")).toBe("true");
    expect(panel(page).hidden).toBe(true);
    expect(page.doc.activeElement).toBe(trigger(page));
    expect(changes).toBe(1);
  });

  it("takes the answer back with the empty row", () => {
    const page = boot();
    click(page, trigger(page));
    click(page, rowOf(page, "Day 2 only"));
    click(page, trigger(page));
    click(page, rowOf(page, "Choose one"));
    expect(select(page).value).toBe("");
    expect(words(page)).toBe("Choose one");
    expect(page.doc.getElementById("f-q0-text").className).toBe("searchable-select__placeholder");
    expect(rows(page).some((row) => row.hasAttribute("aria-current"))).toBe(false);
  });

  it("follows the real select: an answer a browser restored is on the button, and so is one set later", () => {
    const restored = bootPage([DAYS], { before: (doc) => (doc.getElementById("f-q0").value = "Both days") });
    expect(words(restored)).toBe("Both days");
    expect(rowOf(restored, "Both days").getAttribute("aria-current")).toBe("true");
    const page = boot();
    chooseOption(page, "f-q0", "Day 2 only");
    expect(words(page)).toBe("Day 2 only");
  });

  it("is sent as the option it is: the answer is the text of the row", async () => {
    const page = boot();
    fillFixedFields(page);
    click(page, trigger(page));
    click(page, rowOf(page, "Day 1 only"));
    sendForm(page);
    await until(() => expect(page.fetchMock).toHaveBeenCalledTimes(1));
    expect(sentBody(page).custom_data).toEqual({ day: "Day 1 only" });
  });

  it("shows the questions that wait for a pick, as the real select did", () => {
    const wait = question({ key: "hotel", label: "Hotel", type: "text", showWhen: { field: "day", value: "Both days" } });
    const page = bootPage([DAYS, wait]);
    const hotel = page.doc.querySelector('[data-custom="hotel"]');
    expect(hotel.hidden).toBe(true);
    click(page, trigger(page));
    click(page, rowOf(page, "Both days"));
    expect(hotel.hidden).toBe(false);
    click(page, trigger(page));
    click(page, rowOf(page, "Day 1 only"));
    expect(hotel.hidden).toBe(true);
  });

  it("is a list of Yes and No for a required Yes/No, and sends the word it keeps: true or false", async () => {
    const badge = question({ key: "badge", label: "Do you want a badge?", type: "boolean", required: true });
    const page = bootPage([badge]);
    expect(shownRows(page)).toEqual(["Choose one", "Yes", "No"]);
    fillFixedFields(page);
    click(page, trigger(page));
    click(page, rowOf(page, "No"));
    sendForm(page);
    await until(() => expect(page.fetchMock).toHaveBeenCalledTimes(1));
    expect(sentBody(page).custom_data).toEqual({ badge: "false" });
  });
});

describe("the keyboard and the pointer", () => {
  it("opens on an arrow, moves between the rows with the arrows, and does not go past the ends", () => {
    const page = boot();
    expect(press(page, trigger(page), "ArrowDown")).toBe(true);
    expect(panel(page).hidden).toBe(false);
    expect(page.doc.activeElement).toBe(rowOf(page, "Choose one"));
    press(page, rowOf(page, "Choose one"), "ArrowDown");
    expect(page.doc.activeElement).toBe(rowOf(page, "Both days"));
    press(page, rowOf(page, "Both days"), "ArrowUp");
    press(page, rowOf(page, "Choose one"), "ArrowUp");
    expect(page.doc.activeElement).toBe(rowOf(page, "Choose one"));
    for (let n = 0; n < 6; n += 1) press(page, page.doc.activeElement, "ArrowDown");
    expect(page.doc.activeElement).toBe(rowOf(page, "Day 2 only"));
  });

  it("shuts on Escape, gives the focus back to the button, and leaves the answer as it was", () => {
    const page = boot();
    click(page, trigger(page));
    expect(press(page, rowOf(page, "Choose one"), "Escape")).toBe(true);
    expect(panel(page).hidden).toBe(true);
    expect(page.doc.activeElement).toBe(trigger(page));
    expect(select(page).value).toBe("");
  });

  it("shuts when the focus leaves it for something else, and stays open while it moves inside", () => {
    const page = boot();
    click(page, trigger(page));
    const row = rowOf(page, "Both days");
    row.dispatchEvent(new page.win.FocusEvent("focusout", { bubbles: true, relatedTarget: rowOf(page, "Day 1 only") }));
    expect(panel(page).hidden).toBe(false);
    row.dispatchEvent(new page.win.FocusEvent("focusout", { bubbles: true, relatedTarget: page.doc.getElementById("f-last_name") }));
    expect(panel(page).hidden).toBe(true);
  });

  it("shuts when a press lands outside it, and not when it lands inside", () => {
    const page = boot();
    click(page, trigger(page));
    rowOf(page, "Both days").dispatchEvent(new page.win.Event("pointerdown", { bubbles: true }));
    expect(panel(page).hidden).toBe(false);
    page.doc.body.dispatchEvent(new page.win.Event("pointerdown", { bubbles: true }));
    expect(panel(page).hidden).toBe(true);
  });

  it("keeps the focus where it is while a row is pressed, so that the panel is there for the click", () => {
    const page = boot();
    click(page, trigger(page));
    const down = new page.win.MouseEvent("mousedown", { bubbles: true, cancelable: true });
    rowOf(page, "Both days").dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
  });

  it("does not open for a press on the button that the focus leaving it has just shut", () => {
    const page = boot();
    click(page, trigger(page));
    // A browser that does not focus a button on a press: the panel is shut by the focus leaving, and then the click comes.
    trigger(page).dispatchEvent(new page.win.MouseEvent("mousedown", { bubbles: true }));
    rowOf(page, "Choose one").dispatchEvent(new page.win.FocusEvent("focusout", { bubbles: true, relatedTarget: null }));
    expect(panel(page).hidden).toBe(true);
    click(page, trigger(page));
    expect(panel(page).hidden).toBe(true);
  });
});

describe("a choice with a search box", () => {
  const city = () => question({ key: "city", label: "City", type: "select", options: CITIES });

  it("has none up to six options, and one past six", () => {
    expect(boot().doc.querySelector("[data-picker-search]")).toBeNull();
    const six = bootPage([question({ key: "city", label: "City", type: "select", options: CITIES.slice(0, 6) })]);
    expect(six.doc.querySelector("[data-picker-search]")).toBeNull();
    expect(bootPage([city()]).doc.querySelector("[data-picker-search]")).not.toBeNull();
  });

  it("puts the focus in the box when it opens, and narrows the rows as the guest types, leaving out the empty row", () => {
    const page = bootPage([city()]);
    const search = page.doc.querySelector("[data-picker-search]");
    click(page, trigger(page));
    expect(page.doc.activeElement).toBe(search);
    search.value = "ber";
    search.dispatchEvent(new page.win.Event("input", { bubbles: true }));
    expect(shownRows(page)).toEqual(["Berlin"]);
    search.value = "E";
    search.dispatchEvent(new page.win.Event("input", { bubbles: true }));
    expect(shownRows(page)).toEqual(["Amsterdam", "Berlin", "Copenhagen", "Dublin", "Edinburgh", "Frankfurt", "Geneva"].filter((name) => name.toLowerCase().includes("e")));
  });

  it("says so when nothing matches, and shows every row again on the next opening", () => {
    const page = bootPage([city()]);
    const search = page.doc.querySelector("[data-picker-search]");
    const none = page.doc.querySelector("[data-picker-empty]");
    click(page, trigger(page));
    search.value = "zzz";
    search.dispatchEvent(new page.win.Event("input", { bubbles: true }));
    expect(shownRows(page)).toEqual([]);
    expect(none.hidden).toBe(false);
    expect(none.textContent).toBe("No options found");
    click(page, trigger(page));
    click(page, trigger(page));
    expect(search.value).toBe("");
    expect(none.hidden).toBe(true);
    expect(shownRows(page)).toEqual(["Choose one", ...CITIES]);
  });

  it("picks the first row that is left on Enter in the box, and does not send the form", () => {
    const page = bootPage([city()]);
    fillFixedFields(page);
    const search = page.doc.querySelector("[data-picker-search]");
    click(page, trigger(page));
    search.value = "d";
    search.dispatchEvent(new page.win.Event("input", { bubbles: true }));
    expect(press(page, search, "Enter")).toBe(true);
    expect(select(page).value).toBe("Amsterdam");
    expect(page.fetchMock).not.toHaveBeenCalled();
  });

  it("goes from the box to the rows and back with the arrows", () => {
    const page = bootPage([city()]);
    const search = page.doc.querySelector("[data-picker-search]");
    click(page, trigger(page));
    press(page, search, "ArrowDown");
    expect(page.doc.activeElement).toBe(rowOf(page, "Choose one"));
    press(page, page.doc.activeElement, "ArrowUp");
    expect(page.doc.activeElement).toBe(search);
  });
});

describe("a choice that is missing, hidden or hostile", () => {
  it("marks its button, says it in the message the button is described by, and takes the focus, when it is required and not answered", () => {
    const page = boot();
    fillFixedFields(page);
    sendForm(page);
    expect(page.fetchMock).not.toHaveBeenCalled();
    expect(trigger(page).classList.contains("searchable-select__trigger--invalid")).toBe(true);
    expect(trigger(page).hasAttribute("aria-invalid")).toBe(false);
    expect(select(page).classList.contains("at-select--invalid")).toBe(true);
    expect(page.doc.activeElement).toBe(trigger(page));
    expect(page.doc.getElementById("m-f-q0").querySelector("[data-msg-text]").textContent).toBe("Choose one option.");
    click(page, trigger(page));
    click(page, rowOf(page, "Both days"));
    expect(trigger(page).classList.contains("searchable-select__trigger--invalid")).toBe(false);
  });

  it("is disabled while its condition keeps it hidden, shuts when it goes again, and works again when it is asked", () => {
    const parking = question({ key: "parking", label: "Parking", type: "boolean" });
    const meal = question({ key: "meal", label: "Meal", type: "select", options: ["Standard", "Vegan"], showWhen: { field: "parking", value: true } });
    const page = bootPage([parking, meal]);
    expect(trigger(page, "f-q1").disabled).toBe(true);
    expect(select(page, "f-q1").disabled).toBe(true);
    tickBox(page, "f-q0", true);
    expect(trigger(page, "f-q1").disabled).toBe(false);
    click(page, trigger(page, "f-q1"));
    expect(panel(page, "f-q1").hidden).toBe(false);
    tickBox(page, "f-q0", false);
    expect(panel(page, "f-q1").hidden).toBe(true);
    expect(trigger(page, "f-q1").disabled).toBe(true);
    expect(trigger(page, "f-q1").getAttribute("aria-expanded")).toBe("false");
  });

  it("does not open while it is disabled", () => {
    const parking = question({ key: "parking", label: "Parking", type: "boolean" });
    const meal = question({ key: "meal", label: "Meal", type: "select", options: ["Standard"], showWhen: { field: "parking", value: true } });
    const page = bootPage([parking, meal]);
    click(page, trigger(page, "f-q1"));
    expect(panel(page, "f-q1").hidden).toBe(true);
  });

  it("keeps the text of an option as text: a row is its words and a data-value, and nothing of it runs", () => {
    const payload = '"><img src=x onerror=alert(1)>';
    const page = bootPage([question({ key: "day", label: "Day", type: "select", options: [payload] })]);
    expect(panel(page).querySelectorAll("img")).toHaveLength(0);
    const row = rowOf(page, payload);
    expect(row.getAttribute("data-value")).toBe(payload);
    click(page, trigger(page));
    click(page, row);
    expect(select(page).value).toBe(payload);
    expect(words(page)).toBe(payload);
  });
});
