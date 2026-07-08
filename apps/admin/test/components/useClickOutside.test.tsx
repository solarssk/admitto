// @vitest-environment jsdom
import { useRef } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useClickOutside } from "../../src/components/useClickOutside.js";

function Harness({ open, onOutside }: { open: boolean; onOutside: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, open, onOutside);
  return (
    <div>
      <div ref={ref} data-testid="inside">
        inside
      </div>
      <div data-testid="outside">outside</div>
    </div>
  );
}

afterEach(() => cleanup());

describe("useClickOutside", () => {
  it("calls onOutside on a pointerdown outside the container while open", () => {
    const onOutside = vi.fn();
    render(<Harness open onOutside={onOutside} />);
    fireEvent.pointerDown(screen.getByTestId("outside"));
    expect(onOutside).toHaveBeenCalledTimes(1);
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
});
