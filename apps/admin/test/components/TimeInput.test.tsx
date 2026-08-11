// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TimeInput } from "../../src/components/TimeInput.js";

afterEach(cleanup);

describe("TimeInput", () => {
  it("propagates typed text immediately via onChange", () => {
    const onChange = vi.fn();
    render(<TimeInput label="Event hours — start" value="" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Event hours — start"), { target: { value: "18:00" } });
    expect(onChange).toHaveBeenCalledWith("18:00");
  });

  it("normalizes flexible digit-only input to zero-padded HH:MM on blur", () => {
    const onChange = vi.fn();
    render(<TimeInput label="Event hours — start" value="" onChange={onChange} />);
    const input = screen.getByLabelText("Event hours — start");
    fireEvent.change(input, { target: { value: "1800" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith("18:00");
    expect((input as HTMLInputElement).value).toBe("18:00");
  });

  it("normalizes an hour-only value to HH:00 on Enter", () => {
    const onChange = vi.fn();
    render(<TimeInput label="Event hours — start" value="" onChange={onChange} />);
    const input = screen.getByLabelText("Event hours — start");
    fireEvent.change(input, { target: { value: "9" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith("09:00");
  });

  it("flags unparseable text as invalid on blur without calling onChange again", () => {
    const onChange = vi.fn();
    render(<TimeInput label="Event hours — start" value="" onChange={onChange} />);
    const input = screen.getByLabelText("Event hours — start");
    fireEvent.change(input, { target: { value: "nope" } });
    onChange.mockClear();
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText("Use 24-hour time, e.g. 18:00.")).toBeTruthy();
  });

  it("flags an out-of-range hour or minute as invalid", () => {
    render(<TimeInput label="Event hours — start" value="" onChange={vi.fn()} />);
    const input = screen.getByLabelText("Event hours — start");
    fireEvent.change(input, { target: { value: "2560" } });
    fireEvent.blur(input);
    expect(screen.getByText("Use 24-hour time, e.g. 18:00.")).toBeTruthy();
  });

  it("clears without error when the field is emptied on blur", () => {
    const onChange = vi.fn();
    render(<TimeInput label="Event hours — start" value="18:00" onChange={onChange} />);
    const input = screen.getByLabelText("Event hours — start");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(screen.queryByText("Use 24-hour time, e.g. 18:00.")).toBeNull();
  });

  it("resets the invalid state and displayed text when the value prop changes externally", () => {
    const { rerender } = render(<TimeInput label="Event hours — start" value="" onChange={vi.fn()} />);
    const input = screen.getByLabelText("Event hours — start");
    fireEvent.change(input, { target: { value: "bad" } });
    fireEvent.blur(input);
    expect(screen.getByText("Use 24-hour time, e.g. 18:00.")).toBeTruthy();

    rerender(<TimeInput label="Event hours — start" value="10:00" onChange={vi.fn()} />);
    expect((input as HTMLInputElement).value).toBe("10:00");
    expect(screen.queryByText("Use 24-hour time, e.g. 18:00.")).toBeNull();
  });

  it("shows the passed error over the typed-invalid hint", () => {
    render(<TimeInput label="Event hours — start" value="" onChange={vi.fn()} error="Required" />);
    expect(screen.getByText("Required")).toBeTruthy();
  });

  it("renders a hint when provided and no error is present", () => {
    render(<TimeInput label="Event hours — start" value="" onChange={vi.fn()} hint="Optional." />);
    expect(screen.getByText("Optional.")).toBeTruthy();
  });

  it("disables the input when disabled is set", () => {
    render(<TimeInput label="Event hours — start" value="" onChange={vi.fn()} disabled />);
    expect((screen.getByLabelText("Event hours — start") as HTMLInputElement).disabled).toBe(true);
  });

  it("ignores non-Enter key presses", () => {
    const onChange = vi.fn();
    render(<TimeInput label="Event hours — start" value="" onChange={onChange} />);
    const input = screen.getByLabelText("Event hours — start");
    fireEvent.change(input, { target: { value: "9" } });
    onChange.mockClear();
    fireEvent.keyDown(input, { key: "Tab" });
    expect(onChange).not.toHaveBeenCalled();
    expect((input as HTMLInputElement).value).toBe("9");
  });

  it("uses ariaLabel when no visible label is passed", () => {
    render(<TimeInput ariaLabel="Start time" value="" onChange={vi.fn()} />);
    expect(screen.getByLabelText("Start time")).toBeTruthy();
  });
});
