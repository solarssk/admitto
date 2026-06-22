import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EmptyState } from "../src/components/EmptyState.js";

describe("EmptyState", () => {
  it("renders title", () => {
    render(<EmptyState title="No sessions found" />);
    expect(screen.getByText("No sessions found")).toBeTruthy();
  });

  it("renders optional icon, description, and action", () => {
    render(
      <EmptyState
        icon="📭"
        title="Empty"
        description="Nothing here yet."
        action={<button type="button">Clear filters</button>}
      />,
    );
    expect(screen.getByText("📭")).toBeTruthy();
    expect(screen.getByText("Nothing here yet.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeTruthy();
  });

  it("has role=status on root element", () => {
    render(<EmptyState title="Empty" />);
    expect(screen.getByRole("status").className).toContain("at-empty-state");
  });
});
