import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../../src");

/** Files allowed to call Intl/toLocale* directly (central formatters or intentional exceptions). */
const ALLOWLIST = new Set([
  "utils/event-dates.ts",
  "utils/locale-store.ts",
  "utils/event-countdown.ts",
  "pages/ReportsPage.tsx",
  "account/AccountPage.tsx",
  "components/TimezoneSelect.tsx",
  "events/CreateEventModal.tsx",
  "pages/wizard/WizardStep4Event.tsx",
]);

const FORBIDDEN = [
  /\.toLocaleTimeString\s*\(/,
  /\.toLocaleDateString\s*\(/,
  /\.toLocaleString\s*\(/,
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      walk(path, out);
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(path);
    }
  }
  return out;
}

describe("locale coverage guard", () => {
  it("no raw toLocale* calls outside central formatters", () => {
    const violations: string[] = [];
    for (const file of walk(SRC)) {
      const rel = relative(SRC, file);
      if (ALLOWLIST.has(rel)) continue;
      const content = readFileSync(file, "utf8");
      for (const pattern of FORBIDDEN) {
        if (pattern.test(content)) {
          violations.push(rel);
          break;
        }
      }
    }
    expect(violations, `Use event-dates.ts / locale-store.ts instead`).toEqual([]);
  });
});
