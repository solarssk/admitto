import { describe, expect, it } from "vitest";
import {
  InstanceUrlRequiredError,
  normalizePersistedInstanceUrl,
  normalizeRuntimeBaseUrl,
  resolveInstanceBaseUrl,
} from "../src/instance-base-url.js";

describe("normalizePersistedInstanceUrl", () => {
  it("accepts HTTPS URLs without trailing slash", () => {
    expect(normalizePersistedInstanceUrl("https://tickets.example.com")).toBe(
      "https://tickets.example.com",
    );
  });

  it("rejects HTTP URLs", () => {
    expect(() => normalizePersistedInstanceUrl("http://tickets.example.com")).toThrow(
      /https/i,
    );
  });

  it("rejects trailing slash", () => {
    expect(() => normalizePersistedInstanceUrl("https://tickets.example.com/")).toThrow(
      /trailing slash/i,
    );
  });

  it("rejects query string", () => {
    expect(() =>
      normalizePersistedInstanceUrl("https://tickets.example.com?preview=1"),
    ).toThrow(/query string or fragment/i);
  });

  it("rejects bare query delimiter", () => {
    expect(() => normalizePersistedInstanceUrl("https://tickets.example.com?")).toThrow(
      /query string or fragment/i,
    );
  });

  it("rejects bare fragment delimiter", () => {
    expect(() => normalizePersistedInstanceUrl("https://tickets.example.com#")).toThrow(
      /query string or fragment/i,
    );
  });

  it("rejects fragment", () => {
    expect(() => normalizePersistedInstanceUrl("https://tickets.example.com#section")).toThrow(
      /query string or fragment/i,
    );
  });

  it("rejects embedded credentials", () => {
    expect(() =>
      normalizePersistedInstanceUrl("https://user:pass@tickets.example.com"),
    ).toThrow(/credentials/i);
  });

  it("rejects username-only userinfo", () => {
    expect(() => normalizePersistedInstanceUrl("https://user@tickets.example.com")).toThrow(
      /credentials/i,
    );
  });
});

describe("normalizeRuntimeBaseUrl", () => {
  it("allows localhost HTTP in test environment", () => {
    expect(normalizeRuntimeBaseUrl("http://localhost:3000", { NODE_ENV: "test" })).toBe(
      "http://localhost:3000",
    );
  });

  it("strips trailing slash", () => {
    expect(
      normalizeRuntimeBaseUrl("https://tickets.example.com/", { NODE_ENV: "test" }),
    ).toBe("https://tickets.example.com");
  });

  it("rejects non-localhost HTTP outside development", () => {
    expect(() =>
      normalizeRuntimeBaseUrl("http://tickets.example.com", { NODE_ENV: "production" }),
    ).toThrow(/https/i);
  });
});

describe("resolveInstanceBaseUrl", () => {
  it("throws InstanceUrlRequiredError in production when unset", async () => {
    const prevBase = process.env.BASE_URL;
    delete process.env.BASE_URL;
    const db = {
      systemSettings: { findUnique: async () => null },
    } as never;
    try {
      await expect(
        resolveInstanceBaseUrl(db, { NODE_ENV: "production", BASE_URL: undefined }),
      ).rejects.toBeInstanceOf(InstanceUrlRequiredError);
    } finally {
      if (prevBase === undefined) delete process.env.BASE_URL;
      else process.env.BASE_URL = prevBase;
    }
  });

  it("prefers injected app baseUrl over env BASE_URL", async () => {
    const db = { systemSettings: { findUnique: async () => null } } as never;
    await expect(
      resolveInstanceBaseUrl(
        db,
        { NODE_ENV: "test", BASE_URL: "https://env.example.com" },
        "https://injected.example.com",
      ),
    ).resolves.toBe("https://injected.example.com");
  });
});
