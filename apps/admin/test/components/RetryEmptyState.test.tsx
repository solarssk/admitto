// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RetryEmptyState } from "../../src/components/RetryEmptyState.js";

afterEach(cleanup);

function tabPanel(children: React.ReactNode) {
  return <div role="tabpanel">{children}</div>;
}

describe("RetryEmptyState", () => {
  it("says what failed and why, as an alert, with a Retry that calls back", () => {
    const onRetry = vi.fn(() => Promise.resolve());
    render(<RetryEmptyState title="Could not load providers" message="Network down." retrying={false} onRetry={onRetry} />);
    expect(screen.getByText("Could not load providers")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Network down.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("draws the standard failure glyph over the title, hidden from assistive tech, so a failure is not taken for an empty list", () => {
    render(<RetryEmptyState title="Could not load providers" message="Network down." retrying={false} onRetry={() => Promise.resolve()} />);
    const alert = screen.getByRole("alert");
    expect(alert.className).toContain("at-empty-state--error");
    const holder = alert.querySelector(".at-empty-state__icon");
    expect(holder?.getAttribute("aria-hidden")).toBe("true");
    expect(holder?.querySelector("i.ti-circle-x")).not.toBeNull();
    // Over the title, which is the first thing the alert says.
    expect(holder?.nextElementSibling?.className).toBe("at-empty-state__title");
  });

  it("takes a class for its root, which stays through a Retry: the fade-in of a list's failure plays once", () => {
    const props = { title: "Could not load", message: "Network down.", onRetry: () => Promise.resolve() };
    const { rerender } = render(<RetryEmptyState {...props} retrying={false} className="at-fade-in" />);
    const alert = screen.getByRole("alert");
    expect(alert.className).toBe("at-empty-state at-empty-state--error at-fade-in");
    rerender(<RetryEmptyState {...props} retrying className="at-fade-in" />);
    expect(screen.getByRole("alert")).toBe(alert);
  });

  it("gives its Retry a name of its own when asked, so two of them on a screen can be told apart", () => {
    render(
      <>
        <RetryEmptyState title="Could not load providers" message="Down." retrying={false} onRetry={() => Promise.resolve()} retryLabel="Retry loading providers" />
        <RetryEmptyState title="Could not load Cloudflare Access" message="Down." retrying={false} onRetry={() => Promise.resolve()} retryLabel="Retry loading Cloudflare Access" />
      </>,
    );
    expect(screen.getByRole("button", { name: "Retry loading providers" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry loading Cloudflare Access" })).toBeTruthy();
  });

  it("keeps the Retry focusable and ignores a click while it is busy", () => {
    const onRetry = vi.fn(() => Promise.resolve());
    render(<RetryEmptyState title="Could not load" message="Network down." retrying onRetry={onRetry} />);
    const retry = screen.getByRole("button", { name: "Retry" });
    expect(retry.getAttribute("aria-busy")).toBe("true");
    expect(retry.hasAttribute("disabled")).toBe(false);
    retry.focus();
    fireEvent.click(retry);
    expect(onRetry).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(retry);
  });

  it("mounts the message afresh when a retry ends with the failure still there, and never the button", () => {
    const props = { title: "Could not load", message: "Network down.", onRetry: () => Promise.resolve() };
    const { rerender } = render(<RetryEmptyState {...props} retrying={false} />);
    const retry = screen.getByRole("button", { name: "Retry" });
    const before = screen.getByText("Network down.");

    rerender(<RetryEmptyState {...props} retrying />);
    expect(screen.getByText("Network down.")).toBe(before);

    rerender(<RetryEmptyState {...props} retrying={false} />);
    expect(screen.getByText("Network down.")).not.toBe(before);
    expect(screen.getByRole("button", { name: "Retry" })).toBe(retry);
  });

  it("hands the focus to the card that holds the list, which stays, rather than to the top of the tab panel", async () => {
    const props = { title: "Could not load", message: "Network down.", onRetry: () => Promise.resolve() };
    const card = (children: React.ReactNode) => (
      <div role="tabpanel">
        <div className="at-card">{children}</div>
      </div>
    );
    const { rerender } = render(card(<RetryEmptyState {...props} retrying={false} />));
    screen.getByRole("button", { name: "Retry" }).focus();

    rerender(card(<p>Loaded</p>));
    await Promise.resolve();
    expect(document.activeElement).toBe(document.querySelector(".at-card"));
  });

  it("hands the focus to the landmark it is given when the error is not in a card", async () => {
    const props = { title: "Could not load", message: "Network down.", onRetry: () => Promise.resolve() };
    const region = (children: React.ReactNode) => (
      <section className="stays" aria-label="Report">
        {children}
      </section>
    );
    const { rerender } = render(region(<RetryEmptyState {...props} retrying={false} landmark=".stays" />));
    screen.getByRole("button", { name: "Retry" }).focus();

    rerender(region(<p>Loaded</p>));
    await Promise.resolve();
    expect(document.activeElement).toBe(document.querySelector(".stays"));
  });

  it("hands the focus of a Retry that goes away to the tab panel it sat in", async () => {
    const props = { title: "Could not load", message: "Network down.", onRetry: () => Promise.resolve() };
    const { rerender } = render(tabPanel(<RetryEmptyState {...props} retrying={false} />));
    screen.getByRole("button", { name: "Retry" }).focus();

    rerender(tabPanel(<p>Loaded</p>));
    await Promise.resolve();
    expect(document.activeElement).toBe(screen.getByRole("tabpanel"));
  });
});
