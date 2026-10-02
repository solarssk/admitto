// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PollDegradedNotice } from "../../src/settings/SystemLogsPanel.js";

afterEach(cleanup);

describe("PollDegradedNotice", () => {
  it("is an alert with a Retry now that runs the reload, busy while it works", () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      <PollDegradedNotice className="x" busy={false} onRetry={onRetry}>
        Live updates stopped.
      </PollDegradedNotice>,
    );
    expect(screen.getByRole("alert").textContent).toContain("Live updates stopped.");
    fireEvent.click(screen.getByRole("button", { name: "Retry now" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    rerender(
      <PollDegradedNotice className="x" busy onRetry={onRetry}>
        Live updates stopped.
      </PollDegradedNotice>,
    );
    const busy = screen.getByRole("button", { name: "Retry now" });
    expect(busy.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(busy);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("moves the focus its Retry now held to the tab panel when the warning goes away", async () => {
    const { rerender } = render(
      <div role="tabpanel" aria-label="Logs">
        <PollDegradedNotice className="x" busy={false} onRetry={() => {}}>
          Live updates stopped.
        </PollDegradedNotice>
      </div>,
    );
    screen.getByRole("button", { name: "Retry now" }).focus();
    rerender(<div role="tabpanel" aria-label="Logs" />);
    await act(async () => {});
    expect(document.activeElement).toBe(screen.getByRole("tabpanel"));
  });
});
