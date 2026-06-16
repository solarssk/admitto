import type { BrandingThemeInput } from "@admitto/ui";
import { resolveThemeVars, themeVarsToStyleBlock } from "@admitto/ui";

const TICKET_LAYOUT_CSS = `
body.ticket-page { margin: 0; background: var(--surface-page); min-height: 100vh; display: grid; place-items: center; padding: 32px 16px; font-family: var(--font-sans, Inter, system-ui, sans-serif); color: var(--text-primary); }
.ticket { width: 380px; max-width: 100%; background: var(--surface-card); border: 1px solid var(--border); border-radius: var(--radius-lg, 12px); box-shadow: var(--shadow-md, 0 4px 12px rgba(15,23,42,.08)); overflow: hidden; }
.ticket__top { padding: 16px 22px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 10px; min-height: 60px; }
.ticket__top small { margin-left: auto; color: var(--text-muted); font-size: 12px; white-space: nowrap; }
.ticket__brand { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 16px; }
.ticket__brand-mark { width: 26px; height: 26px; border-radius: 8px; background: var(--primary); display: inline-block; }
.ticket__body { padding: 22px 24px 18px; text-align: center; }
.ticket__event-name { font-size: 1.25rem; font-weight: 700; margin: 0; }
.ticket__meta { color: var(--text-secondary); font-size: 0.875rem; margin-top: 6px; }
.ticket__attendee { margin: 16px 0 18px; }
.ticket__attendee-name { font-size: 1.125rem; font-weight: 600; margin: 0 0 8px; }
.ticket__qr { display: inline-flex; padding: 14px; background: #fff; border: 1px solid var(--border); border-radius: 8px; }
.ticket__qr img { width: 220px; height: 220px; display: block; }
.ticket__perf { height: 0; border-top: 2px dashed var(--border); margin: 6px 0; }
.ticket__wallets { padding: 16px 16px 20px; display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
.wallet-cta { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 0 16px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface-sunken); color: var(--text-muted); font-size: 0.8125rem; font-weight: 600; cursor: not-allowed; opacity: 0.7; }
.ticket__foot { padding: 12px 22px; background: var(--surface-sunken); border-top: 1px solid var(--border); font-size: 12px; color: var(--text-muted); text-align: center; }
.at-badge { display: inline-flex; align-items: center; gap: 0.35em; padding: 0.2em 0.55em; border-radius: 6px; font-size: 0.75rem; font-weight: 600; letter-spacing: 0.02em; }
.at-badge--dot::before { content: ""; width: 0.45em; height: 0.45em; border-radius: 50%; background: currentColor; }
.at-badge--neutral { background: #f1f5f9; color: #475569; }
.at-badge--ok { background: #e9f7ec; color: #1f7a2e; }
.at-badge--warn { background: #fdf3e1; color: #9a6400; }
.at-badge--error { background: #fbeaea; color: #b32525; }
.at-badge--confirmed { background: #e6f6f1; color: #097a59; }
`;

export function buildTicketPageStyles(theme?: BrandingThemeInput | null): string {
  const vars = themeVarsToStyleBlock(resolveThemeVars(theme));
  return `${vars}\n${TICKET_LAYOUT_CSS}`;
}
