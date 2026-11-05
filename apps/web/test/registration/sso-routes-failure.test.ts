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
import { GUEST_SSO_FLOW_COOKIE } from "../../src/registration/sso-session.js";

const failing = (() => {
  const error = Object.assign(new Error("connect to ada.lovelace@contoso.example failed"), { name: "ConnectionError" });
  return { event: { findUnique: vi.fn(async () => Promise.reject(error)) } } as unknown as PrismaClient;
})();

const app = new Hono();
const deps = { db: failing, baseUrl: async () => "https://tickets.example.com" };
app.get("/r/:slug/sso/start", (c) => handleSsoStart(c, deps));
app.get("/r/:slug/sso/callback", (c) => handleSsoCallback(c, deps));

afterEach(() => {
  vi.restoreAllMocks();
  resetSystemLogBufferForTest();
});

describe("an unexpected failure", () => {
  it.each([
    ["the start", "/r/northwind-summit/sso/start", undefined],
    ["the callback", "/r/northwind-summit/sso/callback?code=a-code&state=a-state", `${GUEST_SSO_FLOW_COOKIE}=a-state`],
  ])("sends the guest of %s back to the page with the general notice, and logs the class of the error alone", async (_name, path, cookie) => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const res = await app.request(`https://tickets.example.com${path}`, cookie ? { headers: { Cookie: cookie } } : {});

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/r/northwind-summit?sso=failed");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.getSetCookie().find((line) => line.startsWith(`${GUEST_SSO_FLOW_COOKIE}=`))).toMatch(/Max-Age=0/);
    expect(JSON.stringify(consoleError.mock.calls)).toBe(JSON.stringify([["registration sso failed:", { reason: "ConnectionError" }]]));
    const refusals = querySystemLogs({ source: "security" }).filter((entry) => entry.message === "registration_sso_refused");
    expect(refusals.map((entry) => entry.fields)).toEqual([{ reason: "internal" }]);
    expect(JSON.stringify([consoleError.mock.calls, querySystemLogs({})])).not.toContain("contoso");
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
