import { Hono } from "hono";
import type { PrismaClient } from "@admitto/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleGetRegistrationForm } from "../../src/registration/form-routes.js";
import { loadRegistrationPage, type RegistrationPageState } from "../../src/registration/form-model.js";
import { renderRegistrationNotFound } from "../../src/registration-page-security.js";
import { closedModel, formModel } from "../helpers/registration-form-fixtures.js";
import { headersOf } from "../helpers/response-headers.js";

vi.mock("../../src/registration/form-model.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/registration/form-model.js")>()),
  loadRegistrationPage: vi.fn(),
}));

const loadPage = vi.mocked(loadRegistrationPage);
const loadTheme = vi.fn(async () => null as { primary?: string } | null);
const serverError = vi.fn(() => new Response("server error", { status: 500 }));
const db = {} as PrismaClient;

const app = new Hono();
app.get("/r/:slug", (c) => handleGetRegistrationForm(c, { db, loadTheme: loadTheme as never, serverError }));

const get = (path = "/r/northwind-summit") => app.request(`https://tickets.example.com${path}`);

function answer(state: RegistrationPageState) {
  loadPage.mockResolvedValue(state);
}

const nonceOf = (res: Response) => /script-src 'nonce-([^']+)'/.exec(res.headers.get("content-security-policy") ?? "")?.[1];

beforeEach(() => {
  vi.clearAllMocks();
  loadTheme.mockResolvedValue(null);
});

describe("when there is nothing to show", () => {
  it("answers the one 404 of the registration routes, byte for byte, and never looks up the theme", async () => {
    answer({ kind: "not_found" });
    const res = await get();
    const expected = renderRegistrationNotFound(true);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe(expected.html);
    expect(headersOf(res)).toMatchObject(Object.fromEntries(Object.entries(expected.headers).map(([k, v]) => [k.toLowerCase(), v])));
    expect(loadTheme).not.toHaveBeenCalled();
  });

  it("is the same for every slug, whatever the reason", async () => {
    answer({ kind: "not_found" });
    const first = await get("/r/one");
    const second = await get("/r/two-different-slug");
    expect(await first.text()).toBe(await second.text());
    expect(headersOf(first)).toEqual(headersOf(second));
  });

  it("asks for the slug of the address, in the case it was written", async () => {
    answer({ kind: "not_found" });
    await get("/r/Some_Slug-1");
    expect(loadPage).toHaveBeenCalledWith(db, "Some_Slug-1", expect.any(Date));
  });
});

describe("an open form", () => {
  it("is a 200 with the page's own policy: a nonce, the Turnstile origin, no cookie, never cached", async () => {
    answer({ kind: "open", form: formModel() });
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/html/);
    const policy = res.headers.get("content-security-policy")!;
    expect(policy).toContain("script-src 'nonce-");
    expect(policy).toContain("https://challenges.cloudflare.com");
    expect(res.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(res.headers.get("referrer-policy")).toBe("same-origin");
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains");
  });

  it("puts the nonce of the header on the script, and a new one on every response", async () => {
    answer({ kind: "open", form: formModel() });
    const first = await get();
    const second = await get();
    const firstNonce = nonceOf(first)!;
    const secondNonce = nonceOf(second)!;
    expect(firstNonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(secondNonce).not.toBe(firstNonce);
    expect(await first.text()).toContain(`<script nonce="${firstNonce}">`);
    expect(await second.text()).toContain(`<script nonce="${secondNonce}">`);
  });

  it("sends no HSTS over plain HTTP", async () => {
    answer({ kind: "open", form: formModel() });
    const res = await app.request("http://tickets.example.com/r/northwind-summit");
    expect(res.headers.get("strict-transport-security")).toBeNull();
  });

  it("looks up the theme once and styles the page with it", async () => {
    loadTheme.mockResolvedValue({ primary: "#aa2200" });
    answer({ kind: "open", form: formModel() });
    const html = await (await get()).text();
    expect(loadTheme).toHaveBeenCalledTimes(1);
    expect(html).toContain("--primary: #aa2200");
  });

  it("allows the event's logo host to draw its logo, and nothing else", async () => {
    answer({ kind: "open", form: formModel({ event: { ...formModel().event, logoUrl: "https://cdn.example.com/logo.png" } }) });
    const res = await get();
    expect(res.headers.get("content-security-policy")).toContain("img-src 'self' data: https://cdn.example.com;");
    expect(await res.text()).toContain('src="https://cdn.example.com/logo.png"');
  });
});

describe("an event that is over", () => {
  it("is a 200 with the closed page, no widget origin in its policy, and no script", async () => {
    answer({ kind: "closed", page: closedModel() });
    const res = await get();
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain("Registration is closed");
    expect(html).not.toContain("<script");
    expect(res.headers.get("content-security-policy")).not.toContain("cloudflare");
    expect(res.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(loadTheme).toHaveBeenCalledTimes(1);
  });
});

describe("when the page cannot be loaded", () => {
  it("answers the server error and logs the class of the failure, never its message", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    loadPage.mockRejectedValue(new Error("connect to anna.kowalska@contoso.example failed"));
    const res = await get();
    expect(res.status).toBe(500);
    expect(serverError).toHaveBeenCalledTimes(1);
    expect(loadTheme).not.toHaveBeenCalled();
    expect(JSON.stringify(consoleError.mock.calls)).toBe(JSON.stringify([["loadRegistrationPage failed:", { reason: "Error" }]]));
    consoleError.mockRestore();
  });
});
