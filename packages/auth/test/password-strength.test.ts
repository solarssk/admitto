import { describe, expect, it } from "vitest";
import { PASSWORD_MIN_LENGTH } from "../src/constants.js";
import {
  scorePasswordStrength,
  scorePasswordStrengthInline,
} from "../src/password-strength.js";
import { passwordStrengthAuthScript } from "../src/password-strength-script.js";

describe("scorePasswordStrength", () => {
  it("returns empty for blank input", () => {
    expect(scorePasswordStrength("")).toEqual({ level: "empty", score: 0, label: "" });
  });

  it("flags passwords below PASSWORD_MIN_LENGTH", () => {
    expect(scorePasswordStrength("short")).toEqual({
      level: "weak",
      score: 0,
      label: "Too short",
    });
  });

  it("rewards length and character variety", () => {
    expect(scorePasswordStrength("a".repeat(PASSWORD_MIN_LENGTH)).label).toBe("Weak");
    expect(scorePasswordStrength("Abcdefghijkl1").label).toBe("Fair");
    expect(scorePasswordStrength("Abcdefghijkl12!").label).toBe("Good");
    expect(scorePasswordStrength("Abcdefghijkl12!@").label).toBe("Strong");
  });
});

describe("scorePasswordStrengthInline parity", () => {
  const samples = [
    "",
    "short",
    "a".repeat(PASSWORD_MIN_LENGTH),
    "abcdefghijklm",
    "Abcdefghijkl1",
    "Abcdefghijkl12!",
    "Correct-Horse-Battery-Staple-99",
  ];

  it("matches scorePasswordStrength for sample passwords", () => {
    for (const sample of samples) {
      const expected = scorePasswordStrength(sample);
      const inline = scorePasswordStrengthInline(sample, PASSWORD_MIN_LENGTH);
      expect(inline).toEqual({
        score: expected.score,
        label: expected.label,
        level: expected.level,
      });
    }
  });
});

describe("passwordStrengthAuthScript", () => {
  it("embeds PASSWORD_MIN_LENGTH and scorer source", () => {
    const script = passwordStrengthAuthScript();
    expect(script).toContain(`var MIN = ${PASSWORD_MIN_LENGTH}`);
    expect(script).toContain("scorePasswordStrengthInline");
    expect(script).toContain("auth-password-strength");
  });
});
