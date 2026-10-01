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
    expect(screen.getByText("Empty")).toBeTruthy();
  });

  it("is a status, not an alert, by default and with variant=default", () => {
    const { rerender } = render(<EmptyState title="Empty" />);
    expect(screen.queryByRole("alert")).toBeNull();
    rerender(<EmptyState title="Empty" variant="default" />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status")).toBeTruthy();
  });

  describe("variant=error", () => {
    it("is an alert (announced at once), not a status", () => {
      render(<EmptyState variant="error" title="Could not load attendees" description="Try again." />);
      const alert = screen.getByRole("alert");
      expect(alert.textContent).toContain("Could not load attendees");
      expect(alert.textContent).toContain("Try again.");
      expect(screen.queryByRole("status")).toBeNull();
    });

    it("looks the same as the default: same class, icon, title, description and action in the same order", () => {
      render(
        <EmptyState
          variant="error"
          className="extra"
          icon={<i data-testid="ico" />}
          title="Could not load"
          description="Why."
          action={<button type="button">Retry</button>}
        />,
      );
      const alert = screen.getByRole("alert");
      expect(alert.className).toBe("at-empty-state extra");
      expect(Array.from(alert.children).map((c) => c.className)).toEqual([
        "at-empty-state__icon",
        "at-empty-state__title",
        "at-empty-state__desc",
        "at-empty-state__action",
      ]);
      expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    });

    it("keeps the action button focusable inside the alert", () => {
      render(<EmptyState variant="error" title="Could not load" action={<button type="button">Retry</button>} />);
      const retry = screen.getByRole("button", { name: "Retry" });
      retry.focus();
      expect(document.activeElement).toBe(retry);
    });
  });
});
