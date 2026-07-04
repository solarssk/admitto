// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRef, useState } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";

const WEDGE_AUTO_SUBMIT_LEN = 20;
const WEDGE_DEBOUNCE_MS = 50;
const WEDGE_MAX_INTER_KEY_GAP_MS = 30;

/** Mirrors CheckInPage handleBufferChange wedge auto-submit timing (incl. burst detection, #262). */
function WedgeDebounceProbe({
  onScan,
  canAct = true,
}: {
  onScan: (value: string) => void;
  canAct?: boolean;
}) {
  const wedgeTimerRef = useRef<number | null>(null);
  const wedgeLastCharAtRef = useRef(0);
  const wedgeIsBurstRef = useRef(true);
  const [buffer, setBuffer] = useState("");

  // Uses the event's own timestamp (not Date.now() at handler-execution
  // time), so a slow main thread when the event is finally processed can't
  // masquerade as an inter-keystroke gap (#262 review).
  const handleBufferChange = (value: string, eventTimestamp: number) => {
    const now = eventTimestamp;
    // A single change event inserting more than one new character is never a
    // real keystroke (paste, autofill, IME, drag-and-drop, ...), regardless
    // of source (#262 review).
    const lengthJump = value.length - buffer.length;
    if (lengthJump > 1) {
      wedgeIsBurstRef.current = false;
    } else if (buffer.length === 0) {
      wedgeIsBurstRef.current = true;
    } else if (now - wedgeLastCharAtRef.current > WEDGE_MAX_INTER_KEY_GAP_MS) {
      wedgeIsBurstRef.current = false;
    }
    wedgeLastCharAtRef.current = now;

    setBuffer(value);
    if (wedgeTimerRef.current != null) window.clearTimeout(wedgeTimerRef.current);

    if (value.length > WEDGE_AUTO_SUBMIT_LEN && wedgeIsBurstRef.current && canAct) {
      wedgeTimerRef.current = window.setTimeout(() => {
        onScan(value);
      }, WEDGE_DEBOUNCE_MS);
    }
  };

  return (
    <input
      aria-label="Scan field"
      value={buffer}
      onChange={(e) => handleBufferChange(e.target.value, e.timeStamp)}
    />
  );
}

/** Fires one change event per character, advancing the fake clock by `gapMs` between each. */
function typeWithGap(input: HTMLElement, text: string, gapMs: number): void {
  for (let i = 1; i <= text.length; i++) {
    fireEvent.change(input, { target: { value: text.slice(0, i) } });
    vi.advanceTimersByTime(gapMs);
  }
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

    typeWithGap(input, token, 2);
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

  it("auto-submits a fast wedge burst (each character well under the gap threshold) (#262)", () => {
    const onScan = vi.fn();
    const { getByLabelText } = render(<WedgeDebounceProbe onScan={onScan} />);
    const input = getByLabelText("Scan field");
    const token = "QRTOKEN-ABCDEFGHIJKLMN"; // 23 chars

    typeWithGap(input, token, 2);
    vi.advanceTimersByTime(WEDGE_DEBOUNCE_MS);
    expect(onScan).toHaveBeenCalledWith(token);
  });

  it("does not auto-submit a long manually-typed query (human inter-key gaps) (#262)", () => {
    const onScan = vi.fn();
    const { getByLabelText } = render(<WedgeDebounceProbe onScan={onScan} />);
    const input = getByLabelText("Scan field");
    // A plausible manual search: company name long enough to cross the wedge length threshold.
    const query = "International Trade Fair Ltd";

    typeWithGap(input, query, 60);
    vi.advanceTimersByTime(WEDGE_DEBOUNCE_MS);
    expect(onScan).not.toHaveBeenCalled();
  });

  it("falls back to burst mode once typing stops and a fast wedge scan follows", () => {
    const onScan = vi.fn();
    const { getByLabelText } = render(<WedgeDebounceProbe onScan={onScan} />);
    const input = getByLabelText("Scan field");

    // A human types a short query, then clears the field (matches CheckInPage's
    // buffer reset after a submit/reset) before the next physical scan.
    typeWithGap(input, "short query", 60);
    fireEvent.change(input, { target: { value: "" } });
    vi.advanceTimersByTime(5);

    const token = "QRTOKEN-NEXTPERSON012";
    typeWithGap(input, token, 2);
    vi.advanceTimersByTime(WEDGE_DEBOUNCE_MS);
    expect(onScan).toHaveBeenCalledWith(token);
  });
});
