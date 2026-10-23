import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Tabs, type TabItem } from "../src/components/Tabs.js";

const INITIAL: TabItem[] = [
  { id: "a", label: "Tab A" },
  { id: "b", label: "Tab B" },
];

describe("Tabs", () => {
  it("reconciles active tab when tabs prop changes after mount", () => {
    const { rerender } = render(<Tabs tabs={INITIAL} defaultValue="b" />);

    expect(screen.getByRole("tab", { name: "Tab B" }).getAttribute("aria-selected")).toBe("true");

    rerender(<Tabs tabs={[{ id: "c", label: "Tab C" }]} defaultValue="b" />);

    expect(screen.getByRole("tab", { name: "Tab C" }).getAttribute("aria-selected")).toBe("true");

    rerender(
      <Tabs
        tabs={[
          { id: "x", label: "Tab X" },
          { id: "y", label: "Tab Y" },
        ]}
        defaultValue="b"
      />,
    );

    expect(screen.getByRole("tab", { name: "Tab X" }).getAttribute("aria-selected")).toBe("true");
  });

  it("uses the controlled value even when the internal fallback differs", () => {
    render(<Tabs tabs={INITIAL} defaultValue="a" value="b" />);

    expect(screen.getByRole("tab", { name: "Tab B" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Tab A" }).getAttribute("aria-selected")).toBe("false");
  });

  it("handles an empty tab list without selecting a fallback", () => {
    render(<Tabs tabs={[]} />);

    expect(screen.queryByRole("tab")).toBeNull();
  });

  it("shows the count after the label, and none for a tab that has none", () => {
    render(
      <Tabs
        tabs={[
          { id: "a", label: "Tab A", count: 3 },
          { id: "b", label: "Tab B", count: 0 },
          { id: "c", label: "Tab C" },
        ]}
        defaultValue="a"
      />,
    );

    expect(screen.getByRole("tab", { name: "Tab A3" }).textContent).toBe("Tab A3");
    expect(screen.getByRole("tab", { name: "Tab B0" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Tab C" }).textContent).toBe("Tab C");
  });

  it("draws the count in the secondary text colour: the muted one is 4.3:1 on the page background, under the 4.5:1 that text of its size needs", () => {
    render(<Tabs tabs={[{ id: "a", label: "Tab A", count: 3 }]} defaultValue="a" />);

    const count = screen.getByText("3");

    expect(count.getAttribute("style")).toContain("var(--text-secondary)");
    expect(count.getAttribute("style")).not.toContain("var(--text-muted)");
  });
});
