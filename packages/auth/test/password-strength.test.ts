import { describe, expect, it } from "vitest";
import { PASSWORD_MIN_LENGTH } from "../src/constants.js";
import {
  hasNearZeroEntropy,
  isSimpleAsciiRun,
  passwordStrengthTip,
  scorePasswordStrength,
  scorePasswordStrengthInline,
  strengthPoints,
  tooShortProgressScore,
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

  it("floors near-zero-entropy passwords to Weak regardless of length", () => {
    expect(scorePasswordStrength("abcdefghijklmnopqrst").label).toBe("Weak");
    expect(scorePasswordStrength("tsrqponmlkjihgfedcba").label).toBe("Weak");
    expect(scorePasswordStrength("a".repeat(20)).label).toBe("Weak");
  });

  it("floors passwords with points === 1 to Weak after minlength", () => {
    expect(scorePasswordStrength("abcdefghijklm").label).toBe("Weak");
    // Low variety but above the near-zero-entropy threshold — only the base point applies.
    expect(scorePasswordStrength("aabbccddeeff").label).toBe("Weak");
  });
});

describe("tooShortProgressScore", () => {
  it("returns 0 for non-positive length", () => {
    expect(tooShortProgressScore(0, PASSWORD_MIN_LENGTH)).toBe(0);
  });
});

describe("isSimpleAsciiRun", () => {
  it("returns false for runs shorter than six characters", () => {
    expect(isSimpleAsciiRun("abcde")).toBe(false);
  });

  it("returns false when the sequence breaks before the end", () => {
    expect(isSimpleAsciiRun("abcdefgxyz")).toBe(false);
  });

  it("detects ascending and descending runs of six or more", () => {
    expect(isSimpleAsciiRun("abcdef")).toBe(true);
    expect(isSimpleAsciiRun("fedcba")).toBe(true);
  });
});

describe("hasNearZeroEntropy and strengthPoints", () => {
  it("flags low-variety passwords without a full run", () => {
    expect(hasNearZeroEntropy("aaaabbbb")).toBe(true);
  });

  it("flags simple ascending runs when variety is otherwise normal", () => {
    expect(hasNearZeroEntropy("abcdefgh")).toBe(true);
  });

  it("awards a single point when length and variety bonuses are not met", () => {
    expect(strengthPoints("aabbccddeeff")).toBe(1);
  });

  it("adds points for length and variety tiers", () => {
    expect(strengthPoints(PASSWORD_STRENGTH_GOOD)).toBe(3);
    expect(strengthPoints(PASSWORD_STRENGTH_STRONG)).toBe(4);
    expect(scorePasswordStrength(PASSWORD_STRENGTH_STRONG).score).toBe(4);
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
    // 12 identical chars: near-zero entropy is the biggest problem, named first
    // (padding a repeated character with length would not help).
    expect(passwordStrengthTip(PASSWORD_STRENGTH_WEAK, PASSWORD_MIN_LENGTH)).toBe(
      "Avoid repeated or sequential characters for a stronger score.",
    );
  });

  it("moves on to the next missing ingredient once entropy and length are satisfied", () => {
    // 13 chars, good variety, below the 16-char tier.
    expect(passwordStrengthTip(PASSWORD_STRENGTH_FAIR, PASSWORD_MIN_LENGTH)).toBe(
      "Add 16+ characters for a stronger score.",
    );
    // 16 chars, good variety, below the 20-char tier.
    expect(passwordStrengthTip(PASSWORD_STRENGTH_GOOD, PASSWORD_MIN_LENGTH)).toBe(
      "Add 20+ characters for a stronger score.",
    );
    // 20 chars (both length tiers met) but low variety.
    expect(passwordStrengthTip("aabbccddeeffgghhiijj", PASSWORD_MIN_LENGTH)).toBe(
      "Add more variety of characters for a stronger score.",
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
