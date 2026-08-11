import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  STAFF_SPA_FONT_SRC,
  STAFF_SPA_IMG_SRC,
  STAFF_SPA_STYLE_SRC,
  getStaffSpaSecurityHeaders,
} from "../src/staff-spa.js";

const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../../admin/dist");

/** Remove CSS block comments so license URLs in bundled vendor CSS are not treated as runtime origins. */
function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Collect unique HTTPS origins referenced in HTML/CSS fixture text. */
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

/** Return whether `csp` allows loading resources from `origin` for the given directive. */
function cspAllowsOrigin(
  csp: string,
  directive: "style-src" | "font-src" | "img-src",
  origin: string,
): boolean {
  const match = csp.match(new RegExp(`${directive}\\s+([^;]+)`));
  if (!match) return false;
  const sources = match[1]!.split(/\s+/);
  if (sources.includes(origin)) return true;
  if (
    (directive === "font-src" || directive === "img-src") &&
    sources.includes("https:") &&
    origin.startsWith("https://")
  ) {
    return true;
  }
  return false;
}

/** Exact token list for the `img-src` directive (order preserved). */
function imgSrcTokens(csp: string): string[] {
  const match = csp.match(/img-src\s+([^;]+)/);
  if (!match) return [];
  return match[1]!.trim().split(/\s+/);
}

describe("getStaffSpaSecurityHeaders", () => {
  it("includes defense-in-depth headers aligned with other HTML surfaces", () => {
    const headers = getStaffSpaSecurityHeaders();
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Referrer-Policy"]).toBe("same-origin");
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
    for (const src of STAFF_SPA_IMG_SRC) {
      expect(csp).toContain(src);
    }
  });

  it("self-hosted admin build has no external CDN references in runtime HTML/CSS", () => {
    const indexPath = join(adminDistRoot, "index.html");
    expect(
      existsSync(indexPath),
      "admin dist missing — run npm run build -w @admitto/admin (pretest should do this)",
    ).toBe(true);

    const indexHtml = readFileSync(indexPath, "utf8");
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

  it("keeps img-src allowlist exact in production and adds localhost only in development", () => {
    const prodTokens = imgSrcTokens(
      getStaffSpaSecurityHeaders({ NODE_ENV: "production" })["Content-Security-Policy"]!,
    );
    expect(prodTokens).toEqual(["'self'", "data:", "https:"]);
    expect(prodTokens).not.toContain("http://localhost:*");
    expect(prodTokens).not.toContain("blob:");

    const devTokens = imgSrcTokens(
      getStaffSpaSecurityHeaders({ NODE_ENV: "development" })["Content-Security-Policy"]!,
    );
    expect(devTokens).toEqual(["'self'", "data:", "https:", "http://localhost:*"]);

    for (const nodeEnv of ["test", undefined]) {
      const tokens = imgSrcTokens(
        getStaffSpaSecurityHeaders({ NODE_ENV: nodeEnv })["Content-Security-Policy"]!,
      );
      expect(tokens).toEqual(["'self'", "data:", "https:"]);
    }

    const csp = getStaffSpaSecurityHeaders()["Content-Security-Policy"]!;
    expect(cspAllowsOrigin(csp, "img-src", "https://cdn.example.com")).toBe(true);
  });

  it("stays 'self'-only when no trusted origins are configured (regression guard)", () => {
    const csp = getStaffSpaSecurityHeaders(process.env, [])["Content-Security-Policy"]!;
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("connect-src 'self'");
  });

  it("appends configured trusted origins to script-src and connect-src", () => {
    const csp = getStaffSpaSecurityHeaders(process.env, [
      "https://static.cloudflareinsights.com",
    ])["Content-Security-Policy"]!;
    expect(csp).toContain("script-src 'self' https://static.cloudflareinsights.com");
    expect(csp).toContain("connect-src 'self' https://static.cloudflareinsights.com");
  });
});
