import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderConfirmPage } from "../../src/registration/confirm-page.js";
import { renderRegistrationClosedPage, renderRegistrationFormPage } from "../../src/registration/form-page.js";
import { REGISTRATION_FORM_SCRIPT } from "../../src/registration/form-script.js";
import {
  REGISTRATION_PAGE_CSS,
  buildRegistrationPageStyles,
  contrastRatio,
  inkOnPrimaryRule,
} from "../../src/registration/form-style.js";
import { resolveThemeVars } from "@admitto/ui";
import { GUEST_PAGE_PRODUCT_CSS } from "../../src/registration/guest-page-css.generated.js";
import {
  GUEST_PAGE_COMPONENT_CLASSES,
  buildGuestPageProductCss,
  generatedModulePath,
  productStylesRoot,
  readProductStyle,
  renderGeneratedModule,
  writeGuestPageCss,
} from "../../src/scripts/guest-page-css.js";
import { CONFIRM_SCREENS, closedModel, documentOf, formModel, panelModel, type Dom } from "../helpers/registration-form-fixtures.js";

const readFromProduct = (relativePath: string) => readProductStyle(productStylesRoot(), relativePath);

describe("the product stylesheet of the guest pages is the product's own CSS", () => {
  it("is exactly what packages/ui/src/styles gives now: a changed product rule fails here until the copy is rebuilt", () => {
    const fresh = renderGeneratedModule(buildGuestPageProductCss(readFromProduct));
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- the generated file next to the generator
    const committed = readFileSync(generatedModulePath(), "utf8");
    expect(
      fresh === committed,
      "apps/web/src/registration/guest-page-css.generated.ts is out of date with packages/ui/src/styles: run `npm run guest-css -w @admitto/web` and commit the result",
    ).toBe(true);
    expect(GUEST_PAGE_PRODUCT_CSS).toBe(buildGuestPageProductCss(readFromProduct));
  });

  it("is written by the generator exactly as it is committed", () => {
    const dir = mkdtempSync(join(tmpdir(), "guest-css-"));
    try {
      const target = join(dir, "guest-page-css.generated.ts");
      writeGuestPageCss(productStylesRoot(), target);
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- files this test just wrote and the committed copy
      expect(readFileSync(target, "utf8")).toBe(readFileSync(generatedModulePath(), "utf8"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("carries the tokens whole and the rules of the classes the form uses", () => {
    for (const expected of [
      ":root { --at-blue: #066fd1;",
      "--font-sans:",
      "--control-h: 2.25rem;",
      "--shadow-md:",
      ".at-input, .at-select, .at-textarea {",
      ".at-check__box {",
      ".at-btn--primary {",
      ".at-notice--error {",
      "@keyframes at-notice-enter {",
      ":focus-visible {",
    ]) {
      expect(GUEST_PAGE_PRODUCT_CSS, expected).toContain(expected);
    }
  });

  it("leaves out the component rules the form does not use (the element rules are copied whole)", () => {
    const components = GUEST_PAGE_PRODUCT_CSS.slice(GUEST_PAGE_PRODUCT_CSS.indexOf("/* components.css"));
    for (const unwanted of [".at-badge", ".at-card", ".at-tab", ".at-switch", ".at-password", ".at-iconbtn", ".at-pageheader"]) {
      expect(components, unwanted).not.toContain(unwanted);
    }
  });

  it("has one rule per line", () => {
    for (const line of GUEST_PAGE_PRODUCT_CSS.split("\n")) {
      const braces = [...line].reduce((sum, ch) => sum + (ch === "{" ? 1 : ch === "}" ? -1 : 0), 0);
      expect(Math.abs(braces), line.slice(0, 80)).toBeLessThanOrEqual(1);
    }
  });
});

describe("every class of the product the pages use has its rules in the stylesheet", () => {
  const pages = [
    renderRegistrationFormPage(formModel({ mode: "automatic", askDepartment: false }), { nonce: "bm9uY2U=" }),
    // The form with panels, icons and a list of suggestions: the classes of the product's searchable select too.
    renderRegistrationFormPage(panelModel(), { nonce: "bm9uY2U=" }),
    renderRegistrationClosedPage(closedModel()),
    // The pages of the link that confirms an address: their badges and their button.
    ...CONFIRM_SCREENS.map((screen) => renderConfirmPage(screen, { event: formModel().event, contact: formModel().contact })),
  ];
  const used = new Set<string>();
  for (const html of pages) {
    for (const el of documentOf(html).querySelectorAll("[class]") as Iterable<Dom>) {
      for (const name of (el.getAttribute("class") ?? "").split(/\s+/)) {
        if (name.startsWith("at-") || name.startsWith("searchable-select")) used.add(name);
      }
    }
  }

  it("lists every at- and searchable-select class a page uses among the classes the generator copies", () => {
    expect(used.size).toBeGreaterThan(10);
    expect([...used].filter((name) => name.startsWith("searchable-select")).length).toBeGreaterThanOrEqual(4);
    for (const name of used) expect(GUEST_PAGE_COMPONENT_CLASSES, name).toContain(name);
  });

  it("lists the classes the page script adds, and the stylesheet has a rule for each", () => {
    const added = new Set([...REGISTRATION_FORM_SCRIPT.matchAll(/classList\.(?:add|remove|toggle)\("([\w-]+)"/g)].map((match) => match[1]!));
    expect([...added].sort()).toEqual([
      "at-input--invalid",
      "at-select--invalid",
      "at-textarea--invalid",
      "has-error",
      "searchable-select__trigger--invalid",
      "searchable-select__trigger--open",
    ]);
    for (const name of [...added].filter((n) => n.startsWith("at-") || n.startsWith("searchable-select"))) expect(GUEST_PAGE_COMPONENT_CLASSES, name).toContain(name);
    expect(REGISTRATION_PAGE_CSS).toContain(".has-error .reg-slot__err { visibility: visible; }");
  });

  it("has a rule in the stylesheet for every other class the pages use, so a misspelt class name is caught", () => {
    const everything = buildRegistrationPageStyles();
    const classes = new Set<string>();
    for (const html of pages) {
      for (const el of documentOf(html).querySelectorAll("[class]") as Iterable<Dom>) {
        for (const name of (el.getAttribute("class") ?? "").split(/\s+/)) if (name) classes.add(name);
      }
    }
    // `cf-turnstile` is the hook Cloudflare's script looks for; it is not ours to style.
    for (const name of [...classes].filter((n) => n !== "cf-turnstile")) {
      expect(everything, name).toMatch(new RegExp(String.raw`\.${name}(?![\w-])`));
    }
    expect(classes.size).toBeGreaterThan(40);
  });

  it("has a rule for each class the generator copies", () => {
    for (const name of GUEST_PAGE_COMPONENT_CLASSES) {
      expect(GUEST_PAGE_PRODUCT_CSS, name).toMatch(new RegExp(String.raw`\.${name}(?![\w-])`));
    }
  });
});

describe("a choice and the list of suggestions are drawn with the product's own searchable select", () => {
  it("copies the rules of its button, label, placeholder, arrow, search box, panel, list, rows, name and empty line from the admin app's own stylesheet", () => {
    for (const expected of [
      ".searchable-select__trigger { display: flex;",
      ".searchable-select__trigger--invalid { border-color: var(--status-error); }",
      ".searchable-select__trigger--open .searchable-select__chevron { transform: rotate(180deg); }",
      ".searchable-select__label { min-width: 0;",
      ".searchable-select__placeholder { min-width: 0;",
      ".searchable-select__chevron { margin-left: auto;",
      ".searchable-select__search { width: 100%;",
      ".searchable-select__panel { z-index: var(--z-dropdown);",
      ".searchable-select__list { list-style: none;",
      ".searchable-select__option { display: flex;",
      ".searchable-select__name { flex: 1;",
      ".searchable-select__empty { padding:",
      "/* apps/admin/src/components/searchable-select.css: the rules of the classes the guest pages use */",
    ]) {
      expect(GUEST_PAGE_PRODUCT_CSS, expected).toContain(expected);
    }
  });

  it("leaves out what the form has no use for: the other panel modes and the multi select", () => {
    for (const unwanted of ["searchable-select__panel--up", "searchable-select__panel--inline", "multi-select"]) {
      expect(GUEST_PAGE_PRODUCT_CSS, unwanted).not.toContain(unwanted);
    }
  });

  it("comes after the rules of components.css, and before the form's own rules, so that the form can refine them", () => {
    const css = buildRegistrationPageStyles();
    expect(css.indexOf("/* apps/admin/src/components/searchable-select.css")).toBeGreaterThan(css.indexOf("/* components.css"));
    expect(css.indexOf(".combo .searchable-select__name {")).toBeGreaterThan(css.indexOf(".searchable-select__name { flex: 1;"));
  });
});

describe("the form's own rules for a panel under a row and the list under a text box", () => {
  const css = REGISTRATION_PAGE_CSS;

  it("sinks a panel into a box of its own that is joined to the row above it", () => {
    expect(css).toContain(".reg-reveal { margin: -2px 0 2px; padding: var(--space-3); background: var(--surface-sunken); border: 1px solid var(--border); border-radius: var(--radius-md); display: grid; gap: var(--space-3); }");
  });

  it("hides a panel, a question and a row of the list by the hidden attribute, which no rule of the form can override", () => {
    expect(css).toContain("[hidden] { display: none !important; }");
  });

  it("puts the list over what follows, as wide as the box, and wraps a long suggestion instead of cutting it", () => {
    expect(css).toContain(".combo { position: relative; }");
    expect(css).toContain(".combo__panel { position: absolute; left: 0; right: 0; top: calc(100% + 4px); margin: 0; }");
    expect(css).toContain(".combo .searchable-select__name { white-space: normal; overflow-wrap: anywhere; }");
  });

  it("shows the row that is active by aria-selected, which is also what assistive technology reads", () => {
    expect(css).toContain('.combo .searchable-select__option[aria-selected="true"] { background: var(--surface-hover, var(--surface-sunken)); }');
  });

  it("keeps the words of a row without an icon in line with the rows that have one, in a run that has any", () => {
    expect(css).toContain(".reg-opts--icons > .reg-opt--bare .reg-opt__text { margin-left: calc(18px + var(--space-2)); }");
  });
});

describe("buildGuestPageProductCss, on a stylesheet written for the test", () => {
  const build = (components: string, tokens = ":root { --a: 1; }") =>
    buildGuestPageProductCss((relativePath) => (relativePath === "components.css" ? components : tokens)).split("\n");

  it("reads the admin's searchable select the same way: the rules of the classes the pages use, and no other", () => {
    const lines = buildGuestPageProductCss((relativePath) =>
      relativePath.endsWith("searchable-select.css")
        ? ".searchable-select__option { a: 1; } .searchable-select__panel--up { b: 2; } .searchable-select__option .multi-select__actions { c: 3; } .searchable-select__name, .searchable-select__panel--inline { d: 4; }"
        : ":root { --x: 1; }",
    ).split("\n");
    expect(lines).toContain("/* apps/admin/src/components/searchable-select.css: the rules of the classes the guest pages use */");
    expect(lines).toContain(".searchable-select__option { a: 1; }");
    expect(lines).toContain(".searchable-select__name { d: 4; }");
    expect(lines.join("\n")).not.toContain("panel--up");
    expect(lines.join("\n")).not.toContain("multi-select");
    expect(lines.join("\n")).not.toContain("panel--inline");
  });

  it("copies a rule whose every class is on the list, and none whose classes are not", () => {
    const lines = build(".at-btn { a: 1; } .at-iconbtn { b: 2; } .at-btn .at-spinner { c: 3; } .at-btn--primary:hover { d: 4; } p { e: 5; }");
    expect(lines).toContain(".at-btn { a: 1; }");
    expect(lines).toContain(".at-btn--primary:hover { d: 4; }");
    expect(lines.join("\n")).not.toContain("iconbtn");
    expect(lines.join("\n")).not.toContain("spinner");
    expect(lines.join("\n")).not.toContain("e: 5");
  });

  it("keeps the selectors of a list that use only listed classes", () => {
    const lines = build(".at-input, .at-switch, .at-select { x: 1; }");
    expect(lines).toContain(".at-input, .at-select { x: 1; }");
  });

  it("looks at what a selector styles, not at its conditions", () => {
    const lines = build(
      ".at-inputgroup:not(:has(.at-inputgroup__icon--action)) > .at-input { a: 1; } .at-inputgroup:has(.at-other) { b: 2; } .at-btn:is(.nope, .at-btn--lg) { c: 3; }",
    );
    expect(lines.join("\n")).toContain(".at-inputgroup:not(:has(.at-inputgroup__icon--action)) > .at-input { a: 1; }");
    expect(lines.join("\n")).toContain(".at-inputgroup:has(.at-other) { b: 2; }");
    expect(lines.join("\n")).toContain(".at-btn:is(.nope, .at-btn--lg) { c: 3; }");
  });

  it("does not split a selector list at a comma inside parentheses", () => {
    const lines = build(".at-btn:is(.at-btn--lg, .at-btn--block), .at-iconbtn { a: 1; }");
    expect(lines).toContain(".at-btn:is(.at-btn--lg, .at-btn--block) { a: 1; }");
  });

  it("copies the rules of a media block that are wanted, with the block, and drops a block with none", () => {
    const lines = build("@media (pointer: coarse) { .at-input { a: 1; } .at-switch { b: 2; } } @media print { .at-card { c: 3; } }");
    expect(lines).toEqual(expect.arrayContaining(["@media (pointer: coarse) {", "  .at-input { a: 1; }", "}"]));
    expect(lines.join("\n")).not.toContain("switch");
    expect(lines.join("\n")).not.toContain("print");
  });

  it("copies keyframes only when a copied rule uses them", () => {
    const lines = build(
      ".at-notice { animation: at-in 450ms ease; } @keyframes at-in { from { opacity: 0; } to { opacity: 1; } } @keyframes at-unused { from { top: 0; } to { top: 1px; } }",
    ).join("\n");
    expect(lines).toContain("@keyframes at-in {");
    expect(lines).toContain("  from { opacity: 0; }");
    expect(lines).not.toContain("at-unused");
  });

  it("drops comments, at-rules without a block and font faces, and joins a selector written over lines", () => {
    const lines = build(
      "@import './x.css'; @charset \"utf-8\"; /* .at-btn { gone: 1; } */ @font-face { font-family: X; } .at-field,\n.at-label { a: 1;\n  b: 2; }",
    );
    expect(lines).toContain(".at-field, .at-label { a: 1; b: 2; }");
    expect(lines.join("\n")).not.toContain("gone");
    expect(lines.join("\n")).not.toContain("font-face");
    expect(lines.join("\n")).not.toContain("import");
  });

  it("keeps a string that holds braces, semicolons or quotes of the other kind", () => {
    const rule = `.at-select { background-image: url("data:image/svg+xml,%3Csvg xmlns='http://x' d='M1 1}{;'%3E"); a: 1; }`;
    expect(build(rule).join("\n")).toContain(`url("data:image/svg+xml,%3Csvg xmlns='http://x' d='M1 1}{;'%3E")`);
  });

  it("copies the token files whole, in order, with their comments gone", () => {
    const lines = buildGuestPageProductCss((relativePath) => `/* ${relativePath} */ :root { --x: "${relativePath}"; }`).split("\n");
    expect(lines.filter((line) => line.startsWith("/* tokens/"))).toHaveLength(5);
    expect(lines.filter((line) => line.startsWith(":root")).slice(0, 2)).toEqual([
      ':root { --x: "tokens/colors.css"; }',
      ':root { --x: "tokens/typography.css"; }',
    ]);
  });

  it("refuses a stylesheet whose braces do not match, or whose string is never closed", () => {
    expect(() => build(".at-btn { a: 1; ")).toThrow("Unbalanced braces");
    expect(() => build('.at-btn { content: "never closed; }')).toThrow("Unbalanced braces");
    expect(() => build(".at-btn { content: 'escaped \\' quote; }")).toThrow("Unbalanced braces");
  });
});

/** The value of each custom property the stylesheet defines, for colours resolved through `var()`. */
function customProperties(css: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const [, name, value] of css.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)[;}]/g)) {
    if (!map.has(name!)) map.set(name!, value!.trim());
  }
  return map;
}

function resolveColor(properties: Map<string, string>, name: string): string {
  let value = properties.get(name) ?? "";
  for (let hops = 0; hops < 8; hops += 1) {
    const reference = /^var\((--[\w-]+)\)$/.exec(value);
    if (!reference) break;
    value = properties.get(reference[1]!) ?? "";
  }
  expect(value, name).toMatch(/^#[0-9a-f]{6}$/i);
  return value;
}

describe("the colours of the form, by the tokens, read well", () => {
  const tokens = customProperties(GUEST_PAGE_PRODUCT_CSS);
  const color = (name: string) => resolveColor(tokens, name);

  it.each([
    ["body text on a card", "--text-primary", "--surface-card"],
    ["labels and notes on a card", "--text-secondary", "--surface-card"],
    ["hints on a card", "--text-muted", "--surface-card"],
    ["the notice and the footer on the sunken surface", "--text-muted", "--surface-sunken"],
    ["an error under a field", "--status-error", "--surface-card"],
    ["the star of a required field", "--status-error-fg", "--surface-card"],
    ["an error notice", "--status-error-fg", "--status-error-tint"],
    ["the text of the send button", "--text-on-primary", "--primary"],
    ["a link", "--text-link", "--surface-card"],
    ["a link in the footer", "--text-link", "--surface-sunken"],
  ])("%s reaches 4.5 to 1", (_what, foreground, background) => {
    expect(contrastRatio(color(foreground), color(background)), `${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5);
  });

  it("has a focus ring that is not the only difference: the field's border changes too", () => {
    expect(GUEST_PAGE_PRODUCT_CSS).toContain(".at-input:focus, .at-select:focus, .at-textarea:focus { outline: none; border-color: var(--border-focus);");
  });

  it("is the same contrast function WCAG gives: black on white is 21, a colour on itself is 1", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#066fd1", "#066fd1")).toBeCloseTo(1, 5);
  });
});

/** The colours a primary button is painted in, and its text, as a page with this accent ends up with them. */
function buttonColours(primary: string) {
  const rule = inkOnPrimaryRule({ primary });
  const set = Object.fromEntries([...rule.matchAll(/(--[a-z-]+): (#[0-9a-f]{6})/g)].map((match) => [match[1]!, match[2]!]));
  const product = resolveThemeVars({ primary });
  return {
    ink: set["--text-on-primary"] ?? "#ffffff",
    states: [primary, set["--primary-hover"] ?? product["--primary-hover"], set["--primary-active"] ?? product["--primary-active"]],
  };
}

describe("the text on the send button, for the organisation's accent colour", () => {
  it("is the product's white on the default blue, and when the accent is dark enough", () => {
    expect(inkOnPrimaryRule()).toBe("");
    expect(inkOnPrimaryRule(null)).toBe("");
    expect(inkOnPrimaryRule({ primary: "#066fd1" })).toBe("");
    expect(inkOnPrimaryRule({ primary: "#1d273b" })).toBe("");
  });

  it("is the product's dark ink on a light accent, which white would leave unreadable", () => {
    for (const primary of ["#f5c400", "#ffffff", "#9be15d", "#e6e7e9"]) {
      const rule = inkOnPrimaryRule({ primary });
      expect(rule, primary).toContain("--text-on-primary: #1d273b;");
      expect(contrastRatio(primary, "#1d273b"), primary).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("is black on a mid-tone accent, where neither white nor the dark ink reaches 4.5 to 1", () => {
    for (const primary of ["#777777", "#3b82f6", "#808080", "#4a90d9"]) {
      expect(contrastRatio(primary, "#ffffff"), `white on ${primary}`).toBeLessThan(4.5);
      expect(contrastRatio(primary, "#1d273b"), `dark ink on ${primary}`).toBeLessThan(4.5);
      expect(inkOnPrimaryRule({ primary }), primary).toContain("--text-on-primary: #000000;");
      expect(contrastRatio(primary, "#000000"), `black on ${primary}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("lightens the button under the pointer and under a press when the text is dark, so the text keeps its contrast", () => {
    // The product darkens both states, which is right under white text and takes black below 4.5 to 1 on this grey.
    expect(inkOnPrimaryRule({ primary: "#777777" })).toBe(
      ":root { --text-on-primary: #000000; --primary-hover: #878787; --primary-active: #959595; }",
    );
    const { ink, states } = buttonColours("#777777");
    for (const background of states) expect(contrastRatio(background, ink), background).toBeGreaterThanOrEqual(4.5);
  });

  it("always gives a text colour that reaches 4.5 to 1, whatever the accent is", () => {
    const steps = Array.from({ length: 16 }, (_, i) => i * 17);
    for (const r of steps) {
      for (const g of steps) {
        for (const b of steps) {
          const primary = `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
          // In every state of the button: at rest, under the pointer and pressed.
          const { ink, states } = buttonColours(primary);
          for (const background of states) {
            expect(contrastRatio(background, ink), `${ink} on ${background} (accent ${primary})`).toBeGreaterThanOrEqual(4.5);
          }
        }
      }
    }
  });

  it("follows the accent chosen for the ticket page, which is the one the guest pages use", () => {
    expect(inkOnPrimaryRule({ primary: "#066fd1", ticket_primary: "#f5c400" })).not.toBe("");
    expect(inkOnPrimaryRule({ primary: "#f5c400", ticket_primary: "#066fd1" })).toBe("");
  });

  it("falls back to the default blue for an accent that is not a colour", () => {
    expect(inkOnPrimaryRule({ primary: "red" })).toBe("");
    expect(inkOnPrimaryRule({ primary: "#12" })).toBe("");
  });
});

describe("the whole stylesheet", () => {
  it("is the product's rules, then the ticket page's shell and branding, then what the form adds", () => {
    const css = buildRegistrationPageStyles({ primary: "#aa2200" });
    const tokenAt = css.indexOf("--primary: var(--at-blue)");
    const brandAt = css.indexOf("--primary: #aa2200");
    const shellAt = css.indexOf("body.ticket-page");
    const formAt = css.indexOf(".reg-hero {");
    expect(tokenAt).toBeGreaterThanOrEqual(0);
    expect(brandAt).toBeGreaterThan(tokenAt);
    expect(shellAt).toBeGreaterThan(brandAt);
    expect(formAt).toBeGreaterThan(shellAt);
  });

  it("puts a light accent's dark ink after the product's white, and before the form's own rules", () => {
    const css = buildRegistrationPageStyles({ primary: "#f5c400" });
    expect(css.indexOf("--text-on-primary: #1d273b")).toBeGreaterThan(css.indexOf("--text-on-primary: #ffffff"));
    expect(css.indexOf("--text-on-primary: #1d273b")).toBeLessThan(css.indexOf(".reg-hero {"));
    expect(buildRegistrationPageStyles()).not.toContain("--text-on-primary: #1d273b");
  });

  it("defines every custom property that the product rules and the form's rules use", () => {
    const css = buildRegistrationPageStyles();
    const defined = new Set(customProperties(css).keys());
    const used = new Set<string>();
    for (const layer of [GUEST_PAGE_PRODUCT_CSS, REGISTRATION_PAGE_CSS]) {
      for (const [, name] of layer.matchAll(/var\((--[\w-]+)/g)) used.add(name!);
    }
    expect(used.size).toBeGreaterThan(30);
    for (const name of used) expect(defined.has(name), name).toBe(true);
  });

  it("gives the form's own rules no colour of their own, only tokens", () => {
    expect(REGISTRATION_PAGE_CSS).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(REGISTRATION_PAGE_CSS).not.toMatch(/\b(rgb|rgba|hsl|hsla)\(/);
  });

  it("spaces the rows of the form by the gap of the admin forms and the product's scale, not by sizes of its own", () => {
    const adminGrid = readFromProduct("../../../../apps/admin/src/attendees/attendee-fields-grid.css");
    const adminGap = /\.attendee-fields-grid \{[^}]*\bgap: (var\(--space-\d\))/.exec(adminGrid)?.[1];
    expect(adminGap).toMatch(/^var\(--space-\d\)$/);
    const bodyOf = (selector: string): string => {
      const start = REGISTRATION_PAGE_CSS.indexOf(`\n${selector} {`);
      return REGISTRATION_PAGE_CSS.slice(start, REGISTRATION_PAGE_CSS.indexOf("}", start));
    };
    for (const selector of [".reg-form", ".reg-row", ".reg-section"]) expect(bodyOf(selector), selector).toContain(`gap: ${adminGap}`);
    for (const selector of [".reg-opts", ".reg-checks"]) expect(bodyOf(selector), selector).toMatch(/gap: var\(--space-\d\);/);
  });

  it("has the self-hosted font of the ticket page and no request to another host", () => {
    const css = buildRegistrationPageStyles();
    expect(css).toContain("@font-face");
    expect(css).not.toMatch(/url\(\s*["']?https?:/);
    expect(css).not.toContain("@import");
  });
});

describe("the long text box and the message slot", () => {
  const productRules = GUEST_PAGE_PRODUCT_CSS.split("\n");

  it("carries the product's textarea rules, including the 16 px on a touch device that stops the zoom on focus", () => {
    expect(productRules.some((line) => line.startsWith(".at-textarea { height: auto;"))).toBe(true);
    expect(productRules).toContain("  .at-textarea { font-size: 16px; }");
    expect(productRules.some((line) => line.startsWith(".at-input--invalid, .at-textarea--invalid, .at-select--invalid {"))).toBe(true);
  });

  it("sets the box in the font of the other fields, not the product's code font, and keeps 16 px on a touch device", () => {
    expect(REGISTRATION_PAGE_CSS).toContain(".reg-form .at-textarea { font-family: var(--font-sans); font-size: var(--fs-body); }");
    expect(REGISTRATION_PAGE_CSS).toContain("@media (pointer: coarse) {\n  .reg-form .at-textarea { font-size: 16px; }\n}");
    const all = buildRegistrationPageStyles();
    // The form's touch rule is the later one, so it is the one that wins, and it must not undo the 16 px.
    expect(all.lastIndexOf(".reg-form .at-textarea { font-size: 16px; }")).toBeGreaterThan(all.indexOf(".reg-form .at-textarea { font-family"));
  });

  it("takes a date and a date and time input out of Mobile Safari's own layout, which cuts off the edges of a box it sizes itself", () => {
    expect(REGISTRATION_PAGE_CSS).toContain(
      '.reg-form .at-input[type="date"], .reg-form .at-input[type="datetime-local"] { -webkit-appearance: none; appearance: none; }',
    );
    // ... and sets the date it shows from the left, like the text of every other field.
    expect(REGISTRATION_PAGE_CSS).toContain(".reg-form .at-input::-webkit-date-and-time-value { text-align: left; }");
  });

  it("puts the note and the error of a slot in one cell, so it is as tall as the taller and an error moves nothing", () => {
    for (const rule of [
      ".reg-slot { display: grid;",
      ".reg-slot > * { grid-area: 1 / 1; }",
      ".reg-slot__err { display: flex; visibility: hidden;",
      ".has-error .reg-slot__hint { visibility: hidden; }",
      ".has-error .reg-slot__err { visibility: visible; }",
    ]) {
      expect(REGISTRATION_PAGE_CSS, rule).toContain(rule);
    }
    // `display: none` would take the hidden one out of the cell, and the slot would change height with the error.
    expect(REGISTRATION_PAGE_CSS).not.toMatch(/\.reg-slot__(hint|err)[^{]*\{[^}]*display: none/);
  });
});
