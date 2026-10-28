/**
 * The stylesheet of the guest pages (the registration form and its closed state).
 *
 * It is three layers, in this order, so each can override the one before it:
 *
 * 1. the product's own tokens, element rules and component rules ({@link GUEST_PAGE_PRODUCT_CSS},
 *    derived from `packages/ui/src/styles` and kept in step by a test);
 * 2. the ticket page's shell and the instance branding (`buildTicketPageStyles`): the card frame
 *    (`.ticket*`), the accent colour and the font the organisation chose;
 * 3. what the form adds and the product does not have: the layout of the form, the rows of options,
 *    the message slot under a field, and the status screens ({@link REGISTRATION_PAGE_CSS}).
 *
 * Every colour in the third layer is a token, and so is the spacing between the rows of the form: `--space-4` between
 * fields, the gap of the admin forms (`apps/admin/src/attendees/attendee-fields-grid.css`), so a change of tokens or
 * branding reaches it.
 */
import type { BrandingTheme } from "@admitto/auth";
import { resolveThemeVars } from "@admitto/ui";
import { buildTicketPageStyles } from "../ticket-inline-styles.js";
import { GUEST_PAGE_PRODUCT_CSS } from "./guest-page-css.generated.js";

/** What the form adds. The state classes are set by the page script: `has-error` on a field whose
 * message slot shows an error. A slot with a note keeps its height either way; one without takes no
 * room until it has an error. */
export const REGISTRATION_PAGE_CSS = `
:root { color-scheme: light; }
[hidden] { display: none !important; }
.ic { width: 1em; height: 1em; flex: none; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.reg-sprite { position: absolute; width: 0; height: 0; overflow: hidden; }
.reg-sr { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
.ticket--registration { width: min(560px, 100%); }
.reg-hero { padding: 20px 24px 4px; text-align: center; }
.reg-hero__title { margin: 0; font-size: var(--fs-h2); letter-spacing: var(--ls-normal); line-height: 1.3; overflow-wrap: anywhere; }
.reg-meta { margin: 8px 0 0; display: flex; flex-wrap: wrap; justify-content: center; gap: 4px 18px; font-size: var(--fs-sm); color: var(--text-secondary); }
.reg-meta span { display: inline-flex; align-items: center; gap: 6px; overflow-wrap: anywhere; }
.reg-meta .ic { color: var(--text-muted); font-size: 15px; }
.reg-lede { margin: 8px 0 0; font-size: var(--fs-body); color: var(--text-secondary); }
.reg-notices { display: grid; gap: 8px; padding: 14px 24px 0; }
.reg-notices .at-notice { animation: none; }
.reg-form { padding: 16px 24px 22px; display: grid; gap: var(--space-4); }
.reg-legend { margin: 0; font-size: var(--fs-xs); color: var(--text-muted); }
.reg-req { color: var(--status-error-fg); margin-left: 2px; }
.reg-legend .reg-req { margin: 0; }
.reg-row { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-4); align-items: start; }
.reg-form .at-field { min-width: 0; align-content: start; }
/* The product's textarea is a code box (monospace). A long answer is prose, so it is set like the other fields. A phone keeps the product's 16 px, which stops the zoom on focus. */
.reg-form .at-textarea { font-family: var(--font-sans); font-size: var(--fs-body); }
@media (pointer: coarse) {
  .reg-form .at-textarea { font-size: 16px; }
}
/* Mobile Safari lays a date input out by its own rules unless it is told to drop them: it does not take the product's border-box sizing, so the box is wider than its field and its right and bottom edges are cut off. It also centres the date it shows. */
.reg-form .at-input[type="date"], .reg-form .at-input[type="datetime-local"] { -webkit-appearance: none; appearance: none; }
.reg-form .at-input::-webkit-date-and-time-value { text-align: left; }
/* The note and the error sit in one grid cell, so the slot is as tall as the taller of the two and an error that takes the place of a note moves nothing below it, whether the note is one line or several. */
.reg-slot { display: grid; min-height: 1rem; line-height: 1rem; }
.reg-slot > * { grid-area: 1 / 1; }
.reg-slot__hint { white-space: pre-line; overflow-wrap: anywhere; }
.reg-slot__err { display: flex; visibility: hidden; align-items: flex-start; gap: 4px; line-height: 1.25; }
.reg-slot__err .ic { margin-top: 2px; font-size: 13px; }
.has-error .reg-slot__hint { visibility: hidden; }
.has-error .reg-slot__err { visibility: visible; }
/* A slot with no note (a name, the company, the terms, the security check) takes no room until it has an error: the fields stand one gap apart, as in the admin forms, and the error opens under its field. */
.reg-slot--collapsed { display: none; }
.has-error .reg-slot--collapsed { display: grid; }
.has-error .at-check__box { border-color: var(--status-error); }
.reg-section { display: grid; gap: var(--space-4); padding-top: var(--space-4); border-top: 1px solid var(--border); }
.reg-section__label { margin: 0; font-size: var(--fs-xs); font-weight: var(--fw-semibold); letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted); }
.reg-opts { display: grid; gap: var(--space-2); }
.reg-opt { display: flex; width: 100%; align-items: center; padding: var(--space-2) var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface-card); }
.reg-opt:hover { background: var(--surface-hover); }
.reg-opt:has(input:checked) { border-color: color-mix(in srgb, var(--primary) 50%, var(--border)); background: color-mix(in srgb, var(--primary) 5%, var(--surface-card)); }
.reg-opt .ic { font-size: 18px; color: var(--text-muted); }
.reg-opt:has(input:checked) .ic { color: var(--primary); }
.reg-opt__text { color: var(--text-primary); line-height: 1.35; overflow-wrap: anywhere; }
.reg-opt__text small { display: block; margin-top: 1px; white-space: pre-line; }
/* In a run where some row has an icon, a row with none keeps its text in line with the others: the icon's width and the gap. */
.reg-opts--icons > .reg-opt--bare .reg-opt__text { margin-left: calc(18px + var(--space-2)); }
/* The questions that wait for another answer, under its row or its field. The small negative margin joins the panel to the row above it. */
.reg-reveal { margin: -2px 0 2px; padding: var(--space-3); background: var(--surface-sunken); border: 1px solid var(--border); border-radius: var(--radius-md); display: grid; gap: var(--space-3); }
/* A text box with suggestions: the product's searchable-select panel under it, over what follows. A long suggestion wraps instead of being cut. Any text is welcome. */
.combo { position: relative; }
.combo__panel { position: absolute; left: 0; right: 0; top: calc(100% + 4px); margin: 0; }
.combo .searchable-select__option[aria-selected="true"] { background: var(--surface-hover, var(--surface-sunken)); }
.combo .searchable-select__option .ic { font-size: 16px; color: var(--text-muted); }
.combo .searchable-select__name { white-space: normal; overflow-wrap: anywhere; }
.combo .searchable-select__name strong { font-weight: var(--fw-semibold); color: var(--primary); }
.combo__custom { border-top: 1px solid var(--border); border-radius: 0 0 var(--radius) var(--radius); margin-top: 2px; }
.combo .searchable-select__empty { padding: var(--space-1) var(--space-2) 0; }
/* A choice is the product's searchable select: a button and a panel of rows. The panel opens under the button, over what follows, as the list of suggestions does. The real select is hidden (reg-sr) and holds the answer. A phone keeps the 16 px of the search box, which stops the zoom on focus. */
.picker { position: relative; }
.picker__panel { position: absolute; left: 0; right: 0; top: calc(100% + 4px); margin: 0; }
@media (pointer: coarse) {
  .picker .searchable-select__search { font-size: 16px; }
}
.reg-checks { display: grid; gap: var(--space-2); }
/* The row of the terms sits in a box of its own (it has an error slot). A grid makes its tick a block like the other ticks, so the box is no taller than the tick and the rows stand one gap apart. */
.reg-checks > [data-field] { display: grid; }
.reg-checks .at-check { align-items: flex-start; font-size: var(--fs-sm); color: var(--text-primary); line-height: 1.45; }
.reg-checks .at-check__box { margin-top: 2px; }
.reg-checks small { display: block; margin-top: 1px; }
.reg-checks .reg-slot { margin-top: 2px; padding-left: calc(1rem + var(--space-2)); }
.reg-captcha { min-height: 65px; max-width: 100%; overflow-x: auto; }
.reg-fine { margin: 0; font-size: var(--fs-xs); color: var(--text-muted); text-align: center; line-height: 1.5; }
.reg-fine a, .reg-link { font-weight: var(--fw-semibold); }
.reg-btn-icon { font-size: 18px; }
.reg-linkbtn { appearance: none; background: none; border: 0; padding: 0; font: inherit; font-weight: var(--fw-semibold); color: var(--text-link); cursor: pointer; }
.reg-linkbtn:hover { text-decoration: underline; }
.reg-center { padding: 28px 24px 24px; display: grid; gap: 14px; justify-items: center; text-align: center; }
.reg-badge { width: 52px; height: 52px; border-radius: 50%; display: grid; place-items: center; font-size: 26px; color: var(--primary); background: var(--primary-tint); }
.reg-badge--muted { color: var(--text-secondary); background: var(--surface-sunken); border: 1px solid var(--border); }
.reg-badge--ok { color: var(--status-ok-fg); background: var(--status-ok-tint); }
.reg-badge--warn { color: var(--status-warn-fg); background: var(--status-warn-tint); }
.reg-center h1 { margin: 0; font-size: var(--fs-h2); letter-spacing: var(--ls-normal); line-height: 1.3; overflow-wrap: anywhere; }
.reg-center h1:focus-visible { box-shadow: none; }
.reg-center p { margin: 0; max-width: 40ch; color: var(--text-secondary); overflow-wrap: anywhere; }
.reg-center p b { color: var(--text-primary); font-weight: var(--fw-semibold); overflow-wrap: anywhere; }
.reg-center form { display: grid; width: 100%; justify-items: center; }
.reg-center .at-btn { width: 100%; max-width: 320px; }
/* The field of the password screen: as wide as the button under it, and set from the left whatever the screen centres. Its sentence for a wrong password takes two lines at that width, so the slot under it keeps two, and the button does not move when the sentence comes. */
.reg-center .at-field { width: 100%; max-width: 320px; text-align: left; }
.reg-center .reg-slot { min-height: 2rem; }
.reg-facts { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px 16px; padding: 10px 14px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface-sunken); font-size: var(--fs-sm); color: var(--text-secondary); }
.reg-facts span { display: inline-flex; align-items: center; gap: 6px; }
.reg-facts .ic { color: var(--text-muted); font-size: 15px; }
.reg-foot-line { margin: 0 0 3px; font-size: var(--fs-sm); color: var(--text-muted); overflow-wrap: anywhere; }
.reg-foot-line b { color: var(--text-secondary); font-weight: var(--fw-semibold); }
/* The icon is part of the line of text, as on the ticket page's venue line, so it stays beside the first words however the text wraps. */
.reg-foot-line .ic { display: inline-block; margin-right: 6px; font-size: 14px; vertical-align: -0.15em; }
@media (max-width: 480px) {
  .reg-row { grid-template-columns: 1fr; }
  .reg-hero, .reg-form, .reg-center, .reg-notices { padding-left: 18px; padding-right: 18px; }
}
`;

/** WCAG 2.x relative luminance of `#rrggbb`. */
function relativeLuminance(hex: string): number {
  const value = Number.parseInt(hex.slice(1), 16);
  const channel = (shift: number): number => {
    const srgb = ((value >> shift) & 255) / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0);
}

/** WCAG contrast ratio of two `#rrggbb` colours, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

/** `hex` (`#rrggbb`) moved towards white by `amount`, 0 to 1. */
function towardWhite(hex: string, amount: number): string {
  const value = Number.parseInt(hex.slice(1), 16);
  const channel = (shift: number): string => {
    const own = (value >> shift) & 255;
    return Math.round(own + (255 - own) * amount)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(16)}${channel(8)}${channel(0)}`;
}

const WHITE = "#ffffff";
/** Dark ink for a light brand colour: the product's own `--at-ink`. */
const DARK_INK = "#1d273b";
/** For the mid-tone accents, a mid blue or a grey, where neither white nor the dark ink reaches AA. */
const BLACK = "#000000";
/** WCAG AA for the 14 px and 18 px text of a button. */
const MIN_TEXT_CONTRAST = 4.5;

/**
 * The accent colour of the organisation can be any colour it likes, a light one too. The product
 * writes white on it (`--text-on-primary`), so a pale accent would leave the send button unreadable on
 * the one page every guest sees. When white would not reach AA on the accent, the text on it is the
 * product's dark ink instead, and black when the dark ink does not reach AA either. White reaches AA
 * up to a relative luminance of 0.183 and black from 0.175, so one of the three always does. Empty
 * when white is fine, which is the default blue.
 *
 * The product darkens a button under the pointer and under a press (`--primary-hover`, `--primary-active`, by 12 and
 * 22 percent). That helps white text and hurts dark text, so with dark text the two states get lighter by the same
 * amounts, and the text keeps its contrast in every state.
 */
export function inkOnPrimaryRule(theme?: BrandingTheme | null): string {
  const primary = resolveThemeVars({ ...theme, primary: theme?.ticket_primary ?? theme?.primary })["--primary"];
  if (contrastRatio(primary, WHITE) >= MIN_TEXT_CONTRAST) return "";
  const ink = contrastRatio(primary, DARK_INK) >= MIN_TEXT_CONTRAST ? DARK_INK : BLACK;
  return `:root { --text-on-primary: ${ink}; --primary-hover: ${towardWhite(primary, 0.12)}; --primary-active: ${towardWhite(primary, 0.22)}; }`;
}

/** The whole stylesheet of a guest page, for the instance branding `theme`. */
export function buildRegistrationPageStyles(theme?: BrandingTheme | null): string {
  return [GUEST_PAGE_PRODUCT_CSS, buildTicketPageStyles(theme), inkOnPrimaryRule(theme), REGISTRATION_PAGE_CSS]
    .filter((part) => part !== "")
    .join("\n");
}
