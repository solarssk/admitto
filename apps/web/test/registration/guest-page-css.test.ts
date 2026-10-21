import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderRegistrationClosedPage, renderRegistrationFormPage } from "../../src/registration/form-page.js";
import { REGISTRATION_FORM_SCRIPT } from "../../src/registration/form-script.js";
import {
  REGISTRATION_PAGE_CSS,
  buildRegistrationPageStyles,
  contrastRatio,
  inkOnPrimaryRule,
} from "../../src/registration/form-style.js";
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
import { closedModel, documentOf, formModel, type Dom } from "../helpers/registration-form-fixtures.js";

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
      ".at-input, .at-select {",
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
    for (const unwanted of [".at-badge", ".at-card", ".at-tab", ".at-switch", ".at-password", ".at-iconbtn", ".at-textarea", ".at-pageheader"]) {
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
    renderRegistrationClosedPage(closedModel()),
  ];
  const used = new Set<string>();
  for (const html of pages) {
    for (const el of documentOf(html).querySelectorAll("[class]") as Iterable<Dom>) {
      for (const name of (el.getAttribute("class") ?? "").split(/\s+/)) if (name.startsWith("at-")) used.add(name);
    }
  }

  it("lists every at- class a page uses among the classes the generator copies", () => {
    expect(used.size).toBeGreaterThan(10);
    for (const name of used) expect(GUEST_PAGE_COMPONENT_CLASSES, name).toContain(name);
  });

  it("lists the classes the page script adds, and the stylesheet has a rule for each", () => {
    const added = new Set([...REGISTRATION_FORM_SCRIPT.matchAll(/classList\.(?:add|remove|toggle)\("([\w-]+)"/g)].map((match) => match[1]!));
    expect([...added].sort()).toEqual(["at-input--invalid", "at-select--invalid", "has-error"]);
    for (const name of [...added].filter((n) => n.startsWith("at-"))) expect(GUEST_PAGE_COMPONENT_CLASSES, name).toContain(name);
    expect(REGISTRATION_PAGE_CSS).toContain(".has-error .reg-slot__err { display: flex; }");
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

describe("buildGuestPageProductCss, on a stylesheet written for the test", () => {
  const build = (components: string, tokens = ":root { --a: 1; }") =>
    buildGuestPageProductCss((relativePath) => (relativePath === "components.css" ? components : tokens)).split("\n");

  it("copies a rule whose every class is on the list, and none whose classes are not", () => {
    const lines = build(".at-btn { a: 1; } .at-iconbtn { b: 2; } .at-btn .at-spinner { c: 3; } .at-btn--primary:hover { d: 4; } p { e: 5; }");
    expect(lines).toContain(".at-btn { a: 1; }");
    expect(lines).toContain(".at-btn--primary:hover { d: 4; }");
    expect(lines.join("\n")).not.toContain("iconbtn");
    expect(lines.join("\n")).not.toContain("spinner");
    expect(lines.join("\n")).not.toContain("e: 5");
  });

  it("keeps the selectors of a list that use only listed classes", () => {
    const lines = build(".at-input, .at-textarea, .at-select { x: 1; }");
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
    const lines = build("@media (pointer: coarse) { .at-input { a: 1; } .at-textarea { b: 2; } } @media print { .at-card { c: 3; } }");
    expect(lines).toEqual(expect.arrayContaining(["@media (pointer: coarse) {", "  .at-input { a: 1; }", "}"]));
    expect(lines.join("\n")).not.toContain("textarea");
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
    expect(GUEST_PAGE_PRODUCT_CSS).toContain(".at-input:focus, .at-select:focus { outline: none; border-color: var(--border-focus);");
  });

  it("is the same contrast function WCAG gives: black on white is 21, a colour on itself is 1", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#066fd1", "#066fd1")).toBeCloseTo(1, 5);
  });
});

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
      expect(rule, primary).toBe(":root { --text-on-primary: #1d273b; }");
      expect(contrastRatio(primary, "#1d273b"), primary).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("is black on a mid-tone accent, where neither white nor the dark ink reaches 4.5 to 1", () => {
    for (const primary of ["#777777", "#3b82f6", "#808080", "#4a90d9"]) {
      expect(contrastRatio(primary, "#ffffff"), `white on ${primary}`).toBeLessThan(4.5);
      expect(contrastRatio(primary, "#1d273b"), `dark ink on ${primary}`).toBeLessThan(4.5);
      expect(inkOnPrimaryRule({ primary }), primary).toBe(":root { --text-on-primary: #000000; }");
      expect(contrastRatio(primary, "#000000"), `black on ${primary}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("always gives a text colour that reaches 4.5 to 1, whatever the accent is", () => {
    const steps = Array.from({ length: 16 }, (_, i) => i * 17);
    for (const r of steps) {
      for (const g of steps) {
        for (const b of steps) {
          const primary = `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
          const ink = /--text-on-primary: (#[0-9a-f]{6})/.exec(inkOnPrimaryRule({ primary }))?.[1] ?? "#ffffff";
          expect(contrastRatio(primary, ink), `${ink} on ${primary}`).toBeGreaterThanOrEqual(4.5);
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

  it("has the self-hosted font of the ticket page and no request to another host", () => {
    const css = buildRegistrationPageStyles();
    expect(css).toContain("@font-face");
    expect(css).not.toMatch(/url\(\s*["']?https?:/);
    expect(css).not.toContain("@import");
  });
});
