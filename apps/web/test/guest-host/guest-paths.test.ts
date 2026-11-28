import { describe, expect, it } from "vitest";
import { classifyGuestRequest, type GuestPathVerdict } from "../../src/guest-host/guest-paths.js";

/**
 * What the application answers on the verified own address of the event whose slug is `summit` (D-C6): a list of what is allowed,
 * and the answer to everything else is the one public 404.
 */
const SLUG = "summit";
const verdict = (path: string, method = "GET") => classifyGuestRequest(method, path, SLUG);

const ALLOWED: string[] = [
  "/r/summit",
  "/r/summit/sso/start",
  "/r/summit/confirm/abc.def",
  "/sso/callback",
  "/legal/summit/privacy_notice",
  "/t/AbCdEf0123456789_-AbCdEf0123456789_-AbCdEf0123",
  "/t/AbCdEf0123456789_-AbCdEf0123456789_-AbCdEf0123/wallet/apple",
  "/t/AbCdEf0123456789_-AbCdEf0123456789_-AbCdEf0123/wallet/google",
  "/t/summit/a/ref123",
  "/t/summit/a/ref123/wallet/apple",
  "/q/AbCdEf0123456789_-AbCdEf0123456789_-AbCdEf0123.png",
  "/q/summit/a/ref123.png",
  "/m/evt-1.png",
  "/assets/admitto-logo.svg",
  "/assets/apple-wallet-badge.png",
  "/uploads/logos/4b2a.png",
  "/vendor/tabler-icons/tabler-icons.min.css",
  "/vendor/fontsource/inter/files/inter-latin-400-normal.woff2",
  "/favicon.svg",
  "/favicon-32.png",
  "/favicon.ico",
  "/apple-touch-icon.png",
  "/apple-touch-icon-precomposed.png",
  "/.well-known/admitto-domain-check",
];

const DENIED: string[] = [
  // The panel and the staff's sign-in
  "/admin",
  "/admin/events",
  "/login",
  "/setup",
  "/logout",
  "/mfa/verify",
  "/mfa/enroll",
  "/change-password",
  "/account",
  "/account/oidc/idp/link",
  "/operator",
  "/operator/scan",
  // The API, the check-in, the ingest and the webhooks
  "/api",
  "/api/admin/events",
  "/api/auth/login",
  "/api/auth/me",
  "/api/auth/oidc/idp/start",
  "/api/account",
  "/api/checkin/scan",
  "/api/ingest",
  "/api/wallet/webhook/passcreator/evt-1",
  "/api/ops/system-logs",
  // The health routes and the other well-known files
  "/healthz",
  "/readyz",
  "/robots.txt",
  "/.well-known/change-password",
  "/.well-known/admitto-domain-check/extra",
  // Another event's pages
  "/r/other",
  "/r/other/sso/start",
  "/r/Summit",
  "/r/summit-2",
  "/r/",
  "/r",
  "/legal/other/privacy_notice",
  "/t/other/a/ref123",
  "/t/other/a/ref123/wallet/apple",
  "/q/other/a/ref123.png",
  // Paths that are of no shape the application serves
  "/t",
  "/t/",
  "/t/a/b",
  "/t/token/wallet",
  "/t/token/a/ref/extra/more",
  "/t/summit/a",
  "/t/summit/a/ref/wallet",
  "/q",
  "/q/",
  "/q/summit/b/ref.png",
  "/q/summit/a",
  "/m",
  "/assets",
  "/uploads",
  "/vendor",
  "/favicon",
  "/favicon.png",
  "/apple-touch-icon-120x120.png",
  "/sso",
  "/sso/callback/extra",
  "/sso/start",
  "//admin",
  "/Admin",
  "/anything",
];

describe("classifyGuestRequest: the paths a guest's address serves", () => {
  it.each(ALLOWED)("allows GET %s", (path) => {
    expect(verdict(path)).toBe<GuestPathVerdict>("allow");
  });

  it.each(DENIED)("hides GET %s", (path) => {
    expect(verdict(path)).toBe<GuestPathVerdict>("deny");
  });

  it("allows the form to be sent and the confirmation button to be pressed, and nothing else to be posted", () => {
    expect(verdict("/r/summit", "POST")).toBe("allow");
    expect(verdict("/r/summit/confirm/abc", "POST")).toBe("allow");
    for (const path of ["/api/admin/events", "/login", "/api/ingest", "/r/other"]) expect(verdict(path, "POST"), path).toBe("deny");
  });

  it("sends GET and HEAD of the root to the form and hides the other methods", () => {
    expect(verdict("/")).toBe("root");
    expect(verdict("/", "HEAD")).toBe("root");
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) expect(verdict("/", method), method).toBe("deny");
  });

  it("compares the slug exactly: the case, a prefix, a longer slug and an empty one do not match", () => {
    expect(classifyGuestRequest("GET", "/r/summit", "summit")).toBe("allow");
    expect(classifyGuestRequest("GET", "/r/summit", "Summit")).toBe("deny");
    expect(classifyGuestRequest("GET", "/r/summit", "summ")).toBe("deny");
    expect(classifyGuestRequest("GET", "/r/summit", "summit-2")).toBe("deny");
    expect(classifyGuestRequest("GET", "/r//x", "")).toBe("deny");
  });
});
