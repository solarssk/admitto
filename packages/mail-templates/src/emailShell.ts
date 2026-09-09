import { escapeHtmlAttribute, escapeHtmlText, resolveBrandingAssetUrlForRender } from "./escape.js";
import { resolvePublicBaseUrl } from "./baseUrl.js";

export type EmailShellLogoKind = "branding" | "admitto";

export interface EmailShellHeaderLogo {
  url: string;
  kind: EmailShellLogoKind;
}

/** Best-effort absolutize of a stored branding logo (org/event logo_url) for email HTML. */
export function absolutizeEmailShellLogo(
  logoUrl: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const raw = logoUrl?.trim() ?? "";
  if (!raw) return null;
  try {
    const baseUrl = resolvePublicBaseUrl(env);
    const abs = resolveBrandingAssetUrlForRender("logo_url", raw, baseUrl);
    return abs || null;
  } catch {
    return null;
  }
}

/** Cache-busting suffix appended to every bundled email asset URL, fixed for this process's
 * lifetime. These routes are served with a 24h Cache-Control (wallet-badges.ts's
 * serveTicketAsset) so mail clients that fetch remote images through their own caching proxy
 * (confirmed with Apple Mail's Mail Privacy Protection relay) keep showing whatever bytes they
 * first fetched at that exact URL for up to a day, even after the file on disk changes - a real
 * bug hit while iterating on the notification badge PNGs in dev. A version query param makes the
 * URL itself change on every server restart (which redeploying/regenerating these assets already
 * requires), so it's always a cache miss against anything fetched by a previous process. */
export const EMAIL_ASSET_VERSION = Date.now().toString(36);

/** Absolute URL for a bundled Admitto-owned static asset served under `/assets/<name>` (the PNG
 * logo, severity badges) - NOT org/event branding, which goes through absolutizeEmailShellLogo
 * instead. Returns null (same permissive fallback as absolutizeEmailShellLogo) when BASE_URL
 * can't be resolved, so a misconfigured env degrades gracefully instead of throwing. */
export function resolveBundledEmailAssetUrl(
  assetPath: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  try {
    return `${resolvePublicBaseUrl(env)}${assetPath}?v=${EMAIL_ASSET_VERSION}`;
  } catch {
    return null;
  }
}

/**
 * Org/event branding logo when set; the bundled Admitto PNG logo otherwise; null only when
 * BASE_URL itself can't be resolved, so the header falls through to the plain "Admitto" text span
 * (buildEmailShellHeaderInner's own no-logo case). Shared by every system email that shows this
 * header (mail transport test, bounce probe, notifications).
 *
 * The bundled fallback is a PNG (`/assets/admitto-logo.png`), not the `/assets/admitto-logo.svg`
 * used on the ticket page - classic desktop Outlook's rendering engine has no SVG support at all
 * in `<img>`, confirmed by real testing there (broken-image icon). Org/event branding stays
 * image-safe the same way because uploads are restricted to png/jpeg/webp (see
 * apps/web/src/admin/branding-upload.ts's ALLOWED_EXT), never svg.
 */
export function resolveEmailShellHeaderLogo(
  brandingLogoUrl: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): EmailShellHeaderLogo | null {
  const branded = absolutizeEmailShellLogo(brandingLogoUrl, env);
  if (branded) return { url: branded, kind: "branding" };
  const admitto = resolveBundledEmailAssetUrl("/assets/admitto-logo.png", env);
  if (admitto) return { url: admitto, kind: "admitto" };
  return null;
}

function buildEmailShellHeaderInner(params: {
  logoUrl?: string | null;
  logoKind?: EmailShellLogoKind;
  /** Alt text when a real (non-Admitto-wordmark) logo is shown. Which name to prefer (org vs
   * event) is the caller's own domain policy - the shell doesn't know about that concept. */
  altFallbackName?: string | null;
}): string {
  const logoUrl = params.logoUrl?.trim() || "";
  if (!logoUrl) {
    return `<span style="font-size:20px;font-weight:700;color:#1f2937;letter-spacing:-0.02em;">Admitto</span>`;
  }

  const alt =
    params.logoKind === "admitto" ? "Admitto" : params.altFallbackName?.trim() || "Admitto";
  const width = params.logoKind === "admitto" ? 118 : 140;
  return (
    `<img src="${escapeHtmlAttribute(logoUrl)}" alt="${escapeHtmlAttribute(alt)}" width="${width}" ` +
    `style="display:block;border:0;outline:none;text-decoration:none;max-width:${width}px;height:auto;" />`
  );
}

/**
 * Email Subject line prefixed with the recipient-relevant entity's display name - the
 * organization, or the event when the send is event-scoped - e.g. "[Acme Corp] Login from a new
 * country". Shared by every system email (mail transport test, notifications) so they all use the
 * same construction instead of each hand-rolling its own "[Admitto] ..." subject, which named the
 * vendor rather than which of possibly many organizations on this instance the message concerns
 * (PO report - a self-hosted instance's own admins already know it's Admitto sending; what they
 * need at a glance in their inbox is which org/event).
 */
export function buildSystemEmailSubject(prefixName: string, mainText: string): string {
  return `[${prefixName}] ${mainText}`;
}

export interface EmailShellParams {
  /** <title> tag text - a short, static label, not the dynamic per-send subject. */
  titleText: string;
  logoUrl?: string | null;
  logoKind?: EmailShellLogoKind;
  altFallbackName?: string | null;
  /** Opaque HTML for the card body: one or more <tr><td>...</td></tr> rows, inserted directly
   * below the header row and above the footer row. The shell does not impose inner padding/
   * font-family on this - each caller already sets its own per-row. */
  bodyHtml: string;
  /** Footer row text - HTML-escaped by this function. */
  footerText: string;
}

/**
 * Outlook-safe page background + centered 600px white bordered/rounded card + header (org/event
 * logo, or the Admitto wordmark, or plain "Admitto" text as last resort) + footer. This is the
 * shared shell every Admitto system email (mail transport test, bounce probe, notifications)
 * renders through - only bodyHtml and footerText vary per email type.
 *
 * The color-scheme/supported-color-schemes meta tags (+ matching :root style, for the clients
 * that read CSS instead of meta) opt this white card out of automatic dark-mode remapping in
 * Outlook.com/New Outlook/Apple Mail - without them some of those clients invert the white card
 * to near-black, confirmed by real-client testing. Copied from a real, production-proven
 * Admitto ticket email that already handles this correctly.
 */
export function buildSystemEmailHtml(params: EmailShellParams): string {
  const headerInner = buildEmailShellHeaderInner({
    logoUrl: params.logoUrl,
    logoKind: params.logoKind,
    altFallbackName: params.altFallbackName,
  });

  return (
    `<!DOCTYPE html>` +
    `<html lang="en">` +
    `<head><meta http-equiv="Content-Type" content="text/html; charset=utf-8" />` +
    `<meta name="viewport" content="width=device-width, initial-scale=1.0" />` +
    `<meta name="color-scheme" content="light" />` +
    `<meta name="supported-color-schemes" content="light" />` +
    `<title>${escapeHtmlText(params.titleText)}</title>` +
    `<style>:root{color-scheme:light;supported-color-schemes:light;}</style>` +
    `</head>` +
    `<body style="margin:0;padding:0;background-color:#f4f4f4;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f4f4;padding:24px 12px;">` +
    `<tr><td align="center">` +
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid #e5e7eb;border-radius:8px;">` +
    `<tr><td style="padding:24px 28px 16px 28px;border-bottom:1px solid #f3f4f6;">${headerInner}</td></tr>` +
    params.bodyHtml +
    `<tr><td align="center" style="padding:0 28px 24px 28px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#9ca3af;text-align:center;">` +
    `${escapeHtmlText(params.footerText)}` +
    `</td></tr>` +
    `</table>` +
    `</td></tr></table>` +
    `</body></html>`
  );
}

/** Generic colored-circle status badge + label, table-based for Outlook. Shared because
 * transportTest's green checkmark and notifications' severity badge are the same mechanical
 * shape with different colors/glyph/label (AGENTS.md: structural copies trip SonarCloud's
 * new-code duplication gate). */
export function buildEmailStatusBadgeHtml(params: {
  circleBackground: string;
  circleColor: string;
  /** Raw HTML (e.g. "&#10003;" or a plain glyph character) - not escaped. */
  glyphHtml: string;
  labelColor: string;
  labelText: string;
}): string {
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;">` +
    `<tr><td align="center" valign="middle" bgcolor="${params.circleBackground}" width="44" height="44" ` +
    `style="width:44px;height:44px;border-radius:22px;background-color:${params.circleBackground};` +
    `color:${params.circleColor};font-size:20px;line-height:44px;text-align:center;font-family:Arial,Helvetica,sans-serif;">${params.glyphHtml}</td></tr>` +
    `</table>` +
    `<div style="margin-top:10px;font-size:13px;font-weight:600;line-height:18px;color:${params.labelColor};text-align:center;">${escapeHtmlText(params.labelText)}</div>`
  );
}

/**
 * Status badge as a single baked PNG image (colored circle + icon) + label below - used by the
 * notification email's severity badge instead of buildEmailStatusBadgeHtml. A first version built
 * the circle from CSS (`border-radius`) with a Unicode/font glyph inside it; real-client testing
 * in classic desktop Outlook showed both parts fail there (`border-radius` on a table cell is
 * ignored, rendering a square, and the "&#8505;" glyph had no font coverage at all in some
 * clients). Baking the whole badge into one raster image removes both dependencies - see
 * scripts/generate-notification-email-assets.mjs for how the 3 severity PNGs are produced (from
 * real @tabler/icons paths, not hand-drawn). transportTest's own green "Transport OK" badge is a
 * different visual style (light background, dark icon) and isn't affected by this - it keeps
 * using buildEmailStatusBadgeHtml unchanged.
 */
export function buildEmailStatusBadgeImageHtml(params: {
  imageUrl: string;
  size?: number;
  labelColor: string;
  labelText: string;
}): string {
  const size = params.size ?? 44;
  return (
    `<img src="${escapeHtmlAttribute(params.imageUrl)}" alt="${escapeHtmlAttribute(params.labelText)}" ` +
    `width="${size}" height="${size}" style="display:block;margin:0 auto;border:0;outline:none;width:${size}px;height:${size}px;" />` +
    `<div style="margin-top:10px;font-size:13px;font-weight:600;line-height:18px;color:${params.labelColor};text-align:center;">${escapeHtmlText(params.labelText)}</div>`
  );
}

/** Generic bordered/rounded gray box with an uppercase label - transportTest's "Diagnostics" box
 * and notifications' "Details" box are the same shape with different labels/contents. */
export function buildEmailBoxedSectionHtml(params: { label: string; innerHtml: string }): string {
  return (
    `<div style="background-color:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:14px 16px;">` +
    `<div style="font-size:11px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:#6b7280;margin-bottom:8px;">${escapeHtmlText(params.label)}</div>` +
    params.innerHtml +
    `</div>`
  );
}

/**
 * "Bulletproof" CTA button - a plain `<a>` with a colored background renders as a bare
 * underlined text link in classic desktop Outlook (Word's rendering engine ignores the
 * background/border-radius on the anchor and forces its own default link style), confirmed by
 * testing the notification email there. A first attempt at fixing this with a hand-rolled
 * MSO-conditional VML `<v:roundrect>` still rendered cut off in real Outlook, so this is
 * rewritten to the "ghost table" technique instead - a single table cell with a `bgcolor`
 * attribute and `mso-padding-alt` inline style, which Outlook's Word engine DOES honor (unlike
 * inline CSS on an `<a>`). No VML, no MSO conditional comments, one markup path for every
 * client. Verified byte-for-byte against the real `mjml` compiler's own `<mj-button>` output
 * (the same industry-standard technique, not a guess) via a throwaway compile script.
 */
export function buildBulletproofButtonHtml(params: {
  url: string;
  label: string;
  backgroundColor: string;
  textColor: string;
  paddingVertical?: number;
  paddingHorizontal?: number;
}): string {
  const paddingVertical = params.paddingVertical ?? 12;
  const paddingHorizontal = params.paddingHorizontal ?? 24;
  const padding = `${paddingVertical}px ${paddingHorizontal}px`;
  const href = escapeHtmlAttribute(params.url);
  const label = escapeHtmlText(params.label);
  return (
    `<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="border-collapse:separate;line-height:100%;">` +
    `<tr><td align="center" bgcolor="${params.backgroundColor}" role="presentation" style="border:none;border-radius:6px;cursor:auto;mso-padding-alt:${padding};background:${params.backgroundColor};" valign="middle">` +
    `<a href="${href}" target="_blank" style="display:inline-block;background:${params.backgroundColor};color:${params.textColor};font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:600;line-height:120%;margin:0;text-decoration:none;text-transform:none;padding:${padding};mso-padding-alt:0px;border-radius:6px;">` +
    label +
    `</a>` +
    `</td></tr>` +
    `</table>`
  );
}
