import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { confirmScreenTitle, renderConfirmPage, type ConfirmScreen } from "../../src/registration/confirm-page.js";
import { documentOf, formModel, type Dom } from "../helpers/registration-form-fixtures.js";

const AXE_SOURCE = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

const model = () => {
  const { event, contact } = formModel();
  return { event, contact };
};

const textOf = (el: { textContent: string | null } | null) => (el?.textContent ?? "").replaceAll(/\s+/g, " ").trim();

/** `badge` is the modifier of `.reg-badge`; none is the colour of the brand. */
const SCREENS: Array<{ name: string; screen: ConfirmScreen; title: string; badge: "" | "ok" | "warn" | "muted"; icon: string }> = [
  { name: "the page the link opens", screen: { kind: "ask" }, title: "Confirm your email address", badge: "", icon: "#i-mail" },
  { name: "a guest who is registered", screen: { kind: "placed", status: "accepted" }, title: "You are registered", badge: "ok", icon: "#i-check" },
  { name: "a guest whose registration awaits a decision", screen: { kind: "placed", status: "pending" }, title: "Registration received", badge: "ok", icon: "#i-check" },
  { name: "a guest on the waiting list", screen: { kind: "placed", status: "waitlist" }, title: "You are on the waiting list", badge: "warn", icon: "#i-hourglass" },
  { name: "a second click", screen: { kind: "already" }, title: "Your address is already confirmed", badge: "ok", icon: "#i-check" },
  { name: "a link that ran out", screen: { kind: "expired" }, title: "This link has expired", badge: "muted", icon: "#i-clock" },
  { name: "an address that is an attendee's", screen: { kind: "registered" }, title: "You are already registered", badge: "ok", icon: "#i-check" },
  { name: "a full event", screen: { kind: "full" }, title: "This event is full", badge: "warn", icon: "#i-users" },
  { name: "a lock that is held", screen: { kind: "busy" }, title: "Please try again in a moment", badge: "muted", icon: "#i-refresh" },
];

/** The screens whose button posts the page again. */
const POSTING = new Set<ConfirmScreen["kind"]>(["ask", "full", "busy"]);

describe("a confirmation page follows the status screens of the mockup, in the card of the form", () => {
  it.each(SCREENS)("has the card, one heading, a badge, the footer, and no script, for $name", ({ screen, title, badge, icon }) => {
    const html = renderConfirmPage(screen, model());
    const doc = documentOf(html);

    expect(doc.querySelector("main.ticket.ticket--registration")).not.toBeNull();
    expect(textOf(doc.querySelector(".ticket__top small"))).toBe("Registration");
    expect(doc.querySelectorAll("h1")).toHaveLength(1);
    expect(textOf(doc.querySelector(".reg-center h1"))).toBe(title);
    expect(confirmScreenTitle(screen)).toBe(title);
    expect(doc.title).toBe(`${title} - Northwind Partner Summit 2027`);
    expect(doc.querySelector(".reg-badge")?.className).toBe(badge === "" ? "reg-badge" : `reg-badge reg-badge--${badge}`);
    expect(doc.querySelector(".reg-badge use")?.getAttribute("href")).toBe(icon);
    expect(textOf(doc.querySelector(".reg-foot-line"))).toBe("Questions? Contact Anna Kowalska at events@northwind.example");
    expect(textOf(doc.querySelector(".ticket__foot > div"))).toBe("Powered by Admitto");
    // Nothing runs on the page, and nothing can be sent but the form of the button.
    expect(doc.querySelectorAll("script")).toHaveLength(0);
    expect(doc.querySelectorAll("input, select, textarea")).toHaveLength(0);
    expect(html).not.toMatch(/\son[a-z]+=/i);
  });

  it("leaves the date and the venue out of the screens that have no use for them", () => {
    const shown = (screen: ConfirmScreen) => documentOf(renderConfirmPage(screen, model())).querySelectorAll(".reg-facts span").length;
    expect(shown({ kind: "ask" })).toBe(2);
    expect(shown({ kind: "placed", status: "accepted" })).toBe(2);
    expect(shown({ kind: "expired" })).toBe(0);
    expect(shown({ kind: "busy" })).toBe(0);
    expect(shown({ kind: "already" })).toBe(0);
  });

  it("keeps the footer without a contact line when the event has none", () => {
    const doc = documentOf(renderConfirmPage({ kind: "ask" }, { ...model(), contact: null }));
    expect(doc.querySelector(".reg-foot-line")).toBeNull();
    expect(textOf(doc.querySelector(".ticket__foot"))).toBe("Powered by Admitto");
  });
});

describe("the button", () => {
  const posting = SCREENS.filter(({ screen }) => POSTING.has(screen.kind));

  it.each(posting)("is a form that posts to the address of the page, with no field and no address of its own, on $name", ({ screen }) => {
    const doc = documentOf(renderConfirmPage(screen, model()));
    const forms = [...doc.querySelectorAll("form")] as Dom[];

    expect(forms).toHaveLength(1);
    expect(forms[0].getAttribute("method")).toBe("post");
    // No action: the form posts to the address the page was opened at, which holds the link. The link is not repeated in the page.
    expect(forms[0].hasAttribute("action")).toBe(false);
    expect(forms[0].querySelectorAll("button")).toHaveLength(1);
    expect(forms[0].querySelector("button").getAttribute("type")).toBe("submit");
    expect(forms[0].querySelector("button").className).toContain("at-btn--primary");
  });

  it("is labelled by what it does", () => {
    const label = (screen: ConfirmScreen) => textOf(documentOf(renderConfirmPage(screen, model())).querySelector("form button"));
    expect(label({ kind: "ask" })).toBe("Confirm my address");
    expect(label({ kind: "full" })).toBe("Try again");
    expect(label({ kind: "busy" })).toBe("Try again");
  });

  it("says on the page the link opens that nothing is confirmed by opening it, and what happens to a request nobody confirms", () => {
    const doc = documentOf(renderConfirmPage({ kind: "ask" }, model()));
    expect(textOf(doc.querySelector(".reg-fine"))).toBe(
      "Did not register? Close this page. Nothing is confirmed until you select the button, and the request is deleted after 24 hours.",
    );
    expect(textOf(doc.querySelector(".reg-center p"))).toBe("Select the button to confirm your address for Northwind Partner Summit 2027.");
  });

  it.each(SCREENS.filter(({ screen }) => !POSTING.has(screen.kind) && screen.kind !== "expired"))(
    "is not on a screen that settles the matter: $name",
    ({ screen }) => {
      const doc = documentOf(renderConfirmPage(screen, model()));
      expect(doc.querySelectorAll("form, button, a.at-btn")).toHaveLength(0);
    },
  );

  it("sends a guest whose link ran out back to the registration form of the event, as a link", () => {
    const doc = documentOf(renderConfirmPage({ kind: "expired" }, model()));
    const link = doc.querySelector("a.at-btn.at-btn--primary");
    expect(link?.getAttribute("href")).toBe("/r/northwind-summit");
    expect(textOf(link)).toBe("Register again");
    expect(doc.querySelectorAll("form")).toHaveLength(0);
    expect(textOf(doc.querySelector(".reg-center p"))).toBe("Confirmation links work for 24 hours. Register again and we will send you a new one.");
  });
});

describe("what a page says about the registration", () => {
  const sentences = (screen: ConfirmScreen) => textOf(documentOf(renderConfirmPage(screen, model())).querySelector(".reg-center p"));

  it("tells the state of the registration that was just placed, in the words of the mockup", () => {
    expect(sentences({ kind: "placed", status: "accepted" })).toBe("Thank you. Your address is confirmed. Your ticket is on its way to your inbox.");
    expect(sentences({ kind: "placed", status: "pending" })).toBe(
      "Thank you. Your address is confirmed. The organisers will review your registration and email you as soon as there is a decision.",
    );
    expect(sentences({ kind: "placed", status: "waitlist" })).toBe(
      "All places are taken right now. If one becomes free, the organisers can offer it to you, and we will email you.",
    );
  });

  it("says nothing about a decision for a registration that was placed before: a second click is told the address is confirmed, whatever became of it", () => {
    expect(sentences({ kind: "already" })).toBe("There is nothing more to do here. Look in your inbox, and in your spam folder, for our messages.");
    for (const word of ["reject", "declin", "turned down", "waiting list", "accepted", "ticket"]) {
      expect(sentences({ kind: "already" }).toLowerCase()).not.toContain(word);
    }
  });

  it("holds no name and no address of the guest: the page has none to show", () => {
    for (const { screen } of SCREENS) {
      const text = textOf(documentOf(renderConfirmPage(screen, model())).querySelector(".reg-center"));
      expect(text).not.toMatch(/@/);
    }
  });

  it("tells a guest of a full event that nothing is reserved and that the link works until it runs out", () => {
    expect(sentences({ kind: "full" })).toContain("Nothing is reserved for you.");
    expect(sentences({ kind: "full" })).toContain("until this link expires");
    expect(sentences({ kind: "busy" })).toBe("We could not confirm your address just now. Nothing has changed, and your link still works.");
  });
});

describe("everything the organiser wrote is escaped", () => {
  const hostile = `"><script>alert(1)</script><img src=x onerror=alert(2)>`;

  it("keeps the title, the venue, the date, the slug and the contact inside their text on every screen", () => {
    const { event } = model();
    const evil = {
      event: { ...event, title: hostile, venue: hostile, when: hostile, slug: `x"><script>alert(3)</script>`, logoUrl: null },
      contact: { name: hostile, email: hostile },
    };
    for (const { screen } of SCREENS) {
      const doc = documentOf(renderConfirmPage(screen, evil));
      expect(doc.querySelectorAll("script, img[onerror], [onerror]"), screen.kind).toHaveLength(0);
      expect(doc.querySelectorAll("img[src='x']")).toHaveLength(0);
    }
    const ask = documentOf(renderConfirmPage({ kind: "ask" }, evil));
    expect(textOf(ask.querySelector(".reg-center p"))).toContain(hostile);
    // The contact of the organiser, in the footer, is text too.
    expect(textOf(ask.querySelector(".reg-foot-line"))).toContain(hostile);
    const expired = documentOf(renderConfirmPage({ kind: "expired" }, evil));
    expect(expired.querySelector("a.at-btn")?.getAttribute("href")).toBe(`/r/x"><script>alert(3)</script>`);
    expect(expired.querySelectorAll("script")).toHaveLength(0);
  });
});

describe("axe-core finds nothing to report", () => {
  async function violations(html: string) {
    const window = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://tickets.example.com/r/northwind-summit/confirm/token" }).window;
    window.eval(AXE_SOURCE);
    const results = await (window as unknown as { axe: { run: Function } }).axe.run(window.document, { rules: { "color-contrast": { enabled: false } } });
    return (results.violations as Array<{ id: string; help: string; nodes: Array<{ target: unknown }> }>).map(
      (violation) => `${violation.id}: ${violation.help} ${JSON.stringify(violation.nodes.slice(0, 3).map((node) => node.target))}`,
    );
  }

  it.each(SCREENS)("on $name", async ({ screen }) => {
    expect(await violations(renderConfirmPage(screen, model()))).toEqual([]);
  });
});
