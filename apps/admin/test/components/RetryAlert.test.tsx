// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RetryAlert } from "../../src/components/RetryAlert.js";

afterEach(cleanup);

const noop = () => Promise.resolve();

describe("RetryAlert", () => {
  it("is an alert with the card's own class that fades in, and a Retry that calls back", () => {
    const onRetry = vi.fn(noop);
    render(<RetryAlert message="Could not load users." retrying={false} onRetry={onRetry} className="x-status" />);
    const alert = screen.getByRole("alert");
    expect(alert.className).toBe("x-status at-fade-in");
    expect(alert.textContent).toContain("Could not load users.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("keeps the Retry focusable and ignores a click while it is busy", () => {
    const onRetry = vi.fn(noop);
    render(<RetryAlert message="Could not load users." retrying onRetry={onRetry} className="x-status" />);
    const retry = screen.getByRole("button", { name: "Retry" });
    expect(retry.getAttribute("aria-busy")).toBe("true");
    expect(retry.hasAttribute("disabled")).toBe(false);
    retry.focus();
    fireEvent.click(retry);
    expect(onRetry).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(retry);
  });

  it("mounts the message afresh when a retry ends with the failure still there, and never the button or the alert", () => {
    const props = { message: "Could not load users.", onRetry: noop, className: "x-status" };
    const { rerender } = render(<RetryAlert {...props} retrying={false} />);
    const retry = screen.getByRole("button", { name: "Retry" });
    const alert = screen.getByRole("alert");
    const before = screen.getByText("Could not load users.");

    rerender(<RetryAlert {...props} retrying />);
    expect(screen.getByText("Could not load users.")).toBe(before);

    rerender(<RetryAlert {...props} retrying={false} />);
    expect(screen.getByText("Could not load users.")).not.toBe(before);
    expect(screen.getByRole("button", { name: "Retry" })).toBe(retry);
    // The alert that fades in stays through the retry, so the fade plays once.
    expect(screen.getByRole("alert")).toBe(alert);
  });

  it("hands the focus to the card that holds the list, which stays, when the retry works", async () => {
    const props = { message: "Could not load users.", onRetry: noop, className: "x-status" };
    const card = (children: React.ReactNode) => (
      <div role="tabpanel">
        <div className="at-card">{children}</div>
      </div>
    );
    const { rerender } = render(card(<RetryAlert {...props} retrying={false} />));
    screen.getByRole("button", { name: "Retry" }).focus();

    rerender(card(<p>Loaded</p>));
    await Promise.resolve();
    expect(document.activeElement).toBe(document.querySelector(".at-card"));
  });

  it("hands the focus to the landmark it is given when the alert is not in a card", async () => {
    const props = { message: "Could not load users.", onRetry: noop, className: "x-status" };
    const region = (children: React.ReactNode) => (
      <section className="stays" aria-label="Users">
        {children}
      </section>
    );
    const { rerender } = render(region(<RetryAlert {...props} retrying={false} landmark=".stays" />));
    screen.getByRole("button", { name: "Retry" }).focus();

    rerender(region(<p>Loaded</p>));
    await Promise.resolve();
    expect(document.activeElement).toBe(document.querySelector(".stays"));
  });
});
