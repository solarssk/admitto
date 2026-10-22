/**
 * The line icons of the guest pages (Tabler outline paths, the same glyphs as the approved mockup).
 * A page declares them once as an inline SVG sprite and uses them with `<use href="#i-name">`, a
 * reference inside the document, so a page that allows no external requests still draws them. The
 * markup is fixed: nothing from the database goes into an icon.
 *
 * Two sets share the sprite. {@link FORM_ICON_PATHS} has one symbol for every name an organiser can
 * give a question (`GUEST_FORM_ICONS` in `@admitto/shared`): the type of the object makes a name
 * without a symbol a compile error, and `test/registration/form-icons.test.ts` says so at run time
 * too, because a name that has no symbol is drawn as nothing. {@link PAGE_ICON_PATHS} are the
 * symbols the page draws for itself and no question can ask for.
 */
import { esc } from "../ticket-page.js";
import type { GuestFormIcon } from "@admitto/shared";

/** The symbols of the page's own markup: the notices, the send button, the closed page, the "use as written" row and the arrow of a choice. */
const PAGE_ICON_PATHS = {
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 9h.01M11 12h1v4h1"/>',
  "calendar-off": '<path d="M7 3v4M16 3v4M4 11h7M20 11h-2M5 5a2 2 0 0 0-1 1.7V19a2 2 0 0 0 2 2h12a2 2 0 0 0 .8-.2"/><path d="M3 3l18 18"/>',
  send: '<path d="M10 14L21 3"/><path d="M21 3l-6.5 18a.55.55 0 0 1-1 0L10 14l-7-3.5a.55.55 0 0 1 0-1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  tick: '<path d="M5 12l5 5l10-10"/>',
  "chevron-down": '<path d="M6 9l6 6l6-6"/>',
} as const;

/** One symbol for each icon a question can name. Twelve are the mockup's own; `phone`, `plane`, `train` and
 * `shirt` are Tabler's outline glyphs, drawn the same way (24 by 24, a 2 px line). */
export const FORM_ICON_PATHS: Readonly<Record<GuestFormIcon, string>> = {
  parking: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 16V8h4a2 2 0 0 1 0 4H9"/>',
  car: '<circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/><path d="M5 17H3v-6l2-5h9l4 5h1a2 2 0 0 1 2 2v4h-2m-4 0H9m-6-6h15m-6 0V6"/>',
  food: '<path d="M19 3v12h-5c-.02-3.7.18-7.4 5-12z"/><path d="M19 15v6h-1v-6"/><path d="M8 4v17M5 4v3a3 3 0 1 0 6 0V4"/>',
  accessible: '<circle cx="12" cy="12" r="9"/><path d="M10 16.5l2-3l2 3m-2-3v-2l3-1m-6 0l3 1"/><path d="M12 7.5h.01"/>',
  bed: '<path d="M3 7v11"/><path d="M3 14h18"/><path d="M21 18v-8a2 2 0 0 0-2-2h-8v6"/><circle cx="7" cy="10" r="1.2"/>',
  "user-plus": '<circle cx="10" cy="7" r="4"/><path d="M16 19h6M19 16v6"/><path d="M6 21v-2a4 4 0 0 1 4-4h4"/>',
  users: '<circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/><path d="M21 21v-2a4 4 0 0 0-3-3.85"/>',
  building: '<path d="M3 21h18"/><path d="M9 8h1M9 12h1M9 16h1M14 8h1M14 12h1M14 16h1"/><path d="M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16"/>',
  calendar: '<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M16 3v4M8 3v4M4 11h16"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
  phone: '<path d="M5 4h4l2 5l-2.5 1.5a11 11 0 0 0 5 5l1.5 -2.5l5 2v4a2 2 0 0 1 -2 2a16 16 0 0 1 -15 -15a2 2 0 0 1 2 -2"/>',
  mail: '<path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 7l9 6l9-6"/>',
  pin: '<circle cx="12" cy="11" r="3"/><path d="M17.7 16.7l-4.3 4.2a2 2 0 0 1-2.8 0l-4.3-4.2a8 8 0 1 1 11.4 0z"/>',
  plane: '<path d="M16 10h4a2 2 0 0 1 0 4h-4l-4 7h-3l2 -7h-4l-2 2h-3l2 -4l-2 -4h3l2 2h4l-2 -7h3l4 7"/>',
  train: '<path d="M21 13c0 -3.87 -3.37 -7 -10 -7h-8"/><path d="M3 15h16a2 2 0 0 0 2 -2"/><path d="M3 6v5h17.5"/><path d="M3 11v4"/><path d="M8 11v-5"/><path d="M13 11v-4.5"/><path d="M3 19h18"/>',
  shirt: '<path d="M15 4l6 2v5h-3v8a1 1 0 0 1 -1 1h-10a1 1 0 0 1 -1 -1v-8h-3v-5l6 -2a3 3 0 0 0 6 0"/>',
};

/** Every name the page can draw: a question's icon or one of the page's own. */
export type GuestIcon = keyof typeof PAGE_ICON_PATHS | GuestFormIcon;

/** The `<symbol>` of each icon in one hidden SVG, for the top of the page. */
export function renderIconSprite(): string {
  const symbols = [...Object.entries(PAGE_ICON_PATHS), ...Object.entries(FORM_ICON_PATHS)]
    .map(([name, paths]) => `<symbol id="i-${name}" viewBox="0 0 24 24">${paths}</symbol>`)
    .join("");
  return `<svg class="reg-sprite" aria-hidden="true" focusable="false">${symbols}</svg>`;
}

/** An icon by name. Decorative: hidden from assistive technology, the text next to it says the thing. The name of a
 * question's icon comes from the organiser's rules, so it is escaped like any other text of theirs: a name that is
 * not in the sprite draws nothing and cannot leave its attribute. */
export function icon(name: GuestIcon, className = "ic"): string {
  return `<svg class="${className}" aria-hidden="true" focusable="false"><use href="#i-${esc(name)}"/></svg>`;
}

/** The tick inside a checkbox: the product's `.at-check__box` draws it once the box is checked. */
export function checkTick(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><use href="#i-tick"/></svg>`;
}
