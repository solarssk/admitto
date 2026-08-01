import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  PASSWORD_STRENGTH_FAIR,
  PASSWORD_STRENGTH_GOOD,
  PASSWORD_STRENGTH_STRONG,
  PASSWORD_STRENGTH_WEAK,
} from "@admitto/auth/password-strength-fixtures";
import { PasswordStrengthMeter } from "../src/components/PasswordStrengthMeter.js";

describe("PasswordStrengthMeter", () => {
  it("renders nothing for empty password", () => {
    const { container } = render(<PasswordStrengthMeter password="" />);
    expect(container.firstChild).toBeNull();
  });

  it("shows Too short below minimum length", () => {
    render(<PasswordStrengthMeter password="short" />);
    expect(screen.getByRole("status").getAttribute("aria-label")).toBe(
      "Password strength: Too short",
    );
    expect(screen.getByText("Too short")).toBeTruthy();
  });

  it("shows stronger labels as complexity increases", () => {
    const { rerender } = render(<PasswordStrengthMeter password={PASSWORD_STRENGTH_WEAK} />);
    expect(screen.getByText("Weak")).toBeTruthy();

    rerender(<PasswordStrengthMeter password={PASSWORD_STRENGTH_FAIR} />);
    expect(screen.getByText("Fair")).toBeTruthy();

    rerender(<PasswordStrengthMeter password={PASSWORD_STRENGTH_GOOD} />);
    expect(screen.getByText("Good")).toBeTruthy();

    rerender(<PasswordStrengthMeter password={PASSWORD_STRENGTH_STRONG} />);
    expect(screen.getByText("Strong")).toBeTruthy();
  });

  it("includes the next-step tip in aria-label for screen readers", () => {
    render(<PasswordStrengthMeter password={PASSWORD_STRENGTH_WEAK} />);
    expect(screen.getByRole("status").getAttribute("aria-label")).toBe(
      "Password strength: Weak. Avoid repeated or sequential characters for a stronger score.",
    );
  });
});
