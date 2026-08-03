import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

/** Static `ti ti-*` names and `ti ti-${name}` nav icons referenced in admin SPA. */
const ADMIN_TABLER_ICON_CLASSES = [
  "alert-triangle",
  "archive",
  "archive-off",
  "adjustments",
  "arrow-right",
  "ban",
  "calendar",
  "calendar-event",
  "calendar-off",
  "camera",
  "camera-off",
  "chart-bar",
  "chart-bar-off",
  "check",
  "chevron-right",
  "circle-check",
  "circle-x",
  "clipboard-list",
  "clock",
  "clock-exclamation",
  "cloud",
  "copy",
  "download",
  "eye",
  "file-text",
  "file-type-pdf",
  "filter-off",
  "heart",
  "help-circle",
  "history",
  "info-circle",
  "layout-dashboard",
  "link",
  "logout",
  "mail",
  "map-pin",
  "menu-2",
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
  "shield-off",
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
    expect(css).toContain("Tabler Icons 3.46");

    const missing = ADMIN_TABLER_ICON_CLASSES.filter(
      (name) => !css.includes(`.ti-${name}:before`),
    );
    expect(missing, `Missing from ${cssPath}`).toEqual([]);
  });
});
