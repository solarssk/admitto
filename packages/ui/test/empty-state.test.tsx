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

    it("has the same parts as the default in the same order, and a class of its own on top of the default's", () => {
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
      expect(alert.className).toBe("at-empty-state at-empty-state--error extra");
      expect(Array.from(alert.children).map((c) => c.className)).toEqual([
        "at-empty-state__icon",
        "at-empty-state__title",
        "at-empty-state__desc",
        "at-empty-state__action",
      ]);
      expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    });

    it("draws the glyph an error has everywhere else (circle-x, as Notice and Toast do) when it is given no icon, hidden from assistive tech", () => {
      render(<EmptyState variant="error" title="Could not load" />);
      const holder = screen.getByRole("alert").querySelector(".at-empty-state__icon");
      expect(holder?.getAttribute("aria-hidden")).toBe("true");
      expect(holder?.querySelector("i")?.className).toBe("ti ti-circle-x");
    });

    it("lets an icon that is given win over the standard one, and `null` mean none", () => {
      const { rerender } = render(<EmptyState variant="error" title="Could not load" icon={<i data-testid="mine" className="ti ti-wifi-off" />} />);
      expect(screen.getByTestId("mine")).toBeTruthy();
      expect(screen.getByRole("alert").querySelector(".ti-circle-x")).toBeNull();

      rerender(<EmptyState variant="error" title="Could not load" icon={null} />);
      expect(screen.getByRole("alert").querySelector(".at-empty-state__icon")).toBeNull();
    });

    it("is the only variant with an icon of its own: a plain empty list has none unless it is given one", () => {
      render(<EmptyState title="Nothing yet" />);
      expect(screen.getByRole("status").querySelector(".at-empty-state__icon")).toBeNull();
      expect(screen.getByRole("status").className).toBe("at-empty-state");
    });

    it("keeps the action button focusable inside the alert", () => {
      render(<EmptyState variant="error" title="Could not load" action={<button type="button">Retry</button>} />);
      const retry = screen.getByRole("button", { name: "Retry" });
      retry.focus();
      expect(document.activeElement).toBe(retry);
    });
  });
});
