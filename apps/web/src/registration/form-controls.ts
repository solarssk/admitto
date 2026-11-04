/**
 * The styled boxes of the registration form (D-E9), as far as the server writes them.
 *
 * An event can switch on "styled boxes" (`styled_form_controls`, one switch for the event and none per field). The form is then
 * the same form: every box is still the browser's own control in the HTML, with the same ids, names and messages, and a second
 * script (./form-controls-script.ts) turns the ones it knows into the product's own boxes. If that script does not run, the
 * browser's boxes are what the guest has, and they work. Only this page's markup for an event that has the switch on carries
 * anything of this file; the page of every other event is the page it was.
 *
 * What the server adds, only when the switch is on and the form has a question that needs it:
 * - `data-controls="styled"` on the form (./form-page.ts) and `data-styled="<kind>"` on the field of a question that the second
 *   script is to take over (./form-fields.ts). The kind is `phone`, `date` or `datetime`;
 * - a `<template>` with the markup of each box's parts (the phone's country button and its list, the calendar button and its
 *   month, the clock button and its lists of hours and minutes), so that the script clones markup that was written, tested and
 *   escaped here, and builds none of its own. A form gets the templates of the boxes it has and no other, and the script gets the
 *   code of the same boxes (./form-controls-script.ts), so a page without a date or a time is not heavier for them;
 * - the countries as a hidden list of data rows, `<li data-iso="PL" data-dial="+48">Poland</li>`: the same list the staff app
 *   shows (`@admitto/shared/phone-countries`), one row for each, with the name as the text of the row. The script reads them with
 *   `getAttribute` and `textContent` and sets what it draws as text, so they are data in the page and never code. They are the
 *   same for every event and every request, and nothing of the database is among them.
 *
 * A date and a date and time have no rule an organiser can set that a calendar could not keep (the rules of a question are
 * lengths, digits, an example, an icon and a condition, and only the first three touch the answer, which they do for text and
 * phone only), so every question of those two types is taken over when the switch is on. A phone question with a rule that
 * shapes the number stays the browser's box.
 */
import { PHONE_COUNTRIES } from "@admitto/shared/phone-countries";
import { esc } from "../ticket-page.js";
import { icon } from "./form-icons.js";
import type { FormQuestion, RegistrationFormModel } from "./form-model.js";

/** What a form with the switch on needs beyond the phone box, which every such page carries. `date`: some question is a date
 * or a date and time. `time`: some question is a date and time. */
export interface StyledNeeds {
  date: boolean;
  time: boolean;
}

/** The kind of box a question gets with the switch on, or undefined when the browser's box stays. */
export type StyledKind = "phone" | "date" | "datetime";

/**
 * Whether the styled phone box (a list of countries beside the number) fits a phone question. It does not when the organiser's
 * rules shape the answer as a bare number: `digits_only` refuses the `+` that a country code puts in front, and a length counts
 * the characters of the stored answer, the code included. The server keeps the answer as `+` and the digits, so a country picked
 * for such a question would make an answer the server refuses. That question keeps the browser's box, which is what its rules are
 * written for (a desk extension, say).
 */
export function wantsCountryPicker(question: FormQuestion): boolean {
  if (question.type !== "phone") return false;
  const rules = question.rules;
  return !rules || (rules.digits_only !== true && rules.min_length === undefined && rules.max_length === undefined);
}

/**
 * The country button and its list, for a script to clone. The button is the product's searchable-select button and the list its
 * panel (a search box and the rows), laid out by ./form-style.ts. The ids and the rows are the script's: it gives each box its own
 * ids from the id of the field, and builds the rows from the data list below. The list has `tabindex="-1"`: a list that scrolls
 * is a stop of the Tab key in Chrome, and this one is driven from the search box (`aria-activedescendant`), so Tab goes from the
 * search box on to the next field.
 */
const PHONE_KIT = `<template id="reg-phone-kit"><div class="reg-phone__code" data-phone-code><button type="button" class="searchable-select__trigger" aria-haspopup="listbox" aria-expanded="false" data-phone-trigger><span class="reg-phone__flag" aria-hidden="true" data-phone-flag></span><span class="reg-phone__dial" data-phone-dial></span>${icon("chevron-down", "ic searchable-select__chevron")}</button><div class="searchable-select__panel reg-phone__panel" data-phone-panel hidden><input type="text" class="searchable-select__search" role="combobox" aria-autocomplete="list" aria-expanded="true" aria-label="Search country or dial code" placeholder="Search country or code" autocomplete="off" autocapitalize="none" spellcheck="false" data-phone-search><ul class="searchable-select__list" role="listbox" aria-label="Countries" tabindex="-1" data-phone-list><li class="searchable-select__empty" role="presentation" data-phone-empty hidden>No countries match.</li></ul></div></div></template>`;

/** One row for each country, in the order of `PHONE_COUNTRIES` (by name). Built once, as the countries never change. */
const COUNTRY_DATA = `<ul id="reg-phone-countries" hidden>${PHONE_COUNTRIES.map(
  (country) => `<li data-iso="${esc(country.iso2)}" data-dial="${esc(country.dialCode)}">${esc(country.name)}</li>`,
).join("")}</ul>`;

/** The kind of styled box a question gets when the event switched them on, or undefined when the question keeps the browser's box:
 * a phone question the rules of which leave room for a country code, and every date and every date and time. */
export function styledKindOf(question: FormQuestion): StyledKind | undefined {
  if (question.type === "date" || question.type === "datetime") return question.type;
  return wantsCountryPicker(question) ? "phone" : undefined;
}

/** Every question the form asks: the guest's own and the companion's. */
function allQuestions(model: RegistrationFormModel): readonly FormQuestion[] {
  return [...model.questions, ...(model.companion?.questions ?? [])];
}

/** What the page of this form needs besides the phone box, or null for an event without the switch. */
export function styledNeedsOf(model: RegistrationFormModel): StyledNeeds | null {
  if (!model.styledControls) return null;
  const kinds = new Set(allQuestions(model).map(styledKindOf));
  return { date: kinds.has("date") || kinds.has("datetime"), time: kinds.has("datetime") };
}

/**
 * The calendar button and its month, for a script to clone. The button is a square beside the date box, the month is a panel
 * under it in the flow of the form (the card of the page clips what sticks out of it, so a panel is never laid over the form).
 * The panel is a dialog that holds a month and a grid of days (ARIA's date picker dialog): the names of the days, the title of
 * the month and the days are the script's, from `Intl`, as text; the words here are the form's own. The arrows are inline
 * paths, as the sprite of the page is shared by every page and is not changed for a box that few pages have.
 */
const DATE_KIT = `<template id="reg-date-kit"><div class="reg-dt__pop" data-date-pop><button type="button" class="reg-dt__button" aria-haspopup="dialog" aria-expanded="false" data-date-trigger>${icon("calendar")}</button><div class="reg-dt__panel reg-date" role="dialog" aria-label="Choose date" data-date-panel hidden><div class="reg-date__head"><button type="button" class="reg-date__nav" aria-label="Previous month" data-date-prev><svg class="ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M15 6l-6 6l6 6"/></svg></button><div class="reg-date__month" aria-live="polite" aria-atomic="true" data-date-month></div><button type="button" class="reg-date__nav" aria-label="Next month" data-date-next><svg class="ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9 6l6 6l-6 6"/></svg></button></div><table class="reg-date__grid" role="grid" data-date-grid><thead><tr data-date-weekdays></tr></thead><tbody data-date-rows></tbody></table><div class="reg-date__foot"><button type="button" class="reg-date__action" data-date-clear>Clear</button><button type="button" class="reg-date__action" data-date-today>Today</button></div></div></div></template>`;

/**
 * The time box of a date and time, for a script to clone: the text box, the clock button and the lists of hours, minutes and (for
 * a 12-hour clock) AM and PM. The lists are filled by the script, from numbers, as text. Each list is a listbox, driven by the keys
 * from its options; the column of AM and PM is hidden until the clock is a 12-hour one.
 */
const TIME_KIT = `<template id="reg-time-kit"><div class="reg-dt__time" data-time-root><div class="at-control"><input class="at-input" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" data-time-input></div><div class="reg-dt__pop" data-time-pop><button type="button" class="reg-dt__button" aria-haspopup="dialog" aria-expanded="false" data-time-trigger>${icon("clock")}</button><div class="reg-dt__panel reg-time" role="dialog" aria-label="Choose time" data-time-panel hidden><div class="reg-time__col"><span class="reg-time__label" aria-hidden="true">Hour</span><ul class="reg-time__list" role="listbox" aria-label="Hour" tabindex="-1" data-time-hours></ul></div><div class="reg-time__col"><span class="reg-time__label" aria-hidden="true">Minute</span><ul class="reg-time__list" role="listbox" aria-label="Minute" tabindex="-1" data-time-minutes></ul></div><div class="reg-time__col" data-time-meridiem-col hidden><span class="reg-time__label" aria-hidden="true">AM/PM</span><ul class="reg-time__list" role="listbox" aria-label="AM or PM" tabindex="-1" data-time-meridiem></ul></div></div></div></div></template>`;

/** What the second script needs in the page, or nothing: for an event without the switch, and for a form with no question that
 * the script would take over. The phone's markup and data come first, as they did before the date and the time were added. */
export function renderStyledControls(model: RegistrationFormModel): string {
  const needs = styledNeedsOf(model);
  if (!needs) return "";
  const phone = allQuestions(model).some(wantsCountryPicker) ? `${PHONE_KIT}${COUNTRY_DATA}` : "";
  return `${phone}${needs.date ? DATE_KIT : ""}${needs.time ? TIME_KIT : ""}`;
}
