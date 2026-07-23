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
});
