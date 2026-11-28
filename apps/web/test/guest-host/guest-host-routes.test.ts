import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { classifyGuestRequest } from "../../src/guest-host/guest-paths.js";

/**
 * Every route of the application has been decided about, once, on purpose (D-C6, 119b): it is either part of the guest's side of an
 * event, and then served on an event's own address, or it is the staff's, and then it does not exist there. A route that is added
 * and is on neither list fails this test. The default for a new route is hidden (guest-paths.ts is a list of what is allowed), so
 * adding a route here is how a person says it is a guest's, with the path in guest-paths.ts.
 *
 * To add a route: if a guest needs it, add the path to `classifyGuestRequest` (and make its handler keep to one event) and to
 * GUEST_ROUTES; if it is the staff's, a prefix in STAFF_PREFIXES covers it, and a new family of staff routes is a new prefix.
 */
const SLUG = "summit";

/** `METHOD path` of every route a guest can reach on their event's own address. `GET /` goes to the form. */
const GUEST_ROUTES: readonly string[] = [
  "GET /",
  "GET /.well-known/admitto-domain-check",
  "GET /favicon.svg",
  "GET /favicon-32.png",
  "GET /favicon.ico",
  "GET /apple-touch-icon.png",
  "GET /apple-touch-icon-precomposed.png",
  "GET /assets/*",
  "GET /uploads/*",
  "GET /vendor/tabler-icons/*",
  "GET /vendor/fontsource/*",
  "GET /m/:filename",
  "GET /r/:slug",
  "POST /r/:slug",
  "GET /r/:slug/sso/start",
  "GET /sso/callback",
  "GET /r/:slug/confirm/:token",
  "POST /r/:slug/confirm/:token",
  "GET /legal/:eventSlug/:ref",
  "GET /t/:eventSlug/a/:ref",
  "GET /t/:token",
  "GET /t/:token/wallet/apple",
  "GET /t/:token/wallet/google",
  "GET /t/:eventSlug/a/:ref/wallet/apple",
  "GET /t/:eventSlug/a/:ref/wallet/google",
  "GET /q/:eventSlug/a/:filename",
  "GET /q/:filename",
];

/** Single files of the bundled assets that a guest's pages and mails link to: `GET /assets/*` covers them on the list above. */
const GUEST_FILE_PREFIXES: readonly string[] = ["/assets/"];

/** The staff's side, the API, the health routes and the files only the instance's own host needs. */
const STAFF_PREFIXES: readonly string[] = [
  "/api/",
  "/admin",
  "/account",
  "/operator",
  "/login",
  "/logout",
  "/setup",
  "/mfa/",
  "/change-password",
  "/healthz",
  "/readyz",
  "/robots.txt",
  "/.well-known/change-password",
];

function sampleOf(path: string): string {
  return path
    .replace(/:(?:slug|eventSlug)\b/g, SLUG)
    .replace(/:[A-Za-z]+/g, "p1")
    .replaceAll("*", "x");
}

function isStaffRoute(path: string): boolean {
  return STAFF_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`));
}

const pathOf = (route: string): string => route.slice(route.indexOf(" ") + 1);
const isGuestFile = (route: string): boolean => GUEST_FILE_PREFIXES.some((prefix) => pathOf(route).startsWith(prefix));
const isGuestRoute = (route: string): boolean => GUEST_ROUTES.includes(route) || isGuestFile(route);

const app = createApp({ baseUrl: "https://tickets.example.com", skipCheckinBootValidation: true, checkinToken: null, allowCheckinBearer: false });
const routes = [...new Set(app.routes.filter((route) => route.method !== "ALL").map((route) => `${route.method} ${route.path}`))];

describe("every route of the application is a guest's or the staff's", () => {
  it("has found the routes", () => {
    expect(routes.length).toBeGreaterThan(300);
  });

  it("puts every route on one of the two lists: a new route is hidden on a guest's address until a person lists it", () => {
    expect(routes.filter((route) => !isGuestRoute(route) && !isStaffRoute(pathOf(route)))).toEqual([]);
  });

  it("serves every guest route on a guest's address, whatever the method it is called with", () => {
    for (const route of routes.filter((r) => isGuestRoute(r))) {
      const [method = "", path = ""] = route.split(" ");
      const verdict = classifyGuestRequest(method, sampleOf(path), SLUG);
      expect(verdict, route).toBe(path === "/" ? "root" : "allow");
    }
  });

  it("hides every staff route on a guest's address", () => {
    for (const route of routes.filter((r) => !isGuestRoute(r))) {
      const [method = "", path = ""] = route.split(" ");
      expect(classifyGuestRequest(method, sampleOf(path), SLUG), route).toBe("deny");
    }
  });

  it("lists no route the application no longer has", () => {
    expect(GUEST_ROUTES.filter((route) => !routes.includes(route))).toEqual([]);
  });

  it("keeps the routes of the staff's list out of the guest's list", () => {
    expect(GUEST_ROUTES.filter((route) => isStaffRoute(pathOf(route)))).toEqual([]);
  });
});
