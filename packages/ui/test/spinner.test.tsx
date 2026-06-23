import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Spinner } from "../src/components/Spinner.js";

describe("Spinner", () => {
  it("renders with role=status and default aria-label", () => {
    render(<Spinner />);
    const el = screen.getByRole("status");
    expect(el.getAttribute("aria-label")).toBe("Loading");
  });

  it("applies size modifier class", () => {
    render(<Spinner size="sm" />);
    expect(screen.getByRole("status").className).toContain("at-spinner--sm");
  });
});
