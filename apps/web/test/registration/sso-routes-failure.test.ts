/**
 * What the two routes of the company sign-in do when something they did not expect goes wrong (D-C4): the database cannot be
 * read, say. The guest is back at the page with the general notice, the flow cookie is deleted, and the log holds the class of
 * the error and nothing of its message, which can carry an address.
 */
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@admitto/db";
import { querySystemLogs, resetSystemLogBufferForTest } from "@admitto/shared/system-log";
import { handleSsoCallback, handleSsoStart } from "../../src/registration/sso-routes.js";
import { GUEST_SSO_CALLBACK_PATH, GUEST_SSO_SESSION_COOKIE } from "../../src/registration/sso-session.js";
import { newGuestSsoStateValue } from "../../src/registration/sso-state-value.js";

const failing = (() => {
  const error = Object.assign(new Error("connect to ada.lovelace@contoso.example failed"), { name: "ConnectionError" });
  const read = vi.fn(async () => Promise.reject(error));
  return { event: { findUnique: read }, registrationSsoState: { findUnique: read } } as unknown as PrismaClient;
})();

const app = new Hono();
const deps = { db: failing, baseUrl: async () => "https://tickets.example.com" };
app.get("/r/:slug/sso/start", (c) => handleSsoStart(c, deps));
app.get(GUEST_SSO_CALLBACK_PATH, (c) => handleSsoCallback(c, deps));

afterEach(() => {
  vi.restoreAllMocks();
  resetSystemLogBufferForTest();
});

const flow = newGuestSsoStateValue("northwind-summit");

describe("an unexpected failure", () => {
  it.each([
    ["the start", "/r/northwind-summit/sso/start", undefined, /^$/],
    ["the callback", `${GUEST_SSO_CALLBACK_PATH}?code=a-code&state=${flow.value}`, `${flow.cookieName}=${flow.value}`, /Max-Age=0/],
  ])("sends the guest of %s back to the page with the general notice, and logs the class of the error alone", async (_name, path, cookie, flowCookieLine) => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const res = await app.request(`https://tickets.example.com${path}`, cookie ? { headers: { Cookie: cookie } } : {});

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/r/northwind-summit?sso=failed");
    expect(res.headers.get("cache-control")).toBe("no-store");
    // The callback deletes the flow cookie of its flow; the start has set none, so it has none to delete.
    expect(res.headers.getSetCookie().find((line) => line.startsWith(`${flow.cookieName}=`)) ?? "").toMatch(flowCookieLine);
    expect(JSON.stringify(consoleError.mock.calls)).toBe(JSON.stringify([["registration sso failed:", { reason: "ConnectionError" }]]));
    const refusals = querySystemLogs({ source: "security" }).filter((entry) => entry.message === "registration_sso_refused");
    expect(refusals.map((entry) => entry.fields)).toEqual([{ reason: "internal" }]);
    expect(JSON.stringify([consoleError.mock.calls, querySystemLogs({})])).not.toContain("contoso");
  });

  it("goes back by the slug of the event of the spent state, not by the hint the state carries, when the event cannot be read afterwards", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // A state whose hint is not the slug of its event (the event was renamed after the start): the row says which event it is.
    const hinted = newGuestSsoStateValue("a-name-the-event-had");
    const row = { id: "row-1", event_id: "evt-1", event: { slug: "northwind-summit" }, provider_id: "idp-1", nonce: "n", code_verifier: "v" };
    const db = {
      registrationSsoState: { findUnique: vi.fn(async () => row), updateMany: vi.fn(async () => ({ count: 1 })) },
      event: { findUnique: vi.fn(async () => Promise.reject(new Error("read failed"))) },
    } as unknown as PrismaClient;
    const spent = new Hono();
    spent.get(GUEST_SSO_CALLBACK_PATH, (c) => handleSsoCallback(c, { db, baseUrl: async () => "https://tickets.example.com" }));

    const res = await spent.request(`https://tickets.example.com${GUEST_SSO_CALLBACK_PATH}?code=a-code&state=${hinted.value}`, {
      headers: { Cookie: `${hinted.cookieName}=${hinted.value}` },
    });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/r/northwind-summit?sso=failed");
    const cookies = res.headers.getSetCookie();
    // The sign-in cookie that is taken away is the one of the event's page, and nothing is said for the hint's path.
    expect(cookies.some((line) => line.startsWith(`${GUEST_SSO_SESSION_COOKIE}=`) && line.includes("Path=/r/northwind-summit") && line.includes("Max-Age=0"))).toBe(true);
    expect(cookies.some((line) => line.includes("a-name-the-event-had"))).toBe(false);
  });

  it("logs an error that is no Error as unknown", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const odd = new Hono();
    odd.get("/r/:slug/sso/start", (c) =>
      handleSsoStart(c, { db: { event: { findUnique: async () => Promise.reject("ada.lovelace@contoso.example") } } as unknown as PrismaClient, baseUrl: async () => "x" }),
    );

    const res = await odd.request("https://tickets.example.com/r/northwind-summit/sso/start");

    expect(res.headers.get("location")).toBe("/r/northwind-summit?sso=failed");
    expect(JSON.stringify(consoleError.mock.calls)).toBe(JSON.stringify([["registration sso failed:", { reason: "unknown" }]]));
  });
});
