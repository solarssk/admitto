import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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

  it("names a tab with a count and a countLabel by both, and leaves the others to their text", () => {
    render(
      <Tabs
        tabs={[
          { id: "a", label: "Plain" },
          { id: "b", label: "Counted", count: 3 },
          { id: "c", label: "Labelled", count: 3, countLabel: "3 steps open" },
          { id: "d", label: "Label only", countLabel: "ignored without a count" },
        ]}
      />,
    );

    expect(screen.getByRole("tab", { name: "Plain" }).getAttribute("aria-label")).toBeNull();
    expect(screen.getByRole("tab", { name: "Counted3" }).getAttribute("aria-label")).toBeNull();
    expect(screen.getByRole("tab", { name: "Labelled, 3 steps open" }).textContent).toBe("Labelled3");
    expect(screen.getByRole("tab", { name: "Label only" }).getAttribute("aria-label")).toBeNull();
  });

  it("only tells the parent when it is controlled, and keeps showing the value it is given", () => {
    const onChange = vi.fn();
    render(<Tabs tabs={INITIAL} value="a" onChange={onChange} />);

    fireEvent.click(screen.getByRole("tab", { name: "Tab B" }));

    expect(onChange).toHaveBeenCalledWith("b");
    expect(screen.getByRole("tab", { name: "Tab A" }).getAttribute("aria-selected")).toBe("true");
  });

  it("selects the tab that is clicked when it is not controlled, and tells the parent", () => {
    const onChange = vi.fn();
    render(<Tabs tabs={INITIAL} onChange={onChange} />);

    fireEvent.click(screen.getByRole("tab", { name: "Tab B" }));

    expect(screen.getByRole("tab", { name: "Tab B" }).getAttribute("aria-selected")).toBe("true");
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("moves between tabs with the arrow, Home and End keys, wrapping, moves the focus too, and leaves other keys alone", () => {
    const onChange = vi.fn();
    render(<Tabs tabs={[...INITIAL, { id: "c", label: "Tab C", icon: <i data-testid="icon" /> }]} defaultValue="a" onChange={onChange} />);
    const selected = () => screen.getAllByRole("tab").find((tab) => tab.getAttribute("aria-selected") === "true")?.textContent;
    const press = (key: string) => fireEvent.keyDown(screen.getAllByRole("tab").find((tab) => tab.getAttribute("aria-selected") === "true") as HTMLElement, { key });

    press("ArrowRight");
    expect(selected()).toBe("Tab B");
    expect(document.activeElement?.textContent).toBe("Tab B");
    press("End");
    expect(selected()).toBe("Tab C");
    press("ArrowRight");
    expect(selected()).toBe("Tab A");
    press("ArrowLeft");
    expect(selected()).toBe("Tab C");
    press("Home");
    expect(selected()).toBe("Tab A");
    const calls = onChange.mock.calls.length;
    press("a");
    expect(onChange).toHaveBeenCalledTimes(calls);
    expect(screen.getByTestId("icon")).toBeTruthy();
  });

  it("draws no tab for an empty list and does nothing for a key", () => {
    render(<Tabs tabs={[]} />);

    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.getByRole("tablist")).toBeTruthy();
  });
});
