import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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
    const { rerender } = render(<PasswordStrengthMeter password="abcdefghijkl" />);
    expect(screen.getByText("Weak")).toBeTruthy();

    rerender(<PasswordStrengthMeter password="Abcdefghijkl1" />);
    expect(screen.getByText("Fair")).toBeTruthy();

    rerender(<PasswordStrengthMeter password="Abcdefghijkl12!" />);
    expect(screen.getByText("Good")).toBeTruthy();

    rerender(<PasswordStrengthMeter password="Abcdefghijkl12!@#" />);
    expect(screen.getByText("Strong")).toBeTruthy();
  });
});
