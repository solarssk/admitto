import { describe, expect, it } from "vitest";
import { isDateTimeAnswer } from "@admitto/shared";
import { question, type Dom } from "../helpers/registration-form-fixtures.js";
import { bootPage, boxOf, fillFixedFields, sendForm, sentBody, typeInto, until, type ScriptPage } from "../helpers/registration-script-page.js";
import {
  DATETIME,
  bootDates,
  calendar,
  calendarButton,
  carrierOf,
  click,
  clockButton,
  clockPanel,
  dayOf,
  field,
  focused,
  leave,
  press,
  pressOutside,
  tap,
  tick,
  timeField,
} from "../helpers/registration-date-page.js";

const boot = (options: Parameters<typeof bootDates>[1] = {}) => bootDates([DATETIME], options);
const carrier = (page: ScriptPage): string => carrierOf(page, "dt").value;
const openClock = (page: ScriptPage): void => click(page, clockButton(page));
const clockOpen = (page: ScriptPage): boolean => !clockPanel(page).hidden;
const list = (page: ScriptPage, kind: "hours" | "minutes" | "meridiem"): Dom => clockPanel(page).querySelector(`[data-time-${kind}]`);
const options = (page: ScriptPage, kind: "hours" | "minutes" | "meridiem"): Dom[] => [...list(page, kind).querySelectorAll("[role=option]")];
const optionText = (page: ScriptPage, kind: "hours" | "minutes" | "meridiem"): string[] => options(page, kind).map((item) => item.textContent);
const chosen = (page: ScriptPage, kind: "hours" | "minutes" | "meridiem"): string[] =>
  options(page, kind).filter((item) => item.getAttribute("aria-selected") === "true").map((item) => item.textContent);
const optionOf = (page: ScriptPage, kind: "hours" | "minutes" | "meridiem", text: string): Dom => options(page, kind).find((item) => item.textContent === text);
const type = (page: ScriptPage, date: string, time: string): string => {
  typeInto(page, "f-q0", date);
  typeInto(page, "f-q0-time", time);
  return carrier(page);
};

/** The staff app's rule for a typed time (`parseFlexibleTime` of its TimeInput), as a reference to run the script against. */
function reference(raw: string): string {
  const normalized = raw.trim().toLowerCase().replaceAll(".", "");
  if (!normalized) return "";
  const match = /^(\d{1,4})(?:[: ](\d{1,2}))?\s*(am|pm)?$/.exec(normalized);
  if (!match) return "";
  const digits = match[1] ?? "";
  const meridiem = match[3];
  if (!match[2] && !meridiem && digits.length < 2) return "";
  let hours: number;
  let minutes: number;
  if (match[2]) {
    hours = Number.parseInt(digits, 10);
    minutes = Number.parseInt(match[2], 10);
  } else if (digits.length <= 2) {
    hours = Number.parseInt(digits, 10);
    minutes = 0;
  } else {
    hours = Number.parseInt(digits.slice(0, -2), 10);
    minutes = Number.parseInt(digits.slice(-2), 10);
  }
  if (minutes > 59 || (meridiem ? hours < 1 || hours > 12 : hours > 23)) return "";
  let whole = hours;
  if (meridiem) whole = (hours % 12) + (meridiem === "pm" ? 12 : 0);
  return `${String(whole).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

describe("the date and time question of an event with the styled boxes on", { timeout: 30_000 }, () => {
  it("keeps the browser's own box in the page as the date box and puts a time box beside it, each with its button", () => {
    const page = boot();
    const box = boxOf(page, "dt");
    const row = box.querySelector(".reg-dt");
    expect(row.classList.contains("reg-dt--pair")).toBe(true);
    expect(field(page).getAttribute("type")).toBe("text");
    expect(field(page).getAttribute("aria-label")).toBe("Expected arrival, date");
    expect(timeField(page).getAttribute("type")).toBe("text");
    expect(timeField(page).getAttribute("aria-label")).toBe("Expected arrival, time");
    expect(box.querySelector("label").getAttribute("for")).toBe("f-q0");
    expect(field(page).getAttribute("aria-describedby")).toBe("m-f-q0");
    expect(timeField(page).getAttribute("aria-describedby")).toBe("m-f-q0");
    expect(row.contains(timeField(page))).toBe(true);
    expect(calendarButton(page).getAttribute("aria-label")).toBe("Expected arrival, choose date");
    expect(clockButton(page).getAttribute("aria-label")).toBe("Expected arrival, choose time");
    expect(clockButton(page).getAttribute("aria-haspopup")).toBe("dialog");
    expect(clockButton(page).getAttribute("aria-expanded")).toBe("false");
    expect(clockButton(page).getAttribute("aria-controls")).toBe("f-q0-clockpanel");
    expect(timeField(page).getAttribute("placeholder")).toBe("--:--");
  });

  it("keeps the note that names the time zone of the event, under the boxes", () => {
    const page = boot();
    const slot = page.doc.getElementById("m-f-q0");
    expect(slot.textContent).toContain("Time in the event's time zone (Europe/Warsaw).");
    expect(boxOf(page, "dt").lastElementChild).toBe(slot);
  });

  it("holds the answer in one hidden control, the first data-control of the field, and the two text boxes are not controls", () => {
    const page = boot();
    expect(boxOf(page, "dt").querySelectorAll("[data-control]")).toHaveLength(1);
    expect(boxOf(page, "dt").querySelector("[data-control]")).toBe(carrierOf(page, "dt"));
    expect(field(page).hasAttribute("data-picker-trigger")).toBe(true);
    expect(timeField(page).hasAttribute("data-picker-trigger")).toBe(false);
    expect(timeField(page).hasAttribute("data-control")).toBe(false);
    expect(carrier(page)).toBe("");
  });

  it("is a date box and a time box on a form with several of them, each with its own ids", () => {
    const page = bootDates([DATETIME, question({ key: "d", label: "Arrival date", type: "date" }), question({ key: "e", label: "Departure", type: "datetime" })]);
    for (const id of ["f-q0", "f-q2"]) {
      expect(page.doc.getElementById(`${id}-time`)).not.toBeNull();
      expect(page.doc.getElementById(`${id}-cal`)).not.toBeNull();
      expect(page.doc.getElementById(`${id}-clock`)).not.toBeNull();
    }
    expect(page.doc.getElementById("f-q1-clock")).toBeNull();
    expect(page.doc.getElementById("f-q1-cal")).not.toBeNull();
    expect(page.doc.querySelectorAll("[id]")).toHaveLength(new Set([...page.doc.querySelectorAll("[id]")].map((el: Dom) => el.id)).size);
  });
});

describe("the answer of a date and time", { timeout: 30_000 }, () => {
  it("is the date and the time together, as the browser's own box gives them: YYYY-MM-DDTHH:mm, with no zone", () => {
    const page = boot();
    expect(type(page, "04/11/2026", "14:30")).toBe("2026-11-04T14:30");
    expect(isDateTimeAnswer(carrier(page))).toBe(true);
    expect(type(page, "29/02/2024", "00:00")).toBe("2024-02-29T00:00");
    expect(type(page, "31/12/2026", "23:59")).toBe("2026-12-31T23:59");
    expect(type(page, "01/01/2027", "6 pm")).toBe("2027-01-01T18:00");
  });

  it("is nothing while only the date or only the time is entered: that is not an answer yet", () => {
    const page = boot();
    expect(type(page, "04/11/2026", "")).toBe("");
    expect(type(page, "", "14:30")).toBe("");
    expect(type(page, "", "")).toBe("");
    expect(type(page, "abc", "14:30")).toBe("");
    expect(type(page, "04/11/2026", "abc")).toBe("");
  });

  it.each([
    ["04/11/2026", "14:30", "2026-11-04T14:30"],
    ["2024-02-29", "1430", "2024-02-29T14:30"],
    ["31/12/2026", "6:30 PM", "2026-12-31T18:30"],
    ["01/01/2026", "12am", "2026-01-01T00:00"],
    ["01/01/2026", "12:00 pm", "2026-01-01T12:00"],
    ["28/02/2023", "9", ""],
    ["28/02/2023", "09", "2023-02-28T09:00"],
  ])("sends what the browser's own box sends for %s %s", async (date, time, expected) => {
    const nativePage = bootPage([DATETIME]);
    if (expected) {
      nativePage.doc.getElementById("f-q0").value = expected;
      fillFixedFields(nativePage);
      sendForm(nativePage);
    }
    const page = boot();
    fillFixedFields(page);
    type(page, date, time);
    sendForm(page);
    if (expected === "") {
      expect(page.fetchMock).not.toHaveBeenCalled();
      return;
    }
    await until(() => expect(page.fetchMock).toHaveBeenCalledTimes(1));
    expect(sentBody(page).custom_data).toEqual({ dt: expected });
    expect(sentBody(page)).toEqual(sentBody(nativePage));
  });

  it("is left out when neither box is filled, as the browser's box leaves it", async () => {
    const page = boot();
    fillFixedFields(page);
    sendForm(page);
    await until(() => expect(page.fetchMock).toHaveBeenCalledTimes(1));
    expect(sentBody(page).custom_data).toBeUndefined();
  });

  it("is sent as typed, when the guest sent the form without leaving the boxes", async () => {
    const page = boot();
    fillFixedFields(page);
    type(page, "4.11.2026", "2:30pm");
    sendForm(page);
    await until(() => expect(page.fetchMock).toHaveBeenCalledTimes(1));
    expect(sentBody(page).custom_data).toEqual({ dt: "2026-11-04T14:30" });
  });

  it("starts from a value the browser filled in before the script ran", () => {
    const page = boot({
      before: (doc) => {
        doc.getElementById("f-q0").value = "2026-03-09T07:05";
      },
    });
    expect(field(page).value).toBe("09/03/2026");
    expect(timeField(page).value).toBe("07:05");
    expect(carrier(page)).toBe("2026-03-09T07:05");
  });
});

describe("a date and time that is required, begun and not finished, or refused", { timeout: 30_000 }, () => {
  const required = () => bootDates([question({ key: "dt", label: "Expected arrival", type: "datetime", required: true })]);
  const message = (page: ScriptPage): string => boxOf(page, "dt").querySelector("[data-msg-text]").textContent;

  it("says that a date and time are needed when a required one is empty", async () => {
    const page = required();
    fillFixedFields(page);
    sendForm(page);
    expect(page.fetchMock).not.toHaveBeenCalled();
    expect(message(page)).toBe("Enter a date and time.");
    expect(focused(page)).toBe(field(page));
    await tick();
    expect(field(page).getAttribute("aria-invalid")).toBe("true");
    expect(timeField(page).getAttribute("aria-invalid")).toBe("true");
    expect(timeField(page).classList.contains("at-input--invalid")).toBe(true);
    expect(field(page).required).toBe(true);
    expect(timeField(page).required).toBe(true);
  });

  it.each([
    ["only a date", "04/11/2026", ""],
    ["only a time", "", "14:30"],
    ["a date that is none", "31/04/2026", "14:30"],
    ["a time that is none", "04/11/2026", "25:00"],
    ["a date and a time that are none", "x", "y"],
  ])("says that the date and time are not valid for %s, even when the question is not required", async (_name, date, time) => {
    const page = boot();
    fillFixedFields(page);
    type(page, date, time);
    sendForm(page);
    expect(page.fetchMock).not.toHaveBeenCalled();
    expect(message(page)).toBe("Enter a valid date and time.");
    expect(focused(page)).toBe(field(page));
    await tick();
    expect(timeField(page).getAttribute("aria-invalid")).toBe("true");
  });

  it("clears the error and the marks when the guest edits either box", async () => {
    const page = required();
    fillFixedFields(page);
    sendForm(page);
    await tick();
    typeInto(page, "f-q0-time", "1");
    expect(boxOf(page, "dt").classList.contains("has-error")).toBe(false);
    await tick();
    expect(field(page).hasAttribute("aria-invalid")).toBe(false);
    expect(timeField(page).hasAttribute("aria-invalid")).toBe(false);
    expect(timeField(page).classList.contains("at-input--invalid")).toBe(false);
  });

  it("shows the sentence of the page, not the server's text, when the server refuses the answer", async () => {
    const page = boot();
    fillFixedFields(page);
    type(page, "04/11/2026", "14:30");
    page.fetchMock.mockResolvedValueOnce({ status: 422, json: async () => ({ errors: { "custom_data.dt": "Server says: bad time <i>x</i>" } }) });
    sendForm(page);
    await until(() => expect(message(page)).toBe("Enter a valid date and time."));
    expect(boxOf(page, "dt").textContent).not.toContain("Server says");
    await tick();
    expect(field(page).getAttribute("aria-invalid")).toBe("true");
  });
});

describe("a date and time that waits for another answer, and the guest's companion's", { timeout: 30_000 }, () => {
  const CAR = question({ key: "car", label: "I will drive", type: "boolean" });
  const WAITING = question({ key: "dt", label: "Expected arrival", type: "datetime", required: true, showWhen: { field: "car", value: true } });

  it("is hidden, disabled and not required until it is asked: both boxes and both buttons", async () => {
    const page = bootDates([CAR, WAITING]);
    const ids = ["f-q1", "f-q1-time", "f-q1-cal", "f-q1-clock"];
    expect(boxOf(page, "dt").hidden).toBe(true);
    for (const id of ids) expect(page.doc.getElementById(id).disabled, id).toBe(true);
    page.doc.getElementById("f-q0").click();
    await tick();
    expect(boxOf(page, "dt").hidden).toBe(false);
    for (const id of ids) expect(page.doc.getElementById(id).disabled, id).toBe(false);
    expect(page.doc.getElementById("f-q1").required).toBe(true);
    expect(page.doc.getElementById("f-q1-time").required).toBe(true);
  });

  it("is neither checked nor sent while it is not asked, and what was typed in it is kept", async () => {
    const page = bootDates([CAR, WAITING]);
    fillFixedFields(page);
    page.doc.getElementById("f-q0").click();
    typeInto(page, "f-q1", "12/11/2026");
    typeInto(page, "f-q1-time", "08:15");
    page.doc.getElementById("f-q0").click();
    await tick();
    sendForm(page);
    await until(() => expect(page.fetchMock).toHaveBeenCalledTimes(1));
    expect(sentBody(page).custom_data).toBeUndefined();
    page.doc.getElementById("f-q0").click();
    await tick();
    expect(carrierOf(page, "dt").value).toBe("2026-11-12T08:15");
  });

  it("closes the list when the question stops being asked", async () => {
    const page = bootDates([CAR, WAITING]);
    page.doc.getElementById("f-q0").click();
    await tick();
    click(page, page.doc.getElementById("f-q1-clock"));
    expect(page.doc.getElementById("f-q1-clockpanel").hidden).toBe(false);
    page.doc.getElementById("f-q0").click();
    await tick();
    expect(page.doc.getElementById("f-q1-clockpanel").hidden).toBe(true);
  });

  it("is sent under the companion when the companion is asked it", async () => {
    const page = bootDates([], { model: { companion: { max: 1, questions: [question({ key: "when", label: "Guest arrival", type: "datetime", required: true })] } } });
    const id = boxOf(page, "when").querySelector("input[type=text]").id;
    expect(id).toMatch(/^f-c\d+$/);
    expect(page.doc.getElementById(`${id}-time`).disabled).toBe(true);
    page.doc.querySelector("[data-companion-toggle]").click();
    await tick();
    expect(page.doc.getElementById(`${id}-time`).disabled).toBe(false);
    fillFixedFields(page);
    typeInto(page, "f-companion_name", "Piotr");
    typeInto(page, id, "05/11/2026");
    typeInto(page, `${id}-time`, "10:45");
    sendForm(page);
    await until(() => expect(page.fetchMock).toHaveBeenCalledTimes(1));
    expect(sentBody(page).companions).toEqual([{ name: "Piotr", answers: { when: "2026-11-05T10:45" } }]);
  });
});

describe("a time typed in the box", { timeout: 30_000 }, () => {
  const typedTime = (page: ScriptPage, text: string): string => {
    typeInto(page, "f-q0", "04/11/2026");
    typeInto(page, "f-q0-time", text);
    return carrier(page).slice(11);
  };

  it.each([
    ["18", "18:00"],
    ["1800", "18:00"],
    ["18:00", "18:00"],
    ["18 30", "18:30"],
    ["0", ""],
    ["00", "00:00"],
    ["0:00", "00:00"],
    ["9", ""],
    ["09", "09:00"],
    ["930", "09:30"],
    ["9:5", "09:05"],
    ["6pm", "18:00"],
    ["6 PM", "18:00"],
    ["6:30 PM", "18:30"],
    ["630p.m.", "18:30"],
    ["12am", "00:00"],
    ["12:30 am", "00:30"],
    ["12pm", "12:00"],
    ["12:59 PM", "12:59"],
    ["1am", "01:00"],
    ["11:59pm", "23:59"],
    ["23:59", "23:59"],
    ["  7:05  ", "07:05"],
  ])("reads %j as %j", (text, expected) => {
    const page = boot();
    expect(typedTime(page, text)).toBe(expected);
  });

  it.each(["", "   ", "24", "24:00", "2400", "25", "18:60", "18:99", "13pm", "0am", "0pm", "13 am", "7:5x", "abc", "6:", ":30", "18:30:15", "1:2:3", "+18", "-1", "12345", "6 p", "6pmm"])(
    "reads %j as no time",
    (text) => {
      const page = boot();
      expect(typedTime(page, text)).toBe("");
    },
  );

  it("reads every text of up to four digits, and the same with a colon, a space and a meridiem, as the staff app's box does", () => {
    const page = boot();
    let checked = 0;
    const texts: string[] = [];
    for (let n = 0; n < 10000; n += 7) texts.push(String(n));
    for (let h = 0; h < 26; h += 1) {
      for (const m of [0, 5, 9, 30, 59, 60, 99]) {
        texts.push(`${h}:${m}`, `${h} ${m}`, `${h}:${String(m).padStart(2, "0")} pm`, `${h}:${String(m).padStart(2, "0")}am`, `${h}pm`, `${h}a.m.`);
      }
    }
    for (const text of texts) {
      expect(typedTime(page, text), text).toBe(reference(text));
      checked += 1;
    }
    expect(checked).toBe(texts.length);
    expect(checked).toBeGreaterThan(1500);
  });

  it("writes a time that was typed in another way the way the box writes it, when the box is left", () => {
    const page = boot();
    typeInto(page, "f-q0-time", "6pm");
    expect(timeField(page).value).toBe("6pm");
    leave(page, timeField(page));
    expect(timeField(page).value).toBe("18:00");
    typeInto(page, "f-q0-time", "930");
    leave(page, timeField(page));
    expect(timeField(page).value).toBe("09:30");
  });

  it("keeps the text that is no time as it was typed, so that it can be corrected", () => {
    const page = boot();
    typeInto(page, "f-q0-time", "25:61");
    leave(page, timeField(page));
    expect(timeField(page).value).toBe("25:61");
  });

  it("has a 12-hour clock in a browser from a region that has one: the box writes AM and PM and takes both ways", () => {
    const page = boot({ languages: ["en-US"] });
    expect(timeField(page).getAttribute("placeholder")).toBe("--:-- AM");
    typeInto(page, "f-q0", "11/04/2026");
    typeInto(page, "f-q0-time", "1830");
    leave(page, timeField(page));
    expect(timeField(page).value).toBe("6:30 PM");
    expect(carrier(page)).toBe("2026-11-04T18:30");
    typeInto(page, "f-q0-time", "12:05 am");
    leave(page, timeField(page));
    expect(timeField(page).value).toBe("12:05 AM");
    expect(carrier(page)).toBe("2026-11-04T00:05");
    typeInto(page, "f-q0-time", "12");
    leave(page, timeField(page));
    expect(timeField(page).value).toBe("12:00 PM");
    expect(carrier(page)).toBe("2026-11-04T12:00");
  });
});

describe("the list of times", { timeout: 30_000 }, () => {
  it("is closed until the clock is pressed, and draws nothing until then", () => {
    const page = boot();
    expect(clockOpen(page)).toBe(false);
    expect(options(page, "hours")).toHaveLength(0);
    expect(clockPanel(page).getAttribute("role")).toBe("dialog");
    expect(clockPanel(page).getAttribute("aria-label")).toBe("Expected arrival, choose time");
  });

  it("has the hours 00 to 23 and the minutes 00 to 59, a minute apart, for a 24-hour clock, and no column of AM and PM", () => {
    const page = boot();
    openClock(page);
    expect(clockOpen(page)).toBe(true);
    expect(clockButton(page).getAttribute("aria-expanded")).toBe("true");
    expect(optionText(page, "hours")).toEqual(Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, "0")));
    expect(optionText(page, "minutes")).toEqual(Array.from({ length: 60 }, (_, minute) => String(minute).padStart(2, "0")));
    expect(options(page, "meridiem")).toHaveLength(0);
    expect(clockPanel(page).querySelector("[data-time-meridiem-col]").hidden).toBe(true);
    expect(list(page, "hours").getAttribute("role")).toBe("listbox");
    expect(list(page, "hours").getAttribute("aria-label")).toBe("Hour");
    expect(list(page, "minutes").getAttribute("aria-label")).toBe("Minute");
    expect(options(page, "hours")[0]!.getAttribute("role")).toBe("option");
    expect(chosen(page, "hours")).toEqual([]);
  });

  it("has the hours 01 to 12, the minutes and AM and PM for a 12-hour clock", () => {
    const page = boot({ languages: ["en-US"] });
    openClock(page);
    expect(optionText(page, "hours")).toEqual(Array.from({ length: 12 }, (_, hour) => String(hour + 1).padStart(2, "0")));
    expect(options(page, "minutes")).toHaveLength(60);
    expect(optionText(page, "meridiem")).toEqual(["AM", "PM"]);
    expect(clockPanel(page).querySelector("[data-time-meridiem-col]").hidden).toBe(false);
    expect(clockPanel(page).classList.contains("reg-time--twelve")).toBe(true);
    expect(list(page, "meridiem").getAttribute("aria-label")).toBe("AM or PM");
  });

  it("puts the focus on the hour 09, which is in the order of the Tab key of its column, and chooses nothing", () => {
    const page = boot();
    openClock(page);
    expect(focused(page)).toBe(optionOf(page, "hours", "09"));
    for (const kind of ["hours", "minutes"] as const) {
      expect(options(page, kind).filter((item) => item.getAttribute("tabindex") === "0")).toHaveLength(1);
    }
    expect(optionOf(page, "minutes", "00").getAttribute("tabindex")).toBe("0");
    expect(chosen(page, "hours")).toEqual([]);
    expect(timeField(page).value).toBe("");
  });

  it("completes the time with the default of the other part: an hour makes hh:00, a minute makes 09:mm", () => {
    const page = boot();
    typeInto(page, "f-q0", "04/11/2026");
    openClock(page);
    click(page, optionOf(page, "hours", "14"));
    expect(timeField(page).value).toBe("14:00");
    expect(carrier(page)).toBe("2026-11-04T14:00");
    click(page, optionOf(page, "minutes", "30"));
    expect(timeField(page).value).toBe("14:30");
    expect(carrier(page)).toBe("2026-11-04T14:30");
    expect(chosen(page, "hours")).toEqual(["14"]);
    expect(chosen(page, "minutes")).toEqual(["30"]);
    expect(clockOpen(page)).toBe(true);

    const other = boot();
    typeInto(other, "f-q0", "04/11/2026");
    openClock(other);
    click(other, optionOf(other, "minutes", "45"));
    expect(timeField(other).value).toBe("09:45");
    expect(carrier(other)).toBe("2026-11-04T09:45");
  });

  it("works out the hour of a 12-hour clock with AM and PM: 12 AM is midnight, 12 PM is noon", () => {
    const page = boot({ languages: ["en-US"] });
    typeInto(page, "f-q0", "11/04/2026");
    openClock(page);
    click(page, optionOf(page, "hours", "06"));
    expect(timeField(page).value).toBe("6:00 AM");
    click(page, optionOf(page, "meridiem", "PM"));
    expect(timeField(page).value).toBe("6:00 PM");
    expect(carrier(page)).toBe("2026-11-04T18:00");
    click(page, optionOf(page, "minutes", "30"));
    expect(carrier(page)).toBe("2026-11-04T18:30");
    click(page, optionOf(page, "hours", "12"));
    expect(timeField(page).value).toBe("12:30 PM");
    expect(carrier(page)).toBe("2026-11-04T12:30");
    click(page, optionOf(page, "meridiem", "AM"));
    expect(timeField(page).value).toBe("12:30 AM");
    expect(carrier(page)).toBe("2026-11-04T00:30");
    expect(chosen(page, "meridiem")).toEqual(["AM"]);
  });

  it("shows the time that was typed, as chosen, when it opens", () => {
    const page = boot();
    type(page, "04/11/2026", "7:45");
    openClock(page);
    expect(chosen(page, "hours")).toEqual(["07"]);
    expect(chosen(page, "minutes")).toEqual(["45"]);
    expect(focused(page)).toBe(optionOf(page, "hours", "07"));
  });

  it("tells the form that the box changed, so that the error of the field is cleared", () => {
    const page = bootDates([question({ key: "dt", label: "Expected arrival", type: "datetime", required: true })]);
    fillFixedFields(page);
    sendForm(page);
    expect(boxOf(page, "dt").classList.contains("has-error")).toBe(true);
    openClock(page);
    click(page, optionOf(page, "hours", "10"));
    expect(boxOf(page, "dt").classList.contains("has-error")).toBe(false);
  });

  it("closes on a press outside, on Escape (the focus returns to the clock) and when the focus leaves", () => {
    const page = boot();
    openClock(page);
    pressOutside(page);
    expect(clockOpen(page)).toBe(false);
    openClock(page);
    press(page, "Escape");
    expect(clockOpen(page)).toBe(false);
    expect(focused(page)).toBe(clockButton(page));
    openClock(page);
    const item = focused(page);
    item.dispatchEvent(new page.win.FocusEvent("focusout", { bubbles: true, relatedTarget: page.doc.getElementById("f-first_name") }));
    expect(clockOpen(page)).toBe(false);
    openClock(page);
    click(page, clockButton(page));
    expect(clockOpen(page)).toBe(false);
  });

  it("closes the calendar when the list opens, and the list when the calendar opens", () => {
    const page = boot();
    click(page, calendarButton(page));
    expect(calendar(page).hidden).toBe(false);
    pressOutside(page);
    openClock(page);
    expect(calendar(page).hidden).toBe(true);
    expect(clockOpen(page)).toBe(true);
    pressOutside(page);
    click(page, calendarButton(page));
    expect(clockOpen(page)).toBe(false);
  });
});

describe("the keys of the list of times", { timeout: 30_000 }, () => {
  const started = (languages?: string[]) => {
    const page = boot(languages ? { languages } : {});
    typeInto(page, "f-q0", "2026-11-04");
    openClock(page);
    return page;
  };

  it("chooses the next and the previous hour with Down and Up, and the first and the last with Home and End", () => {
    const page = started();
    press(page, "ArrowDown");
    expect(timeField(page).value).toBe("10:00");
    expect(focused(page)).toBe(optionOf(page, "hours", "10"));
    press(page, "ArrowUp");
    press(page, "ArrowUp");
    expect(timeField(page).value).toBe("08:00");
    press(page, "Home");
    expect(timeField(page).value).toBe("00:00");
    press(page, "End");
    expect(timeField(page).value).toBe("23:00");
    press(page, "ArrowDown");
    expect(timeField(page).value).toBe("23:00");
    expect(carrier(page)).toBe("2026-11-04T23:00");
  });

  it("goes to the next column with Right, to the previous with Left, and does not go past the columns", () => {
    const page = started();
    press(page, "ArrowRight");
    expect(focused(page)).toBe(optionOf(page, "minutes", "00"));
    press(page, "ArrowDown");
    press(page, "ArrowDown");
    expect(timeField(page).value).toBe("09:02");
    press(page, "ArrowRight");
    expect(focused(page)).toBe(optionOf(page, "minutes", "02"));
    press(page, "ArrowLeft");
    expect(focused(page)).toBe(optionOf(page, "hours", "09"));
    press(page, "ArrowLeft");
    expect(focused(page)).toBe(optionOf(page, "hours", "09"));
  });

  it("goes on to the AM and PM column of a 12-hour clock", () => {
    const page = started(["en-US"]);
    press(page, "ArrowRight");
    press(page, "ArrowRight");
    expect(focused(page)).toBe(optionOf(page, "meridiem", "AM"));
    press(page, "ArrowDown");
    expect(timeField(page).value).toBe("9:00 PM");
    expect(carrier(page)).toBe("2026-11-04T21:00");
  });

  it("chooses the option that has the focus with Space, and with Enter, which closes the list and gives the focus to the clock", () => {
    const page = started();
    press(page, " ");
    expect(timeField(page).value).toBe("09:00");
    expect(clockOpen(page)).toBe(true);
    press(page, "ArrowRight");
    press(page, "ArrowDown");
    press(page, "Enter");
    expect(timeField(page).value).toBe("09:01");
    expect(clockOpen(page)).toBe(false);
    expect(focused(page)).toBe(clockButton(page));
    expect(page.fetchMock).not.toHaveBeenCalled();
  });

  it("has one option of each column in the order of the Tab key, the one that is chosen", () => {
    const page = started();
    press(page, "ArrowDown");
    for (const kind of ["hours", "minutes"] as const) {
      expect(options(page, kind).filter((item) => item.getAttribute("tabindex") === "0")).toHaveLength(1);
    }
    expect(optionOf(page, "hours", "10").getAttribute("tabindex")).toBe("0");
    expect(optionOf(page, "hours", "09").getAttribute("tabindex")).toBe("-1");
  });

  it("takes the keys it uses away from the page, and leaves the others", () => {
    const page = started();
    expect(press(page, "ArrowDown")).toBe(false);
    expect(press(page, "ArrowRight")).toBe(false);
    expect(press(page, "Home")).toBe(false);
    expect(press(page, "Tab")).toBe(true);
    expect(press(page, "a")).toBe(true);
    expect(press(page, "ArrowDown", { ctrlKey: true })).toBe(true);
    expect(press(page, "ArrowDown", { altKey: true })).toBe(true);
  });

  it("opens from the time box with the Down key", () => {
    const page = boot();
    timeField(page).focus();
    expect(press(page, "ArrowDown")).toBe(false);
    expect(clockOpen(page)).toBe(true);
    expect(focused(page)).toBe(optionOf(page, "hours", "09"));
  });
});

describe("Clear on the calendar of a date and time", { timeout: 30_000 }, () => {
  it("empties the date and the time together, and is not offered for a required question", () => {
    const page = boot();
    type(page, "04/11/2026", "14:30");
    click(page, calendarButton(page));
    click(page, calendar(page).querySelector("[data-date-clear]"));
    expect(field(page).value).toBe("");
    expect(timeField(page).value).toBe("");
    expect(carrier(page)).toBe("");
    const required = bootDates([question({ key: "dt", label: "Expected arrival", type: "datetime", required: true })]);
    click(required, calendarButton(required));
    expect(calendar(required).querySelector("[data-date-clear]").hidden).toBe(true);
  });

  it("picks the date with the calendar and keeps the time", () => {
    const page = boot();
    typeInto(page, "f-q0-time", "14:30");
    click(page, calendarButton(page));
    click(page, dayOf(page, "2026-11-12"));
    expect(carrier(page)).toBe("2026-11-12T14:30");
    expect(calendarButton(page).getAttribute("aria-label")).toContain("change date");
    expect(clockButton(page).getAttribute("aria-label")).toBe("Expected arrival, change time, 14:30");
  });
});

describe("by touch", { timeout: 30_000 }, () => {
  it("opens the calendar with a tap on the button, picks a day with a tap, and closes with the focus on the button", () => {
    const page = boot();
    tap(page, calendarButton(page));
    expect(calendar(page).hidden).toBe(false);
    tap(page, dayOf(page, "2026-11-18"));
    expect(calendar(page).hidden).toBe(true);
    expect(field(page).value).toBe("18/11/2026");
    expect(carrierOf(page, "dt").value).toBe("");
    expect(focused(page)).toBe(calendarButton(page));
  });

  it("closes the calendar with a second tap on the button, and does not open it again", () => {
    const page = boot();
    tap(page, calendarButton(page));
    tap(page, calendarButton(page));
    expect(calendar(page).hidden).toBe(true);
    expect(calendarButton(page).getAttribute("aria-expanded")).toBe("false");
  });

  it("closes the calendar with a tap outside, and with a tap on the other button, which opens the list of times", () => {
    const page = boot();
    tap(page, calendarButton(page));
    tap(page, page.doc.getElementById("f-first_name"));
    expect(calendar(page).hidden).toBe(true);
    tap(page, calendarButton(page));
    tap(page, clockButton(page));
    expect(calendar(page).hidden).toBe(true);
    expect(clockOpen(page)).toBe(true);
    tap(page, calendarButton(page));
    expect(clockOpen(page)).toBe(false);
    expect(calendar(page).hidden).toBe(false);
  });

  it("chooses an hour and a minute with a tap, keeps the list open between them, and closes it with a tap outside", () => {
    const page = boot();
    typeInto(page, "f-q0", "04/11/2026");
    tap(page, clockButton(page));
    tap(page, optionOf(page, "hours", "17"));
    expect(clockOpen(page)).toBe(true);
    tap(page, optionOf(page, "minutes", "45"));
    expect(carrier(page)).toBe("2026-11-04T17:45");
    expect(clockOpen(page)).toBe(true);
    tap(page, page.doc.getElementById("f-first_name"));
    expect(clockOpen(page)).toBe(false);
    expect(timeField(page).value).toBe("17:45");
  });

  it("taps a blank cell and the Today button: nothing happens for the cell, and today is picked for the button", () => {
    const page = boot();
    tap(page, calendarButton(page));
    const blank = [...calendar(page).querySelectorAll("tbody td")].find((cell: Dom) => !cell.hasAttribute("data-iso"));
    tap(page, blank);
    expect(calendar(page).hidden).toBe(false);
    tap(page, calendar(page).querySelector("[data-date-today]"));
    expect(field(page).value).toBe("04/11/2026");
    expect(calendar(page).hidden).toBe(true);
  });
});
