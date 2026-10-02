// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("hides the cards from assistive tech, so the region does not read their titles again when the slow note joins it", () => {
    const { container } = render(<SettingsPanelSkeleton label="Loading" held={false} slow cards={cards} />);
    expect(container.querySelectorAll('.at-card[aria-hidden="true"]')).toHaveLength(cards.length);
    // What is exposed in the region is its name and the note.
    expect(screen.getByText(/Taking longer than usual/).closest('[aria-hidden="true"]')).toBeNull();
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

  it("draws an intro of one line as one bar and a longer one as that many lines, the last one shorter", () => {
    const { container } = render(
      <SettingsPanelSkeleton
        label="Loading"
        held={false}
        slow={false}
        cards={[{ id: "one", title: "One", intro: true }, { id: "three", title: "Three", intro: 3 }]}
        footer={false}
      />,
    );
    const cardBodies = container.querySelectorAll(".settings-card-stack");
    expect(cardBodies[0]!.querySelectorAll(".at-skeleton")).toHaveLength(1);
    expect(cardBodies[0]!.querySelector(".settings-skeleton__intro")).toBeNull();
    const lines = cardBodies[1]!.querySelectorAll(".settings-skeleton__intro .at-skeleton");
    expect(lines).toHaveLength(3);
    expect((lines[0] as HTMLElement).style.width).toBe("100%");
    expect((lines[2] as HTMLElement).style.width).toBe("62%");
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

  describe("keyboard focus when the retry worked", () => {
    // A settings panel in its tab panel: the failed card, then (once the retry has worked) the form.
    function Harness({ failed, retrying = false, tabIndex, formAutoFocus = false }: Readonly<{ failed: boolean; retrying?: boolean; tabIndex?: number; formAutoFocus?: boolean }>) {
      return (
        <div>
          <button type="button">Elsewhere</button>
          <div role="tabpanel" aria-label="General" tabIndex={tabIndex}>
            {failed ? (
              <PanelLoadError cardTitle="Instance URL" title="Could not load" message="Why." retrying={retrying} onRetry={async () => {}} />
            ) : (
              <form>
                <input aria-label="Instance URL" autoFocus={formAutoFocus} />
              </form>
            )}
          </div>
        </div>
      );
    }

    it("moves focus from the Retry that has gone to the tab panel, and the next field is a Tab away", async () => {
      const { rerender } = render(<Harness failed />);
      screen.getByRole("button", { name: "Retry" }).focus();
      rerender(<Harness failed={false} />);
      const panel = screen.getByRole("tabpanel", { name: "General" });
      await waitFor(() => expect(document.activeElement).toBe(panel));
      expect(panel.getAttribute("tabindex")).toBe("-1");
      expect(panel.contains(screen.getByLabelText("Instance URL"))).toBe(true);
    });

    it("keeps a tabindex the tab panel already has", async () => {
      const { rerender } = render(<Harness failed tabIndex={0} />);
      screen.getByRole("button", { name: "Retry" }).focus();
      rerender(<Harness failed={false} tabIndex={0} />);
      const panel = screen.getByRole("tabpanel", { name: "General" });
      await waitFor(() => expect(document.activeElement).toBe(panel));
      expect(panel.getAttribute("tabindex")).toBe("0");
    });

    it("leaves focus alone when it is on something else by then", async () => {
      const { rerender } = render(<Harness failed />);
      const elsewhere = screen.getByRole("button", { name: "Elsewhere" });
      elsewhere.focus();
      rerender(<Harness failed={false} />);
      await Promise.resolve();
      expect(document.activeElement).toBe(elsewhere);
      expect(screen.getByRole("tabpanel", { name: "General" }).hasAttribute("tabindex")).toBe(false);
    });

    it("leaves focus alone when the Retry did not have it (a click does not focus a button in Safari)", async () => {
      const { rerender } = render(<Harness failed />);
      expect(document.activeElement).toBe(document.body);
      rerender(<Harness failed={false} />);
      await Promise.resolve();
      expect(document.activeElement).toBe(document.body);
      expect(screen.getByRole("tabpanel", { name: "General" }).hasAttribute("tabindex")).toBe(false);
    });

    it("leaves focus alone when the new content has taken it", async () => {
      const { rerender } = render(<Harness failed />);
      screen.getByRole("button", { name: "Retry" }).focus();
      rerender(<Harness failed={false} formAutoFocus />);
      await Promise.resolve();
      expect(document.activeElement).toBe(screen.getByLabelText("Instance URL"));
      expect(screen.getByRole("tabpanel", { name: "General" }).hasAttribute("tabindex")).toBe(false);
    });

    it("does not move focus while the Retry is still there, busy or failed again", async () => {
      const { rerender } = render(<Harness failed />);
      const retry = screen.getByRole("button", { name: "Retry" });
      retry.focus();
      rerender(<Harness failed retrying />);
      rerender(<Harness failed />);
      await Promise.resolve();
      expect(document.activeElement).toBe(retry);
      expect(screen.getByRole("tabpanel", { name: "General" }).hasAttribute("tabindex")).toBe(false);
    });

    it("has nothing to move focus to outside a tab panel, and does not fail", async () => {
      const { unmount } = render(<PanelLoadError cardTitle="C" title="Could not load" message="Why." retrying={false} onRetry={async () => {}} />);
      screen.getByRole("button", { name: "Retry" }).focus();
      unmount();
      await Promise.resolve();
      expect(document.activeElement).toBe(document.body);
    });
  });
});
