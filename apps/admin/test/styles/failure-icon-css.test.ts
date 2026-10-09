import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../../src");
const css = readFileSync(join(SRC, "staff.css"), "utf8").replaceAll(/\/\*[\s\S]*?\*\//g, "");

function rule(selector: string): string {
  const escaped = selector.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  const match = new RegExp(String.raw`(?:^|\})\s*${escaped}\s*\{([^}]*)\}`, "m").exec(css);
  expect(match, `staff.css has no rule for ${selector}`).not.toBeNull();
  return match![1]!;
}

describe("the glyph of a failed load: CSS that the tests in jsdom cannot see", () => {
  it("the glyph of a failure that is a line of text takes the error colour and sits inline before the message", () => {
    const body = rule(".failure-icon");
    expect(body).toMatch(/color:\s*var\(--status-error\)/);
    expect(body).toMatch(/margin-right:\s*0\.375em/);
  });

  it("the hint's message is in the error colour, like a field's own error, and wins over the grey of a field hint", () => {
    expect(rule(".mail-field-hint.retry-hint")).toMatch(/color:\s*var\(--status-error-fg\)/);
  });

  it("the hint has room above it: the base field hint tucks itself 4px under its field, which glued a failure to its control", () => {
    expect(rule(".mail-field-hint.retry-hint")).toMatch(/margin:\s*var\(--space-2\) 0\s*(?:;|$)/);
  });

  it("its Retry reads as an action without being a boxed button or an underlined link: the link colour, semibold, no border, no background, a tint on hover", () => {
    const body = rule(".retry-hint .at-btn.retry-hint__button");
    expect(body).toMatch(/color:\s*var\(--text-link/);
    expect(body).toMatch(/font-weight:\s*var\(--fw-semibold\)/);
    expect(body).toMatch(/border:\s*0\s*(?:;|$)/m);
    expect(body).toMatch(/background:\s*none/);
    expect(body).not.toMatch(/text-decoration:\s*underline/);
    expect(rule(".retry-hint .at-btn.retry-hint__button:hover:not(:disabled, [aria-disabled=\"true\"])")).toMatch(/background:\s*var\(--primary-tint\)/);
  });

  it("the large one stands over the message, as large as an empty state's glyph, where a failure has a block of its own", () => {
    const body = rule(".failure-icon--large");
    expect(body).toMatch(/display:\s*block/);
    expect(body).toMatch(/font-size:\s*2\.5rem/);
    expect(body).toMatch(/margin:\s*0 auto/);
  });

  it("the identity editor's error is centred, like the placeholder of any failed load", () => {
    const body = rule(".identity-editor__error");
    expect(body).toMatch(/align-items:\s*center/);
    expect(body).toMatch(/text-align:\s*center/);
  });

  it("in the notification bell it stands above the text, like the bell-off of its empty state, with no inline margin", () => {
    const body = rule(".notif-bell__status .failure-icon");
    expect(body).toMatch(/margin-right:\s*0\s*(?:;|$)/);
  });

  it("on the dark log console it is the colour of the message, the console's one red", () => {
    expect(rule(".system-log-panel__console-empty--error .failure-icon")).toMatch(/color:\s*inherit/);
    expect(rule(".system-log-panel__console-empty--error")).toMatch(/color:\s*var\(--at-red\)/);
  });

  it("the application's error screen shows it as large as an empty state's, in the error colour", () => {
    const body = rule(".error-boundary__icon");
    expect(body).toMatch(/color:\s*var\(--status-error\)/);
    expect(body).toMatch(/font-size:\s*2\.5rem/);
  });
});
