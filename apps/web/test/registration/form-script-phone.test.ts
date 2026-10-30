import { describe, expect, it } from "vitest";
import { composePhoneE164, PHONE_COUNTRIES, splitPhoneForPicker } from "@admitto/shared/phone-countries";
import { sanitizeContactPhoneInput } from "@admitto/shared";
import type { RegistrationFormModel } from "../../src/registration/form-model.js";
import { question, type Dom } from "../helpers/registration-form-fixtures.js";
import { bootPage, boxOf, fillFixedFields, sendForm, sentBody, typeInto, until, type ScriptPage } from "../helpers/registration-script-page.js";

/** The page of an event with the styled boxes on and one phone question, `mobile`, as f-q0. */
function boot(model: Partial<RegistrationFormModel> = {}) {
  return bootPage([question({ key: "mobile", label: "Mobile phone", type: "phone" })], { model: { styledControls: true, ...model } });
}

const number = (page: ScriptPage): Dom => page.doc.getElementById("f-q0");
const trigger = (page: ScriptPage): Dom => page.doc.getElementById("f-q0-country");
const panel = (page: ScriptPage): Dom => page.doc.getElementById("f-q0-panel");
const search = (page: ScriptPage): Dom => page.doc.getElementById("f-q0-search");
const carrier = (page: ScriptPage): Dom => boxOf(page, "mobile").querySelector("input[type=hidden]");
const listed = (page: ScriptPage): string[] =>
  [...page.doc.querySelectorAll("#f-q0-list [role=option]")].filter((row: Dom) => !row.hidden).map((row: Dom) => row.getAttribute("data-iso"));
const activeRow = (page: ScriptPage): Dom | undefined =>
  [...page.doc.querySelectorAll("#f-q0-list [role=option]")].find((row: Dom) => row.getAttribute("aria-selected") === "true");
const rowOf = (page: ScriptPage, iso: string): Dom => page.doc.getElementById(`f-q0-opt-${iso}`);

function click(page: ScriptPage, el: Dom): void {
  el.dispatchEvent(new page.win.MouseEvent("click", { bubbles: true, cancelable: true }));
}

/** A key pressed in `el`; false when a listener cancelled it. */
function press(page: ScriptPage, el: Dom, key: string, init: Record<string, unknown> = {}): boolean {
  return el.dispatchEvent(new page.win.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
}

const open = (page: ScriptPage, id = "f-q0"): void => click(page, page.doc.getElementById(`${id}-country`));

/** Opens the list of the question `id`, types `text` in its search box, and picks the first row that is left, as a guest does. */
function chooseCountry(page: ScriptPage, text: string, id = "f-q0"): void {
  open(page, id);
  typeInto(page, `${id}-search`, text);
  press(page, page.doc.getElementById(`${id}-search`), "Enter");
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("the phone question of an event with the styled boxes on", { timeout: 30_000 }, () => {
  it("keeps the browser's own number box, with its id, its label and its note, and puts the country button before it", () => {
    const page = boot();
    const box = boxOf(page, "mobile");
    expect(number(page).getAttribute("type")).toBe("tel");
    expect(box.querySelector("label").getAttribute("for")).toBe("f-q0");
    expect(number(page).getAttribute("aria-describedby")).toBe("m-f-q0");
    expect(trigger(page).tagName).toBe("BUTTON");
    expect(trigger(page).getAttribute("type")).toBe("button");
    const line = box.querySelector(".reg-phone");
    expect(line.firstElementChild.contains(trigger(page))).toBe(true);
    expect(line.lastElementChild.contains(number(page))).toBe(true);
  });

  it("holds the answer in a hidden control that the form reads, and the number box is not that control", () => {
    const page = boot();
    expect(carrier(page).hasAttribute("data-control")).toBe(true);
    expect(number(page).hasAttribute("data-control")).toBe(false);
    expect(boxOf(page, "mobile").querySelector("[data-control]")).toBe(carrier(page));
    expect(number(page).hasAttribute("data-picker-trigger")).toBe(true);
  });

  it("shows no code until one is picked, and says so to assistive technology", () => {
    const page = boot();
    expect(trigger(page).textContent).toContain("No code");
    expect(trigger(page).getAttribute("aria-label")).toBe("Mobile phone country code, no code selected");
    expect(trigger(page).getAttribute("aria-haspopup")).toBe("listbox");
    expect(trigger(page).getAttribute("aria-expanded")).toBe("false");
    expect(trigger(page).getAttribute("aria-controls")).toBe("f-q0-panel");
    expect(panel(page).hidden).toBe(true);
  });

  it("builds the rows of the list only when it first opens, and has one for each country of the staff app's list", () => {
    const page = boot();
    expect(page.doc.querySelectorAll("#f-q0-list [role=option]")).toHaveLength(0);
    open(page);
    expect(page.doc.querySelectorAll("#f-q0-list [role=option]")).toHaveLength(PHONE_COUNTRIES.length);
    expect(listed(page)).toEqual(PHONE_COUNTRIES.map((country) => country.iso2));
  });

  it("draws each row with the flag, the name and the code of the staff app's list", () => {
    const page = boot();
    open(page);
    for (const country of PHONE_COUNTRIES) {
      const row = rowOf(page, country.iso2);
      expect(row.getAttribute("role")).toBe("option");
      expect(row.children[0].textContent).toBe(country.flag);
      expect(row.children[0].getAttribute("aria-hidden")).toBe("true");
      expect(row.children[1].textContent).toBe(country.name);
      expect(row.children[2].textContent).toBe(country.dialCode);
    }
  });
});

describe("picking a country", { timeout: 30_000 }, () => {
  it("with the mouse: the button shows the flag and the code, and the answer is the code and the digits", () => {
    const page = boot();
    open(page);
    click(page, rowOf(page, "PL"));
    expect(trigger(page).textContent).toContain("+48");
    expect(trigger(page).textContent).toContain("🇵🇱");
    expect(trigger(page).getAttribute("aria-label")).toBe("Mobile phone country code, Poland +48");
    typeInto(page, "f-q0", "500 100 200");
    expect(carrier(page).value).toBe("+48500100200");
    expect(number(page).value).toBe("500 100 200");
    fillFixedFields(page);
    sendForm(page);
    expect(sentBody(page).custom_data).toEqual({ mobile: "+48500100200" });
  });

  it("by touch: a press on a row keeps the focus where it is (the list stays), and the tap that follows picks", () => {
    const page = boot();
    open(page);
    search(page).focus();
    const press1 = new page.win.MouseEvent("mousedown", { bubbles: true, cancelable: true });
    rowOf(page, "DE").dispatchEvent(press1);
    expect(press1.defaultPrevented).toBe(true);
    expect(page.doc.activeElement).toBe(search(page));
    expect(panel(page).hidden).toBe(false);
    click(page, rowOf(page, "DE"));
    expect(panel(page).hidden).toBe(true);
    expect(trigger(page).textContent).toContain("+49");
  });

  it("with the keyboard: type in the search box, move with the arrows, and Enter picks", () => {
    const page = boot();
    trigger(page).focus();
    expect(press(page, trigger(page), "ArrowDown")).toBe(false);
    expect(panel(page).hidden).toBe(false);
    expect(page.doc.activeElement).toBe(search(page));
    typeInto(page, "f-q0-search", "ger");
    expect(listed(page)).toContain("DE");
    expect(activeRow(page)?.getAttribute("data-iso")).toBe(listed(page)[0]);
    press(page, search(page), "ArrowDown");
    press(page, search(page), "ArrowUp");
    expect(activeRow(page)?.getAttribute("data-iso")).toBe(listed(page)[0]);
    typeInto(page, "f-q0-search", "germany");
    expect(listed(page)).toEqual(["DE"]);
    expect(press(page, search(page), "Enter")).toBe(false);
    expect(panel(page).hidden).toBe(true);
    expect(trigger(page).textContent).toContain("+49");
    expect(page.doc.activeElement).toBe(trigger(page));
  });

  it("takes the pick of the first row when Enter is pressed with no row active", () => {
    const page = boot();
    open(page);
    expect(activeRow(page)).toBeUndefined();
    press(page, search(page), "Enter");
    expect(trigger(page).textContent).toContain(PHONE_COUNTRIES[0]!.dialCode);
  });

  it("does not send the form when Enter picks", () => {
    const page = boot();
    fillFixedFields(page);
    open(page);
    typeInto(page, "f-q0-search", "poland");
    press(page, search(page), "Enter");
    expect(page.fetchMock).not.toHaveBeenCalled();
  });

  it("clears the error of the field, as any edit of it does", () => {
    const page = bootPage([question({ key: "mobile", label: "Mobile phone", type: "phone", required: true })], { model: { styledControls: true } });
    fillFixedFields(page);
    sendForm(page);
    expect(boxOf(page, "mobile").classList.contains("has-error")).toBe(true);
    // Only the pick: nothing is typed in the search box, whose own input events would clear the error as well.
    open(page);
    expect(boxOf(page, "mobile").classList.contains("has-error")).toBe(true);
    click(page, rowOf(page, "PL"));
    expect(boxOf(page, "mobile").classList.contains("has-error")).toBe(false);
  });
});

describe("the answer", { timeout: 30_000 }, () => {
  it("is the number as it was typed while no country is picked", () => {
    const page = boot();
    typeInto(page, "f-q0", "500 100 200");
    expect(carrier(page).value).toBe("500 100 200");
    fillFixedFields(page);
    sendForm(page);
    expect(sentBody(page).custom_data).toEqual({ mobile: "500 100 200" });
  });

  it("is left out when only a country is picked: no number, no answer", () => {
    const page = boot();
    chooseCountry(page, "poland");
    expect(carrier(page).value).toBe("");
    fillFixedFields(page);
    sendForm(page);
    expect(sentBody(page).custom_data).toBeUndefined();
  });

  it("moves a number typed or pasted with a + and a known code to the button, so the code is not in the answer twice", () => {
    const page = boot();
    typeInto(page, "f-q0", "+48 500 100 200");
    expect(trigger(page).textContent).toContain("+48");
    expect(number(page).value).toBe("500 100 200");
    expect(carrier(page).value).toBe("+48500100200");
  });

  it("keeps a number with a + and no code the list knows as it is, with no country", () => {
    const page = boot();
    chooseCountry(page, "poland");
    typeInto(page, "f-q0", "+999 12345");
    expect(trigger(page).textContent).toContain("No code");
    expect(number(page).value).toBe("+999 12345");
    expect(carrier(page).value).toBe("+999 12345");
  });

  it("reads the longest code first: +1345 is the Cayman Islands, not +1 and a rest", () => {
    const page = boot();
    typeInto(page, "f-q0", "+1345 555 0100");
    expect(trigger(page).textContent).toContain("+1345");
    expect(trigger(page).getAttribute("aria-label")).toBe("Mobile phone country code, Cayman Islands +1345");
    expect(number(page).value).toBe("555 0100");
    expect(carrier(page).value).toBe("+13455550100");
  });

  it("takes only what a phone number is written with: letters never stay in the box", () => {
    const page = boot();
    typeInto(page, "f-q0", "500abc 100");
    expect(number(page).value).toBe("500 100");
    expect(carrier(page).value).toBe("500 100");
  });

  it("drops a + in the number once a country is picked, and keeps the number", () => {
    const page = boot();
    typeInto(page, "f-q0", "+999 100");
    expect(number(page).value).toBe("+999 100");
    chooseCountry(page, "poland");
    expect(number(page).value).toBe("999 100");
    expect(carrier(page).value).toBe("+48999100");
  });

  it("keeps the country that was picked when several share a code, and shows the first of them when a typed number sets it", () => {
    const page = boot();
    chooseCountry(page, "united states");
    expect(trigger(page).getAttribute("aria-label")).toBe("Mobile phone country code, United States +1");
    typeInto(page, "f-q0", "+1 416 555 0100");
    expect(trigger(page).getAttribute("aria-label")).toBe("Mobile phone country code, United States +1");
    expect(carrier(page).value).toBe("+14165550100");
    // A number typed with the code of a country that was not picked sets the first country that has the code.
    typeInto(page, "f-q0", "");
    expect(trigger(page).getAttribute("aria-label")).toBe("Mobile phone country code, United States +1");
    chooseCountry(page, "germany");
    typeInto(page, "f-q0", "+1 416 555 0100");
    expect(trigger(page).getAttribute("aria-label")).toBe("Mobile phone country code, Canada +1");
  });

  it("is what the staff app's rules make of the same input: composePhoneE164, splitPhoneForPicker and sanitizeContactPhoneInput", () => {
    const inputs = [
      "",
      "500100200",
      "500 100 200",
      "(22) 123-45-67",
      "+48 500 100 200",
      "+48500100200",
      "+1242 555 0100",
      "+1 416 555 0100",
      "+44 20 7946 0958",
      "+999 123",
      "++48 500",
      "  +48   500  ",
      "tel. 500-100-200",
      "+",
      "00 48 500 100 200",
      "500.100.200",
    ];
    for (const typed of inputs) {
      for (const start of ["", "+48", "+49"]) {
        const page = boot();
        if (start !== "") chooseCountry(page, start);
        typeInto(page, "f-q0", typed);
        // The staff app's phone input (CustomDataFieldInput): the same three functions, in the same order.
        const text = sanitizeContactPhoneInput(typed, true);
        const next = text.startsWith("+") ? splitPhoneForPicker(text) : { dialCode: start, nationalNumber: text };
        expect(carrier(page).value, `${JSON.stringify(typed)} after ${start || "no code"}`).toBe(composePhoneE164(next.dialCode, next.nationalNumber));
        expect(number(page).value, `${JSON.stringify(typed)} after ${start || "no code"}`).toBe(next.nationalNumber);
        expect(trigger(page).textContent?.includes(next.dialCode || "No code")).toBe(true);
      }
    }
  });

  it("takes the number the browser filled in before the script ran", () => {
    const page = bootPage([question({ key: "mobile", label: "Mobile phone", type: "phone" })], {
      model: { styledControls: true },
      before: (doc) => {
        doc.getElementById("f-q0").value = "+48500100200";
      },
    });
    expect(trigger(page).textContent).toContain("+48");
    expect(number(page).value).toBe("500100200");
    expect(carrier(page).value).toBe("+48500100200");
  });
});

describe("the list", { timeout: 30_000 }, () => {
  it("narrows by the name of a country, anywhere in it", () => {
    const page = boot();
    open(page);
    typeInto(page, "f-q0-search", "land");
    const names = listed(page).map((iso) => PHONE_COUNTRIES.find((country) => country.iso2 === iso)!.name);
    expect(names.length).toBeGreaterThan(5);
    for (const name of names) expect(name.toLowerCase()).toContain("land");
    expect(names).toContain("Poland");
    expect(names).toContain("Finland");
  });

  it("narrows by the start of a code, with the + or without it", () => {
    const page = boot();
    open(page);
    typeInto(page, "f-q0-search", "+48");
    expect(listed(page)).toEqual(["PL"]);
    typeInto(page, "f-q0-search", "48");
    expect(listed(page)).toEqual(["PL"]);
  });

  it("says so when nothing matches, and Enter then picks nothing", () => {
    const page = boot();
    open(page);
    typeInto(page, "f-q0-search", "zzzz");
    expect(listed(page)).toEqual([]);
    expect(page.doc.querySelector("[data-phone-empty]").hidden).toBe(false);
    press(page, search(page), "Enter");
    expect(panel(page).hidden).toBe(false);
    expect(trigger(page).textContent).toContain("No code");
  });

  it("opens on the country that is picked, marks it, and starts at the top when none is", () => {
    const page = boot();
    chooseCountry(page, "poland");
    open(page);
    expect(rowOf(page, "PL").getAttribute("aria-current")).toBe("true");
    expect(activeRow(page)).toBe(rowOf(page, "PL"));
    expect(search(page).value).toBe("");
    expect(listed(page)).toHaveLength(PHONE_COUNTRIES.length);
  });

  it("moves with the arrows without going past either end, and to the first and last with Home and End", () => {
    const page = boot();
    open(page);
    press(page, search(page), "ArrowDown");
    expect(activeRow(page)?.getAttribute("data-iso")).toBe(PHONE_COUNTRIES[0]!.iso2);
    press(page, search(page), "ArrowUp");
    expect(activeRow(page)?.getAttribute("data-iso")).toBe(PHONE_COUNTRIES[0]!.iso2);
    press(page, search(page), "End");
    expect(activeRow(page)?.getAttribute("data-iso")).toBe(PHONE_COUNTRIES.at(-1)!.iso2);
    press(page, search(page), "ArrowDown");
    expect(activeRow(page)?.getAttribute("data-iso")).toBe(PHONE_COUNTRIES.at(-1)!.iso2);
    press(page, search(page), "Home");
    expect(activeRow(page)?.getAttribute("data-iso")).toBe(PHONE_COUNTRIES[0]!.iso2);
  });

  it("leaves Home and End to the cursor of the search box when it has text", () => {
    const page = boot();
    open(page);
    typeInto(page, "f-q0-search", "ger");
    expect(press(page, search(page), "Home")).toBe(true);
    expect(press(page, search(page), "End")).toBe(true);
  });

  it("says which row is active in aria-activedescendant, and only that row is aria-selected", () => {
    const page = boot();
    open(page);
    press(page, search(page), "ArrowDown");
    press(page, search(page), "ArrowDown");
    const row = activeRow(page)!;
    expect(row.getAttribute("data-iso")).toBe(PHONE_COUNTRIES[1]!.iso2);
    expect(search(page).getAttribute("aria-activedescendant")).toBe(row.id);
    expect(page.doc.querySelectorAll("#f-q0-list [aria-selected=true]")).toHaveLength(1);
  });

  it("is an ARIA combobox with a listbox", () => {
    const page = boot();
    open(page);
    expect(search(page).getAttribute("role")).toBe("combobox");
    expect(search(page).getAttribute("aria-autocomplete")).toBe("list");
    expect(search(page).getAttribute("aria-expanded")).toBe("true");
    expect(search(page).getAttribute("aria-controls")).toBe("f-q0-list");
    expect(page.doc.getElementById("f-q0-list").getAttribute("role")).toBe("listbox");
    expect(trigger(page).getAttribute("aria-expanded")).toBe("true");
  });
});

describe("opening and closing", { timeout: 30_000 }, () => {
  it("opens on a click, closes on a second one, and the focus goes to the search box", () => {
    const page = boot();
    open(page);
    expect(panel(page).hidden).toBe(false);
    expect(page.doc.activeElement).toBe(search(page));
    expect(trigger(page).classList.contains("searchable-select__trigger--open")).toBe(true);
    trigger(page).dispatchEvent(new page.win.MouseEvent("mousedown", { bubbles: true }));
    click(page, trigger(page));
    expect(panel(page).hidden).toBe(true);
    expect(trigger(page).getAttribute("aria-expanded")).toBe("false");
    expect(trigger(page).classList.contains("searchable-select__trigger--open")).toBe(false);
  });

  it("does not open again on the click that follows a press that closed it by taking the focus (a browser that does not focus a button)", () => {
    const page = boot();
    open(page);
    trigger(page).dispatchEvent(new page.win.MouseEvent("mousedown", { bubbles: true }));
    search(page).blur();
    expect(panel(page).hidden).toBe(true);
    click(page, trigger(page));
    expect(panel(page).hidden).toBe(true);
  });

  it("closes on Escape and gives the focus back to the button", () => {
    const page = boot();
    open(page);
    expect(press(page, search(page), "Escape")).toBe(false);
    expect(panel(page).hidden).toBe(true);
    expect(page.doc.activeElement).toBe(trigger(page));
  });

  it("leaves Escape alone while the list is closed", () => {
    const page = boot();
    trigger(page).focus();
    expect(press(page, trigger(page), "Escape")).toBe(true);
  });

  it("closes on a press outside it, and leaves the focus where the press put it", () => {
    const page = boot();
    open(page);
    page.doc.getElementById("f-first_name").dispatchEvent(new page.win.Event("pointerdown", { bubbles: true }));
    expect(panel(page).hidden).toBe(true);
  });

  it("stays open for a press inside it", () => {
    const page = boot();
    open(page);
    search(page).dispatchEvent(new page.win.Event("pointerdown", { bubbles: true }));
    expect(panel(page).hidden).toBe(false);
  });

  it("closes when the focus leaves it (Tab to the number)", () => {
    const page = boot();
    open(page);
    number(page).focus();
    expect(panel(page).hidden).toBe(true);
  });

  it("opens with a letter typed on the button, which goes into the search box", () => {
    const page = boot();
    trigger(page).focus();
    expect(press(page, trigger(page), "p")).toBe(false);
    expect(panel(page).hidden).toBe(false);
    expect(search(page).value).toBe("p");
    expect(page.doc.activeElement).toBe(search(page));
    expect(listed(page).length).toBeGreaterThan(1);
  });

  it("takes an arrow on the button of a list that is open into the list, and types nothing on it", () => {
    const page = boot();
    open(page);
    trigger(page).focus();
    expect(panel(page).hidden).toBe(false);
    expect(press(page, trigger(page), "ArrowDown")).toBe(false);
    expect(page.doc.activeElement).toBe(search(page));
    trigger(page).focus();
    expect(press(page, trigger(page), "p")).toBe(true);
    expect(search(page).value).toBe("");
  });

  it("leaves a key with Ctrl, Meta or Alt, a space and an unknown key on the button to the browser", () => {
    const page = boot();
    trigger(page).focus();
    expect(press(page, trigger(page), "a", { ctrlKey: true })).toBe(true);
    expect(press(page, trigger(page), "a", { metaKey: true })).toBe(true);
    expect(press(page, trigger(page), "a", { altKey: true })).toBe(true);
    expect(press(page, trigger(page), " ")).toBe(true);
    expect(press(page, trigger(page), "Shift")).toBe(true);
    expect(panel(page).hidden).toBe(true);
  });

  it("does not open for a question that is not asked", () => {
    const page = bootPage(
      [
        question({ key: "car", label: "I come by car", type: "boolean" }),
        question({ key: "mobile", label: "Mobile phone", type: "phone", showWhen: { field: "car", value: true } }),
      ],
      { model: { styledControls: true } },
    );
    expect(boxOf(page, "mobile").hidden).toBe(true);
    expect(page.doc.getElementById("f-q1").disabled).toBe(true);
    expect(page.doc.getElementById("f-q1-country").disabled).toBe(true);
    click(page, page.doc.getElementById("f-q1-country"));
    expect(page.doc.getElementById("f-q1-panel").hidden).toBe(true);
  });
});

describe("with the first script", { timeout: 30_000 }, () => {
  it("makes a required number, left empty, an error under the field, and the focus goes to the number", () => {
    const page = bootPage([question({ key: "mobile", label: "Mobile phone", type: "phone", required: true })], { model: { styledControls: true } });
    fillFixedFields(page);
    sendForm(page);
    expect(boxOf(page, "mobile").classList.contains("has-error")).toBe(true);
    expect(boxOf(page, "mobile").querySelector("[data-msg-text]").textContent).toBe("Enter a phone number.");
    expect(page.doc.activeElement).toBe(number(page));
    expect(page.fetchMock).not.toHaveBeenCalled();
  });

  it("makes a required number with only a country an error too: the answer is empty", () => {
    const page = bootPage([question({ key: "mobile", label: "Mobile phone", type: "phone", required: true })], { model: { styledControls: true } });
    fillFixedFields(page);
    chooseCountry(page, "poland");
    sendForm(page);
    expect(boxOf(page, "mobile").classList.contains("has-error")).toBe(true);
    expect(page.fetchMock).not.toHaveBeenCalled();
  });

  it("marks the number box invalid, in colour and to assistive technology, and clears it when the guest edits", async () => {
    const page = bootPage([question({ key: "mobile", label: "Mobile phone", type: "phone", required: true })], { model: { styledControls: true } });
    fillFixedFields(page);
    sendForm(page);
    await tick();
    expect(number(page).getAttribute("aria-invalid")).toBe("true");
    expect(number(page).classList.contains("at-input--invalid")).toBe(true);
    expect(number(page).classList.contains("searchable-select__trigger--invalid")).toBe(true);
    typeInto(page, "f-q0", "5");
    await tick();
    expect(number(page).hasAttribute("aria-invalid")).toBe(false);
    expect(number(page).classList.contains("at-input--invalid")).toBe(false);
  });

  it("shows the field's own sentence when the server refuses the number, and never the server's text", async () => {
    const page = boot();
    page.fetchMock.mockResolvedValueOnce({ status: 422, json: async () => ({ errors: { "custom_data.mobile": "Phone must not contain <b>this</b>." } }) });
    fillFixedFields(page);
    chooseCountry(page, "poland");
    typeInto(page, "f-q0", "123");
    sendForm(page);
    await until(() => expect(boxOf(page, "mobile").classList.contains("has-error")).toBe(true));
    const message = boxOf(page, "mobile").querySelector("[data-msg-text]").textContent;
    expect(message).toBe("Enter a valid phone number.");
    expect(message).not.toContain("<b>");
    expect(page.doc.activeElement).toBe(number(page));
  });

  const CAR = question({ key: "car", label: "I come by car", type: "boolean" });
  const WAITING = question({ key: "mobile", label: "Mobile phone", type: "phone", required: true, showWhen: { field: "car", value: true } });

  async function tickCar(page: ScriptPage, on: boolean): Promise<void> {
    const car = page.doc.getElementById("f-q0");
    car.checked = on;
    car.dispatchEvent(new page.win.Event("change", { bubbles: true }));
    await tick();
  }

  it("sends nothing for a question that is not asked, and does not ask for it", () => {
    const page = bootPage([CAR, WAITING], { model: { styledControls: true } });
    expect(boxOf(page, "mobile").hidden).toBe(true);
    expect(carrier(page).disabled).toBe(true);
    fillFixedFields(page);
    sendForm(page);
    expect(sentBody(page).custom_data).toBeUndefined();
  });

  it("asks it once its condition is met: required, and sent with the code", async () => {
    const page = bootPage([CAR, WAITING], { model: { styledControls: true } });
    await tickCar(page, true);
    expect(boxOf(page, "mobile").hidden).toBe(false);
    expect(page.doc.getElementById("f-q1").disabled).toBe(false);
    expect(page.doc.getElementById("f-q1").required).toBe(true);
    expect(page.doc.getElementById("f-q1-country").disabled).toBe(false);
    fillFixedFields(page);
    sendForm(page);
    expect(page.fetchMock).not.toHaveBeenCalled();
    expect(boxOf(page, "mobile").classList.contains("has-error")).toBe(true);
    chooseCountry(page, "poland", "f-q1");
    typeInto(page, "f-q1", "500 100 200");
    sendForm(page);
    expect(sentBody(page).custom_data).toEqual({ car: "true", mobile: "+48500100200" });
  });

  it("keeps what the guest typed in a question that goes away, and sends it again when the question comes back", async () => {
    const page = bootPage([CAR, { ...WAITING, required: false }], { model: { styledControls: true } });
    await tickCar(page, true);
    chooseCountry(page, "germany", "f-q1");
    typeInto(page, "f-q1", "151 2345678");
    await tickCar(page, false);
    expect(page.doc.getElementById("f-q1").disabled).toBe(true);
    expect(page.doc.getElementById("f-q1-country").disabled).toBe(true);
    expect(carrier(page).value).toBe("+491512345678");
    await tickCar(page, true);
    expect(page.doc.getElementById("f-q1").value).toBe("151 2345678");
    fillFixedFields(page);
    sendForm(page);
    expect(sentBody(page).custom_data).toEqual({ car: "true", mobile: "+491512345678" });
  });
});

describe("two phone questions, and the guest's companion", { timeout: 30_000 }, () => {
  it("keeps the state of each box to itself, with ids of its own", () => {
    const page = bootPage(
      [question({ key: "mobile", label: "Mobile phone", type: "phone" }), question({ key: "office", label: "Office phone", type: "phone" })],
      { model: { styledControls: true } },
    );
    click(page, page.doc.getElementById("f-q0-country"));
    typeInto(page, "f-q0-search", "poland");
    press(page, page.doc.getElementById("f-q0-search"), "Enter");
    typeInto(page, "f-q0", "500");
    typeInto(page, "f-q1", "12 345");
    expect(boxOf(page, "mobile").querySelector("input[type=hidden]").value).toBe("+48500");
    expect(boxOf(page, "office").querySelector("input[type=hidden]").value).toBe("12 345");
    expect(page.doc.getElementById("f-q1-country").textContent).toContain("No code");
    const ids = [...page.doc.querySelectorAll("[id]")].map((el: Dom) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("takes a phone question about the companion, which is sent with the companion and only while one comes", async () => {
    const page = bootPage([], {
      model: {
        styledControls: true,
        companion: { max: 1, questions: [question({ key: "guest_phone", label: "Guest phone", type: "phone" })] },
      },
    });
    const toggle = page.doc.getElementById("f-companion");
    toggle.checked = true;
    toggle.dispatchEvent(new page.win.Event("change", { bubbles: true }));
    await tick();
    typeInto(page, "f-companion_name", "Piotr Nowak");
    chooseCountry(page, "poland", "f-c0");
    typeInto(page, "f-c0", "600 100 200");
    fillFixedFields(page);
    sendForm(page);
    expect(sentBody(page).companions).toEqual([{ name: "Piotr Nowak", answers: { guest_phone: "+48600100200" } }]);
  });
});

describe("a page that lacks something the script needs", { timeout: 30_000 }, () => {
  it("leaves the browser's own box alone when the list of countries is missing, and the form works as it does without the script", () => {
    const page = bootPage([question({ key: "mobile", label: "Mobile phone", type: "phone" })], {
      model: { styledControls: true },
      edit: (html) => html.replace(/<ul id="reg-phone-countries"[\s\S]*?<\/ul>/, ""),
    });
    expect(page.doc.getElementById("f-q0-country")).toBeNull();
    expect(number(page).hasAttribute("data-control")).toBe(true);
    typeInto(page, "f-q0", "500 100 200");
    fillFixedFields(page);
    sendForm(page);
    expect(sentBody(page).custom_data).toEqual({ mobile: "500 100 200" });
  });

  it("does nothing for a phone question the page did not mark, such as a desk extension with digits only", () => {
    const page = bootPage([question({ key: "ext", label: "Desk extension", type: "phone", rules: { digits_only: true, max_length: 6 } })], {
      model: { styledControls: true },
    });
    expect(page.doc.getElementById("f-q0-country")).toBeNull();
    expect(page.doc.getElementById("reg-phone-kit")).toBeNull();
    expect(page.doc.getElementById("f-q0").hasAttribute("data-control")).toBe(true);
  });
});

describe("what the script writes is text", { timeout: 30_000 }, () => {
  it("never turns the words of a label into markup", () => {
    const label = "Phone <img src=x onerror=alert(1)> & \"more\"";
    const page = bootPage([question({ key: "mobile", label, type: "phone" })], { model: { styledControls: true } });
    open(page);
    expect(page.doc.querySelector("img[onerror]")).toBeNull();
    expect(trigger(page).getAttribute("aria-label")).toBe(`${label} country code, no code selected`);
    expect(page.doc.querySelector("#f-q0-list img, #f-q0-list [onerror]")).toBeNull();
  });
});
