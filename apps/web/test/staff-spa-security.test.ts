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

function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

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

  it("self-hosted admin build has no external CDN references in runtime HTML/CSS", () => {
    const indexHtml = readFileSync(join(adminDistRoot, "index.html"), "utf8");
    let bundledCss = "";
    const assetsDir = join(adminDistRoot, "assets");
    for (const file of readdirSync(assetsDir)) {
      if (file.endsWith(".css")) {
        bundledCss += readFileSync(join(assetsDir, file), "utf8");
      }
    }

    const combined = `${indexHtml}\n${stripCssComments(bundledCss)}`;
    expect(combined).not.toMatch(/jsdelivr/i);
    expect(combined).not.toMatch(/fonts\.googleapis/i);
    expect(combined).not.toMatch(/fonts\.gstatic/i);

    const csp = getStaffSpaSecurityHeaders()["Content-Security-Policy"]!;
    const styleOrigins = collectHttpsOrigins(combined);
    for (const origin of styleOrigins) {
      expect(cspAllowsOrigin(csp, "style-src", origin), `missing style-src for ${origin}`).toBe(
        true,
      );
    }
  });

  it("keeps font-src https: for optional superadmin branding fonts (regression guard)", () => {
    const csp = getStaffSpaSecurityHeaders()["Content-Security-Policy"]!;
    expect(csp).toContain("font-src 'self' https:");
    // Regression: wildcard must allow a configured branding host (not branding logic itself).
    expect(cspAllowsOrigin(csp, "font-src", "https://cdn.example.com")).toBe(true);
  });
});
