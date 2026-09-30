import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../../src");
const css = readFileSync(join(SRC, "pages/event-settings-page.css"), "utf8");
const panel = readFileSync(join(SRC, "settings/EventDangerZonePanel.tsx"), "utf8");

/** jsdom does no layout, so a margin stacking on top of the tabpanel's flex gap never shows up in
 * a behavioural test: the notice under the Danger zone panel sat 28px below it (16px gap + 12px
 * margin) instead of the 16px every other pair of siblings in the tabpanel gets. */
describe("Danger zone notice spacing (event-settings-page.css)", () => {
  it("leaves the distance to the panel to the tabpanel's flex gap", () => {
    expect(css).toMatch(/\.event-settings-tabpanel\s*\{[^}]*display:\s*flex[^}]*gap:\s*var\(--space-4\)/);
    expect(panel).toContain('className="danger-zone-notice"');
    expect(css).not.toMatch(/\.danger-zone-notice\s*\{[^}]*margin/);
  });
});
