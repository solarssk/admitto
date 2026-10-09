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
const notifications = parse(read("apps/admin/src/settings/notifications-panel.css"));

describe("the baseline: every text is wrapped with even lines", () => {
  it("is set on the body, so that every text inherits it", () => {
    expect(sets(bodyOf(base, "body"), "text-wrap", "balance")).toBe(true);
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

describe("the notification settings, on a phone", () => {
  const media = "@media (max-width: 640px)";

  it("shows the type x channel matrix as a block for each type: the text across the width and the toggles under it, each named", () => {
    expect(sets(bodyOf(notifications, ".table.notifications-type-matrix tbody tr", media), "display", "grid")).toBe(true);
    expect(sets(bodyOf(notifications, ".table.notifications-type-matrix tbody td:first-child", media), "grid-column", "1 / -1")).toBe(true);
    expect(sets(bodyOf(notifications, ".table.notifications-type-matrix tbody td:not(:first-child)::before", media), "content", "attr\\(data-label\\)")).toBe(true);
    // The header row stays for assistive tech and is out of sight.
    expect(sets(bodyOf(notifications, ".notifications-type-matrix thead", media), "position", "absolute")).toBe(true);
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
