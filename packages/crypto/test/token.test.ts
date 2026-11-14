import { describe, expect, it } from "vitest";
import { encodeBase32Lower, generateEventSlug, generateToken } from "../src/token.js";

describe("generateToken", () => {
  it("returns base64url string of expected length", () => {
    const token = generateToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("returns unique values", () => {
    expect(generateToken()).not.toBe(generateToken());
  });
});

describe("generateEventSlug", () => {
  it("returns 26 lowercase base32 characters that fit the slug rule", () => {
    for (let i = 0; i < 200; i++) {
      const slug = generateEventSlug();
      expect(slug).toMatch(/^[a-z2-7]{26}$/);
      expect(slug).toMatch(/^[a-z0-9_-]+$/);
    }
  });

  it("returns unique values", () => {
    const slugs = new Set(Array.from({ length: 500 }, () => generateEventSlug()));
    expect(slugs.size).toBe(500);
  });

  it("uses every character of the alphabet and does not repeat a fixed prefix", () => {
    const seen = new Set<string>();
    const firsts = new Set<string>();
    for (let i = 0; i < 400; i++) {
      const slug = generateEventSlug();
      firsts.add(slug.charAt(0));
      for (const ch of slug) seen.add(ch);
    }
    expect(seen.size).toBe(32);
    expect(firsts.size).toBeGreaterThan(10);
  });

  it("encodes bytes as RFC 4648 base32 in lowercase, without padding", () => {
    const enc = (text: string) => encodeBase32Lower(new TextEncoder().encode(text));
    expect(enc("f")).toBe("my");
    expect(enc("fo")).toBe("mzxq");
    expect(enc("foobar")).toBe("mzxw6ytboi");
    expect(encodeBase32Lower(new Uint8Array(16).fill(0xff))).toBe("7".repeat(25) + "4");
    expect(encodeBase32Lower(new Uint8Array(16))).toBe("a".repeat(26));
  });
});
