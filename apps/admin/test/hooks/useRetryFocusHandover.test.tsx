// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { useRetryFocusHandover } from "../../src/hooks/useRetryFocusHandover.js";

function ErrorBlock({ withRetry }: Readonly<{ withRetry: boolean }>) {
  return <div role="tabpanel" aria-label="Logs">{withRetry ? <Retry /> : <p>Content</p>}</div>;
}

function Retry() {
  const ref = useRef<HTMLButtonElement>(null);
  useRetryFocusHandover(ref);
  return (
    <button ref={ref} type="button">
      Retry
    </button>
  );
}

afterEach(cleanup);

describe("useRetryFocusHandover", () => {
  it("moves the focus the Retry held to the tab panel when the Retry goes away", async () => {
    const { getByRole, rerender } = render(<ErrorBlock withRetry />);
    getByRole("button", { name: "Retry" }).focus();
    rerender(<ErrorBlock withRetry={false} />);
    await act(async () => {});
    const panel = getByRole("tabpanel");
    expect(document.activeElement).toBe(panel);
    expect(panel.getAttribute("tabindex")).toBe("-1");
  });

  it("leaves the focus alone when it was never on the Retry", async () => {
    const { getByRole, rerender } = render(
      <>
        <button type="button">Elsewhere</button>
        <ErrorBlock withRetry />
      </>,
    );
    getByRole("button", { name: "Elsewhere" }).focus();
    rerender(
      <>
        <button type="button">Elsewhere</button>
        <ErrorBlock withRetry={false} />
      </>,
    );
    await act(async () => {});
    expect(document.activeElement).toBe(getByRole("button", { name: "Elsewhere" }));
  });

  it("does nothing when the Retry is not inside a tab panel", async () => {
    function Bare({ withRetry }: Readonly<{ withRetry: boolean }>) {
      return <div>{withRetry ? <Retry /> : <p>Content</p>}</div>;
    }
    const { getByRole, rerender } = render(<Bare withRetry />);
    getByRole("button", { name: "Retry" }).focus();
    rerender(<Bare withRetry={false} />);
    await act(async () => {});
    expect(document.activeElement).toBe(document.body);
  });
});
