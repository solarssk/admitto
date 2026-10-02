// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PanelLoadError } from "../../src/settings/PanelLoadError.js";
import { SettingsPanelSkeleton } from "../../src/settings/SettingsPanelSkeleton.js";

afterEach(cleanup);

const cards = [
  { id: "one", title: "Instance URL", intro: true, fields: 1 },
  { id: "two", title: "Support contact", fields: 2, columns: 2 as const, controlHeight: 64 },
  { id: "three", title: "Sessions", rows: 3, rowHeight: 90 },
];

describe("SettingsPanelSkeleton", () => {
  it("is a status region named after what loads, with the real card titles", () => {
    render(<SettingsPanelSkeleton label="Loading organisation settings" held={false} slow={false} cards={cards} />);
    const region = screen.getByLabelText("Loading organisation settings");
    expect(region.tagName).toBe("OUTPUT");
    expect(screen.getByText("Instance URL")).toBeTruthy();
    expect(screen.getByText("Support contact")).toBeTruthy();
    expect(screen.getByText("Sessions")).toBeTruthy();
  });

  it("holds its room invisible until it is drawn", () => {
    const { rerender } = render(<SettingsPanelSkeleton label="Loading" held slow={false} cards={cards} />);
    expect(screen.getByLabelText("Loading").className).toContain("at-loading-hold");
    rerender(<SettingsPanelSkeleton label="Loading" held={false} slow={false} cards={cards} />);
    expect(screen.getByLabelText("Loading").className).not.toContain("at-loading-hold");
  });

  it("draws the shapes: intro, fields (in two columns when asked), rows, and the footer", () => {
    const { container } = render(<SettingsPanelSkeleton label="Loading" held={false} slow={false} cards={cards} />);
    expect(container.querySelectorAll(".settings-skeleton__field")).toHaveLength(3);
    expect(container.querySelector(".settings-skeleton__fields.mail-transport-section")).not.toBeNull();
    // intro (1) + two fields' labels and controls (3 x 2) + rows (3) + footer buttons (2)
    expect(container.querySelectorAll(".at-skeleton")).toHaveLength(1 + 6 + 3 + 2);
    expect(container.querySelector(".settings-skeleton__footer")).not.toBeNull();
  });

  it("leaves out the footer for a panel without one", () => {
    const { container } = render(<SettingsPanelSkeleton label="Loading" held={false} slow={false} cards={cards} footer={false} />);
    expect(container.querySelector(".settings-skeleton__footer")).toBeNull();
  });

  it("says it is taking longer than usual only when it is slow", () => {
    const { rerender } = render(<SettingsPanelSkeleton label="Loading" held={false} slow={false} cards={cards} />);
    expect(screen.queryByText(/Taking longer than usual/)).toBeNull();
    rerender(<SettingsPanelSkeleton label="Loading" held={false} slow cards={cards} />);
    expect(screen.getByText(/Taking longer than usual/)).toBeTruthy();
  });
});

describe("PanelLoadError", () => {
  it("is a card with what failed and why as an alert, and a Retry that loads it again", () => {
    const onRetry = vi.fn(async () => {});
    render(<PanelLoadError cardTitle="Instance URL" title="Could not load organisation settings" message="The server did not answer in time." retrying={false} onRetry={onRetry} />);
    expect(screen.getByText("Instance URL")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Could not load organisation settings");
    expect(screen.getByRole("alert").textContent).toContain("The server did not answer in time.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("keeps the Retry on screen and focusable while it works, and swallows a second click", () => {
    const onRetry = vi.fn(async () => {});
    render(<PanelLoadError cardTitle="Instance URL" title="Could not load" message="Why." retrying onRetry={onRetry} />);
    const retry = screen.getByRole("button", { name: "Retry" });
    expect(retry.getAttribute("aria-busy")).toBe("true");
    expect((retry as HTMLButtonElement).disabled).toBe(false);
    retry.focus();
    fireEvent.click(retry);
    expect(onRetry).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(retry);
  });

  it("says a failure that repeats with the same text again: the message is mounted afresh when the retry ends", () => {
    const { rerender } = render(<PanelLoadError cardTitle="C" title="Could not load" message="Why." retrying onRetry={async () => {}} />);
    const before = screen.getByText("Could not load");
    rerender(<PanelLoadError cardTitle="C" title="Could not load" message="Why." retrying={false} onRetry={async () => {}} />);
    expect(screen.getByText("Could not load")).not.toBe(before);
  });
});
