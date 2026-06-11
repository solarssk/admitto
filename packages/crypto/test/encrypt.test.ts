import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decrypt, decryptFromString, encrypt, encryptToString } from "../src/encrypt.js";
import { _resetKeyCache } from "../src/key.js";

// Key is set by vitest.config.ts env (ENCRYPTION_KEY + NODE_ENV=test).

afterEach(() => {
  _resetKeyCache();
  // Restore env vars modified in individual tests.
  process.env["NODE_ENV"] = "test";
  process.env["ENCRYPTION_KEY"] = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
});

describe("encrypt / decrypt — round-trip", () => {
  it("decrypts to original string", () => {
    const plain = "hello world";
    expect(decrypt(encrypt(plain))).toBe(plain);
  });

  it("handles empty string", () => {
    expect(decrypt(encrypt(""))).toBe("");
  });

  it("handles unicode", () => {
    const plain = "Cześć świecie 🎉";
    expect(decrypt(encrypt(plain))).toBe(plain);
  });

  it("handles long text", () => {
    const plain = "x".repeat(10_000);
    expect(decrypt(encrypt(plain))).toBe(plain);
  });

  it("produces unique ciphertext each call (random IV)", () => {
    const a = encrypt("same input");
    const b = encrypt("same input");
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("sets keyVersion to 1", () => {
    expect(encrypt("v").keyVersion).toBe(1);
  });
});

describe("encrypt / decrypt — tamper detection", () => {
  it("throws on modified authTag", () => {
    const payload = encrypt("secret");
    const tampered = { ...payload, authTag: Buffer.alloc(16, 0xff).toString("base64") };
    expect(() => decrypt(tampered)).toThrow();
  });

  it("throws on modified ciphertext", () => {
    const payload = encrypt("secret");
    const raw = Buffer.from(payload.ciphertext, "base64");
    raw[0] ^= 0xff;
    const tampered = { ...payload, ciphertext: raw.toString("base64") };
    expect(() => decrypt(tampered)).toThrow();
  });
});

describe("encryptToString / decryptFromString", () => {
  it("round-trips through JSON string", () => {
    const plain = "raw-ticket-token-abc123";
    expect(decryptFromString(encryptToString(plain))).toBe(plain);
  });
});

describe("fail-fast — missing ENCRYPTION_KEY", () => {
  it("throws in production when key is missing", () => {
    delete process.env["ENCRYPTION_KEY"];
    process.env["NODE_ENV"] = "production";
    _resetKeyCache();
    expect(() => encrypt("x")).toThrow("ENCRYPTION_KEY is required");
  });

  it("throws in development with helpful message when key is missing", () => {
    delete process.env["ENCRYPTION_KEY"];
    process.env["NODE_ENV"] = "development";
    _resetKeyCache();
    expect(() => encrypt("x")).toThrow("ENCRYPTION_KEY is not set");
  });

  it("throws when key is wrong length", () => {
    process.env["ENCRYPTION_KEY"] = Buffer.alloc(16).toString("base64"); // 16 bytes, not 32
    _resetKeyCache();
    expect(() => encrypt("x")).toThrow("32 bytes");
  });
});

describe("keyVersion guard", () => {
  it("decrypts successfully with keyVersion 1", () => {
    const payload = encrypt("hello");
    expect(decrypt(payload)).toBe("hello");
  });

  it("throws before any crypto operation on unsupported keyVersion", () => {
    const payload = encrypt("hello");
    expect(() => decrypt({ ...payload, keyVersion: 99 })).toThrow(
      "Unsupported key version: 99",
    );
  });

  it("throws before any crypto operation on keyVersion 0", () => {
    const payload = encrypt("hello");
    expect(() => decrypt({ ...payload, keyVersion: 0 })).toThrow(
      "Unsupported key version: 0",
    );
  });

  it("throws when keyVersion field is absent (legacy payload)", () => {
    const { keyVersion: _, ...legacyPayload } = encrypt("hello");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => decrypt(legacyPayload as any)).toThrow("Unsupported key version: undefined");
  });
});
