import { describe, expect, it } from "vitest";
import { isDateAnswer } from "@admitto/shared";
import { question, type Dom } from "../helpers/registration-form-fixtures.js";
import { bootPage, boxOf, fillFixedFields, sendForm, sentBody, typeInto, until, type ScriptPage } from "../helpers/registration-script-page.js";
import {
  DATE,
  bootDates,
  calendar,
  calendarButton,
  carrierOf,
  click,
  dayOf,
  days,
  field,
  focused,
  leave,
  press,
  pressOutside,
  tick,
} from "../helpers/registration-date-page.js";

const boot = (options: Parameters<typeof bootDates>[1] = {}) => bootDates([DATE], options);
const carrier = (page: ScriptPage): string => carrierOf(page, "d").value;
const open = (page: ScriptPage): void => click(page, calendarButton(page));
const isOpen = (page: ScriptPage): boolean => !calendar(page).hidden;
const title = (page: ScriptPage): string => calendar(page).querySelector("[data-date-month]").textContent;
/** The words of the page: English, whatever the browser's region is. */
const named = (iso: string): string => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y!, m! - 1, d)));
};

describe("the date question of an event with the styled boxes on", { timeout: 30_000 }, () => {
  it("keeps the browser's own box in the page as the text box, with its id, label and note, and puts a calendar button after it", () => {
    const page = boot();
    const box = boxOf(page, "d");
    expect(field(page).tagName).toBe("INPUT");
    expect(field(page).getAttribute("type")).toBe("text");
    expect(field(page).getAttribute("aria-describedby")).toBe("m-f-q0");
    expect(box.querySelector("label").getAttribute("for")).toBe("f-q0");
    expect(field(page).hasAttribute("data-picker-trigger")).toBe(true);
    expect(field(page).hasAttribute("data-control")).toBe(false);
    expect(field(page).getAttribute("placeholder")).toBe("dd/mm/yyyy");
    const button = calendarButton(page);
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("type")).toBe("button");
    expect(button.getAttribute("aria-haspopup")).toBe("dialog");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.getAttribute("aria-controls")).toBe("f-q0-calpanel");
    expect(button.getAttribute("aria-label")).toBe("Arrival date, choose date");
    const row = box.querySelector(".reg-dt");
    expect(row.contains(field(page))).toBe(true);
    expect(row.contains(button)).toBe(true);
    expect(row.classList.contains("reg-dt--pair")).toBe(false);
  });

  it("holds the answer in a hidden control that the form reads, and the text box is not that control", () => {
    const page = boot();
    expect(carrierOf(page, "d").hasAttribute("data-control")).toBe(true);
    expect(carrierOf(page, "d").getAttribute("type")).toBe("hidden");
    expect(boxOf(page, "d").querySelector("[data-control]")).toBe(carrierOf(page, "d"));
    expect(boxOf(page, "d").querySelectorAll("[data-control]")).toHaveLength(1);
    expect(carrier(page)).toBe("");
  });

  it("draws nothing of the calendar until it is opened, and keeps the month closed", () => {
    const page = boot();
    expect(isOpen(page)).toBe(false);
    expect(days(page)).toHaveLength(0);
    expect(calendar(page).getAttribute("role")).toBe("dialog");
    expect(calendar(page).getAttribute("aria-label")).toBe("Arrival date, choose date");
  });

  it("opens the month of today with the focus on today, and names every day by its full date", () => {
    const page = boot();
    open(page);
    expect(isOpen(page)).toBe(true);
    expect(calendarButton(page).getAttribute("aria-expanded")).toBe("true");
    expect(title(page)).toBe("November 2026");
    expect(days(page)).toHaveLength(42);
    expect(focused(page)).toBe(dayOf(page, "2026-11-04"));
    expect(focused(page).getAttribute("aria-label")).toBe(named("2026-11-04"));
    expect(focused(page).getAttribute("aria-label")).toContain("Wednesday");
    expect(focused(page).getAttribute("aria-current")).toBe("date");
    expect(focused(page).getAttribute("tabindex")).toBe("0");
    expect(days(page).filter((cell) => cell.getAttribute("tabindex") === "0")).toHaveLength(1);
    expect(days(page).filter((cell) => cell.getAttribute("aria-selected") === "true")).toHaveLength(0);
    expect(days(page).filter((cell) => cell.hasAttribute("data-iso"))).toHaveLength(30);
  });

  it("has a grid of days whose names are the columns: the week from Monday for a British browser, from Sunday for an American one", () => {
    const heads = (page: ScriptPage): string[] => [...calendar(page).querySelectorAll("thead th")].map((th: Dom) => th.textContent);
    const gb = boot();
    open(gb);
    expect(heads(gb)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect(calendar(gb).querySelector("thead th").getAttribute("abbr")).toBe("Monday");
    expect(calendar(gb).querySelector("thead th").getAttribute("scope")).toBe("col");
    // 1 November 2026 is a Sunday: the last column of a week that starts on Monday.
    expect(days(gb).indexOf(dayOf(gb, "2026-11-01"))).toBe(6);
    const us = boot({ languages: ["en-US"] });
    open(us);
    expect(heads(us)).toEqual(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
    expect(days(us).indexOf(dayOf(us, "2026-11-01"))).toBe(0);
    expect(calendar(us).getAttribute("role")).toBe("dialog");
    expect(calendar(us).querySelector("table").getAttribute("role")).toBe("grid");
    expect(calendar(us).querySelector("table").getAttribute("aria-labelledby")).toBe(calendar(us).querySelector("[data-date-month]").id);
    expect(days(us)[0]!.getAttribute("role")).toBe("gridcell");
  });

  it("announces the change of the month: the title is a live region", () => {
    const page = boot();
    const month = calendar(page).querySelector("[data-date-month]");
    expect(month.getAttribute("aria-live")).toBe("polite");
    expect(month.getAttribute("aria-atomic")).toBe("true");
  });
});

describe("picking a date with the mouse or a finger", { timeout: 30_000 }, () => {
  it("writes the date in the box and the answer, closes the month, and gives the focus to the button", () => {
    const page = boot();
    open(page);
    click(page, dayOf(page, "2026-11-12"));
    expect(field(page).value).toBe("12/11/2026");
    expect(carrier(page)).toBe("2026-11-12");
    expect(isOpen(page)).toBe(false);
    expect(calendarButton(page).getAttribute("aria-expanded")).toBe("false");
    expect(focused(page)).toBe(calendarButton(page));
    expect(calendarButton(page).getAttribute("aria-label")).toBe(`Arrival date, change date, ${named("2026-11-12")}`);
  });

  it("opens on the month of the date that is picked, with that day selected", () => {
    const page = boot();
    open(page);
    click(page, dayOf(page, "2026-11-12"));
    open(page);
    expect(focused(page)).toBe(dayOf(page, "2026-11-12"));
    expect(dayOf(page, "2026-11-12").getAttribute("aria-selected")).toBe("true");
    expect(dayOf(page, "2026-11-13").getAttribute("aria-selected")).toBe("false");
  });

  it("shows another month with the arrows, and leaves the focus on the arrow", () => {
    const page = boot();
    open(page);
    const next = calendar(page).querySelector("[data-date-next]");
    const prev = calendar(page).querySelector("[data-date-prev]");
    next.focus();
    click(page, next);
    expect(title(page)).toBe("December 2026");
    expect(dayOf(page, "2026-12-31")).not.toBeNull();
    expect(focused(page)).toBe(next);
    click(page, next);
    expect(title(page)).toBe("January 2027");
    click(page, prev);
    click(page, prev);
    click(page, prev);
    expect(title(page)).toBe("October 2026");
    expect(dayOf(page, "2026-10-04")).not.toBeNull();
    expect(dayOf(page, "2026-11-04")).toBeNull();
  });

  it("picks a day of another month the same way", () => {
    const page = boot();
    open(page);
    click(page, calendar(page).querySelector("[data-date-prev]"));
    click(page, dayOf(page, "2026-10-31"));
    expect(carrier(page)).toBe("2026-10-31");
    expect(field(page).value).toBe("31/10/2026");
  });

  it("has an empty cell for each day outside the month, hidden from a screen reader and not in the order of the Tab key", () => {
    const page = boot();
    open(page);
    const blank = days(page).filter((cell) => !cell.hasAttribute("data-iso"));
    expect(blank).toHaveLength(12);
    for (const cell of blank) {
      expect(cell.getAttribute("aria-hidden")).toBe("true");
      expect(cell.hasAttribute("tabindex")).toBe(false);
      expect(cell.textContent).toBe("");
    }
    click(page, blank[0]);
    expect(isOpen(page)).toBe(true);
    expect(carrier(page)).toBe("");
  });

  it("picks today with the Today button, and does not offer Clear for a required question", () => {
    const required = bootDates([question({ key: "d", label: "Arrival date", type: "date", required: true })]);
    open(required);
    expect(calendar(required).querySelector("[data-date-clear]").hidden).toBe(true);
    click(required, calendar(required).querySelector("[data-date-today]"));
    expect(carrierOf(required, "d").value).toBe("2026-11-04");
    expect(field(required).value).toBe("04/11/2026");
    expect(isOpen(required)).toBe(false);
  });

  it("empties the answer with Clear, closes the month and tells the form that the box changed", () => {
    const page = boot();
    open(page);
    click(page, dayOf(page, "2026-11-12"));
    let changes = 0;
    page.doc.getElementById("reg-form").addEventListener("change", () => (changes += 1));
    open(page);
    const clear = calendar(page).querySelector("[data-date-clear]");
    expect(clear.hidden).toBe(false);
    click(page, clear);
    expect(field(page).value).toBe("");
    expect(carrier(page)).toBe("");
    expect(isOpen(page)).toBe(false);
    expect(changes).toBe(1);
    expect(calendarButton(page).getAttribute("aria-label")).toBe("Arrival date, choose date");
  });

  it("closes on a press outside, without taking the focus, and when the focus leaves the month", () => {
    const page = boot();
    open(page);
    field(page).focus();
    pressOutside(page);
    expect(isOpen(page)).toBe(false);
    expect(focused(page)).toBe(field(page));
    open(page);
    const tail = calendar(page).querySelector("[data-date-today]");
    tail.focus();
    tail.dispatchEvent(new page.win.FocusEvent("focusout", { bubbles: true, relatedTarget: page.doc.getElementById("f-first_name") }));
    expect(isOpen(page)).toBe(false);
  });

  it("closes with the second press on the button", () => {
    const page = boot();
    open(page);
    click(page, calendarButton(page));
    expect(isOpen(page)).toBe(false);
  });

  it("tells the form that the box changed, so that the error of the field is cleared", () => {
    const page = bootDates([question({ key: "d", label: "Arrival date", type: "date", required: true })]);
    fillFixedFields(page);
    sendForm(page);
    expect(boxOf(page, "d").classList.contains("has-error")).toBe(true);
    open(page);
    expect(boxOf(page, "d").classList.contains("has-error")).toBe(true);
    click(page, dayOf(page, "2026-11-12"));
    expect(boxOf(page, "d").classList.contains("has-error")).toBe(false);
  });
});

/** Opens the month, presses `key` and reports the day that has the focus. */
function after(keys: ReadonlyArray<readonly [string, Record<string, unknown>?]>, start?: string, options: Parameters<typeof bootDates>[1] = {}) {
  const page = boot(options);
  if (start) {
    typeInto(page, "f-q0", start);
    leave(page, field(page));
  }
  open(page);
  for (const [key, init] of keys) press(page, key, init ?? {});
  return { page, day: focused(page).getAttribute("data-iso") };
}

describe("the keys of the month", { timeout: 30_000 }, () => {
  it.each([
    ["ArrowRight", "2026-11-05"],
    ["ArrowLeft", "2026-11-03"],
    ["ArrowDown", "2026-11-11"],
    ["ArrowUp", "2026-10-28"],
    ["Home", "2026-11-02"],
    ["End", "2026-11-08"],
    ["PageDown", "2026-12-04"],
    ["PageUp", "2026-10-04"],
  ])("%s moves the focus to %s", (key, expected) => {
    expect(after([[key]]).day).toBe(expected);
  });

  it.each([
    ["PageDown", "2027-11-04"],
    ["PageUp", "2025-11-04"],
  ])("Shift+%s moves the focus a year to %s", (key, expected) => {
    expect(after([[key, { shiftKey: true }]]).day).toBe(expected);
  });

  it("goes to the start and the end of the week of the browser: Home is a Sunday for an American one", () => {
    expect(after([["Home"]], undefined, { languages: ["en-US"] }).day).toBe("2026-11-01");
    expect(after([["End"]], undefined, { languages: ["en-US"] }).day).toBe("2026-11-07");
  });

  it("goes over the end of a month, a year and a leap day", () => {
    expect(after([["ArrowRight"]], "31/12/2026").day).toBe("2027-01-01");
    expect(after([["ArrowLeft"]], "01/01/2027").day).toBe("2026-12-31");
    expect(after([["ArrowRight"]], "28/02/2024").day).toBe("2024-02-29");
    expect(after([["ArrowRight"]], "28/02/2023").day).toBe("2023-03-01");
    expect(after([["ArrowDown"]], "25/02/2024").day).toBe("2024-03-03");
  });

  it("keeps the day of the month, or the last day of a shorter one, when it goes by a month or a year", () => {
    expect(after([["PageDown"]], "31/01/2023").day).toBe("2023-02-28");
    expect(after([["PageDown"]], "31/01/2024").day).toBe("2024-02-29");
    expect(after([["PageUp"]], "31/03/2024").day).toBe("2024-02-29");
    expect(after([["PageDown"]], "30/12/2026").day).toBe("2027-01-30");
    expect(after([["PageDown", { shiftKey: true }]], "29/02/2024").day).toBe("2025-02-28");
    expect(after([["PageUp", { shiftKey: true }]], "29/02/2024").day).toBe("2023-02-28");
    expect(after([["PageDown", { shiftKey: true }]], "29/02/2024").page.doc.querySelector("[data-date-month]").textContent).toBe("February 2025");
  });

  it("announces the month it comes to: the title follows the focus", () => {
    const { page } = after([["PageDown"], ["PageDown"]]);
    expect(title(page)).toBe("January 2027");
    expect(focused(page).getAttribute("data-iso")).toBe("2027-01-04");
  });

  it("does not leave the years a date can have: the first of January of year 1 and the last of December of 9999 stay", () => {
    expect(after([["ArrowLeft"]], "0001-01-01").day).toBe("0001-01-01");
    expect(after([["PageUp"]], "0001-01-01").day).toBe("0001-01-01");
    expect(after([["PageUp", { shiftKey: true }]], "0001-06-15").day).toBe("0001-06-15");
    expect(after([["ArrowRight"]], "9999-12-31").day).toBe("9999-12-31");
    expect(after([["PageDown", { shiftKey: true }]], "9999-06-15").day).toBe("9999-06-15");
  });

  it("picks the day that has the focus with Enter or Space, and does not send the form", () => {
    const page = boot();
    fillFixedFields(page);
    open(page);
    press(page, "ArrowRight");
    press(page, "ArrowRight");
    press(page, "Enter");
    expect(carrier(page)).toBe("2026-11-06");
    expect(isOpen(page)).toBe(false);
    expect(focused(page)).toBe(calendarButton(page));
    open(page);
    press(page, "ArrowDown");
    press(page, " ");
    expect(carrier(page)).toBe("2026-11-13");
    expect(page.fetchMock).not.toHaveBeenCalled();
  });

  it("closes with Escape, gives the focus to the button and picks nothing", () => {
    const page = boot();
    open(page);
    press(page, "ArrowRight");
    press(page, "Escape");
    expect(isOpen(page)).toBe(false);
    expect(focused(page)).toBe(calendarButton(page));
    expect(carrier(page)).toBe("");
  });

  it("keeps the keys of the browser that it does not use, and takes the ones it uses away from the page", () => {
    const page = boot();
    open(page);
    expect(press(page, "ArrowRight")).toBe(false);
    expect(press(page, "PageDown")).toBe(false);
    expect(press(page, "Home")).toBe(false);
    expect(press(page, "Tab")).toBe(true);
    expect(press(page, "a")).toBe(true);
    expect(press(page, "ArrowRight", { ctrlKey: true })).toBe(true);
    expect(press(page, "ArrowRight", { altKey: true })).toBe(true);
    expect(press(page, "PageDown", { metaKey: true })).toBe(true);
  });

  it("opens from the text box with the Down key, and the focus goes into the month", () => {
    const page = boot();
    field(page).focus();
    expect(press(page, "ArrowDown")).toBe(false);
    expect(isOpen(page)).toBe(true);
    expect(focused(page)).toBe(dayOf(page, "2026-11-04"));
  });

  it("does not open when the box is not in use: a question that waits for its condition", () => {
    const page = bootDates([
      question({ key: "car", label: "I need parking", type: "boolean" }),
      question({ key: "d", label: "Arrival date", type: "date", showWhen: { field: "car", value: true } }),
    ]);
    const button = page.doc.getElementById("f-q1-cal");
    expect(button.disabled).toBe(true);
    click(page, button);
    expect(page.doc.getElementById("f-q1-calpanel").hidden).toBe(true);
  });
});

describe("a date typed in the box", { timeout: 30_000 }, () => {
  const typed = (page: ScriptPage, text: string): string => {
    typeInto(page, "f-q0", text);
    return carrier(page);
  };

  // A British browser: the day comes first, and the first of the numbers is the day unless it cannot be.
  it.each([
    ["04/11/2026", "2026-11-04"],
    ["4/11/2026", "2026-11-04"],
    ["04.11.2026", "2026-11-04"],
    ["04-11-2026", "2026-11-04"],
    ["04 11 2026", "2026-11-04"],
    ["  04/11/2026  ", "2026-11-04"],
    ["04/11/2026.", "2026-11-04"],
    ["2026-11-04", "2026-11-04"],
    ["2026-1-4", "2026-01-04"],
    ["2026/11/04", "2026-11-04"],
    ["2026.11.04", "2026-11-04"],
    ["11/04/2026", "2026-04-11"],
    ["04/13/2026", "2026-04-13"],
    ["13/04/2026", "2026-04-13"],
    ["29/02/2024", "2024-02-29"],
    ["29/02/2000", "2000-02-29"],
    ["28/02/2023", "2023-02-28"],
    ["31/12/2026", "2026-12-31"],
    ["30/04/2026", "2026-04-30"],
    ["01/01/1000", "1000-01-01"],
    ["9999-12-31", "9999-12-31"],
    ["0001-01-01", "0001-01-01"],
    ["0999-06-15", "0999-06-15"],
    // As lenient as the staff app's box: a mark twice, or one at the start, is only a mark.
    ["2026--11-04", "2026-11-04"],
    ["-04/11/2026", "2026-11-04"],
    ["04/11/-2026", "2026-11-04"],
  ])("reads %j as %j", (text, expected) => {
    const page = boot();
    expect(typed(page, text)).toBe(expected);
    expect(isDateAnswer(expected)).toBe(true);
  });

  it.each([
    "",
    "   ",
    "abc",
    "4 Nov 2026",
    "04/11",
    "04/11/26",
    "4/11/2026/1",
    "29/02/2023",
    "29/02/1900",
    "30/02/2026",
    "31/04/2026",
    "31/06/2026",
    "00/11/2026",
    "04/00/2026",
    "13/13/2026",
    "32/01/2026",
    "04/32/2026",
    "2026-02-30",
    "2026-13-01",
    "2026-00-10",
    "0000-01-01",
    "10000-01-01",
    "2026-11-04T12:00",
    "04/11/2026 12:00",
    "+04/11/2026",
    "04/11/2026x",
    "٠٤/١١/٢٠٢٦",
  ])("reads %j as no date", (text) => {
    const page = boot();
    expect(typed(page, text)).toBe("");
  });

  it("keeps the order of an American browser: the month comes first", () => {
    const page = boot({ languages: ["en-US"] });
    expect(field(page).getAttribute("placeholder")).toBe("mm/dd/yyyy");
    expect(typed(page, "11/04/2026")).toBe("2026-11-04");
    expect(typed(page, "04/11/2026")).toBe("2026-04-11");
    expect(typed(page, "13/04/2026")).toBe("2026-04-13");
    expect(typed(page, "04/13/2026")).toBe("2026-04-13");
    expect(typed(page, "02/29/2023")).toBe("");
  });

  it("agrees with the date check of the server for every ending of every month of years that are and are not leap years", () => {
    const page = boot();
    const text = (year: number, month: number, day: number) => `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    let checked = 0;
    for (const year of [1, 999, 1900, 2000, 2023, 2024, 2026, 2100, 9999]) {
      for (let month = 1; month <= 12; month += 1) {
        for (const day of [0, 1, 28, 29, 30, 31, 32]) {
          const iso = text(year, month, day);
          expect(typed(page, iso), iso).toBe(isDateAnswer(iso) ? iso : "");
          // The same day written the way the box writes it.
          const written = `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${String(year).padStart(4, "0")}`;
          const expected = isDateAnswer(iso) && year >= 1000 ? iso : "";
          expect(typed(page, written), written).toBe(expected);
          checked += 1;
        }
      }
    }
    expect(checked).toBe(9 * 12 * 7);
  });

  it("writes a date that was typed in another way the way the box writes it, when the box is left", () => {
    const page = boot();
    typeInto(page, "f-q0", "4.11.2026");
    expect(field(page).value).toBe("4.11.2026");
    leave(page, field(page));
    expect(field(page).value).toBe("04/11/2026");
    expect(carrier(page)).toBe("2026-11-04");
    typeInto(page, "f-q0", "2026-2-3");
    leave(page, field(page));
    expect(field(page).value).toBe("03/02/2026");
  });

  it("does not work its own text out again: a date of an early year, which the box writes with four digits and does not read back, stays", () => {
    const page = boot();
    typeInto(page, "f-q0", "0999-06-15");
    leave(page, field(page));
    expect(field(page).value).toBe("15/06/0999");
    expect(carrier(page)).toBe("0999-06-15");
    leave(page, field(page));
    expect(carrier(page)).toBe("0999-06-15");
    open(page);
    press(page, "ArrowRight");
    press(page, "Enter");
    expect(field(page).value).toBe("16/06/0999");
    expect(carrier(page)).toBe("0999-06-16");
  });

  it("keeps the text that is no date as it was typed, so that it can be corrected", () => {
    const page = boot();
    typeInto(page, "f-q0", "31/04/2026");
    leave(page, field(page));
    expect(field(page).value).toBe("31/04/2026");
    expect(carrier(page)).toBe("");
  });

  it("shows the typed date in the month, and a text that is no date opens the month of today", () => {
    const page = boot();
    typeInto(page, "f-q0", "15/03/2025");
    open(page);
    expect(title(page)).toBe("March 2025");
    expect(focused(page)).toBe(dayOf(page, "2025-03-15"));
    expect(focused(page).getAttribute("aria-selected")).toBe("true");
    click(page, calendarButton(page));
    typeInto(page, "f-q0", "31/04/2025");
    open(page);
    expect(title(page)).toBe("November 2026");
  });

  it("starts from a date the browser filled in before the script ran", () => {
    const page = boot({
      before: (doc) => {
        doc.getElementById("f-q0").value = "2026-03-09";
      },
    });
    expect(field(page).value).toBe("09/03/2026");
    expect(carrier(page)).toBe("2026-03-09");
  });
});

describe("the date that goes to the server", { timeout: 30_000 }, () => {
  const native = (iso: string) => {
    const page = bootPage([DATE]);
    typeInto(page, "f-q0", iso);
    fillFixedFields(page);
    sendForm(page);
    return sentBody(page);
  };
  const styled = (text: string) => {
    const page = boot();
    typeInto(page, "f-q0", text);
    fillFixedFields(page);
    sendForm(page);
    return sentBody(page);
  };
  const picked = (iso: string) => {
    const page = boot();
    typeInto(page, "f-q0", iso);
    leave(page, field(page));
    open(page);
    press(page, "Enter");
    fillFixedFields(page);
    sendForm(page);
    return sentBody(page);
  };

  it.each(["2026-11-04", "2024-02-29", "2023-02-28", "2026-12-31", "2000-01-01", "2026-01-31"])("is what the browser's own box gives for %s: a text YYYY-MM-DD, whichever way it is entered", (iso) => {
    const expected = native(iso);
    const [year, month, day] = iso.split("-");
    expect(expected.custom_data).toEqual({ d: iso });
    expect(styled(iso)).toEqual(expected);
    expect(styled(`${day}/${month}/${year}`)).toEqual(expected);
    expect(picked(iso)).toEqual(expected);
  });

  it("leaves the question out when nothing is entered, as the browser's box does", () => {
    const empty = bootPage([DATE]);
    fillFixedFields(empty);
    sendForm(empty);
    const page = boot();
    fillFixedFields(page);
    sendForm(page);
    expect(sentBody(page)).toEqual(sentBody(empty));
    expect(sentBody(page).custom_data).toBeUndefined();
  });

  it("is sent as typed, when the guest sent the form without leaving the box", () => {
    const page = boot();
    fillFixedFields(page);
    typeInto(page, "f-q0", "4.11.2026");
    sendForm(page);
    expect(sentBody(page).custom_data).toEqual({ d: "2026-11-04" });
  });
});

describe("a date that is required, begun and not finished, or refused", { timeout: 30_000 }, () => {
  const required = () => bootDates([question({ key: "d", label: "Arrival date", type: "date", required: true })]);
  const message = (page: ScriptPage): string => boxOf(page, "d").querySelector("[data-msg-text]").textContent;

  it("says that a date is needed when a required one is empty, and puts the focus in the text box", async () => {
    const page = required();
    fillFixedFields(page);
    sendForm(page);
    expect(page.fetchMock).not.toHaveBeenCalled();
    expect(message(page)).toBe("Enter a date.");
    expect(focused(page)).toBe(field(page));
    await tick();
    expect(field(page).getAttribute("aria-invalid")).toBe("true");
    expect(field(page).classList.contains("at-input--invalid")).toBe(true);
    expect(field(page).required).toBe(true);
  });

  it("says that the date is not a date when a text was typed that is none, even for a question that is not required", async () => {
    const page = boot();
    fillFixedFields(page);
    typeInto(page, "f-q0", "31/04/2026");
    sendForm(page);
    expect(page.fetchMock).not.toHaveBeenCalled();
    expect(message(page)).toBe("Enter a valid date.");
    expect(focused(page)).toBe(field(page));
    await tick();
    expect(field(page).getAttribute("aria-invalid")).toBe("true");
  });

  it("clears the error when the guest edits the box, and the mark with it", async () => {
    const page = required();
    fillFixedFields(page);
    sendForm(page);
    await tick();
    typeInto(page, "f-q0", "4");
    expect(boxOf(page, "d").classList.contains("has-error")).toBe(false);
    await tick();
    expect(field(page).hasAttribute("aria-invalid")).toBe(false);
    expect(field(page).classList.contains("at-input--invalid")).toBe(false);
  });

  it("sends the form once the text is a date", async () => {
    const page = boot();
    fillFixedFields(page);
    typeInto(page, "f-q0", "31/04/2026");
    sendForm(page);
    expect(page.fetchMock).not.toHaveBeenCalled();
    typeInto(page, "f-q0", "30/04/2026");
    sendForm(page);
    await until(() => expect(page.fetchMock).toHaveBeenCalledTimes(1));
    expect(sentBody(page).custom_data).toEqual({ d: "2026-04-30" });
  });

  it("shows the sentence of the page, not the server's text, when the server refuses the date", async () => {
    const page = boot();
    fillFixedFields(page);
    typeInto(page, "f-q0", "30/04/2026");
    page.fetchMock.mockResolvedValueOnce({ status: 422, json: async () => ({ errors: { "custom_data.d": "Server says: no such date <b>x</b>" } }) });
    sendForm(page);
    await until(() => expect(message(page)).toBe("Enter a valid date."));
    expect(boxOf(page, "d").textContent).not.toContain("Server says");
    expect(focused(page)).toBe(field(page));
    await tick();
    expect(field(page).getAttribute("aria-invalid")).toBe("true");
  });

  it("marks the text box and not the carrier as the one to focus: the first problem of the form gets the focus there", () => {
    const page = bootDates([question({ key: "d", label: "Arrival date", type: "date", required: true }), question({ key: "e", label: "Another", type: "text", required: true })]);
    fillFixedFields(page);
    sendForm(page);
    expect(focused(page)).toBe(field(page));
  });
});

describe("a date question that waits for another answer, and the guest's companion's", { timeout: 30_000 }, () => {
  const WAITING = question({ key: "d", label: "Arrival date", type: "date", required: true, showWhen: { field: "car", value: true } });
  const CAR = question({ key: "car", label: "I will drive", type: "boolean" });

  it("is hidden, disabled and not required until it is asked, with its calendar button", async () => {
    const page = bootDates([CAR, WAITING]);
    const box = boxOf(page, "d");
    expect(box.hidden).toBe(true);
    expect(page.doc.getElementById("f-q1").disabled).toBe(true);
    expect(page.doc.getElementById("f-q1-cal").disabled).toBe(true);
    expect(page.doc.getElementById("f-q1").required).toBe(false);
    page.doc.getElementById("f-q0").click();
    await tick();
    expect(box.hidden).toBe(false);
    expect(page.doc.getElementById("f-q1").disabled).toBe(false);
    expect(page.doc.getElementById("f-q1-cal").disabled).toBe(false);
    expect(page.doc.getElementById("f-q1").required).toBe(true);
    expect(carrierOf(page, "d").required).toBe(true);
  });

  it("is neither checked nor sent while it is not asked, and what was typed in it is kept for when it is", async () => {
    const page = bootDates([CAR, WAITING]);
    fillFixedFields(page);
    page.doc.getElementById("f-q0").click();
    typeInto(page, "f-q1", "12/11/2026");
    page.doc.getElementById("f-q0").click();
    await tick();
    sendForm(page);
    await until(() => expect(page.fetchMock).toHaveBeenCalledTimes(1));
    expect(sentBody(page).custom_data).toBeUndefined();
    expect(page.doc.getElementById("f-q1").value).toBe("12/11/2026");
    page.doc.getElementById("f-q0").click();
    await tick();
    expect(carrierOf(page, "d").value).toBe("2026-11-12");
  });

  it("closes the month when the question stops being asked", async () => {
    const page = bootDates([CAR, WAITING]);
    page.doc.getElementById("f-q0").click();
    await tick();
    click(page, page.doc.getElementById("f-q1-cal"));
    expect(page.doc.getElementById("f-q1-calpanel").hidden).toBe(false);
    page.doc.getElementById("f-q0").click();
    await tick();
    expect(page.doc.getElementById("f-q1-calpanel").hidden).toBe(true);
  });

  it("is a box of the companion's part of the form, sent under the companion", async () => {
    const page = bootDates([], {
      model: { companion: { max: 1, questions: [question({ key: "arrive", label: "Guest arrival", type: "date", required: true })] } },
    });
    const id = boxOf(page, "arrive").querySelector("input[type=text]").id;
    expect(id).toMatch(/^f-c\d+$/);
    expect(page.doc.getElementById(`${id}-cal`).disabled).toBe(true);
    page.doc.querySelector("[data-companion-toggle]").click();
    await tick();
    expect(page.doc.getElementById(`${id}-cal`).disabled).toBe(false);
    fillFixedFields(page);
    typeInto(page, "f-companion_name", "Piotr");
    typeInto(page, id, "05/11/2026");
    sendForm(page);
    await until(() => expect(page.fetchMock).toHaveBeenCalledTimes(1));
    expect(sentBody(page).companions).toEqual([{ name: "Piotr", answers: { arrive: "2026-11-05" } }]);
    expect(sentBody(page).custom_data).toBeUndefined();
  });
});

describe("the words and the habits of the box", { timeout: 30_000 }, () => {
  it("writes the date the way a Polish browser does, with the names of the page in English", () => {
    const page = boot({ languages: ["pl-PL", "en"] });
    expect(field(page).getAttribute("placeholder")).toBe("dd.mm.yyyy");
    typeInto(page, "f-q0", "2026-11-04");
    leave(page, field(page));
    expect(field(page).value).toBe("04.11.2026");
    open(page);
    expect(title(page)).toBe("November 2026");
    expect(calendar(page).querySelector("thead th").textContent).toBe("Mon");
  });

  it("writes the year first for a Japanese browser, and the month first for an American one", () => {
    const ja = boot({ languages: ["ja-JP"] });
    expect(field(ja).getAttribute("placeholder")).toBe("yyyy/mm/dd");
    typeInto(ja, "f-q0", "2026-11-04");
    leave(ja, field(ja));
    expect(field(ja).value).toBe("2026/11/04");
    const us = boot({ languages: ["en-US"] });
    typeInto(us, "f-q0", "2026-11-04");
    leave(us, field(us));
    expect(field(us).value).toBe("11/04/2026");
  });

  it("writes the digits of the Latin script and the Gregorian calendar, whatever the browser's region uses", () => {
    for (const tag of ["ar-EG", "fa-IR", "th-TH", "hi-IN", "zh-CN", "ko-KR", "he-IL", "ru-RU", "de-CH", "sv-SE"]) {
      const page = boot({ languages: [tag] });
      typeInto(page, "f-q0", "2026-11-04");
      leave(page, field(page));
      expect(field(page).value, tag).toMatch(/^\d{2}[./-]\d{2}[./-]\d{2,4}$|^\d{4}[./-]\d{2}[./-]\d{2}$/);
      expect(carrier(page), tag).toBe("2026-11-04");
      // The text the box writes reads back as the same day.
      const written = field(page).value;
      typeInto(page, "f-q0", "");
      typeInto(page, "f-q0", written);
      expect(carrier(page), `${tag} ${written}`).toBe("2026-11-04");
    }
  });

  it("falls back to the day first and a slash for a browser that sends a tag it cannot use", () => {
    const page = boot({ languages: ["not a tag"] });
    expect(field(page).getAttribute("placeholder")).toBe("mm/dd/yyyy");
    typeInto(page, "f-q0", "11/04/2026");
    expect(carrier(page)).toBe("2026-11-04");
  });

  it("does nothing, and leaves the browser's own box, when the browser cannot format the parts of a date", () => {
    const page = boot({
      before: (doc) => {
        delete doc.defaultView.Intl.DateTimeFormat.prototype.formatToParts;
      },
    });
    expect(field(page).getAttribute("type")).toBe("date");
    expect(field(page).hasAttribute("data-control")).toBe(true);
    expect(page.doc.getElementById("f-q0-cal")).toBeNull();
    expect(boxOf(page, "d").querySelector("input[type=hidden]")).toBeNull();
  });
});
