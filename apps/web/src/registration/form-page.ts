/**
 * The registration page as HTML: the form, the "Check your inbox" screen that replaces it after a
 * send, and the "Registration is closed" page of an event that is over. The pages of the link that
 * confirms an address (./confirm-page.ts) are built from the same shell: the document, the header and
 * the footer.
 *
 * Pure: it takes the model of ./form-model.ts and returns a string, so the same text is built for
 * the same event every time. The page is the ticket page's card (`.ticket*`, its brand header and
 * its footer) filled with the product's own form classes (`at-field`, `at-input`, `at-check`,
 * `at-btn`, `at-notice`, ...). It follows the mockup Filip approved (`_ops/v08-registration/mockups`).
 *
 * Every string the organiser wrote is escaped here or in ./form-fields.ts. There is no HTML of the
 * organiser's anywhere on this page. The script and the Turnstile widget are added only to the form:
 * the closed page has neither.
 *
 * An event whose way in is the password (D-C3) shows its password screen first, as the mockup does, with the hero, the
 * notices, the form and the contact of the event written hidden behind it (`data-after-password`). The page script shows
 * them when a password has been typed ("Continue" checks nothing else) and the server judges that password with the form,
 * once: there is no route that only checks it. So the questions are in the page for anyone who knows its address, and
 * the password protects the registration and not the page.
 */
import type { BrandingTheme } from "@admitto/auth";
import { renderAdmittoFaviconLink } from "../favicon.js";
import { TURNSTILE_ORIGIN } from "../registration-page-security.js";
import { esc } from "../ticket-page.js";
import { renderAgreement, renderCompanion, renderPasswordField, renderPersonalFields, renderQuestions } from "./form-fields.js";
import { icon, renderIconSprite } from "./form-icons.js";
import type { ClosedFormModel, FormContact, FormEvent, RegistrationFormModel } from "./form-model.js";
import { renderFormScript } from "./form-script.js";
import { buildRegistrationPageStyles } from "./form-style.js";

export interface RegistrationPageOptions {
  /** The nonce of this response, the one in its `Content-Security-Policy`. */
  nonce: string;
  theme?: BrandingTheme | null;
}

/** Cloudflare's widget script. Its origin is the one the policy allows when Turnstile is on. */
const TURNSTILE_SCRIPT_URL = `${TURNSTILE_ORIGIN}/turnstile/v0/api.js`;

/** Both pages tell iOS not to turn what looks like a phone number into a call link: an organiser's example of a phone
 * answer ("For example: +1 555 0100") would become one, and so would any other run of digits in a note. */
export function renderDocument(title: string, content: string, scripts: string, theme?: BrandingTheme | null): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="format-detection" content="telephone=no">
  <title>${esc(title)}</title>
  ${renderAdmittoFaviconLink()}
  <style>${buildRegistrationPageStyles(theme)}</style>
</head>
<body class="ticket-page">
  ${renderIconSprite()}
  <main class="ticket ticket--registration">
    ${content}
  </main>
  ${scripts}
</body>
</html>`;
}

/** The ticket page's header: the event's logo, else the Admitto mark. */
export function renderHeader(event: FormEvent): string {
  const brand = event.logoUrl
    ? `<img class="ticket__brand-logo" src="${esc(event.logoUrl)}" alt="${esc(event.title)}">`
    : `<img class="ticket__brand-mark" src="/assets/admitto-mark.svg" width="30" height="30" alt=""><span>Admitto</span>`;
  return `<header class="ticket__top"><div class="ticket__brand">${brand}</div><small>Registration</small></header>`;
}

/** The attributes of what waits behind the password screen: written hidden, and shown by the script. Nothing for an event
 * that has no password screen. */
function behindPassword(model: Pick<RegistrationFormModel, "needsPassword">): string {
  return model.needsPassword ? " data-after-password hidden" : "";
}

function renderHero(event: FormEvent, gate: string): string {
  const venue = event.venue ? `<span>${icon("pin")}${esc(event.venue)}</span>` : "";
  return `<div class="reg-hero" data-hide-when-done${gate}><h1 class="reg-hero__title">${esc(event.title)}</h1><p class="reg-meta"><span>${icon("calendar")}${esc(event.when)}</span>${venue}</p><p class="reg-lede">Fill in your details to register for this event.</p></div>`;
}

/** What happens after the send, in a sentence (D-B1, D-C5). */
function modeNote(model: RegistrationFormModel): string {
  if (model.mode === "approval") return "The organisers review every registration. You will get an email with their decision.";
  return model.verifyEmail
    ? "We email your ticket as soon as you confirm your address."
    : "We email your ticket as soon as you send this form.";
}

/** The answer for a browser without scripts: the page needs its script to send the form, and to get past the password. */
function renderNoScript(): string {
  return `<noscript><div class="at-notice at-notice--error">${icon("alert", "ic at-notice__icon")}<div class="at-notice__body">This form needs JavaScript. Turn it on in your browser, then reload the page.</div></div></noscript>`;
}

/** The note about the mode, the error notice the script fills in, and the answer for a browser without scripts. */
function renderNotices(model: RegistrationFormModel): string {
  const note = `<div class="at-notice at-notice--info">${icon("info", "ic at-notice__icon")}<div class="at-notice__body">${esc(modeNote(model))}</div></div>`;
  const error = `<div class="at-notice at-notice--error" id="reg-error" role="alert" tabindex="-1" hidden>${icon("alert", "ic at-notice__icon")}<div class="at-notice__body" id="reg-error-text"></div></div>`;
  return `<div class="reg-notices" data-hide-when-done${behindPassword(model)}>${note}${error}${renderNoScript()}</div>`;
}

/**
 * The screen an event with a password shows first (D-C3): the lock, the name of the event, what to do, the field, and a
 * button that only looks at whether something is typed. It is the mockup's "Event password" screen. The field and the error
 * under it are the script's (./form-script.ts); with no script the button stays off and the page says why.
 */
function renderPasswordScreen(model: RegistrationFormModel): string {
  return `<section class="reg-center" id="reg-password" aria-labelledby="reg-password-title">
      <div class="reg-badge">${icon("lock")}</div>
      <h1 id="reg-password-title">${esc(model.event.title)}</h1>
      <p>This registration needs the event password. You will find it in your invitation.</p>
      ${renderPasswordField()}
      <button class="at-btn at-btn--primary at-btn--lg" type="button" id="reg-password-continue" disabled>Continue</button>
      ${renderNoScript()}
    </section>`;
}

/** The screen that replaces the form after a send. The script fills in the address and shows it. */
function renderInbox(model: RegistrationFormModel): string {
  const next = model.verifyEmail
    ? " Open the link in it to confirm your address. The link works for 24 hours."
    : " It tells you what happens next.";
  return `<section class="reg-center" id="reg-done" aria-labelledby="reg-done-title" hidden>
      <div class="reg-badge">${icon("mail")}</div>
      <h1 id="reg-done-title" tabindex="-1">Check your inbox</h1>
      <p>We sent a message to <b id="reg-done-email"></b>.${next}</p>
      <div class="reg-facts"><span>${icon("clock")}It can take a few minutes</span><span>${icon("mail")}Look in your spam folder too</span></div>
      <p class="reg-fine">Wrong address? <button class="reg-linkbtn" type="button" id="reg-again">Start again</button></p>
    </section>`;
}

/** The footer of the card: who to write to, when the event has a contact, and the product line. `gate`: the attributes of
 * what waits behind the password screen, which the mockup shows without the contact line. */
export function renderFoot(contact: FormContact | null, gate = ""): string {
  let line = "";
  if (contact) {
    const who = contact.name ? `<b>${esc(contact.name)}</b> at ` : "";
    line = `<p class="reg-foot-line"${gate}>${icon("mail")}Questions? Contact ${who}${esc(contact.email)}</p>`;
  }
  return `<div class="ticket__foot">${line}<div>Powered by Admitto</div></div>`;
}

/** The form page, for the nonce of one response. */
export function renderRegistrationFormPage(model: RegistrationFormModel, options: RegistrationPageOptions): string {
  const gate = behindPassword(model);
  const form = `<form class="reg-form" id="reg-form" method="post" action="/r/${esc(model.event.slug)}" novalidate data-hide-when-done${gate}>
      <p class="reg-legend"><span class="reg-req" aria-hidden="true">*</span> Required</p>
      ${renderPersonalFields(model)}${renderQuestions(model.questions, { timeZone: model.event.timezone })}${renderCompanion(model)}${renderAgreement(model)}
    </form>`;
  const content = [
    renderHeader(model.event),
    model.needsPassword ? renderPasswordScreen(model) : "",
    renderHero(model.event, gate),
    renderNotices(model),
    form,
    renderInbox(model),
    renderFoot(model.contact, gate),
  ]
    .filter((part) => part !== "")
    .join("\n    ");
  const scripts = `${renderFormScript(options.nonce)}\n  <script src="${TURNSTILE_SCRIPT_URL}" async defer></script>`;
  return renderDocument(`Registration - ${model.event.title}`, content, scripts, options.theme);
}

/** The page of an event that is over. No form, no script, no widget. */
export function renderRegistrationClosedPage(page: ClosedFormModel, theme?: BrandingTheme | null): string {
  const content = [
    renderHeader(page.event),
    `<div class="reg-center">
      <div class="reg-badge reg-badge--muted">${icon("calendar-off")}</div>
      <h1>Registration is closed</h1>
      <p>Registration for ${esc(page.event.title)} has ended.</p>
    </div>`,
    renderFoot(page.contact),
  ].join("\n    ");
  return renderDocument(`Registration closed - ${page.event.title}`, content, "", theme);
}
