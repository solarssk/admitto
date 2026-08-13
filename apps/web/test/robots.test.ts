import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

describe("robots.txt", () => {
  it("does not disallow crawling, so noindex headers stay reachable", async () => {
    const app = createApp();
    const res = await app.request("/robots.txt");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    const body = await res.text();
    expect(body).toContain("User-agent: *");
    expect(body).toContain("Allow: /");
    expect(body).not.toContain("Disallow");
  });
});
