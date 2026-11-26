import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * What keeps text readable in the admin SPA (AGENTS.md, "Admin SPA readability"): the lines of a short block are made even so that
 * a lone word never ends it, a label wraps instead of being cut to "Attende…", and a column is never so narrow that only a word or
 * two fits on a line. All of it is CSS, which the tests in jsdom cannot see, and each rule is a guess about layout that a later
 * edit can quietly undo, so they are pinned here (the pages themselves were looked at in real Chrome, at 1280px and at 390px).
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replaceAll(/\/\*[\s\S]*?\*\//g, "");

interface Rule {
  /** The `@media` the rule sits in, or null. */
  media: string | null;
  selector: string;
  body: string;
}

/** Every rule of a stylesheet with the media query it sits in (these files nest only one level deep). */
function parse(css: string): Rule[] {
  const rules: Rule[] = [];
  const open: string[] = [];
  let prelude = "";
  let bodyStart = 0;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === "{") {
      open.push(prelude.trim());
      prelude = "";
      bodyStart = i + 1;
    } else if (ch === "}") {
      const head = open.pop() ?? "";
      if (!head.startsWith("@")) {
        const media = open.find((p) => p.startsWith("@media")) ?? null;
        rules.push({ media, selector: head.replaceAll(/\s+/g, " "), body: css.slice(bodyStart, i) });
      }
      prelude = "";
      bodyStart = i + 1;
    } else {
      prelude += ch;
    }
  }
  return rules;
}

function bodyOf(rules: Rule[], selector: string, media: string | null = null): string {
  const found = rules.find((r) => r.selector === selector && r.media === media);
  expect(found, `no rule for ${selector}${media ? ` in ${media}` : ""}`).toBeDefined();
  return found!.body;
}

/** A property that is set, as the declaration `name: value` (not a longer property that ends in the same letters, `min-height` for `height`). */
const sets = (body: string, name: string, value: string) =>
  new RegExp(String.raw`(?:^|[;\s])${name}\s*:\s*${value}\s*(?:;|$)`).test(body.trim());
const declares = (body: string, name: string) => new RegExp(String.raw`(?:^|[;\s])${name}\s*:`).test(body);

const base = parse(read("packages/ui/src/styles/tokens/base.css"));
const emptyState = parse(read("packages/ui/src/styles/components/empty-state.css"));
const components = parse(read("packages/ui/src/styles/components.css"));
const staff = parse(read("apps/admin/src/staff.css"));
const users = parse(read("apps/admin/src/pages/users-page.css"));
const reports = parse(read("apps/admin/src/pages/reports-page.css"));
const attendees = parse(read("apps/admin/src/attendees/attendees.css"));
const requests = parse(read("apps/admin/src/registration/registration-requests.css"));
const requestDetail = parse(read("apps/admin/src/registration/request-detail.css"));
const notifications = parse(read("apps/admin/src/settings/notifications-panel.css"));
const requirements = parse(read("apps/admin/src/requirements/requirements.css"));
const importPage = parse(read("apps/admin/src/pages/import.css"));

describe("the baseline: running text runs to the edge of its column, short standalone texts are balanced", () => {
  it("is pretty on the body, so that every description, hint and paragraph inherits it and none is a narrow block with an empty strip beside it", () => {
    expect(sets(bodyOf(base, "body"), "text-wrap", "pretty")).toBe(true);
  });

  it("balances the texts that stand alone: headings, titles, an empty state and a toast", () => {
    const selector = base.find((r) => r.media === null && r.selector.startsWith("h1, h2, h3, h4, h5, h6,"))?.selector ?? "";
    for (const part of ["h1", "h6", ".at-card__title", ".at-pageheader__title", ".at-empty-state__title", ".at-empty-state__desc", ".at-toast"]) {
      expect(selector, part).toContain(part);
    }
    // A tooltip box is as wide as the unbroken text, so balancing its lines only leaves an empty strip on the right.
    expect(selector).not.toContain("tooltip");
    expect(sets(bodyOf(base, selector), "text-wrap", "balance")).toBe(true);
  });

  it("leaves what is typed, or laid out by its author, as it is (the longhand, which keeps a pre's own white-space)", () => {
    const body = bodyOf(base, "input, textarea, select, pre, code, kbd, samp");
    expect(sets(body, "text-wrap-style", "auto")).toBe(true);
    expect(declares(body, "text-wrap")).toBe(false);
  });

  it("gives the description of an empty or error state room for two even lines of a sentence of this length", () => {
    const width = /max-width:\s*(\d+)ch/.exec(bodyOf(emptyState, ".at-empty-state__desc"));
    expect(Number(width?.[1])).toBeGreaterThanOrEqual(40);
  });
});

describe("a notice with an action, on a phone", () => {
  it("puts the action under the text instead of beside it, lined up with the text", () => {
    const media = "@media (max-width: 640px)";
    expect(sets(bodyOf(components, ".at-notice--has-action", media), "flex-wrap", "wrap")).toBe(true);
    expect(sets(bodyOf(components, ".at-notice--has-action .at-notice__action", media), "flex", "1 0 100%")).toBe(true);
    expect(bodyOf(components, ".at-notice--has-action .at-notice__action", media)).toMatch(/padding-left:\s*calc\(1em \+ var\(--space-2\)\)/);
  });
});

describe("the stat tiles (Overview, Users, Reports): nothing is cut off", () => {
  const media = "@media (max-width: 640px)";
  const tiles = [
    { name: "Overview", rules: staff, tile: ".overview-kpi", label: ".overview-kpi__label", icon: ".overview-kpi__icon", card: ".overview-kpi-card > .at-card__body", phoneMin: "96px" },
    { name: "Users", rules: users, tile: ".users-page__stat", label: ".users-page__stat-label", icon: ".users-page__stat-icon", card: ".users-page__stat-card > .at-card__body", phoneMin: null },
    { name: "Reports", rules: reports, tile: ".reports-stat", label: ".reports-stat__label", icon: ".reports-stat__icon", card: ".reports-stats-grid > .at-card > .at-card__body", phoneMin: "108px" },
  ];

  for (const { name, rules, tile, label, icon, card, phoneMin } of tiles) {
    it(`${name}: the tile is at least 76px tall, never exactly, so a label that wraps makes it taller`, () => {
      const body = bodyOf(rules, tile);
      expect(sets(body, "min-height", "76px")).toBe(true);
      expect(declares(body, "height")).toBe(false);
    });

    it(`${name}: the label wraps, where an ellipsis would hide the word`, () => {
      expect(declares(bodyOf(rules, label), "white-space")).toBe(false);
    });

    it(`${name}: on a phone the tile gives its text more room (less padding at the sides, a smaller icon) and is not a fixed height`, () => {
      const tilePhone = bodyOf(rules, tile, media);
      if (phoneMin) expect(sets(tilePhone, "min-height", phoneMin)).toBe(true);
      expect(declares(tilePhone, "height")).toBe(false);
      expect(sets(bodyOf(rules, card, media), "padding-inline", "10px")).toBe(true);
      expect(sets(bodyOf(rules, icon, media), "width", "30px")).toBe(true);
    });
  }

  it("the Overview and Users cards centre their tile in the height the grid gives them, so a taller sibling does not leave the text at the top", () => {
    for (const body of [bodyOf(staff, ".overview-kpi-card > .at-card__body"), bodyOf(users, ".users-page__stat-card > .at-card__body"), bodyOf(reports, ".reports-stats-grid > .at-card > .at-card__body")]) {
      expect(sets(body, "display", "flex")).toBe(true);
      expect(sets(body, "align-items", "center")).toBe(true);
    }
  });
});

describe("the attendee page", () => {
  it("lets the check-in time move under the day when the chip is too narrow for both on a line", () => {
    expect(sets(bodyOf(attendees, ".attendee-status-chip__checkin"), "flex-wrap", "wrap")).toBe(true);
  });

  it("gives the subtitle the whole width under the title and the actions on a phone, where beside the actions it had 127px", () => {
    const media = "@media (max-width: 767px)";
    expect(sets(bodyOf(attendees, ".attendee-detail-pageheader .at-pageheader__row", media), "display", "grid")).toBe(true);
    expect(sets(bodyOf(attendees, ".attendee-detail-pageheader .at-pageheader__row > :first-child", media), "display", "contents")).toBe(true);
    expect(sets(bodyOf(attendees, ".attendee-detail-pageheader .at-pageheader__subtitle", media), "grid-column", "1 / -1")).toBe(true);
  });
});

describe("the attendee page's Activity log, on a phone", () => {
  const media = "@media (max-width: 560px)";

  it("wraps a row, so that the time and the person can go under the text instead of beside it", () => {
    expect(sets(bodyOf(attendees, ".at-tl-item", media), "flex-wrap", "wrap")).toBe(true);
  });

  it("gives the time and the person a line of their own, lined up with the text: beside it they left it a column of 66px at 390px", () => {
    const meta = bodyOf(attendees, ".at-tl-meta", media);
    expect(sets(meta, "flex", "0 0 100%")).toBe(true);
    expect(sets(meta, "flex-direction", "row")).toBe(true);
    expect(sets(meta, "flex-wrap", "wrap")).toBe(true);
    expect(sets(meta, "padding-left", String.raw`calc\(28px \+ 12px\)`)).toBe(true);
    // The indent is the dot and the gap of the row, which are what it lines up with: changing either has to change it too.
    expect(sets(bodyOf(attendees, ".at-tl-dot"), "width", "28px")).toBe(true);
    expect(sets(bodyOf(attendees, ".at-tl-item"), "gap", "12px")).toBe(true);
  });

  it("lets the person's name wrap, where a long address would stick out of the row, and keeps the time on one line", () => {
    const actor = bodyOf(attendees, ".at-tl-actor", media);
    expect(sets(actor, "white-space", "normal")).toBe(true);
    expect(sets(actor, "overflow-wrap", "anywhere")).toBe(true);
    // A date broken in the middle is worse than a long one.
    expect(sets(bodyOf(attendees, ".at-tl-time"), "white-space", "nowrap")).toBe(true);
  });
});

describe("the attendee page's Notes", () => {
  it("lets the head of a note wrap, so that the time goes to the next line instead of past the card (it stuck out at 390px)", () => {
    expect(sets(bodyOf(attendees, ".at-notes-list__head"), "flex-wrap", "wrap")).toBe(true);
  });

  it("lets the avatar, the name and the role wrap too, and the group shrink below its content, so a long name does not hold the head wide", () => {
    const group = bodyOf(attendees, ".at-notes-list__author-group");
    expect(sets(group, "flex-wrap", "wrap")).toBe(true);
    expect(sets(group, "min-width", "0")).toBe(true);
  });

  it("breaks a name that does not fit (an address, when that is the name) only where it has to", () => {
    const author = bodyOf(attendees, ".at-notes-list__author");
    expect(sets(author, "overflow-wrap", "anywhere")).toBe(true);
    expect(declares(author, "word-break")).toBe(false);
  });
});

describe("the notification settings, on a phone and on a tablet", () => {
  // Below 1024px: the 460px box of a 768px screen would give the type 84px of a fixed layout, and the description ran to 13 lines.
  const media = "@media (max-width: 1023px)";
  const row = ".item-table .table.notifications-type-matrix tbody";

  it("shows the type x channel matrix as a block for each type: the text across the width and the toggles under it, each named", () => {
    expect(sets(bodyOf(notifications, `${row} tr`, media), "display", "grid")).toBe(true);
    expect(sets(bodyOf(notifications, `${row} td:first-child`, media), "grid-column", "1 / -1")).toBe(true);
    expect(sets(bodyOf(notifications, `${row} td:not(:first-child)::before`, media), "content", "attr\\(data-label\\)")).toBe(true);
    // The header row stays for assistive tech and is out of sight.
    expect(sets(bodyOf(notifications, ".notifications-type-matrix thead", media), "position", "absolute")).toBe(true);
  });

  it("takes the height and the padding of the shared row back for a block of a type, which holds a name, a description and its toggles", () => {
    expect(sets(bodyOf(notifications, `${row} tr`, media), "height", "auto")).toBe(true);
    expect(sets(bodyOf(notifications, `${row} td`, media), "padding", "0")).toBe(true);
    expect(sets(bodyOf(notifications, `${row} td`, media), "width", "auto")).toBe(true);
  });

  it("puts the webhook's fields one under the other, where side by side the format's select cut 'Generic JSON'", () => {
    const body = bodyOf(notifications, ".notifications-webhook-row > .mail-secret-field, .notifications-webhook-row > .at-field", "@media (max-width: 480px)");
    expect(sets(body, "flex", "1 1 100%")).toBe(true);
  });
});

describe("the Users cards", () => {
  it("wrap their head when the name and the badge with its icons do not fit side by side, instead of squeezing the name to a few letters a line", () => {
    expect(sets(bodyOf(users, ".users-page__card-head"), "flex-wrap", "wrap")).toBe(true);
    const basis = /flex:\s*1 1 ([\d.]+)rem/.exec(bodyOf(users, ".users-page__card-head > :first-child"));
    expect(Number(basis?.[1])).toBeGreaterThanOrEqual(13);
    expect(sets(bodyOf(users, ".users-page__card-head > .sessions-card-head-end"), "margin-left", "auto")).toBe(true);
  });

  it("give a cell that holds a time with its local time under it both columns, where in one it ran to three lines of one or two words", () => {
    expect(sets(bodyOf(users, ".users-page__card-meta > .users-page__card-meta-wide"), "grid-column", "1 / -1")).toBe(true);
  });
});

describe("the Users cards, on a phone", () => {
  it("name the user whole, wrapped, where a table cell truncates", () => {
    const body = bodyOf(users, ".users-page__card .users-page__user-name, .users-page__card .users-page__user-email", "@media (max-width: 768px)");
    expect(sets(body, "white-space", "normal")).toBe(true);
    expect(sets(body, "overflow-wrap", "anywhere")).toBe(true);
  });
});

describe("the sessions table (Users & roles), on a laptop", () => {
  it("drops its Sign-in column from 1181px to 1499px, right after the tablet range that drops three columns: Device and IP address stay", () => {
    expect(sets(bodyOf(staff, ".sessions-col-tablet-hide", "@media (min-width: 768px) and (max-width: 1180px)"), "display", "none")).toBe(true);
    expect(sets(bodyOf(staff, ".sessions-col-laptop-hide", "@media (min-width: 1181px) and (max-width: 1499px)"), "display", "none")).toBe(true);
  });

  it("hides nothing from 1500px, where the eight columns fit in a line or two a cell, and nothing outside that range", () => {
    expect(staff.some((r) => r.selector.includes("sessions-col-laptop-hide") && r.media === null)).toBe(false);
    expect(staff.filter((r) => r.selector.includes("sessions-col-laptop-hide")).map((r) => r.media)).toEqual(["@media (min-width: 1181px) and (max-width: 1499px)"]);
  });
});

describe("the sessions table", () => {
  it("breaks the IP cell inside a word only when it does not fit: 'Internal network' under an address was cut to 'Interna' / 'l network'", () => {
    const body = bodyOf(staff, ".sessions-ip-cell");
    expect(sets(body, "overflow-wrap", "anywhere")).toBe(true);
    expect(declares(body, "word-break")).toBe(false);
  });
});

describe("the pieces of the second review round (Reports chart, Danger zone, tabs, dialogs)", () => {
  const settings = parse(read("apps/admin/src/pages/event-settings-page.css"));
  const tabs = parse(read("apps/admin/src/components/scroll-fade-tabs.css"));
  const loader = parse(read("packages/ui/src/styles/components/loader.css"));
  const preview = parse(read("apps/admin/src/communication/wallet-message-preview.css"));

  it("grows the hourly chart into the height of the card beside it, so no empty strip is left under the hour labels", () => {
    expect(sets(bodyOf(reports, ".reports-panels > .at-card"), "display", "flex")).toBe(true);
    expect(sets(bodyOf(reports, ".reports-panels > .at-card > .at-card__body"), "flex", "1")).toBe(true);
    expect(sets(bodyOf(reports, ".reports-chart"), "flex", "1")).toBe(true);
    expect(sets(bodyOf(reports, ".reports-chart__track"), "flex", "1")).toBe(true);
    // The bar's percentage height has to resolve against a track whose height is not a fixed number.
    expect(sets(bodyOf(reports, ".reports-chart__bar"), "position", "absolute")).toBe(true);
  });

  it("lets a Danger zone description run to the button instead of stopping at 640px", () => {
    expect(declares(bodyOf(settings, ".danger-zone__desc"), "max-width")).toBe(false);
  });

  it("gives the focus ring of a tab room inside the scroll box, and takes the room back so the strip does not move", () => {
    const body = bodyOf(tabs, ".scroll-fade-tabs__scroll");
    expect(body).toMatch(/padding:\s*4px 4px 0/);
    expect(body).toMatch(/margin:\s*-4px -4px 0/);
  });

  it("brings a notice into a dialog with the dialog, without a slide of its own, and not at all for reduced motion", () => {
    expect(bodyOf(loader, "dialog[open] .at-notice")).toMatch(/animation:\s*at-fade-in 0\.15s/);
    expect(bodyOf(loader, ".at-fade-in, .content > *, :where(.scroll-fade-tabs, .at-tabs) ~ *, :where([role=\"tabpanel\"]), dialog[open], dialog[open] .at-notice, dialog[open] > :not(.at-modal-backdrop, [class*=\"backdrop\"])", "@media (prefers-reduced-motion: reduce)")).toMatch(/animation:\s*none/);
  });

  it("keeps the text under the wallet preview clear of the stacked layers that peek out under the card", () => {
    expect(sets(bodyOf(preview, ".wallet-message-preview"), "gap", "var\\(--space-4\\)")).toBe(true);
  });
});

describe("the Requests tab of the Registration page", () => {
  it("lets a name, an address, a company and a department wrap, and breaks inside a word only when it does not fit: none is cut to an ellipsis", () => {
    for (const selector of [
      ".registration-requests__name",
      ".registration-requests__email",
      ".registration-requests__company",
      ".registration-requests__department, .registration-requests__affiliation",
    ]) {
      const body = bodyOf(requests, selector);
      expect(sets(body, "overflow-wrap", "anywhere"), selector).toBe(true);
      expect(declares(body, "white-space"), selector).toBe(false);
      expect(declares(body, "text-overflow"), selector).toBe(false);
    }
  });

  it("gives the guest the widest column of the table, the company the room of a long department and the last email the room of its longest name, so a row stays two lines tall (the first column holds the checkbox)", () => {
    expect(sets(bodyOf(requests, ".registration-requests__table thead th:nth-child(2)"), "width", "32%")).toBe(true);
    expect(sets(bodyOf(requests, ".registration-requests__table thead th:nth-child(3)"), "min-width", "12rem")).toBe(true);
    expect(sets(bodyOf(requests, ".registration-requests__table thead th:nth-child(5)"), "min-width", "9.5rem")).toBe(true);
  });

  it("balances a company and a department, which stand alone in their cell, so that a name of two lines does not end on a word or two", () => {
    expect(sets(bodyOf(requests, ".registration-requests__company > span"), "text-wrap", "balance")).toBe(true);
  });

  it("gives the muted texts of a selected row and card the secondary grey, which is readable on the tint (the muted one is under 4.5:1)", () => {
    for (const selector of [
      ".attendees-table-v2__row--selected .registration-requests__email, .attendees-table-v2__row--selected .registration-requests__department, .attendees-table-v2__row--selected .registration-requests__mail-kind, .attendees-table-v2__row--selected .registration-requests__none, .registration-requests__card--selected .registration-requests__email, .registration-requests__card--selected .registration-requests__affiliation, .registration-requests__card--selected .registration-requests__mail-kind, .registration-requests__card--selected .registration-requests__card-label, .registration-requests__card--selected .registration-requests__none",
    ]) {
      expect(sets(bodyOf(requests, selector), "color", "var\\(--text-secondary\\)")).toBe(true);
    }
  });

  it("insets the banner of the waiting requests and the boxed table by the card's own spacing, so neither touches its edge", () => {
    expect(sets(bodyOf(requests, ".registration-requests__banner"), "padding", "var\\(--space-4\\) var\\(--space-4\\) 0")).toBe(true);
    expect(sets(bodyOf(requests, ".registration-requests__box"), "margin", "var\\(--space-4\\)")).toBe(true);
    expect(sets(bodyOf(requests, ".registration-requests__cards-wrap"), "margin", "var\\(--space-4\\)")).toBe(true);
  });

  it("keeps the table at a width it can be read in, and lets only it scroll sideways, inside its box, never the page", () => {
    const box = ".item-table.registration-requests__box";
    expect(sets(bodyOf(requests, `${box} .registration-requests__table-wrap .table`), "min-width", "640px")).toBe(true);
    expect(sets(bodyOf(requests, `${box} .registration-requests__table-wrap .table`), "table-layout", "auto")).toBe(true);
    expect(sets(bodyOf(requests, `${box} .registration-requests__table-wrap`), "overflow-x", "auto")).toBe(true);
  });

  it("gives the cards a box that looks like the table's: a border, rounded corners and a grey head row for Select all", () => {
    expect(sets(bodyOf(requests, ".registration-requests__cards-wrap"), "border", "1px solid var\\(--border\\)")).toBe(true);
    expect(sets(bodyOf(requests, ".registration-requests__cards-wrap"), "overflow", "hidden")).toBe(true);
    expect(sets(bodyOf(requests, ".registration-requests__selectall"), "background", "var\\(--surface-sunken\\)")).toBe(true);
  });

  it("puts the badge and the name of the last email on one line in a card, and in a column in the table", () => {
    const card = bodyOf(requests, ".registration-requests__card-mail .registration-requests__mail");
    expect(sets(card, "flex-direction", "row")).toBe(true);
    expect(sets(bodyOf(requests, ".registration-requests__mail"), "flex-direction", "column")).toBe(true);
  });

  it("lets the name and the address of the request window wrap, gives a long answer the whole row, and has one column of pairs on a phone", () => {
    for (const selector of [".request-detail__name, .request-detail__email"]) {
      expect(sets(bodyOf(requestDetail, selector), "overflow-wrap", "anywhere"), selector).toBe(true);
    }
    expect(sets(bodyOf(requestDetail, ".request-detail__wide"), "grid-column", "1 / -1")).toBe(true);
    expect(sets(bodyOf(requestDetail, ".request-detail__grid", "@media (max-width: 520px)"), "grid-template-columns", "minmax\\(0, 1fr\\)")).toBe(true);
  });

  it("lets the head of an email wrap, so that its badge goes under its name on a phone, and keeps Delete apart from the decisions", () => {
    expect(sets(bodyOf(requestDetail, ".request-detail__mail-head"), "flex-wrap", "wrap")).toBe(true);
    expect(sets(bodyOf(requestDetail, ".request-detail__delete"), "margin-right", "auto")).toBe(true);
  });

  it("is a column of cards, a card a column of lines, with no fixed height", () => {
    expect(sets(bodyOf(requests, ".registration-requests__cards"), "flex-direction", "column")).toBe(true);
    const card = bodyOf(requests, ".registration-requests__card");
    expect(sets(card, "flex-direction", "column")).toBe(true);
    expect(declares(card, "height")).toBe(false);
  });
});

describe("the Registration page's suggested questions: the card header, the window and its badges (looked at in real Chrome at 1280px and 390px)", () => {
  const requirements = parse(read("apps/admin/src/requirements/requirements.css"));
  const suggested = parse(read("apps/admin/src/registration/suggested-questions.css"));

  it("lets the header of the card grow on a phone, with the title first and the two buttons under it, instead of a button hanging out of the card", () => {
    const header = bodyOf(requirements, ".requirements-section--registration .at-card__header", "@media (max-width: 640px)");
    expect(sets(header, "flex-wrap", "wrap")).toBe(true);
    expect(sets(header, "height", "auto")).toBe(true);
    expect(sets(bodyOf(requirements, ".requirements-section--registration .at-card__actions", "@media (max-width: 640px)"), "flex-wrap", "wrap")).toBe(true);
  });

  it("gives the two buttons of the header a line each, as wide as the card, from 480px down, as on the Legal tab", () => {
    expect(sets(bodyOf(requirements, ".requirements-section--registration .at-card__actions > *", "@media (max-width: 480px)"), "flex", "1 1 100%")).toBe(true);
    expect(sets(bodyOf(requirements, ".requirements-section--registration .at-card__actions .at-btn", "@media (max-width: 480px)"), "width", "100%")).toBe(true);
  });

  it("scrolls the window of the questions on a screen too short for it, so that its buttons can still be reached", () => {
    const body = bodyOf(suggested, ".confirm-dialog__panel:has(.suggested-questions)");
    expect(sets(body, "max-height", "100%")).toBe(true);
    expect(sets(body, "overflow-y", "auto")).toBe(true);
  });

  it("puts the badge of a question under its words on a phone, as wide as its own words and not as a bar across the row", () => {
    expect(sets(bodyOf(suggested, ".suggested-questions__row", "@media (max-width: 480px)"), "grid-template-columns", String.raw`minmax\(0, 1fr\)`)).toBe(true);
    expect(sets(bodyOf(suggested, ".suggested-questions__row .at-badge", "@media (max-width: 480px)"), "justify-self", "start")).toBe(true);
  });

  it("wraps the words of a question inside their column instead of cutting them", () => {
    expect(sets(bodyOf(suggested, ".suggested-questions__title"), "overflow-wrap", "anywhere")).toBe(true);
    expect(sets(bodyOf(suggested, ".suggested-questions__text"), "min-width", "0")).toBe(true);
  });
});

describe("Theme by surface (Branding): the controls of the three rows line up and stack", () => {
  const controls = ".theme-surface-rows .settings-row__controls > *";

  it("gives the colour control and the font select of every row the same fixed width, so the rows line up", () => {
    const body = bodyOf(staff, controls);
    expect(sets(body, "width", "220px")).toBe(true);
    expect(sets(body, "flex", "0 0 220px")).toBe(true);
  });

  it("puts the controls under the text below 1024px, the two side by side while they fit, since a 768px screen has about 460px of content", () => {
    const media = "@media (max-width: 1023px)";
    expect(sets(bodyOf(staff, ".theme-surface-rows .settings-row", media), "flex-direction", "column")).toBe(true);
    expect(sets(bodyOf(staff, ".theme-surface-rows .settings-row", media), "align-items", "stretch")).toBe(true);
    expect(sets(bodyOf(staff, ".theme-surface-rows .settings-row__controls", media), "flex-wrap", "wrap")).toBe(true);
  });

  it("gives each control the whole row on a phone", () => {
    expect(sets(bodyOf(staff, controls, "@media (max-width: 640px)"), "width", "100%")).toBe(true);
  });
});

describe("the state of a secret field (Not set, the mask), on Mail and on Guest registration", () => {
  it("is set in the product font and the size of the text of a field, not in monospace: one font on a screen", () => {
    const body = bodyOf(staff, ".mail-secret-field__display-value");
    expect(declares(body, "font-family")).toBe(false);
    expect(sets(body, "font-size", String.raw`var\(--fs-body\)`)).toBe(true);
  });
});

describe("the text area (the description of a question, a long answer, a note)", () => {
  it("is set in the product font and the size of a field, not in monospace: it holds words, and the form had to override it", () => {
    const body = bodyOf(components, ".at-textarea");
    expect(declares(body, "font-family")).toBe(false);
    expect(declares(body, "font-size")).toBe(false);
    expect(sets(bodyOf(components, ".at-input, .at-select, .at-textarea"), "font-family", String.raw`var\(--font-sans\)`)).toBe(true);
  });
});

describe("the window of the field editor", () => {
  it("is wider than the other windows of its shell from a desktop width, and as wide as they are below it", () => {
    expect(sets(bodyOf(requirements, ".event-item-modal__panel"), "width", String.raw`min\(100%, 600px\)`)).toBe(true);
    expect(sets(bodyOf(requirements, ".event-item-modal__panel--wide", "@media (min-width: 1024px)"), "width", String.raw`min\(100%, 720px\)`)).toBe(true);
    expect(requirements.some((r) => r.selector === ".event-item-modal__panel--wide" && r.media === null)).toBe(false);
  });

  it("says the column name at the left of the footer, in a row of its own above the buttons when the window is too narrow for both", () => {
    expect(sets(bodyOf(requirements, ".custom-field-modal__footer"), "flex-wrap", "wrap")).toBe(true);
    const note = bodyOf(requirements, ".custom-field-modal__footer-note");
    expect(sets(note, "flex", "1 1 16rem")).toBe(true);
    expect(sets(note, "min-width", "0")).toBe(true);
  });
});

describe("the spacing of the Import page", () => {
  it("has one gap between its cards, the gap of the page's stack (.settings-sections): a card carries no margin of its own, which doubled it to 32px", () => {
    expect(sets(bodyOf(staff, ".settings-sections"), "gap", String.raw`var\(--space-4\)`)).toBe(true);
    expect(declares(bodyOf(importPage, ".import-card"), "margin-bottom")).toBe(false);
    expect(declares(bodyOf(importPage, ".import-card"), "margin")).toBe(false);
  });

  it("is one column of full-width cards: no grid of two halves, and no table style of its own", () => {
    const selectors = importPage.map((rule) => rule.selector);
    expect(selectors.filter((selector) => /^\.import-(?:two-col|stack)\b/.test(selector))).toEqual([]);
    expect(selectors.filter((selector) => /^\.import-(?:columns|sample|history)-table\b/.test(selector))).toEqual([]);
  });

  it("sets only the widths of the columns of its tables, on the shared box: the columns, the rows that are not imported, the preview and the history", () => {
    const widthOf = (selector: string) => sets(bodyOf(importPage, selector), "width", String.raw`\d+(?:\.\d+)?rem`);
    for (const table of ["columns", "invalid", "skipped", "sample", "history"]) {
      expect(widthOf(`.item-table.import-table--${table} .table th:first-child, .item-table.import-table--${table} .table td:first-child`), table).toBe(true);
    }
  });

  it("gives the date of the history the room of a whole date with its zone, so that it is not cut or run into the file name", () => {
    const body = bodyOf(importPage, ".item-table.import-table--history .table th:first-child, .item-table.import-table--history .table td:first-child");
    expect(sets(body, "width", String.raw`1[2-9](?:\.\d+)?rem`)).toBe(true);
    expect(sets(bodyOf(importPage, ".import-history__date"), "overflow", "hidden")).toBe(true);
    expect(sets(bodyOf(importPage, ".import-history__date"), "text-overflow", "ellipsis")).toBe(true);
  });

  it("scrolls the wide tables (the preview, the history) sideways inside their box, and the long lists (invalid and skipped rows) up and down", () => {
    expect(sets(bodyOf(importPage, `.item-table.import-table--sample .attendees-table-wrap, .item-table.import-table--history .attendees-table-wrap`), "overflow-x", "auto")).toBe(true);
    const lists = bodyOf(importPage, ".item-table.import-table--invalid .attendees-table-wrap, .item-table.import-table--skipped .attendees-table-wrap");
    expect(sets(lists, "max-height", "280px")).toBe(true);
    expect(sets(lists, "overflow-y", "auto")).toBe(true);
  });

  it("keeps every column of a wide table readable when it scrolls: the file name of the history has 14rem, each column of the preview after the email 8rem", () => {
    const rem = (css: string, name: string) => Number(new RegExp(String.raw`(?:^|[;\s])${name}\s*:\s*(\d+(?:\.\d+)?)rem`).exec(css)?.[1]);
    const width = (table: string, nth: string) =>
      rem(bodyOf(importPage, `.item-table.import-table--${table} .table th${nth}, .item-table.import-table--${table} .table td${nth}`), "width");
    // The selector of a minimum is one class longer than the shared `.item-table .attendees-table-wrap .table` (min-width: 0), so the order of the stylesheets does not decide.
    const minimum = (table: string) => bodyOf(importPage, `.item-table.import-table--${table} .attendees-table-wrap .table`);

    // The history: the date, the status and the counts have a width of their own, and the file name (the second column) takes what is left of the minimum.
    const counts = (read("apps/admin/src/import/ImportHistoryCard.tsx").match(/<th>/g) ?? []).length - 3;
    const fixed = width("history", ":first-child") + width("history", ":nth-child(3)") + counts * width("history", ":nth-child(n + 4)");
    expect(counts).toBe(3);
    expect(rem(minimum("history"), "min-width") - fixed).toBeGreaterThanOrEqual(14);

    // The preview: the row number, the name and the email have a width of their own, and each column after them (ImportPage.tsx counts them) has 8rem at least.
    const named = width("sample", ":first-child") + width("sample", ":nth-child(2)") + width("sample", ":nth-child(3)");
    const sample = /min-width:\s*calc\(([\d.]+)rem \+ var\(--import-sample-extra, 0\) \* ([\d.]+)rem\)/.exec(minimum("sample"));
    expect(Number(sample?.[1])).toBe(named);
    expect(Number(sample?.[2])).toBeGreaterThanOrEqual(8);
  });

  it("has no margin around the fold of the columns: the gap of the card stack is the space around it", () => {
    expect(sets(bodyOf(importPage, ".import-columns-info"), "margin", "0")).toBe(true);
  });

  it("keeps the empty state of the history in the padding of its card, with less room of its own, as on the Legal tab", () => {
    expect(sets(bodyOf(importPage, ".import-history__empty"), "padding-block", String.raw`var\(--space-4\)`)).toBe(true);
  });

  it("gives the fieldset of the options no gap and no padding of its own: the rows bring their own", () => {
    const body = bodyOf(importPage, ".import-options");
    expect(declares(body, "gap")).toBe(false);
    expect(sets(body, "padding", "0")).toBe(true);
  });
});

// The box of a table is the screen less the sidebar (256px), the page padding (2 x 24px) and the padding and border of the card: 371px
// (measured in Chrome: 653px at 1024px, 909px at 1280px, 1069px at 1440px). A name needs avatar, gap and a short name: 9rem. An address is cut with
// an ellipsis. `nameRoom` is what a name keeps at a screen width when the other columns of a table have `fixedRem` between them.
const rem = (css: string, name: string) => Number(new RegExp(String.raw`(?:^|[;\s])${name}\s*:\s*(\d+(?:\.\d+)?)rem`).exec(css)?.[1]);
const boxRem = (viewport: number) => (viewport - 371) / 16;
const MIN_NAME = 9;
const nameRoom = (viewport: number, fixedRem: number) => boxRem(viewport) - fixedRem;

describe("the tables of the Users page", () => {
  const usersPage = parse(read("apps/admin/src/pages/users-page.css"));
  const width = (table: string, column: number, media: string | null = null) =>
    rem(bodyOf(usersPage, `.item-table.users-table--${table} .table :is(th, td):nth-child(${column})`, media), "width");
  const sum = (table: string, columns: number[]) => columns.reduce((total, column) => total + width(table, column), 0);

  it("draws the boxed table from 1024px and the cards below it, and keeps what a column folded away out of sight above its ladder", () => {
    // The complement of the query of `useIsDesktop(1024)` (`(min-width: 1024px)`, pinned in the test of the sessions tab): with `max-width: 1023px` a
    // fractional width between 1023px and 1024px matches neither, and a list the code has switched to its cards shows nothing.
    const narrow = "@media not all and (min-width: 1024px)";
    expect(sets(bodyOf(usersPage, ".users-table", narrow), "display", "none")).toBe(true);
    expect(sets(bodyOf(usersPage, ".users-page__cards--narrow", narrow), "display", "flex")).toBe(true);
    expect(sets(bodyOf(usersPage, ".users-table__narrow-only"), "display", "none")).toBe(true);
  });

  it("wraps a long word in any cell of the three tables, where a fixed layout would let an address as a name paint across the next cell", () => {
    expect(sets(bodyOf(usersPage, ".item-table.users-table .table td"), "overflow-wrap", "anywhere")).toBe(true);
  });

  it("folds the sign-in, the two-factor state and the sessions of the staff list below 1280px, and leaves the name room in both forms", () => {
    const fold = bodyOf(usersPage, ".item-table.users-table--staff .table :is(th, td).users-table__wide-only", "@media (max-width: 1279px)");
    expect(sets(fold, "width", "0")).toBe(true);
    expect(sets(bodyOf(usersPage, ".item-table.users-table--staff .users-table__narrow-only", "@media (max-width: 1279px)"), "display", "inline-flex")).toBe(true);
    // All eight columns from 1280px (the name is the first column and takes what is left), five below it, down to 1024px.
    expect(nameRoom(1280, sum("staff", [2, 3, 4, 5, 6, 7, 8]))).toBeGreaterThanOrEqual(MIN_NAME);
    expect(nameRoom(1024, sum("staff", [2, 5, 7, 8]))).toBeGreaterThanOrEqual(MIN_NAME);
  });

  it("folds the grant time of the role assignments below 1180px, and leaves the name room in both forms", () => {
    const fold = bodyOf(usersPage, ".item-table.users-table--roles .table :is(th, td).users-table__wide-only", "@media (max-width: 1179px)");
    expect(sets(fold, "width", "0")).toBe(true);
    // The scope is the first column and the user the second, which takes what is left. From 1180px the role (3), the time (4) and the revoke (5) have their widths.
    const scope = rem(bodyOf(usersPage, ".item-table.users-table--roles .table :is(th, td):first-child"), "width");
    expect(nameRoom(1180, scope + sum("roles", [3, 4, 5]))).toBeGreaterThanOrEqual(MIN_NAME);
    // Below it the role is wider, as it carries the time as a line of its own, and the time has no column.
    expect(nameRoom(1024, scope + width("roles", 3, "@media (max-width: 1179px)") + width("roles", 5))).toBeGreaterThanOrEqual(MIN_NAME);
  });

  it("leaves the name of an active session room at every step of its ladder: eight columns from 1500px, seven from 1280px, six from 1181px, five below", () => {
    const columns = (...except: number[]) => [2, 3, 4, 5, 6, 7, 8].filter((column) => !except.includes(column));
    expect(nameRoom(1500, sum("sessions", columns()))).toBeGreaterThanOrEqual(MIN_NAME);
    expect(nameRoom(1280, sum("sessions", columns(7)))).toBeGreaterThanOrEqual(MIN_NAME);
    expect(nameRoom(1181, sum("sessions", columns(3, 7)))).toBeGreaterThanOrEqual(MIN_NAME);
    expect(nameRoom(1024, sum("sessions", columns(3, 4, 7)))).toBeGreaterThanOrEqual(MIN_NAME);
    // Device goes below 1280px on top of the ladder of staff.css (Device, IP address and Sign-in below 1181px, Sign-in below 1500px).
    expect(sets(bodyOf(usersPage, ".item-table.users-table--sessions .table :is(th, td):nth-child(3)", "@media (max-width: 1279px)"), "display", "none")).toBe(true);
  });
});

describe("the tables of Organisation settings", () => {
  const archiving = parse(read("apps/admin/src/settings/archiving-table.css"));
  const archivingWidth = (column: number | "last", view = "") =>
    rem(bodyOf(archiving, `.item-table.archiving-table${view} .table :is(th, td):${column === "last" ? "last-child" : `nth-child(${column})`}`), "width");
  const recipientWidth = (column: number | "last") =>
    rem(bodyOf(notifications, `.item-table.notifications-recipients .table :is(th, td):${column === "last" ? "last-child" : `nth-child(${column})`}`), "width");

  it("folds the attendees and the creation of an event below 1440px, and leaves the name room with every column and with the folded ones", () => {
    const fold = "@media (max-width: 1439px)";
    expect(sets(bodyOf(archiving, ".item-table.archiving-table .table :is(th, td).archiving-table__wide-only", fold), "width", "0")).toBe(true);
    expect(sets(bodyOf(archiving, ".item-table.archiving-table .archiving-table__narrow-only", fold), "display", "block")).toBe(true);
    expect(sets(bodyOf(archiving, ".archiving-table__narrow-only"), "display", "none")).toBe(true);
    const date = archivingWidth(2);
    const attendees = archivingWidth(3);
    const created = archivingWidth(4);
    const archived = archivingWidth(5, "--archived");
    const action = archivingWidth("last");
    // From 1440px: every column of the Archived view, which has the most. Below it, down to 1024px: the date, the archiving and the button.
    expect(nameRoom(1440, date + attendees + created + archived + action)).toBeGreaterThanOrEqual(MIN_NAME);
    expect(nameRoom(1024, date + archived + action)).toBeGreaterThanOrEqual(MIN_NAME);
  });

  it("aligns the number of attendees to the right, with its heading, in digits of one width", () => {
    const body = bodyOf(archiving, ".item-table.archiving-table .table :is(th, td):nth-child(3)");
    expect(sets(body, "text-align", "right")).toBe(true);
    expect(sets(body, "font-variant-numeric", "tabular-nums")).toBe(true);
  });

  it("folds the description of a recipient below 1280px and the time it was added below 1024px, and leaves the email room at each step", () => {
    for (const [media, column] of [["@media (max-width: 1279px)", "from-1280"], ["@media (max-width: 1023px)", "from-1024"]] as const) {
      expect(sets(bodyOf(notifications, `.item-table.notifications-recipients .table :is(th, td).notifications-recipients__${column}`, media), "width", "0")).toBe(true);
    }
    expect(sets(bodyOf(notifications, ".notifications-recipients__line"), "display", "none")).toBe(true);
    const description = recipientWidth(2);
    const added = recipientWidth(3);
    const actions = recipientWidth("last");
    expect(nameRoom(1280, description + added + actions)).toBeGreaterThanOrEqual(MIN_NAME);
    expect(nameRoom(1024, added + actions)).toBeGreaterThanOrEqual(MIN_NAME);
    expect(nameRoom(768, actions)).toBeGreaterThanOrEqual(MIN_NAME);
  });

  it("lets the email of a recipient and the lines under it wrap and the row grow: a narrow screen has no tooltip to read a cut address with", () => {
    const body = bodyOf(notifications, ".notifications-recipients__line");
    expect(declares(body, "text-overflow")).toBe(false);
    expect(declares(body, "white-space")).toBe(false);
    expect(declares(body, "overflow")).toBe(false);
    expect(sets(body, "overflow-wrap", "anywhere")).toBe(true);
    // The shared name of an item (requirements.css) is cut with an ellipsis: the email, which is the name here, is not.
    const email = bodyOf(notifications, ".item-table.notifications-recipients .requirements-item-name");
    expect(sets(email, "white-space", "normal")).toBe(true);
    expect(sets(email, "text-overflow", "clip")).toBe(true);
    expect(sets(email, "overflow-wrap", "anywhere")).toBe(true);
  });

  it("leaves the type of a notification room beside its three channels from 1024px, where the matrix is still a table", () => {
    const channel = rem(bodyOf(notifications, ".item-table.notifications-matrix .table :is(th, td):not(:first-child)"), "width");
    expect(nameRoom(1024, 3 * channel)).toBeGreaterThanOrEqual(MIN_NAME);
  });
});

