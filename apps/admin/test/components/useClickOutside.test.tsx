// @vitest-environment jsdom
import { useRef } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useClickOutside, type OutsideInteraction } from "../../src/components/useClickOutside.js";

function Harness({ open, onOutside }: { open: boolean; onOutside: (reason: OutsideInteraction) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, open, onOutside);
  return (
    <div>
      <div ref={ref} data-testid="inside">
        <button type="button" data-testid="inside-button">
          inside
        </button>
      </div>
      <button type="button" data-testid="outside">
        outside
      </button>
    </div>
  );
}

afterEach(() => cleanup());

describe("useClickOutside", () => {
  it("calls onOutside with reason 'pointer' on a pointerdown outside the container while open", () => {
    const onOutside = vi.fn();
    render(<Harness open onOutside={onOutside} />);
    fireEvent.pointerDown(screen.getByTestId("outside"));
    expect(onOutside).toHaveBeenCalledTimes(1);
    expect(onOutside).toHaveBeenCalledWith("pointer");
  });

  it("does not call onOutside on a pointerdown inside the container", () => {
    const onOutside = vi.fn();
    render(<Harness open onOutside={onOutside} />);
    fireEvent.pointerDown(screen.getByTestId("inside"));
    expect(onOutside).not.toHaveBeenCalled();
  });

  it("does nothing while closed", () => {
    const onOutside = vi.fn();
    render(<Harness open={false} onOutside={onOutside} />);
    fireEvent.pointerDown(screen.getByTestId("outside"));
    expect(onOutside).not.toHaveBeenCalled();
  });

  it("calls onOutside with reason 'focus' when focus moves outside the container (e.g. Tab to another control, with no pointerdown)", () => {
    const onOutside = vi.fn();
    render(<Harness open onOutside={onOutside} />);
    fireEvent.focusIn(screen.getByTestId("outside"));
    expect(onOutside).toHaveBeenCalledTimes(1);
    expect(onOutside).toHaveBeenCalledWith("focus");
  });

  it("does not call onOutside when focus moves within the container", () => {
    const onOutside = vi.fn();
    render(<Harness open onOutside={onOutside} />);
    fireEvent.focusIn(screen.getByTestId("inside-button"));
    expect(onOutside).not.toHaveBeenCalled();
  });

  it("does not react to focus changes while closed", () => {
    const onOutside = vi.fn();
    render(<Harness open={false} onOutside={onOutside} />);
    fireEvent.focusIn(screen.getByTestId("outside"));
    expect(onOutside).not.toHaveBeenCalled();
  });
});
