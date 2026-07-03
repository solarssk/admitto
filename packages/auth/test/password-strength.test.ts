import { describe, expect, it } from "vitest";
import { PASSWORD_MIN_LENGTH } from "../src/constants.js";
import {
  scorePasswordStrength,
  scorePasswordStrengthInline,
} from "../src/password-strength.js";
import { passwordStrengthAuthScript } from "../src/password-strength-script.js";
import {
  PASSWORD_STRENGTH_FAIR,
  PASSWORD_STRENGTH_GOOD,
  PASSWORD_STRENGTH_STRONG,
  PASSWORD_STRENGTH_WEAK,
} from "./password-strength-samples.js";

describe("scorePasswordStrength", () => {
  it("returns empty for blank input", () => {
    expect(scorePasswordStrength("")).toEqual({ level: "empty", score: 0, label: "" });
  });

  it("flags passwords below PASSWORD_MIN_LENGTH with partial meter progress", () => {
    expect(scorePasswordStrength("short")).toEqual({
      level: "weak",
      score: 2,
      label: "Too short",
    });
    expect(scorePasswordStrength("a")).toEqual({
      level: "weak",
      score: 1,
      label: "Too short",
    });
  });

  it("rewards length and character variety", () => {
    expect(scorePasswordStrength(PASSWORD_STRENGTH_WEAK).label).toBe("Weak");
    expect(scorePasswordStrength(PASSWORD_STRENGTH_FAIR).label).toBe("Fair");
    expect(scorePasswordStrength(PASSWORD_STRENGTH_GOOD).label).toBe("Good");
    expect(scorePasswordStrength(PASSWORD_STRENGTH_STRONG).label).toBe("Strong");
  });
});

describe("scorePasswordStrengthInline parity", () => {
  const samples = [
    "",
    "short",
    PASSWORD_STRENGTH_WEAK,
    "abcdefghijklm",
    PASSWORD_STRENGTH_FAIR,
    PASSWORD_STRENGTH_GOOD,
    ["correct", "horse", "battery", "staple", "99"].join("-"),
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

  it("wires confirm field for match feedback only", () => {
    const script = passwordStrengthAuthScript();
    expect(script).toContain("wireMatch(confirm, password)");
    expect(script).not.toMatch(/updateMeter\s*\(\s*confirm/);
  });

  it("embeds tooShortProgressScore for sub-minimum passwords", () => {
    const script = passwordStrengthAuthScript();
    expect(script).toContain("var tooShortProgressScore =");
    expect(script).toContain("Too short");
  });

  it("positions meter in auth-password-slot without layout shift", () => {
    const script = passwordStrengthAuthScript();
    expect(script).toContain("auth-password-slot");
    expect(script).toContain("auth-password-strength--empty");
    expect(script).toContain("clearMeter");
  });
});
