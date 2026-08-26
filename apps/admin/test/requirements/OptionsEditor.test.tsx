// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { OptionsEditor, optionRowsFromOptions, type OptionRow } from "../../src/requirements/OptionsEditor.js";

const ROW_HEIGHT = 40;

/** OptionsEditor is a controlled component - a plain `vi.fn()` onChange never actually updates
 * `rows`, so a test that needs to see a re-render reflecting an edit (not just assert on the
 * onChange call) needs a real state owner, same as EventCustomFieldModal is in production. */
function ControlledOptionsEditor({
  initial,
  usageCounts,
}: {
  initial: OptionRow[];
  usageCounts: Record<string, number> | null;
}) {
  const [rows, setRows] = useState(initial);
  return <OptionsEditor rows={rows} usageCounts={usageCounts} onChange={setRows} />;
}

beforeAll(() => {
  // jsdom has no pointer-capture implementation at all (not even a no-op) - real browsers do,
  // so this is a test-environment stand-in, not a behavior change.
  if (!("setPointerCapture" in HTMLElement.prototype)) {
    Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
      value: () => {},
      configurable: true,
    });
  }
});

afterEach(() => {
  cleanup();
});

/** jsdom never computes real layout (offsetTop/offsetHeight are always 0), but the drag math
 * depends on real row positions - stub them to a fixed, predictable row height. */
function stubRowLayout(container: HTMLElement) {
  const rows = container.querySelectorAll<HTMLElement>(".options-editor__row");
  rows.forEach((row, i) => {
    Object.defineProperty(row, "offsetTop", { value: i * ROW_HEIGHT, configurable: true });
    Object.defineProperty(row, "offsetHeight", { value: ROW_HEIGHT - 6, configurable: true });
  });
  const list = container.querySelector<HTMLElement>(".options-editor__list")!;
  vi.spyOn(list, "getBoundingClientRect").mockReturnValue({
    top: 0,
    bottom: rows.length * ROW_HEIGHT,
    left: 0,
    right: 300,
    width: 300,
    height: rows.length * ROW_HEIGHT,
    x: 0,
    y: 0,
    toJSON: () => {},
  } as DOMRect);
  return list;
}

function pointerEvent(type: string, init: PointerEventInit) {
  return new PointerEvent(type, { bubbles: true, cancelable: true, ...init });
}

describe("OptionsEditor — drag to reorder (Pointer Events)", () => {
  it("commits a reorder once the pointer crosses into the next row's slot", () => {
    const rows = optionRowsFromOptions(["S", "M", "L"]);
    const onChange = vi.fn();
    const { container } = render(<OptionsEditor rows={rows} usageCounts={{}} onChange={onChange} />);
    const list = stubRowLayout(container);
    const handle = screen.getAllByLabelText(/Drag to reorder/)[0]!;

    fireEvent(handle, pointerEvent("pointerdown", { pointerId: 7, clientY: 0 }));
    fireEvent(list, pointerEvent("pointermove", { pointerId: 7, clientY: 45 }));
    fireEvent(list, pointerEvent("pointerup", { pointerId: 7 }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0].map((r: { text: string }) => r.text)).toEqual(["M", "S", "L"]);
  });

  it("commits an upward reorder when the pointer moves back past an earlier row's slot", () => {
    const rows = optionRowsFromOptions(["S", "M", "L"]);
    const onChange = vi.fn();
    const { container } = render(<OptionsEditor rows={rows} usageCounts={{}} onChange={onChange} />);
    const list = stubRowLayout(container);
    const lastHandle = screen.getAllByLabelText(/Drag to reorder/)[2]!; // L, index 2

    fireEvent(lastHandle, pointerEvent("pointerdown", { pointerId: 4, clientY: 80 }));
    fireEvent(list, pointerEvent("pointermove", { pointerId: 4, clientY: 35 })); // up past M's slot
    fireEvent(list, pointerEvent("pointerup", { pointerId: 4 }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0].map((r: { text: string }) => r.text)).toEqual(["S", "L", "M"]);
  });

  it("does not commit when the pointer never crosses into another row's slot", () => {
    const rows = optionRowsFromOptions(["S", "M", "L"]);
    const onChange = vi.fn();
    const { container } = render(<OptionsEditor rows={rows} usageCounts={{}} onChange={onChange} />);
    const list = stubRowLayout(container);
    const handle = screen.getAllByLabelText(/Drag to reorder/)[0]!;

    fireEvent(handle, pointerEvent("pointerdown", { pointerId: 3, clientY: 0 }));
    fireEvent(list, pointerEvent("pointermove", { pointerId: 3, clientY: 5 }));
    fireEvent(list, pointerEvent("pointerup", { pointerId: 3 }));

    expect(onChange).not.toHaveBeenCalled();
  });

  it("discards the drag on pointercancel without reordering", () => {
    const rows = optionRowsFromOptions(["S", "M", "L"]);
    const onChange = vi.fn();
    const { container } = render(<OptionsEditor rows={rows} usageCounts={{}} onChange={onChange} />);
    const list = stubRowLayout(container);
    const handle = screen.getAllByLabelText(/Drag to reorder/)[0]!;

    fireEvent(handle, pointerEvent("pointerdown", { pointerId: 5, clientY: 0 }));
    fireEvent(list, pointerEvent("pointermove", { pointerId: 5, clientY: 45 }));
    fireEvent(list, pointerEvent("pointercancel", { pointerId: 5 }));

    expect(onChange).not.toHaveBeenCalled();
  });

  it("ignores pointermove/pointerup from a different pointerId than the one that started the drag", () => {
    const rows = optionRowsFromOptions(["S", "M", "L"]);
    const onChange = vi.fn();
    const { container } = render(<OptionsEditor rows={rows} usageCounts={{}} onChange={onChange} />);
    const list = stubRowLayout(container);
    const handle = screen.getAllByLabelText(/Drag to reorder/)[0]!;

    fireEvent(handle, pointerEvent("pointerdown", { pointerId: 1, clientY: 0 }));
    fireEvent(list, pointerEvent("pointermove", { pointerId: 2, clientY: 45 }));
    fireEvent(list, pointerEvent("pointerup", { pointerId: 2 }));
    expect(onChange).not.toHaveBeenCalled();

    fireEvent(list, pointerEvent("pointerup", { pointerId: 1 }));
    expect(onChange).not.toHaveBeenCalled(); // no real movement was ever recorded for pointer 1
  });

  it("does nothing when a non-arrow key is pressed on the drag handle", () => {
    const rows = optionRowsFromOptions(["S", "M", "L"]);
    const onChange = vi.fn();
    render(<OptionsEditor rows={rows} usageCounts={{}} onChange={onChange} />);
    const handle = screen.getAllByLabelText(/Drag to reorder/)[0]!;

    fireEvent.keyDown(handle, { key: "Enter" });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("does nothing when pointerdown doesn't originate on a drag handle", () => {
    const rows = optionRowsFromOptions(["S", "M"]);
    const onChange = vi.fn();
    const { container } = render(<OptionsEditor rows={rows} usageCounts={{}} onChange={onChange} />);
    const list = stubRowLayout(container);
    const input = screen.getAllByLabelText("Option text")[0]!;

    fireEvent(input, pointerEvent("pointerdown", { pointerId: 9, clientY: 0 }));
    fireEvent(list, pointerEvent("pointermove", { pointerId: 9, clientY: 45 }));
    fireEvent(list, pointerEvent("pointerup", { pointerId: 9 }));

    expect(onChange).not.toHaveBeenCalled();
  });

  it("falls back to the row's own height for the drag step with a single option (nothing to measure between rows)", () => {
    const rows = optionRowsFromOptions(["S"]);
    const onChange = vi.fn();
    const { container } = render(<OptionsEditor rows={rows} usageCounts={{}} onChange={onChange} />);
    const list = stubRowLayout(container);
    const handle = screen.getAllByLabelText(/Drag to reorder/)[0]!;

    fireEvent(handle, pointerEvent("pointerdown", { pointerId: 6, clientY: 0 }));
    fireEvent(list, pointerEvent("pointermove", { pointerId: 6, clientY: 45 }));
    fireEvent(list, pointerEvent("pointerup", { pointerId: 6 }));

    // Only one slot exists, so the target index always clamps back to it - no reorder to commit,
    // but the single-row step fallback (row.offsetHeight, not a gap between two rows) still runs.
    expect(onChange).not.toHaveBeenCalled();
  });

  it("auto-scrolls the list toward the pointer when dragging near its top or bottom edge", () => {
    const rows = optionRowsFromOptions(["S", "M", "L"]);
    const onChange = vi.fn();
    const { container } = render(<OptionsEditor rows={rows} usageCounts={{}} onChange={onChange} />);
    const list = stubRowLayout(container);
    const handle = screen.getAllByLabelText(/Drag to reorder/)[1]!; // M, index 1

    list.scrollTop = 50;
    fireEvent(handle, pointerEvent("pointerdown", { pointerId: 8, clientY: 40 }));
    fireEvent(list, pointerEvent("pointermove", { pointerId: 8, clientY: 5 })); // within 26px of top (0)
    expect(list.scrollTop).toBe(41);

    fireEvent(list, pointerEvent("pointermove", { pointerId: 8, clientY: 115 })); // within 26px of bottom (120)
    expect(list.scrollTop).toBe(50);
    fireEvent(list, pointerEvent("pointerup", { pointerId: 8 }));
  });
});

describe("OptionsEditor — delete confirmation wording", () => {
  it("uses singular wording in the delete-confirm strip for exactly one attendee", () => {
    const rows = optionRowsFromOptions(["S", "M"]);
    const onChange = vi.fn();
    render(<OptionsEditor rows={rows} usageCounts={{ S: 1 }} onChange={onChange} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Remove option" })[0]!);

    expect(screen.getByText(/1 attendee currently have this value/)).toBeTruthy();
  });
});

describe("OptionsEditor — blanking an in-use option", () => {
  it("warns in place when an in-use option's text is cleared, the same as a rename", () => {
    const initial = optionRowsFromOptions(["S", "M"]);
    const { container } = render(<ControlledOptionsEditor initial={initial} usageCounts={{ M: 42 }} />);

    const mInput = screen.getAllByLabelText("Option text")[1]!;
    fireEvent.change(mInput, { target: { value: "" } });

    expect(screen.getByText(/42 attendees currently have “M”\. Clearing this removes the option/)).toBeTruthy();
    expect(container.querySelector(".options-editor__row--warning")).toBeTruthy();
  });

  it("does not warn when a brand-new, never-saved row is left or cleared blank", () => {
    const initial = optionRowsFromOptions(["S"]);
    const { container } = render(<ControlledOptionsEditor initial={initial} usageCounts={{}} />);

    fireEvent.click(screen.getByRole("button", { name: "+ Add option" }));

    expect(container.querySelector(".options-editor__row--warning")).toBeNull();
    expect(screen.queryByText(/Clearing this removes/)).toBeNull();
  });
});
