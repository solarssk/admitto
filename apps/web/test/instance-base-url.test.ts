import { describe, expect, it } from "vitest";
import {
  normalizePersistedInstanceUrl,
  normalizeRuntimeBaseUrl,
} from "../src/instance-base-url.js";

describe("normalizePersistedInstanceUrl", () => {
  it("accepts HTTPS URLs without trailing slash", () => {
    expect(normalizePersistedInstanceUrl("https://tickets.example.com/")).toBe(
      "https://tickets.example.com",
    );
  });

  it("rejects HTTP URLs", () => {
    expect(() => normalizePersistedInstanceUrl("http://tickets.example.com")).toThrow(
      /https/i,
    );
  });
});

describe("normalizeRuntimeBaseUrl", () => {
  it("allows localhost HTTP in test environment", () => {
    expect(normalizeRuntimeBaseUrl("http://localhost:3000", { NODE_ENV: "test" })).toBe(
      "http://localhost:3000",
    );
  });

  it("rejects non-localhost HTTP outside development", () => {
    expect(() =>
      normalizeRuntimeBaseUrl("http://tickets.example.com", { NODE_ENV: "production" }),
    ).toThrow(/https/i);
  });
});
