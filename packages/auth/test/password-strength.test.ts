import { describe, expect, it } from "vitest";
import { PASSWORD_MIN_LENGTH } from "../src/constants.js";
import {
  passwordStrengthTip,
  scorePasswordStrength,
  scorePasswordStrengthInline,
} from "../src/password-strength.js";
import { passwordStrengthAuthScript } from "../src/password-strength-script.js";
import {
  PASSWORD_STRENGTH_FAIR,
  PASSWORD_STRENGTH_GOOD,
  PASSWORD_STRENGTH_STRONG,
  PASSWORD_STRENGTH_WEAK,
} from "../src/password-strength-fixtures.js";

describe("scorePasswordStrength", () => {
  it("returns empty for blank input", () => {
    expect(scorePasswordStrength("")).toEqual({ level: "empty", score: 0, label: "" });
  });

  it("flags passwords below PASSWORD_MIN_LENGTH with partial meter progress", () => {
    // Distinct "tooShort" level (not "weak") — incomplete progress should
    // read as neutral, not as an alarming red warning.
    expect(scorePasswordStrength("short")).toEqual({
      level: "tooShort",
      score: 2,
      label: "Too short",
    });
    expect(scorePasswordStrength("a")).toEqual({
      level: "tooShort",
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

describe("passwordStrengthTip", () => {
  it("is empty below minlength — 'Too short' already says enough", () => {
    expect(passwordStrengthTip("short", PASSWORD_MIN_LENGTH)).toBe("");
    expect(passwordStrengthTip("", PASSWORD_MIN_LENGTH)).toBe("");
  });

  it("is empty once the password is already Strong", () => {
    expect(passwordStrengthTip(PASSWORD_STRENGTH_STRONG, PASSWORD_MIN_LENGTH)).toBe("");
  });

  it("names only the single highest-impact missing ingredient (stays one line)", () => {
    // 12 lowercase chars: length is the biggest lever, named first.
    expect(passwordStrengthTip(PASSWORD_STRENGTH_WEAK, PASSWORD_MIN_LENGTH)).toBe(
      "Add 16+ characters for a stronger score.",
    );
  });

  it("moves on to the next missing ingredient once length is satisfied", () => {
    expect(passwordStrengthTip("a".repeat(16), PASSWORD_MIN_LENGTH)).toBe(
      "Add upper & lower case for a stronger score.",
    );
    expect(passwordStrengthTip("aaaaaaaaaaaaaaaA", PASSWORD_MIN_LENGTH)).toBe(
      "Add a number for a stronger score.",
    );
    expect(passwordStrengthTip("aaaaaaaaaaaaaaA1", PASSWORD_MIN_LENGTH)).toBe(
      "Add a symbol for a stronger score.",
    );
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
  const SCRIPT_NONCE = "dGVzdC1zY3JpcHQtbm9uY2U=";

  it("embeds PASSWORD_MIN_LENGTH and scorer source", () => {
    const script = passwordStrengthAuthScript(SCRIPT_NONCE);
    expect(script).toContain(`var MIN = ${PASSWORD_MIN_LENGTH}`);
    expect(script).toContain("scorePasswordStrengthInline");
    expect(script).toContain("auth-password-strength");
    expect(script).toContain(`nonce="${SCRIPT_NONCE}"`);
  });

  it("wires confirm field for match feedback only", () => {
    const script = passwordStrengthAuthScript(SCRIPT_NONCE);
    expect(script).toContain("wireMatch(confirm, password)");
    expect(script).not.toMatch(/updateMeter\s*\(\s*confirm/);
  });

  it("embeds tooShortProgressScore for sub-minimum passwords", () => {
    const script = passwordStrengthAuthScript(SCRIPT_NONCE);
    expect(script).toContain("var tooShortProgressScore =");
    expect(script).toContain("Too short");
  });

  it("positions meter in auth-password-slot without layout shift", () => {
    const script = passwordStrengthAuthScript(SCRIPT_NONCE);
    expect(script).toContain("auth-password-slot");
    expect(script).toContain("auth-password-strength--empty");
    expect(script).toContain("clearMeter");
  });

  it("embeds passwordStrengthTip in aria-label, not as a visible tip row", () => {
    const script = passwordStrengthAuthScript(SCRIPT_NONCE);
    expect(script).toContain("var strengthTip =");
    expect(script).toContain("meterAriaLabel");
    expect(script).not.toContain("auth-password-strength__tip");
  });
});
