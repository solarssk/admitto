// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { useState, type KeyboardEvent } from "react";
import { render, fireEvent } from "@testing-library/react";
import { normalizeScannedInput } from "../../src/checkin/normalize.js";

function WedgeProbe({ onScan }: { onScan: (value: string) => void }) {
  const [buffer, setBuffer] = useState("");

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onScan(normalizeScannedInput(buffer));
    }
  };

  return (
    <input
      aria-label="Scan field"
      value={buffer}
      onChange={(e) => setBuffer(e.target.value)}
      onKeyDown={onKeyDown}
    />
  );
}

describe("keyboard wedge Enter", () => {
  it("submits normalized payload on Enter", () => {
    const onScan = vi.fn();
    const { getByLabelText } = render(<WedgeProbe onScan={onScan} />);
    const input = getByLabelText("Scan field");

    fireEvent.change(input, { target: { value: "TOKEN-ABC\r\n" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onScan).toHaveBeenCalledWith("TOKEN-ABC");
  });
});
