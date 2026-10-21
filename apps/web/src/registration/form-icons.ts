/**
 * The line icons of the guest pages (Tabler outline paths, the same glyphs as the approved mockup).
 * A page declares them once as an inline SVG sprite and uses them with `<use href="#i-name">`, a
 * reference inside the document, so a page that allows no external requests still draws them. The
 * markup is fixed: nothing from the database goes into an icon.
 */

const ICON_PATHS = {
  mail: '<path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 7l9 6l9-6"/>',
  building: '<path d="M3 21h18"/><path d="M9 8h1M9 12h1M9 16h1M14 8h1M14 12h1M14 16h1"/><path d="M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16"/>',
  users: '<circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/><path d="M21 21v-2a4 4 0 0 0-3-3.85"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 9h.01M11 12h1v4h1"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
  calendar: '<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M16 3v4M8 3v4M4 11h16"/>',
  "calendar-off": '<path d="M7 3v4M16 3v4M4 11h7M20 11h-2M5 5a2 2 0 0 0-1 1.7V19a2 2 0 0 0 2 2h12a2 2 0 0 0 .8-.2"/><path d="M3 3l18 18"/>',
  pin: '<circle cx="12" cy="11" r="3"/><path d="M17.7 16.7l-4.3 4.2a2 2 0 0 1-2.8 0l-4.3-4.2a8 8 0 1 1 11.4 0z"/>',
  send: '<path d="M10 14L21 3"/><path d="M21 3l-6.5 18a.55.55 0 0 1-1 0L10 14l-7-3.5a.55.55 0 0 1 0-1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  tick: '<path d="M5 12l5 5l10-10"/>',
} as const;

export type GuestIcon = keyof typeof ICON_PATHS;

/** The `<symbol>` of each icon in one hidden SVG, for the top of the page. */
export function renderIconSprite(): string {
  const symbols = Object.entries(ICON_PATHS)
    .map(([name, paths]) => `<symbol id="i-${name}" viewBox="0 0 24 24">${paths}</symbol>`)
    .join("");
  return `<svg class="reg-sprite" aria-hidden="true" focusable="false">${symbols}</svg>`;
}

/** An icon by name. Decorative: hidden from assistive technology, the text next to it says the thing. */
export function icon(name: GuestIcon, className = "ic"): string {
  return `<svg class="${className}" aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`;
}

/** The tick inside a checkbox: the product's `.at-check__box` draws it once the box is checked. */
export function checkTick(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><use href="#i-tick"/></svg>`;
}
