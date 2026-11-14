import { describe, expect, it } from "vitest";
import { question, type Dom } from "../helpers/registration-form-fixtures.js";
import { bootPage, fillFixedFields, sendForm, sentBody, typeInto, until, type ScriptPage } from "../helpers/registration-script-page.js";

const DIET = ["No pork", "Vegetarian", "Vegan", "Pescatarian", "Gluten free", "Nut allergy"];

/** The page with one text question that has suggestions, as f-q0. */
function boot(suggestions: readonly string[] = DIET) {
  return bootPage([question({ key: "diet", label: "What should we know?", type: "text", suggestions })]);
}

const input = (page: ScriptPage): Dom => page.doc.getElementById("f-q0");
const panel = (page: ScriptPage): Dom => page.doc.querySelector("[data-combo-panel]");
const listed = (page: ScriptPage): string[] =>
  [...page.doc.querySelectorAll('[role="option"]')].filter((row: Dom) => !row.hidden).map((row: Dom) => row.textContent);
const active = (page: ScriptPage): string | null =>
  [...page.doc.querySelectorAll('[role="option"]')].find((row: Dom) => row.getAttribute("aria-selected") === "true")?.textContent ?? null;

function focusIt(page: ScriptPage) {
  input(page).focus();
}

function press(page: ScriptPage, key: string, init: Record<string, unknown> = {}): boolean {
  // `dispatchEvent` answers false when a listener called preventDefault.
  return !input(page).dispatchEvent(new page.win.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
}

/** Types `text` into the box the way a guest does: the value changes and an input event follows. */
function typeText(page: ScriptPage, text: string) {
  focusIt(page);
  typeInto(page, "f-q0", text);
}

const rowOf = (page: ScriptPage, text: string): Dom =>
  [...page.doc.querySelectorAll('[role="option"]')].find((row: Dom) => row.getAttribute("data-value") === text);

function click(page: ScriptPage, row: Dom) {
  row.dispatchEvent(new page.win.MouseEvent("click", { bubbles: true, cancelable: true }));
}

describe("opening the list", () => {
  it("is closed until the guest comes to the box, and says so to assistive technology", () => {
    const page = boot();
    expect(panel(page).hidden).toBe(true);
    expect(input(page).getAttribute("aria-expanded")).toBe("false");
    expect(input(page).getAttribute("role")).toBe("combobox");
    expect(input(page).getAttribute("aria-autocomplete")).toBe("list");
    expect(input(page).getAttribute("aria-controls")).toBe("f-q0-list");
    expect(page.doc.getElementById("f-q0-list").getAttribute("role")).toBe("listbox");
    expect(input(page).hasAttribute("aria-activedescendant")).toBe(false);
  });

  it("lists every suggestion, in the organiser's order, when the guest comes to an empty box", () => {
    const page = boot();
    focusIt(page);
    expect(panel(page).hidden).toBe(false);
    expect(input(page).getAttribute("aria-expanded")).toBe("true");
    expect(listed(page)).toEqual(DIET);
  });

  it("lists them for a box that already holds text, filtered by it", () => {
    const page = boot();
    input(page).value = "nut";
    focusIt(page);
    expect(listed(page)).toEqual(["Nut allergy", "Use “nut” as written"]);
  });

  it("opens again on a click when the guest closed it and the box still has the focus", () => {
    const page = boot();
    focusIt(page);
    press(page, "Escape");
    expect(panel(page).hidden).toBe(true);
    input(page).dispatchEvent(new page.win.MouseEvent("click", { bubbles: true }));
    expect(panel(page).hidden).toBe(false);
  });

  it("closes when the box loses the focus, a Tab to the next field included", () => {
    const page = boot();
    focusIt(page);
    input(page).blur();
    expect(panel(page).hidden).toBe(true);
    expect(input(page).getAttribute("aria-expanded")).toBe("false");
  });
});

describe("filtering", () => {
  it("keeps the suggestions that contain what was typed, whatever the case, in their own order", () => {
    const page = boot();
    typeText(page, "VEG");
    expect(listed(page).slice(0, -1)).toEqual(["Vegetarian", "Vegan"]);
    typeText(page, "an");
    expect(listed(page).slice(0, -1)).toEqual(["Vegetarian", "Vegan", "Pescatarian"]);
    typeText(page, "  allergy ");
    expect(listed(page).slice(0, -1)).toEqual(["Nut allergy"]);
  });

  it("marks what matches in bold, in the case of the suggestion, and leaves its text whole", () => {
    const page = boot();
    typeText(page, "veg");
    const row = rowOf(page, "Vegetarian");
    expect(row.querySelector("strong").textContent).toBe("Veg");
    expect(row.querySelector(".searchable-select__name").textContent).toBe("Vegetarian");
    expect(row.querySelectorAll("strong")).toHaveLength(1);
    typeText(page, "tarian");
    expect(row.querySelector("strong").textContent).toBe("tarian");
    typeText(page, "");
    expect(row.querySelector("strong")).toBeNull();
  });

  it("does not mark a letter whose lower case has another length, and still lists it", () => {
    const page = boot(["İzmir", "Izmir"]);
    typeText(page, "i");
    expect(listed(page).slice(0, -1)).toEqual(["İzmir", "Izmir"]);
    expect(rowOf(page, "İzmir").querySelector("strong")).toBeNull();
    expect(rowOf(page, "Izmir").querySelector("strong").textContent).toBe("I");
  });

  it("offers what was typed as it is, unless it is a suggestion already, in any case", () => {
    const page = boot();
    typeText(page, "veg");
    expect(listed(page).at(-1)).toBe("Use “veg” as written");
    expect(page.doc.querySelector("[data-combo-custom]").getAttribute("data-value")).toBe("veg");
    typeText(page, "VEGAN");
    expect(listed(page)).toEqual(["Vegan"]);
    typeText(page, " vegan  ");
    expect(listed(page)).toEqual(["Vegan"]);
    typeText(page, "");
    expect(page.doc.querySelector("[data-combo-custom]").hidden).toBe(true);
  });

  it("says so when nothing matches, and still offers the text", () => {
    const page = boot();
    typeText(page, "zzz");
    expect(listed(page)).toEqual(["Use “zzz” as written"]);
    expect(page.doc.querySelector("[data-combo-empty]").hidden).toBe(false);
    expect(page.doc.querySelector("[data-combo-empty]").textContent).toBe("Not on the list. That is fine.");
    typeText(page, "veg");
    expect(page.doc.querySelector("[data-combo-empty]").hidden).toBe(true);
  });

  it("shows what was typed as text, never as markup", () => {
    const hostile = "<img src=x onerror=alert(1)>";
    const page = boot([hostile, "Vegan"]);
    typeText(page, "<img");
    expect(page.doc.querySelectorAll("#f-q0-list img")).toHaveLength(0);
    expect(rowOf(page, hostile).querySelector("strong").textContent).toBe("<img");
    expect(page.doc.querySelector("[data-combo-custom] .searchable-select__name").textContent).toBe("Use “<img” as written");
    expect(page.doc.querySelector("[data-combo-custom] .searchable-select__name *")).toBeNull();
  });
});

describe("picking", () => {
  it("writes the exact text of the suggestion into the box, closes the list and keeps the focus", () => {
    const page = boot();
    typeText(page, "veg");
    click(page, rowOf(page, "Vegetarian"));
    expect(input(page).value).toBe("Vegetarian");
    expect(panel(page).hidden).toBe(true);
    expect(page.doc.activeElement).toBe(input(page));
  });

  it("writes the text as it was typed when the guest takes the offer, without the spaces round it", () => {
    const page = boot();
    typeText(page, "  Kosher, no onion ");
    click(page, page.doc.querySelector("[data-combo-custom]"));
    expect(input(page).value).toBe("Kosher, no onion");
    expect(panel(page).hidden).toBe(true);
  });

  it("clears the error of the box, as any edit does", () => {
    const page = bootPage([question({ key: "diet", label: "Diet", type: "text", required: true, suggestions: DIET })]);
    sendForm(page);
    expect(input(page).getAttribute("aria-invalid")).toBe("true");
    focusIt(page);
    click(page, rowOf(page, "Vegan"));
    expect(input(page).hasAttribute("aria-invalid")).toBe(false);
    expect(page.doc.querySelector('[data-custom="diet"]').classList.contains("has-error")).toBe(false);
  });

  it("is not a click on the text of the list: only a row picks", () => {
    const page = boot();
    focusIt(page);
    input(page).value = "keep";
    page.doc.getElementById("f-q0-list").dispatchEvent(new page.win.MouseEvent("click", { bubbles: true }));
    expect(input(page).value).toBe("keep");
  });

  it("keeps the focus in the box while a row is pressed, so that the list is still there for the click", () => {
    const page = boot();
    focusIt(page);
    const notPrevented = rowOf(page, "Vegan").dispatchEvent(new page.win.MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(notPrevented).toBe(false);
  });

  it("opens and filters again when the guest types after a pick", () => {
    const page = boot();
    focusIt(page);
    click(page, rowOf(page, "Vegan"));
    typeInto(page, "f-q0", "Veg");
    expect(panel(page).hidden).toBe(false);
    expect(listed(page).slice(0, -1)).toEqual(["Vegetarian", "Vegan"]);
  });
});

describe("the keyboard", () => {
  it("opens the list with the arrow down and goes down it, one row at a time, to the end and no further", () => {
    const page = boot(["One", "Two"]);
    focusIt(page);
    press(page, "Escape");
    expect(press(page, "ArrowDown")).toBe(true);
    expect(panel(page).hidden).toBe(false);
    expect(active(page)).toBe("One");
    expect(input(page).getAttribute("aria-activedescendant")).toBe("f-q0-opt0");
    press(page, "ArrowDown");
    expect(active(page)).toBe("Two");
    press(page, "ArrowDown");
    expect(active(page)).toBe("Two");
    expect(page.doc.querySelectorAll('[role="option"][aria-selected="true"]')).toHaveLength(1);
  });

  it("goes down to the offer of what was typed, which is the last row", () => {
    const page = boot(["One", "Two"]);
    typeText(page, "o");
    press(page, "ArrowDown");
    press(page, "ArrowDown");
    expect(active(page)).toBe("Two");
    press(page, "ArrowDown");
    expect(active(page)).toBe("Use “o” as written");
    expect(input(page).getAttribute("aria-activedescendant")).toBe("f-q0-custom");
  });

  it("goes up from nothing to the last row, and up the list to the first and no further", () => {
    const page = boot(["One", "Two", "Three"]);
    focusIt(page);
    expect(press(page, "ArrowUp")).toBe(true);
    expect(active(page)).toBe("Three");
    press(page, "ArrowUp");
    press(page, "ArrowUp");
    expect(active(page)).toBe("One");
    press(page, "ArrowUp");
    expect(active(page)).toBe("One");
  });

  it("picks the row that is active with Enter, and does not send the form", () => {
    const page = boot();
    focusIt(page);
    press(page, "ArrowDown");
    press(page, "ArrowDown");
    expect(press(page, "Enter")).toBe(true);
    expect(input(page).value).toBe("Vegetarian");
    expect(panel(page).hidden).toBe(true);
    expect(input(page).hasAttribute("aria-activedescendant")).toBe(false);
  });

  it("leaves Enter to the form when no row is active, so that it sends as it does from any other box", () => {
    const page = boot();
    typeText(page, "veg");
    expect(press(page, "Enter")).toBe(false);
    expect(input(page).value).toBe("veg");
  });

  it("leaves Enter alone while the guest is still composing a character", () => {
    const page = boot();
    focusIt(page);
    press(page, "ArrowDown");
    expect(press(page, "Enter", { isComposing: true })).toBe(false);
    expect(input(page).value).toBe("");
  });

  it("closes the list with Escape, takes the active row off, and does nothing when it is closed", () => {
    const page = boot();
    focusIt(page);
    press(page, "ArrowDown");
    expect(press(page, "Escape")).toBe(true);
    expect(panel(page).hidden).toBe(true);
    expect(active(page)).toBeNull();
    expect(input(page).hasAttribute("aria-activedescendant")).toBe(false);
    expect(press(page, "Escape")).toBe(false);
  });

  it("does not hold a Tab, a Home or an End: the box keeps its own keys", () => {
    const page = boot();
    focusIt(page);
    for (const key of ["Tab", "Home", "End", "ArrowLeft", "ArrowRight", "a"]) expect(press(page, key), key).toBe(false);
  });

  it("starts at the first row again after the guest types, whatever was active", () => {
    const page = boot();
    focusIt(page);
    press(page, "ArrowDown");
    press(page, "ArrowDown");
    typeInto(page, "f-q0", "g");
    expect(active(page)).toBeNull();
    expect(input(page).hasAttribute("aria-activedescendant")).toBe(false);
  });
});

describe("what is sent", () => {
  async function sendWith(value: (page: ScriptPage) => void) {
    const page = bootPage([question({ key: "diet", label: "Diet", type: "text", suggestions: DIET })]);
    fillFixedFields(page);
    value(page);
    sendForm(page);
    await until(() => expect(page.fetchMock).toHaveBeenCalledTimes(1));
    return sentBody(page);
  }

  it("is the text of the suggestion that was picked, exactly", async () => {
    const body = await sendWith((page) => {
      typeText(page, "veg");
      click(page, rowOf(page, "Vegetarian"));
    });
    expect(body.custom_data).toEqual({ diet: "Vegetarian" });
  });

  it("is any other text as it was typed, trimmed like every answer: a list never limits", async () => {
    const body = await sendWith((page) => typeText(page, "  Kosher, but no onion or garlic  "));
    expect(body.custom_data).toEqual({ diet: "Kosher, but no onion or garlic" });
  });

  it("is a suggestion's own case, not the case that was typed", async () => {
    const body = await sendWith((page) => {
      typeText(page, "VEGAN");
      press(page, "ArrowDown");
      press(page, "Enter");
    });
    expect(body.custom_data).toEqual({ diet: "Vegan" });
  });

  it("is nothing for an empty box", async () => {
    const body = await sendWith(() => undefined);
    expect(body.custom_data).toBeUndefined();
  });
});

describe("two lists on one page", () => {
  it("work apart: each has its own panel, rows and ids", () => {
    const page = bootPage([
      question({ key: "a", label: "A", type: "text", suggestions: ["Alpha", "Beta"] }),
      question({ key: "b", label: "B", type: "text", suggestions: ["Gamma"] }),
    ]);
    page.doc.getElementById("f-q0").focus();
    const panels = page.doc.querySelectorAll("[data-combo-panel]");
    expect([panels[0].hidden, panels[1].hidden]).toEqual([false, true]);
    click(page, page.doc.querySelector('#f-q0-list [data-value="Beta"]'));
    expect(page.doc.getElementById("f-q0").value).toBe("Beta");
    expect(page.doc.getElementById("f-q1").value).toBe("");
    page.doc.getElementById("f-q1").focus();
    expect([panels[0].hidden, panels[1].hidden]).toEqual([true, false]);
  });
});
