/**
 * The pages of the link that confirms an address (`/r/:slug/confirm/:token`, ./confirm-route.ts): the page the link
 * opens, with a button, and the screen each answer to the button comes to. They are the status screens of the approved
 * mockup (`_ops/v08-registration/mockups`) in the card of the registration form, built from the same shell.
 *
 * Pure, like ./form-page.ts: the model in, a string out, and no script. The button is a plain form posting to the page's
 * own address, so nothing runs in the browser and nothing but a person's click can confirm.
 *
 * What a page may say is limited. The link is the credential of an address, so a page can say where the registration
 * stands, but it holds no name, no address and no answer of the guest: the model has none to give. A registration that
 * the organisers turned down is told as "already confirmed" too: by default they send no mail about a rejection (D-B8),
 * and this page must not say what that mail would not.
 */
import type { BrandingTheme } from "@admitto/auth";
import type { PlacedStatus } from "@admitto/tickets";
import { esc } from "../ticket-page.js";
import { icon, type GuestIcon } from "./form-icons.js";
import { renderDocument, renderFoot, renderHeader } from "./form-page.js";
import type { FormContact, FormEvent } from "./form-model.js";

/** What a confirmation page shows. */
export type ConfirmScreen =
  /** The page the link opens: a button, and nothing is confirmed by opening it. */
  | { kind: "ask" }
  /** The button was used and the registration left `awaiting_email` now, for this state. */
  | { kind: "placed"; status: PlacedStatus }
  /** The registration had left `awaiting_email` before (a second click, or a decision of the organisers since). */
  | { kind: "already" }
  /** The link ran out, or its registration is gone (cleaned up, deleted or erased): the guest registers again. */
  | { kind: "expired" }
  /** The address became an attendee meanwhile. */
  | { kind: "registered" }
  /** No place and no waiting list: the registration stays, and the link works until it runs out. */
  | { kind: "full" }
  /** Nothing could be written just now (a lock was held): nothing changed, and the link works. */
  | { kind: "busy" };

export interface ConfirmPageModel {
  event: FormEvent;
  contact: FormContact | null;
}

type Badge = "info" | "ok" | "warn" | "muted";

/** The button under the text: a form that posts to this page again, or the link back to the registration form. */
type Action = { kind: "post"; label: string; icon: GuestIcon } | { kind: "register"; label: string };

interface ScreenContent {
  badge: Badge;
  icon: GuestIcon;
  title: string;
  /** Trusted markup: fixed sentences, with the event's title escaped in the one place it is used. */
  body: (event: FormEvent) => string;
  /** Whether the date and the venue of the event are shown. */
  facts: boolean;
  action: Action | null;
  /** A line in small type under the button. */
  fine?: string;
}

const text = (sentence: string) => () => esc(sentence);

const PLACED: Readonly<Record<PlacedStatus, ScreenContent>> = {
  accepted: {
    badge: "ok",
    icon: "check",
    title: "You are registered",
    body: text("Thank you. Your address is confirmed. Your ticket is on its way to your inbox."),
    facts: true,
    action: null,
  },
  pending: {
    badge: "ok",
    icon: "check",
    title: "Registration received",
    body: text("Thank you. Your address is confirmed. The organisers will review your registration and email you as soon as there is a decision."),
    facts: true,
    action: null,
  },
  waitlist: {
    badge: "warn",
    icon: "hourglass",
    title: "You are on the waiting list",
    body: text("All places are taken right now. If one becomes free, the organisers can offer it to you, and we will email you."),
    facts: true,
    action: null,
  },
};

const OTHER: Readonly<Record<Exclude<ConfirmScreen["kind"], "placed">, ScreenContent>> = {
  ask: {
    badge: "info",
    icon: "mail",
    title: "Confirm your email address",
    body: (event) => `Select the button to confirm your address for <b>${esc(event.title)}</b>.`,
    facts: true,
    action: { kind: "post", label: "Confirm my address", icon: "check" },
    fine: "Did not register? Close this page. Nothing is confirmed until you select the button, and the request is deleted after 24 hours.",
  },
  already: {
    badge: "ok",
    icon: "check",
    title: "Your address is already confirmed",
    body: text("There is nothing more to do here. Look in your inbox, and in your spam folder, for our messages."),
    facts: false,
    action: null,
  },
  expired: {
    badge: "muted",
    icon: "clock",
    title: "This link has expired",
    body: text("Confirmation links work for 24 hours. Register again and we will send you a new one."),
    facts: false,
    action: { kind: "register", label: "Register again" },
  },
  registered: {
    badge: "ok",
    icon: "check",
    title: "You are already registered",
    body: text("This address is already registered for this event. If you are missing your ticket, contact the organisers."),
    facts: true,
    action: null,
  },
  full: {
    badge: "warn",
    icon: "users",
    title: "This event is full",
    body: text(
      "There is no place left right now, and your address is not confirmed yet. Nothing is reserved for you. If a place becomes free, you can select the button again until this link expires.",
    ),
    facts: true,
    action: { kind: "post", label: "Try again", icon: "refresh" },
  },
  busy: {
    badge: "muted",
    icon: "refresh",
    title: "Please try again in a moment",
    body: text("We could not confirm your address just now. Nothing has changed, and your link still works."),
    facts: false,
    action: { kind: "post", label: "Try again", icon: "refresh" },
  },
};

function contentOf(screen: ConfirmScreen): ScreenContent {
  return screen.kind === "placed" ? PLACED[screen.status] : OTHER[screen.kind];
}

/** The title of the page, which is the heading of its screen. */
export function confirmScreenTitle(screen: ConfirmScreen): string {
  return contentOf(screen).title;
}

function renderFacts(event: FormEvent): string {
  const venue = event.venue ? `<span>${icon("pin")}${esc(event.venue)}</span>` : "";
  return `<div class="reg-facts"><span>${icon("calendar")}${esc(event.when)}</span>${venue}</div>`;
}

function renderAction(action: Action, event: FormEvent): string {
  if (action.kind === "register") {
    return `<a class="at-btn at-btn--primary at-btn--lg" href="/r/${esc(event.slug)}">${icon("refresh", "ic reg-btn-icon")}${esc(action.label)}</a>`;
  }
  // No `action` attribute: the form posts to the address of the page, which holds the link. Nothing is in the body.
  return `<form method="post"><button class="at-btn at-btn--primary at-btn--lg" type="submit">${icon(action.icon, "ic reg-btn-icon")}${esc(action.label)}</button></form>`;
}

/** The page for a screen. */
export function renderConfirmPage(screen: ConfirmScreen, model: ConfirmPageModel, theme?: BrandingTheme | null): string {
  const content = contentOf(screen);
  const { event } = model;
  const center = `<div class="reg-center">
      <div class="reg-badge${content.badge === "info" ? "" : ` reg-badge--${content.badge}`}">${icon(content.icon)}</div>
      <h1>${esc(content.title)}</h1>
      <p>${content.body(event)}</p>
      ${content.facts ? renderFacts(event) : ""}
      ${content.action ? renderAction(content.action, event) : ""}
      ${content.fine ? `<p class="reg-fine">${esc(content.fine)}</p>` : ""}
    </div>`;
  const body = [renderHeader(event), center, renderFoot(model.contact)].join("\n    ");
  return renderDocument(`${content.title} - ${event.title}`, body, "", theme);
}
