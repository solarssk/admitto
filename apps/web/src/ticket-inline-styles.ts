import type { BrandingThemeInput } from "@admitto/ui";
import { resolveThemeVars, sanitizeBrandingFontFamilyName, themeVarsToStyleBlock } from "@admitto/ui";
import { builtInFontFaceCss } from "./vendor-assets.js";

const TICKET_LAYOUT_CSS = `
body.ticket-page { margin: 0; box-sizing: border-box; width: 100%; overflow-x: clip; background: var(--surface-page, #f1f5f9); min-height: 100vh; display: grid; place-items: center; padding: 32px 16px; font-family: var(--font-sans, Inter, system-ui, sans-serif); color: var(--text-primary, #1d273b); }
.ticket { width: min(400px, 100%); box-sizing: border-box; min-width: 0; background: var(--surface-card, #ffffff); border: 1px solid var(--border, #e6e7e9); border-radius: var(--radius-lg, 12px); box-shadow: var(--shadow-md, 0 4px 12px rgba(15,23,42,.08)); overflow: hidden; border-top: 3px solid var(--primary, #066fd1); }
.ticket__top { padding: 16px 22px; border-bottom: 1px solid var(--border, #e6e7e9); display: flex; align-items: center; gap: 10px; min-height: 60px; }
.ticket__top small { margin-left: auto; color: var(--text-muted, #64748b); font-size: 12px; white-space: nowrap; }
.ticket__brand { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 17px; letter-spacing: -0.02em; }
.ticket__brand-mark { width: 30px; height: 30px; display: block; flex: 0 0 auto; }
.ticket__brand-logo { max-height: 32px; max-width: 160px; object-fit: contain; display: block; }
.ticket__body { padding: 22px 24px 18px; text-align: center; }
.ticket__event-name { font-size: 1.25rem; font-weight: 700; margin: 0; }
.ticket__meta { color: var(--text-secondary, #475569); font-size: 0.875rem; margin-top: 6px; display: flex; flex-direction: column; align-items: center; gap: 3px; }
/* Icon + label as one centered text run so multi-line venues stay balanced (no flex gap drift). */
.ticket__meta > span { display: block; max-width: 100%; text-align: center; text-wrap: balance; line-height: 1.35; }
.ticket__meta svg { display: inline-block; width: 15px; height: 15px; vertical-align: -0.15em; margin-right: 6px; }
.ticket__attendee { margin: 16px 0 18px; display: flex; flex-direction: column; align-items: center; gap: 6px; }
.ticket__attendee-name { font-size: 1.125rem; font-weight: 600; margin: 0 0 8px; }
.ticket__type { display: inline-flex; align-items: center; padding: 0.2em 0.55em; border-radius: 6px; background: var(--surface-sunken, #f1f5f9); color: var(--text-secondary, #475569); font-size: 0.75rem; font-weight: 600; }
/* Public HTML 404/500: large status code + icon, no inner bordered box. */
.ticket__body--public-error { padding: 28px 24px 32px; }
.at-public-error { margin: 0; display: flex; flex-direction: column; align-items: center; text-align: center; }
.at-public-error__icon { display: flex; align-items: center; justify-content: center; width: 3.5rem; height: 3.5rem; margin-bottom: 0.75rem; color: var(--primary, #066fd1); opacity: 0.85; }
.at-public-error__icon svg { width: 100%; height: 100%; display: block; }
.at-public-error__code { margin: 0 0 0.35rem; font-size: 3rem; font-weight: 800; letter-spacing: -0.03em; line-height: 1; color: var(--text-primary, #1d273b); }
.at-public-error__heading { margin: 0 0 0.5rem; font-size: 1.125rem; font-weight: 700; color: var(--text-primary, #1d273b); }
.at-public-error__message { margin: 0; max-width: 28ch; font-size: 0.875rem; line-height: 1.45; color: var(--text-secondary, #475569); }
.ticket__status-notice { margin: 4px 0 8px; padding: 16px 14px; text-align: center; border: 1px solid color-mix(in srgb, var(--status-error, #d63939) 35%, #e6e7e9); border-radius: 8px; background: var(--status-error-tint, #fcebea); color: var(--status-error-fg, #9b1c1c); }
.ticket__status-notice h2 { margin: 0 0 8px; font-size: 1.0625rem; font-weight: 700; color: inherit; }
.ticket__status-notice p { margin: 0; font-size: 0.875rem; line-height: 1.45; color: inherit; }
.ticket__qr { display: inline-flex; padding: 12px; background: #fff; border: 1px solid color-mix(in srgb, var(--primary, #066fd1) 35%, #e6e7e9); border-radius: 8px; }
.ticket__qr img { width: 220px; height: 220px; display: block; }
.ticket__token { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; color: var(--text-muted, #64748b); font-size: 0.75rem; margin: 10px 0 0; word-break: break-all; }
.ticket__perf { height: 0; border-top: 2px dashed var(--border, #e6e7e9); margin: 6px 0; }
.ticket__wallets { padding: 16px 16px 8px; display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; align-items: flex-end; }
/* Both frames share Google's 48dp minimum so the Google badge is never smaller than Apple.
 * Official Apple SVG paints ~47px of ink in a 48px box (1px empty under the pill). Scale the
 * Apple img to 49px inside a 48px clipped frame so the painted pill fills the frame — layout
 * only; do not edit brand artwork. */
.wallet-badge-frame { display: block; height: 48px; overflow: hidden; line-height: 0; }
.wallet-badge { display: block; height: 48px; width: auto; cursor: not-allowed; }
.wallet-badge--apple { height: 49px; }
.ticket__wallet-help { margin: 0 20px 14px; color: var(--text-muted, #64748b); font-size: 0.75rem; line-height: 1.45; text-align: center; }
.ticket__wallet-help summary { cursor: pointer; list-style: none; padding: 0; font-weight: 500; color: var(--text-muted, #64748b); text-decoration: none; }
.ticket__wallet-help summary::-webkit-details-marker { display: none; }
.ticket__wallet-help[open] summary { margin-bottom: 6px; }
.ticket__wallet-help p { margin: 0 0 4px; color: var(--text-secondary, #475569); text-align: left; }
.ticket__wallet-help p:last-child { margin-bottom: 0; }
.ticket__getting-there { padding: 2px 24px 22px; border-top: 1px solid var(--border, #e6e7e9); }
.ticket__getting-there h2 { color: var(--text-muted, #64748b); font-size: 0.75rem; font-weight: 700; letter-spacing: 0.08em; margin: 20px 0 10px; text-transform: uppercase; }
.ticket__weather-block { margin-top: 16px; padding-top: 4px; border-top: 1px solid var(--border, #e6e7e9); }
.ticket__weather-heading { color: var(--text-muted, #64748b); font-size: 0.75rem; font-weight: 700; letter-spacing: 0.08em; margin: 16px 0 12px; text-transform: uppercase; }
.ticket__weather-main { display: flex; align-items: center; gap: 14px; }
.ticket__weather-icon { flex: 0 0 auto; width: 40px; height: 40px; color: var(--text-secondary, #475569); }
.ticket__weather-icon svg { display: block; width: 100%; height: 100%; }
.ticket__weather-copy { min-width: 0; flex: 1 1 auto; }
.ticket__weather-title { margin: 0; color: var(--text-primary, #1d273b); font-size: 1.0625rem; font-weight: 600; line-height: 1.25; }
.ticket__weather-temp { margin: 4px 0 0; color: var(--text-secondary, #475569); font-size: 0.9375rem; line-height: 1.3; }
.ticket__weather-credit-row { margin: 10px 0 0; text-align: right; }
.ticket__weather-credit { color: var(--text-muted, #64748b); font-size: 0.75rem; text-decoration: none; }
.ticket__weather-credit:hover { text-decoration: underline; text-underline-offset: 2px; }
.ticket__address { color: var(--text-secondary, #475569); font-size: 0.875rem; line-height: 1.4; margin: 0 0 12px; display: flex; flex-direction: column; gap: 2px; }
.ticket__address-line { display: block; overflow-wrap: anywhere; word-break: break-word; }
.ticket__address-locality { overflow-wrap: anywhere; word-break: break-word; }
.ticket__map-frame { position: relative; border: 1px solid var(--border, #e6e7e9); border-radius: 8px; overflow: hidden; background: var(--surface-sunken, #f8fafc); }
.ticket__map { display: block; height: auto; max-width: 100%; width: 100%; min-height: 150px; border: 0; }
.ticket__map-fallback { color: var(--text-muted, #64748b); font-size: 0.8125rem; margin: 0; padding: 28px 16px; text-align: center; }
.ticket__map-links { display: grid; gap: 8px; grid-template-columns: repeat(2, minmax(0, 1fr)); margin-top: 14px; }
.ticket__map-link { align-items: center; border: 1px solid var(--border, #e6e7e9); border-radius: 8px; color: var(--text-primary, #1d273b); display: inline-flex; gap: 6px; font-size: 0.8125rem; font-weight: 600; justify-content: center; min-height: 40px; text-decoration: none; }
.ticket__map-link svg { width: 16px; height: 16px; flex: 0 0 auto; }
.ticket__travel-note { border-top: 1px solid var(--border, #e6e7e9); margin-top: 16px; padding-top: 14px; }
.ticket__travel-note h3 { color: var(--text-primary, #1d273b); font-size: 0.8125rem; margin: 0 0 4px; display: inline-flex; align-items: center; gap: 6px; }
.ticket__travel-note h3 svg { width: 15px; height: 15px; flex: 0 0 auto; color: var(--text-secondary, #475569); }
.ticket__travel-note p { color: var(--text-secondary, #475569); font-size: 0.8125rem; line-height: 1.45; margin: 0; white-space: pre-line; }
.ticket__foot { padding: 12px 22px; background: var(--surface-sunken, #f8fafc); border-top: 1px solid var(--border, #e6e7e9); font-size: 12px; color: var(--text-muted, #64748b); text-align: center; }

@media print {
  body.ticket-page {
    background: white;
    min-height: unset;
    padding: 0;
    display: block;
  }
  .ticket {
    width: 100%;
    max-width: 100%;
    background: #fff;
    box-shadow: none;
    border: 1px solid #ccc;
    border-top: 3px solid #066fd1;
    border-radius: 0;
    overflow: visible;
    page-break-inside: avoid;
    break-inside: avoid;
  }
  .ticket__top {
    border-bottom: 1px solid #ccc;
  }
  .ticket__foot {
    background: #f5f5f5;
    border-top: 1px solid #ccc;
    color: #555;
  }
  .ticket__qr {
    border: 1px solid #99b8d9;
    border-radius: 0;
  }
  .ticket__wallets,
  .ticket__wallet-help {
    display: none;
  }
  .ticket__getting-there {
    border-top: 1px solid #ccc;
  }
  .ticket__map-frame {
    border-color: #ccc;
  }
  .ticket__perf {
    border-top: 2px dashed #aaa;
  }
  .ticket__event-name,
  .ticket__attendee-name {
    color: #000;
  }
  .ticket__meta {
    color: #555;
  }
  .ticket__foot a::after {
    content: none;
  }
}

@media (max-width: 480px) {
  body.ticket-page { padding: 20px 12px; }
  .ticket__body { padding: 18px 16px 16px; }
  .ticket__body--public-error { padding: 24px 16px 28px; }
  .at-public-error__code { font-size: 2.5rem; }
}
`;

export function buildTicketPageStyles(theme?: BrandingThemeInput | null): string {
  // The ticket page has its own font pick, falling back to the admin SPA's when unset - resolve it
  // once here so everything below (resolveThemeVars, the self-hosting fallback) works with a plain
  // font_family_name the same way it always has, rather than needing to know about two fields.
  const ticketTheme = theme ? { ...theme, font_family_name: theme.ticket_font_family_name ?? theme.font_family_name } : theme;
  const vars = resolveThemeVars(ticketTheme);
  // resolveThemeVars only sets fontFaceCss for a *custom* uploaded family - the ticket page has no
  // bundler and so never gets the admin SPA's own @fontsource CSS imports (fonts.css) for a
  // built-in pick (Inter/Manrope/Space Grotesk/IBM Plex Sans). Self-host that one here instead; an
  // unset font_family_name (the default pick) means Inter, matching the CSS fallback below. A name
  // that matches neither a built-in nor a saved custom family (e.g. stale data from a deleted
  // custom family) falls back to Inter too - fonts.css imports Inter unconditionally regardless of
  // the active pick, so the admin SPA always has it as a working base; mirror that here rather
  // than silently rendering with no self-hosted face at all.
  if (!vars.fontFaceCss) {
    const fontName = sanitizeBrandingFontFamilyName(ticketTheme?.font_family_name ?? "") ?? "Inter";
    vars.fontFaceCss = builtInFontFaceCss(fontName) ?? builtInFontFaceCss("Inter");
  }
  return `${themeVarsToStyleBlock(vars)}\n${TICKET_LAYOUT_CSS}`;
}
