import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

describe("/.well-known/change-password", () => {
  it("redirects to /change-password so browsers and password managers can find it directly", async () => {
    const app = createApp();
    const res = await app.request("/.well-known/change-password", { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/change-password");
  });
});
