// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { TimeInput } from "../../src/components/TimeInput.js";
import { setPreferredTimeFormat } from "../../src/utils/locale-store.js";

afterEach(() => {
  setPreferredTimeFormat(undefined);
  cleanup();
  vi.restoreAllMocks();
});

/** Stubs the layout reads TimeInput's placement effect uses - jsdom has no real layout engine,
 * so getBoundingClientRect/scrollHeight/offsetWidth/innerWidth/innerHeight all default to 0.
 * Same technique as DatePicker.test.tsx's own helper - both pickers share the fixed-position,
 * viewport-flip placement pattern. */
function mockPlacementLayout(opts: {
  rect: { top: number; bottom: number; left: number };
  panelHeight: number;
  panelWidth: number;
  innerWidth: number;
  innerHeight: number;
}) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(opts.rect as DOMRect);
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(opts.panelHeight);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(opts.panelWidth);
  vi.spyOn(window, "innerWidth", "get").mockReturnValue(opts.innerWidth);
  vi.spyOn(window, "innerHeight", "get").mockReturnValue(opts.innerHeight);
}

describe("TimeInput", () => {
  it("stores 24-hour typed input as canonical HH:MM on blur", () => {
    const onChange = vi.fn();
    render(<TimeInput hourCycle="24h" label="Event hours start" value="" onChange={onChange} />);
    const input = screen.getByLabelText("Event hours start");
    fireEvent.change(input, { target: { value: "1800" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith("18:00");
    expect((input as HTMLInputElement).value).toBe("18:00");
  });

  it("waits for a complete time before publishing it, so 2 can become 23", () => {
    const onChange = vi.fn();
    render(<TimeInput hourCycle="24h" label="Event hours start" value="" onChange={onChange} />);
    const input = screen.getByLabelText("Event hours start");

    fireEvent.change(input, { target: { value: "2" } });
    expect((input as HTMLInputElement).value).toBe("2");
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "23" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith("23:00");
  });

  it("does not invent minutes from a single 24-hour digit", () => {
    const onChange = vi.fn();
    render(<TimeInput hourCycle="24h" label="Event hours start" value="" onChange={onChange} />);
    const input = screen.getByLabelText("Event hours start");
    fireEvent.change(input, { target: { value: "6" } });
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText("Use a time such as 18:00 or 6:00 PM.")).toBeTruthy();
  });

  it("reports that an incomplete typed time cannot be submitted", () => {
    const onValidityChange = vi.fn();
    render(
      <TimeInput
        hourCycle="24h"
        label="Event hours start"
        value=""
        onChange={vi.fn()}
        onValidityChange={onValidityChange}
      />,
    );
    const input = screen.getByLabelText("Event hours start");
    fireEvent.change(input, { target: { value: "6" } });
    fireEvent.blur(input);

    expect(onValidityChange).toHaveBeenLastCalledWith(false);

    fireEvent.change(input, { target: { value: "18:00" } });
    fireEvent.blur(input);
    expect(onValidityChange).toHaveBeenLastCalledWith(true);

    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(onValidityChange).toHaveBeenLastCalledWith(true);
  });

  it("accepts AM/PM text and stores the equivalent 24-hour value", () => {
    const onChange = vi.fn();
    render(<TimeInput hourCycle="12h" label="Event hours start" value="" onChange={onChange} />);
    const input = screen.getByLabelText("Event hours start");
    fireEvent.change(input, { target: { value: "6:30 PM" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith("18:30");
    expect((input as HTMLInputElement).value).toBe("6:30 PM");
  });

  it("accepts midnight written with AM and displays it in the account format", () => {
    const onChange = vi.fn();
    render(<TimeInput hourCycle="12h" label="Event hours start" value="" onChange={onChange} />);
    const input = screen.getByLabelText("Event hours start");

    fireEvent.change(input, { target: { value: "12:00 AM" } });
    fireEvent.blur(input);

    expect(onChange).toHaveBeenLastCalledWith("00:00");
    expect((input as HTMLInputElement).value).toBe("12:00 AM");
  });

  it("uses the account Time format independently from the Regional format", () => {
    setPreferredTimeFormat("12h");
    const { rerender } = render(<TimeInput label="Event hours start" value="18:30" onChange={vi.fn()} />);
    expect((screen.getByLabelText("Event hours start") as HTMLInputElement).value).toBe("6:30 PM");

    setPreferredTimeFormat("24h");
    rerender(<TimeInput label="Event hours start" value="18:30" onChange={vi.fn()} />);
    expect((screen.getByLabelText("Event hours start") as HTMLInputElement).value).toBe("18:30");
  });

  it("opens a custom picker and selects an hour, minute, and PM", () => {
    const onChange = vi.fn();
    const onValidityChange = vi.fn();
    render(
      <TimeInput
        hourCycle="12h"
        label="Event hours start"
        value=""
        onChange={onChange}
        onValidityChange={onValidityChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open time picker" }));
    expect(screen.getByRole("dialog", { name: "Choose time" })).toBeTruthy();

    fireEvent.click(within(screen.getByLabelText("Hour")).getByRole("button", { name: "06" }));
    fireEvent.click(within(screen.getByLabelText("Minute")).getByRole("button", { name: "30" }));
    fireEvent.click(screen.getByRole("button", { name: "PM" }));

    expect(onChange).toHaveBeenLastCalledWith("18:30");
    expect(onValidityChange).toHaveBeenLastCalledWith(true);
    expect((screen.getByLabelText("Event hours start") as HTMLInputElement).value).toBe("6:30 PM");
  });

  it("lets 12-hour picker users switch a selected evening time back to AM", () => {
    const onChange = vi.fn();
    render(
      <TimeInput hourCycle="12h" label="Event hours start" value="18:30" onChange={onChange} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open time picker" }));
    fireEvent.click(within(screen.getByLabelText("AM or PM")).getByRole("button", { name: "AM" }));

    expect(onChange).toHaveBeenLastCalledWith("06:30");
  });

  it("chooses a 24-hour picker value without exposing an AM/PM column", () => {
    const onChange = vi.fn();
    render(<TimeInput hourCycle="24h" label="Event hours start" value="09:00" onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Open time picker" }));
    expect(screen.queryByLabelText("AM or PM")).toBeNull();
    fireEvent.click(within(screen.getByLabelText("Hour")).getByRole("button", { name: "18" }));

    expect(onChange).toHaveBeenLastCalledWith("18:00");
  });

  it("keeps the picker closed while the operator focuses the field to type manually", () => {
    render(<TimeInput label="Event hours start" value="" onChange={vi.fn()} />);
    fireEvent.focus(screen.getByLabelText("Event hours start"));
    expect(screen.queryByRole("dialog", { name: "Choose time" })).toBeNull();
  });

  it("flags unparseable or out-of-range text without replacing the saved value", () => {
    const onChange = vi.fn();
    render(<TimeInput label="Event hours start" value="" onChange={onChange} />);
    const input = screen.getByLabelText("Event hours start");
    fireEvent.change(input, { target: { value: "13:00 PM" } });
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText("Use a time such as 18:00 or 6:00 PM.")).toBeTruthy();
  });

  it("supports keyboard commit, dismissal, and opening the picker", () => {
    const onChange = vi.fn();
    render(<TimeInput hourCycle="24h" label="Event hours start" value="" onChange={onChange} />);
    const input = screen.getByLabelText("Event hours start");

    fireEvent.change(input, { target: { value: "1845" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith("18:45");
    expect(screen.queryByRole("dialog", { name: "Choose time" })).toBeNull();

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getByRole("dialog", { name: "Choose time" })).toBeTruthy();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Choose time" })).toBeNull();
  });

  it("prefers an explicit error over its normal hint", () => {
    const { rerender } = render(
      <TimeInput
        hourCycle="24h"
        label="Event hours start"
        value=""
        onChange={vi.fn()}
        hint="Optional time on tickets"
      />,
    );
    expect(screen.getByText("Optional time on tickets")).toBeTruthy();

    rerender(
      <TimeInput
        hourCycle="24h"
        label="Event hours start"
        value=""
        onChange={vi.fn()}
        hint="Optional time on tickets"
        error="Choose a valid time"
      />,
    );
    expect(screen.getByText("Choose a valid time")).toBeTruthy();
    expect(screen.queryByText("Optional time on tickets")).toBeNull();
  });

  it("clears the stored time when the field is emptied", () => {
    const onChange = vi.fn();
    render(<TimeInput hourCycle="24h" label="Event hours start" value="18:00" onChange={onChange} />);
    const input = screen.getByLabelText("Event hours start");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith("");
  });

  it("closes the picker when clicking elsewhere", () => {
    render(<><TimeInput label="Event hours start" value="" onChange={vi.fn()} /><button type="button">Elsewhere</button></>);
    fireEvent.click(screen.getByRole("button", { name: "Open time picker" }));
    fireEvent.pointerDown(screen.getByRole("button", { name: "Elsewhere" }));
    expect(screen.queryByRole("dialog", { name: "Choose time" })).toBeNull();
  });

  it("does not reopen when the click that follows an outside pointerdown lands on the icon", () => {
    vi.useFakeTimers();
    try {
      render(
        <>
          <TimeInput label="Event hours start" value="" onChange={vi.fn()} />
          <button type="button">Elsewhere</button>
        </>,
      );
      const pickerButton = screen.getByRole("button", { name: "Open time picker" });
      fireEvent.click(pickerButton);
      fireEvent.pointerDown(screen.getByRole("button", { name: "Elsewhere" }));
      fireEvent.click(pickerButton);

      expect(screen.queryByRole("dialog", { name: "Choose time" })).toBeNull();
      act(() => vi.runAllTimers());
      fireEvent.click(pickerButton);
      expect(screen.getByRole("dialog", { name: "Choose time" })).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses ariaLabel when no visible label is passed", () => {
    render(<TimeInput ariaLabel="Start time" value="" onChange={vi.fn()} />);
    expect(screen.getByLabelText("Start time")).toBeTruthy();
  });

  it("opens the picker fixed-positioned below the field by default", () => {
    mockPlacementLayout({
      rect: { top: 100, bottom: 130, left: 50 },
      panelHeight: 200,
      panelWidth: 200,
      innerWidth: 1024,
      innerHeight: 768,
    });
    render(<TimeInput ariaLabel="Start time" value="" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Open time picker" }));

    const dialog = screen.getByRole("dialog", { name: "Choose time" });
    expect(dialog.className).not.toContain("time-input__picker--above");
    expect(dialog.style.position).toBe("fixed");
    expect(dialog.style.left).toBe("50px");
  });

  it("flips the picker above the field when there isn't room below - e.g. the last field on a scrolled page", () => {
    mockPlacementLayout({
      rect: { top: 500, bottom: 540, left: 50 },
      panelHeight: 300,
      panelWidth: 200,
      innerWidth: 1024,
      innerHeight: 600,
    });
    render(<TimeInput ariaLabel="Start time" value="" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Open time picker" }));

    const dialog = screen.getByRole("dialog", { name: "Choose time" });
    expect(dialog.className).toContain("time-input__picker--above");
  });

  it("clamps the picker inside the viewport for a field near the right edge, instead of overflowing", () => {
    mockPlacementLayout({
      rect: { top: 100, bottom: 130, left: 900 },
      panelHeight: 200,
      panelWidth: 200,
      innerWidth: 1024,
      innerHeight: 768,
    });
    render(<TimeInput ariaLabel="Start time" value="" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Open time picker" }));

    const dialog = screen.getByRole("dialog", { name: "Choose time" });
    // Would overflow past 1024 (900 + 200 = 1100) if left-anchored at the field's own left edge -
    // clamped to stay within the viewport instead of opening off to the right of it.
    expect(Number.parseFloat(dialog.style.left)).toBeLessThanOrEqual(1024 - 8 - 200);
  });

  it("clamps the picker's own height and scrolls when neither above nor below has room for it", () => {
    mockPlacementLayout({
      rect: { top: 50, bottom: 90, left: 50 },
      panelHeight: 500,
      panelWidth: 200,
      innerWidth: 1024,
      innerHeight: 200,
    });
    render(<TimeInput ariaLabel="Start time" value="" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Open time picker" }));

    const dialog = screen.getByRole("dialog", { name: "Choose time" });
    expect(dialog.style.maxHeight).toBe("96px");
    expect(dialog.style.overflowY).toBe("auto");
  });
});
