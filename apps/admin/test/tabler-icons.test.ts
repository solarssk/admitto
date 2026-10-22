import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

/** Static `ti ti-*` names and `ti ti-${name}` nav icons referenced in admin SPA. */
const ADMIN_TABLER_ICON_CLASSES = [
  "activity-heartbeat",
  "alert-triangle",
  "archive",
  "archive-off",
  "adjustments",
  "arrow-left",
  "arrow-right",
  "ban",
  "bold",
  "calendar",
  "calendar-event",
  "calendar-off",
  "camera",
  "camera-off",
  "chart-bar",
  "chart-bar-off",
  "check",
  "checkbox",
  "chevron-right",
  "circle-check",
  "circle-x",
  "clipboard-check",
  "clipboard-list",
  "clock",
  "clock-exclamation",
  "cloud",
  "copy",
  "download",
  "external-link",
  "eye",
  "file-text",
  "file-type-pdf",
  "filter-off",
  "h-2",
  "h-3",
  "heart",
  "help-circle",
  "history",
  "info-circle",
  "layout-dashboard",
  "link",
  "list",
  "list-numbers",
  "logout",
  "mail",
  "mail-exclamation",
  "map-pin",
  "menu-2",
  "minus",
  "moon",
  "package",
  "pencil",
  "plus",
  "qrcode",
  "qrcode-off",
  "refresh",
  "scan",
  "search",
  "selector",
  "settings",
  "shield",
  "shield-check",
  "shield-lock",
  "shield-off",
  "sun",
  "trash",
  "user-check",
  "user-circle",
  "users",
  "users-group",
  "wallet",
  "wifi-off",
  "x",
] as const;

describe("@tabler/icons-webfont coverage for admin SPA", () => {
  it("includes every icon class used in admin UI", () => {
    const cssPath = require.resolve("@tabler/icons-webfont/dist/tabler-icons.min.css");
    const css = readFileSync(cssPath, "utf8");
    const { version } = require("@tabler/icons-webfont/package.json") as { version: string };
    expect(css).toContain(`Tabler Icons ${version}`);

    const missing = ADMIN_TABLER_ICON_CLASSES.filter(
      (name) => !css.includes(`.ti-${name}:before`),
    );
    expect(missing, `Missing from ${cssPath}`).toEqual([]);
  });
});
