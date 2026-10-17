import { describe, expect, it } from "vitest";
import {
  hasTrivialCharacterPattern,
  isPasswordBlocklisted,
  isPasswordTooCommon,
  passwordTooCommonJsonBody,
  PASSWORD_TOO_COMMON_CODE,
} from "../src/password-blocklist.js";
import {
  BASE64URL,
  DIGITS,
  GENERATED_PASSPHRASE,
  HEX,
  generatedText,
  generatedUuidPair,
  withDistinctCharacters,
} from "./generated-passwords.js";

describe("isPasswordBlocklisted", () => {
  it("matches well-known common passwords case-insensitively", () => {
    expect(isPasswordBlocklisted("password123")).toBe(true);
    expect(isPasswordBlocklisted("Password123")).toBe(true);
    expect(isPasswordBlocklisted("PASSWORD123")).toBe(true);
    expect(isPasswordBlocklisted("qwerty123")).toBe(true);
    expect(isPasswordBlocklisted("letmein123")).toBe(true);
  });

  it("does not match a random, unrelated password", () => {
    expect(isPasswordBlocklisted("users-pass-123")).toBe(false);
    expect(isPasswordBlocklisted("correct-horse-battery-staple")).toBe(false);
  });

  it("requires an exact match, not a substring", () => {
    // A password merely containing a blocklisted word is not itself flagged —
    // avoids over-broad false positives from substring matching.
    expect(isPasswordBlocklisted("myadminpanel2024xyz")).toBe(false);
  });
});

describe("hasTrivialCharacterPattern", () => {
  it("flags a single character repeated", () => {
    expect(hasTrivialCharacterPattern("aaaaaaaaaaaa")).toBe(true);
    expect(hasTrivialCharacterPattern("111111111111")).toBe(true);
  });

  it("flags a simple ascending or descending character run", () => {
    expect(hasTrivialCharacterPattern("abcdefghijkl")).toBe(true);
    // Digits wrap at the "9" → "0" boundary (ASCII code steps by -9, not +1),
    // so a run has to stay within one ascending/descending decade to hold.
    expect(hasTrivialCharacterPattern("23456789")).toBe(true);
    expect(hasTrivialCharacterPattern("nmlkjihgfedcba")).toBe(true);
    expect(hasTrivialCharacterPattern("zyxwvu")).toBe(true);
  });

  it("flags passwords at the low-variety threshold without a full run", () => {
    expect(hasTrivialCharacterPattern("aabbaabb")).toBe(true);
  });

  it("does not flag a password with normal character variety", () => {
    expect(hasTrivialCharacterPattern("users-pass-123")).toBe(false);
    expect(hasTrivialCharacterPattern("Tr0ub4dor&3xyz")).toBe(false);
    expect(hasTrivialCharacterPattern("correct-horse-battery-staple")).toBe(false);
  });

  it("does not flag a short suffix run inside an otherwise varied password", () => {
    // Only the last 3 characters ascend; the full string is not a run.
    expect(hasTrivialCharacterPattern("setup-pass-12345")).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(hasTrivialCharacterPattern("")).toBe(false);
  });

  it("does not flag ascending runs shorter than six characters", () => {
    expect(hasTrivialCharacterPattern("abcde")).toBe(false);
  });

  it("does not flag a sequence that breaks before the end", () => {
    expect(hasTrivialCharacterPattern("abcdefgxyz")).toBe(false);
  });
});

describe("hasTrivialCharacterPattern and long passwords", () => {
  // A long generated password repeats characters because its alphabet is small: 64 hex characters
  // use at most 16 different ones. That is not a pattern.
  const longGenerated: Array<[string, string]> = [
    ["64 hex characters", generatedText(HEX, 64, 1)],
    ["two UUIDs written one after the other", generatedUuidPair(2)],
    ["40 digits", generatedText(DIGITS, 40, 3)],
    ["a passphrase of 15 words", GENERATED_PASSPHRASE],
  ];

  it.each(longGenerated)("does not flag %s", (_label, password) => {
    const distinct = new Set(password.toLowerCase()).size;
    // Few different characters for the length (at most a quarter), yet more than six.
    expect(distinct * 4).toBeLessThanOrEqual(password.length);
    expect(distinct).toBeGreaterThan(6);
    expect(hasTrivialCharacterPattern(password)).toBe(false);
    expect(isPasswordTooCommon(password)).toBe(false);
  });

  it("does not flag 64 base64url characters", () => {
    expect(isPasswordTooCommon(generatedText(BASE64URL, 64, 4))).toBe(false);
  });

  it.each([
    ["one character, 64 times", "a".repeat(64)],
    ["two characters taking turns", "ab".repeat(30)],
    ["three characters repeating", "abc".repeat(20)],
    ["six characters repeating", withDistinctCharacters(48, 6)],
    ["a long ascending run", "abcdefghijklmnopqrstuvwxyz"],
    ["a long descending run", "zyxwvutsrqponmlkjihgfedcba"],
  ])("still flags %s", (_label, password) => {
    expect(hasTrivialCharacterPattern(password)).toBe(true);
    expect(isPasswordTooCommon(password)).toBe(true);
  });

  it("flags a password of up to 27 characters when at most a quarter of them are different", () => {
    const wrong: string[] = [];
    for (let length = 12; length <= 27; length++) {
      for (let distinct = 1; distinct <= 8; distinct++) {
        const flagged = hasTrivialCharacterPattern(withDistinctCharacters(length, distinct));
        if (flagged !== distinct * 4 <= length) wrong.push(`${distinct} different in ${length}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("flags a password of 28 or more characters when at most six of them are different", () => {
    const wrong: string[] = [];
    for (const length of [28, 32, 40, 64, 72, 128, 256]) {
      for (let distinct = 1; distinct <= 9; distinct++) {
        const flagged = hasTrivialCharacterPattern(withDistinctCharacters(length, distinct));
        if (flagged !== distinct <= 6) wrong.push(`${distinct} different in ${length}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe("isPasswordTooCommon", () => {
  it("rejects blocklisted and trivially-patterned passwords", () => {
    expect(isPasswordTooCommon("password123")).toBe(true);
    expect(isPasswordTooCommon("aaaaaaaaaaaa")).toBe(true);
  });

  it("accepts passwords used by existing integration test fixtures", () => {
    // Guards against accidentally rejecting the seed passwords other test
    // suites rely on to exercise the happy path.
    for (const candidate of [
      "users-pass-123",
      "new-temp-pass-99",
      "long-enough",
      "created-pass-1",
      "duplicate-pass-1",
      "created-staff-pass-1",
      "audit-rollback-1",
      "setup-pass-12345",
    ]) {
      expect(isPasswordTooCommon(candidate)).toBe(false);
    }
  });
});

describe("passwordTooCommonJsonBody", () => {
  it("returns the stable API error code used by password-setting routes", () => {
    expect(passwordTooCommonJsonBody()).toEqual({
      code: PASSWORD_TOO_COMMON_CODE,
      error: PASSWORD_TOO_COMMON_CODE,
    });
  });
});
