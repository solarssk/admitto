import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { isSecureRequest } from "../src/auth/routes.js";

async function probe(url: string, headers: Record<string, string> = {}): Promise<boolean> {
  const app = new Hono();
  app.get("/probe", (c) => c.json({ secure: isSecureRequest(c) }));
  const res = await app.request(url, { headers });
  const body = (await res.json()) as { secure: boolean };
  return body.secure;
}

describe("isSecureRequest", () => {
  it("is false for plain HTTP requests", async () => {
    expect(await probe("http://127.0.0.1:8080/probe")).toBe(false);
  });

  it("is true for HTTPS requests", async () => {
    expect(await probe("https://app.example.com/probe")).toBe(true);
  });

  it("honours X-Forwarded-Proto when TRUST_PROXY is enabled", async () => {
    const prev = process.env["TRUST_PROXY"];
    process.env["TRUST_PROXY"] = "true";
    try {
      expect(await probe("http://127.0.0.1:8080/probe", { "X-Forwarded-Proto": "https" })).toBe(
        true,
      );
      expect(await probe("https://app.example.com/probe", { "X-Forwarded-Proto": "http" })).toBe(
        false,
      );
    } finally {
      if (prev === undefined) delete process.env["TRUST_PROXY"];
      else process.env["TRUST_PROXY"] = prev;
    }
  });

  it("treats X-Forwarded-Proto case-insensitively when TRUST_PROXY is enabled", async () => {
    const prev = process.env["TRUST_PROXY"];
    process.env["TRUST_PROXY"] = "true";
    try {
      expect(await probe("http://127.0.0.1:8080/probe", { "X-Forwarded-Proto": "HTTPS" })).toBe(
        true,
      );
    } finally {
      if (prev === undefined) delete process.env["TRUST_PROXY"];
      else process.env["TRUST_PROXY"] = prev;
    }
  });
});
