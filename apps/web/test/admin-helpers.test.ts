import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { resolveClientTimezone } from "../src/admin/admin-helpers.js";

function appWithRequest(headers: Record<string, string> = {}) {
  const app = new Hono();
  app.get("/tz", (c) => c.json({ timezone: resolveClientTimezone(c) }));
  return app.request("/tz", { headers });
}

describe("resolveClientTimezone (Codecov review — previously untested)", () => {
  it("returns null when the header is missing", async () => {
    const res = await appWithRequest();
    expect(await res.json()).toEqual({ timezone: null });
  });

  it("returns null for a value that isn't a real IANA timezone", async () => {
    const res = await appWithRequest({ "X-Client-Timezone": "not/a-real-zone" });
    expect(await res.json()).toEqual({ timezone: null });
  });

  it("returns the header value when it's a valid IANA timezone", async () => {
    const res = await appWithRequest({ "X-Client-Timezone": "Europe/Warsaw" });
    expect(await res.json()).toEqual({ timezone: "Europe/Warsaw" });
  });
});
