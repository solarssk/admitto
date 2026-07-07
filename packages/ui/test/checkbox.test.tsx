import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Checkbox } from "../src/components/Checkbox.js";

describe("Checkbox", () => {
  it("renders the visual box with the check icon (not just a hidden input)", () => {
    const { container } = render(<Checkbox label="Superadmin" />);
    const box = container.querySelector(".at-check__box");
    expect(box).toBeTruthy();
    expect(box!.querySelector("svg polyline")).toBeTruthy();
    expect(box!.getAttribute("aria-hidden")).toBe("true");
  });

  it("renders the label and toggles via click", () => {
    const onChange = vi.fn();
    render(<Checkbox label="Operator" checked={false} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("Operator"));
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("derives a stable id from the label", () => {
    render(<Checkbox label="Require 2FA" />);
    expect(screen.getByLabelText("Require 2FA").id).toBe("cb-require-2fa");
  });

  it("renders without a label", () => {
    const { container } = render(<Checkbox aria-label="bare" />);
    expect(container.querySelector(".at-check__label")).toBeNull();
    expect(container.querySelector(".at-check__box")).toBeTruthy();
  });
});
