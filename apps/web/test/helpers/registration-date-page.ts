import type { FormQuestion, RegistrationFormModel } from "../../src/registration/form-model.js";
import { question, type Dom } from "./registration-form-fixtures.js";
import { bootPage, boxOf, type ScriptPage } from "./registration-script-page.js";

/** How a test sets up the guest's browser: its languages (the first one gives the order of a date, the first day of the week and the
 * clock) and the day it is. The words on the page are English, as the page's `lang` is. */
export interface DatePageOptions {
  languages?: string[];
  today?: string;
  model?: Partial<RegistrationFormModel>;
  before?: (doc: Dom) => void;
}

/** A date from the window's own clock: `new Date()` of the page's script is `iso` at noon, and every other date is a real one. */
function freezeToday(win: Dom, iso: string): void {
  const [year, month, day] = iso.split("-").map(Number);
  const Real = win.Date;
  class Fixed extends Real {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(...args: any[]) {
      if (args.length === 0) super(year, month! - 1, day, 12, 0, 0);
      else super(...args);
    }
  }
  win.Date = Fixed;
}

/** The page of an event with the styled boxes on and these questions, with the guest's browser set up as asked. The default browser is
 * a British English one on 4 November 2026 (a Wednesday): day first, the week from Monday, a 24-hour clock. */
export function bootDates(questions: readonly FormQuestion[], options: DatePageOptions = {}): ScriptPage {
  return bootPage(questions, {
    model: { styledControls: true, ...options.model },
    before: (doc) => {
      const win = doc.defaultView;
      const languages = options.languages ?? ["en-GB"];
      Object.defineProperty(win.navigator, "languages", { value: languages, configurable: true });
      Object.defineProperty(win.navigator, "language", { value: languages[0], configurable: true });
      freezeToday(win, options.today ?? "2026-11-04");
      options.before?.(doc);
    },
  });
}

/** One optional date question, `d`, as f-q0. */
export const DATE = question({ key: "d", label: "Arrival date", type: "date" });
/** One optional date and time question, `dt`, as f-q0. */
export const DATETIME = question({ key: "dt", label: "Expected arrival", type: "datetime" });

export const field = (page: ScriptPage, id = "f-q0"): Dom => page.doc.getElementById(id);
export const carrierOf = (page: ScriptPage, key: string): Dom => boxOf(page, key).querySelector("input[type=hidden]");
export const calendarButton = (page: ScriptPage, id = "f-q0"): Dom => page.doc.getElementById(`${id}-cal`);
export const calendar = (page: ScriptPage, id = "f-q0"): Dom => page.doc.getElementById(`${id}-calpanel`);
export const clockButton = (page: ScriptPage, id = "f-q0"): Dom => page.doc.getElementById(`${id}-clock`);
export const clockPanel = (page: ScriptPage, id = "f-q0"): Dom => page.doc.getElementById(`${id}-clockpanel`);
export const timeField = (page: ScriptPage, id = "f-q0"): Dom => page.doc.getElementById(`${id}-time`);
/** Every day cell of the month on show, in order. A blank cell is one with no date. */
export const days = (page: ScriptPage, id = "f-q0"): Dom[] => [...calendar(page, id).querySelectorAll("tbody td")];
export const dayOf = (page: ScriptPage, iso: string, id = "f-q0"): Dom => calendar(page, id).querySelector(`td[data-iso="${iso}"]`);
export const focused = (page: ScriptPage): Dom => page.doc.activeElement;

export function click(page: ScriptPage, el: Dom): void {
  el.dispatchEvent(new page.win.MouseEvent("click", { bubbles: true, cancelable: true }));
}

/** What a browser of a touch screen sends for a tap: the pointer, then the mouse events it keeps for old pages, then the click. */
export function tap(page: ScriptPage, el: Dom): void {
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
    el.dispatchEvent(new page.win.MouseEvent(type, { bubbles: true, cancelable: true }));
  }
}

/** A key pressed in `el` (the element that has the focus when omitted); false when a listener cancelled it. */
export function press(page: ScriptPage, key: string, init: Record<string, unknown> = {}, el: Dom = page.doc.activeElement): boolean {
  return el.dispatchEvent(new page.win.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
}

/** What a guest does when they leave a text box they typed in: the browser's `change`. */
export function leave(page: ScriptPage, el: Dom): void {
  el.dispatchEvent(new page.win.Event("change", { bubbles: true }));
}

/** A tap outside whatever is open. */
export function pressOutside(page: ScriptPage): void {
  page.doc.body.dispatchEvent(new page.win.Event("pointerdown", { bubbles: true }));
}

export const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
