// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRef, useState } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";

const WEDGE_AUTO_SUBMIT_LEN = 20;
const WEDGE_DEBOUNCE_MS = 50;

/** Mirrors CheckInPage handleBufferChange wedge auto-submit timing. */
function WedgeDebounceProbe({
  onScan,
  canAct = true,
}: {
  onScan: (value: string) => void;
  canAct?: boolean;
}) {
  const wedgeTimerRef = useRef<number | null>(null);
  const [buffer, setBuffer] = useState("");

  const handleBufferChange = (value: string) => {
    setBuffer(value);
    if (wedgeTimerRef.current != null) window.clearTimeout(wedgeTimerRef.current);

    if (value.length > WEDGE_AUTO_SUBMIT_LEN && canAct) {
      wedgeTimerRef.current = window.setTimeout(() => {
        onScan(value);
      }, WEDGE_DEBOUNCE_MS);
    }
  };

  return (
    <input
      aria-label="Scan field"
      value={buffer}
      onChange={(e) => handleBufferChange(e.target.value)}
    />
  );
}

describe("keyboard wedge debounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("auto-submits after 50ms when input length exceeds 20 characters", () => {
    const onScan = vi.fn();
    const { getByLabelText } = render(<WedgeDebounceProbe onScan={onScan} />);
    const input = getByLabelText("Scan field");
    const token = "A".repeat(21);

    fireEvent.change(input, { target: { value: token } });
    expect(onScan).not.toHaveBeenCalled();

    vi.advanceTimersByTime(WEDGE_DEBOUNCE_MS);
    expect(onScan).toHaveBeenCalledWith(token);
  });

  it("does not schedule auto-submit when disconnected", () => {
    const onScan = vi.fn();
    const { getByLabelText } = render(<WedgeDebounceProbe onScan={onScan} canAct={false} />);
    const input = getByLabelText("Scan field");

    fireEvent.change(input, { target: { value: "A".repeat(21) } });
    vi.advanceTimersByTime(WEDGE_DEBOUNCE_MS);
    expect(onScan).not.toHaveBeenCalled();
  });
});
