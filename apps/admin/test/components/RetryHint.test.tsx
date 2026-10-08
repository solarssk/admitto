// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RetryHint } from "../../src/components/RetryHint.js";

afterEach(cleanup);

describe("RetryHint", () => {
  it("is an alert with the message and a Retry that calls back", () => {
    const onRetry = vi.fn();
    render(<RetryHint message="Could not load types." busy={false} onRetry={onRetry} />);
    expect(screen.getByRole("alert").textContent).toContain("Could not load types.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("gives its Retry a name of its own when asked, starting with Retry", () => {
    render(<RetryHint message="Could not load events." busy={false} onRetry={vi.fn()} retryLabel="Retry loading events" />);
    expect(screen.getByRole("button", { name: "Retry loading events" })).toBeTruthy();
  });

  it("has no button when it was given nothing to call", () => {
    render(<RetryHint message="Could not load types." busy={false} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("keeps the Retry focusable and ignores a click while busy", () => {
    const onRetry = vi.fn();
    render(<RetryHint message="Could not load types." busy onRetry={onRetry} />);
    const retry = screen.getByRole("button", { name: "Retry" });
    expect(retry.getAttribute("aria-busy")).toBe("true");
    expect((retry as HTMLButtonElement).disabled).toBe(false);
    retry.focus();
    fireEvent.click(retry);
    expect(onRetry).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(retry);
  });

  it("mounts the message afresh when a retry ends with the error still there, and never the button", () => {
    const { rerender } = render(<RetryHint message="Could not load types." busy={false} onRetry={() => {}} />);
    const retry = screen.getByRole("button", { name: "Retry" });
    const before = screen.getByText("Could not load types.");

    rerender(<RetryHint message="Could not load types." busy onRetry={() => {}} />);
    // Busy: the same nodes, nothing is announced yet.
    expect(screen.getByText("Could not load types.")).toBe(before);

    rerender(<RetryHint message="Could not load types." busy={false} onRetry={() => {}} />);
    expect(screen.getByText("Could not load types.")).not.toBe(before);
    expect(screen.getByRole("button", { name: "Retry" })).toBe(retry);
  });

  it("hands the focus of a Retry that goes away to the landmark it is given, only when the focus was on it", async () => {
    const page = (hint: boolean) => (
      <section className="stays" aria-label="Step">
        {hint ? <RetryHint message="Could not load types." busy={false} onRetry={() => {}} landmark=".stays" /> : <p>Loaded</p>}
      </section>
    );
    const { rerender } = render(page(true));
    screen.getByRole("button", { name: "Retry" }).focus();

    rerender(page(false));
    await Promise.resolve();
    expect(document.activeElement).toBe(screen.getByRole("region", { name: "Step" }));

    // Focus that was somewhere else is left alone.
    rerender(page(true));
    const other = document.createElement("button");
    document.body.appendChild(other);
    other.focus();
    rerender(page(false));
    await Promise.resolve();
    expect(document.activeElement).toBe(other);
    other.remove();
  });

  it("hands the focus nowhere when it has no landmark: a hint in a dialog leaves that to the dialog", async () => {
    const page = (hint: boolean) => (
      <section role="tabpanel" aria-label="Panel">
        {hint ? <RetryHint message="Could not load types." busy={false} onRetry={() => {}} /> : <p>Loaded</p>}
      </section>
    );
    const { rerender } = render(page(true));
    screen.getByRole("button", { name: "Retry" }).focus();

    rerender(page(false));
    await Promise.resolve();
    expect(document.activeElement).toBe(document.body);
  });
});
