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
 *   script is to take over (./form-fields.ts). The kind is `phone` for now;
 * - a `<template>` with the markup of the phone box's country button and its list, so that the script clones markup that was
 *   written, tested and escaped here, and builds none of its own;
 * - the countries as a hidden list of data rows, `<li data-iso="PL" data-dial="+48">Poland</li>`: the same list the staff app
 *   shows (`@admitto/shared/phone-countries`), one row for each, with the name as the text of the row. The script reads them with
 *   `getAttribute` and `textContent` and sets what it draws as text, so they are data in the page and never code. They are the
 *   same for every event and every request, and nothing of the database is among them.
 */
import { PHONE_COUNTRIES } from "@admitto/shared/phone-countries";
import { esc } from "../ticket-page.js";
import { icon } from "./form-icons.js";
import type { FormQuestion, RegistrationFormModel } from "./form-model.js";

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

/** Whether some question the form asks (the guest's own or the companion's) is one the styled phone box takes. */
function hasStyledPhone(model: RegistrationFormModel): boolean {
  return [...model.questions, ...(model.companion?.questions ?? [])].some(wantsCountryPicker);
}

/** What the second script needs in the page, or nothing: for an event without the switch, and for a form with no question that
 * the script would take over. */
export function renderStyledControls(model: RegistrationFormModel): string {
  if (!model.styledControls) return "";
  return hasStyledPhone(model) ? `${PHONE_KIT}${COUNTRY_DATA}` : "";
}
