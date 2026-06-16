import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  STAFF_SPA_FONT_SRC,
  STAFF_SPA_STYLE_SRC,
  getStaffSpaSecurityHeaders,
} from "../src/staff-spa.js";

const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../../admin/dist");

function collectHttpsOrigins(text: string): Set<string> {
  const origins = new Set<string>();
  for (const match of text.matchAll(/https:\/\/[^/ "';)]+/g)) {
    try {
      origins.add(new URL(match[0]).origin);
    } catch {
      // ignore malformed URLs in fixture scan
    }
  }
  return origins;
}

function cspAllowsOrigin(csp: string, directive: "style-src" | "font-src", origin: string): boolean {
  const match = csp.match(new RegExp(`${directive}\\s+([^;]+)`));
  if (!match) return false;
  const sources = match[1]!.split(/\s+/);
  if (sources.includes(origin)) return true;
  if (directive === "font-src" && sources.includes("https:") && origin.startsWith("https://")) {
    return true;
  }
  return false;
}

describe("getStaffSpaSecurityHeaders", () => {
  it("includes defense-in-depth headers aligned with other HTML surfaces", () => {
    const headers = getStaffSpaSecurityHeaders();
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Referrer-Policy"]).toBe("no-referrer");
    expect(headers["Cache-Control"]).toBe("no-store");
    const csp = headers["Content-Security-Policy"]!;
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("connect-src 'self'");
    for (const src of STAFF_SPA_STYLE_SRC) {
      expect(csp).toContain(src);
    }
    for (const src of STAFF_SPA_FONT_SRC) {
      expect(csp).toContain(src);
    }
  });

  it("allows external stylesheet and font origins used by the production admin build", () => {
    let indexHtml: string;
    let bundledCss = "";
    try {
      indexHtml = readFileSync(join(adminDistRoot, "index.html"), "utf8");
      const assetsDir = join(adminDistRoot, "assets");
      for (const file of readdirSync(assetsDir)) {
        if (file.endsWith(".css")) {
          bundledCss += readFileSync(join(assetsDir, file), "utf8");
        }
      }
    } catch {
      // dist may be absent in CI before admin build; skip origin cross-check
      return;
    }

    const csp = getStaffSpaSecurityHeaders()["Content-Security-Policy"]!;
    const styleOrigins = collectHttpsOrigins(`${indexHtml}\n${bundledCss}`);
    for (const origin of styleOrigins) {
      expect(cspAllowsOrigin(csp, "style-src", origin), `missing style-src for ${origin}`).toBe(
        true,
      );
    }

    // Tabler icon webfont files resolve under jsDelivr when the stylesheet is CDN-hosted.
    expect(cspAllowsOrigin(csp, "font-src", "https://cdn.jsdelivr.net")).toBe(true);
    expect(cspAllowsOrigin(csp, "font-src", "https://fonts.gstatic.com")).toBe(true);
  });
});
