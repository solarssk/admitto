// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TotpDigitInput } from "../../src/account/TotpDigitInput.js";

afterEach(() => {
  cleanup();
});

describe("TotpDigitInput", () => {
  it("advances focus when typing single digits", () => {
    const onChange = vi.fn();
    const { rerender } = render(<TotpDigitInput id="totp-code" value="" onChange={onChange} />);
    const inputs = screen.getAllByRole("textbox");
    expect(inputs).toHaveLength(6);

    fireEvent.change(inputs[0]!, { target: { value: "1" } });
    expect(onChange).toHaveBeenLastCalledWith("1");

    rerender(<TotpDigitInput id="totp-code" value="1" onChange={onChange} />);
    fireEvent.change(screen.getAllByRole("textbox")[1]!, { target: { value: "2" } });
    expect(onChange).toHaveBeenLastCalledWith("12");
  });

  it("distributes multi-character input across boxes", () => {
    const onChange = vi.fn();
    render(<TotpDigitInput value="" onChange={onChange} />);
    const inputs = screen.getAllByRole("textbox");

    fireEvent.change(inputs[0]!, { target: { value: "123456" } });
    expect(onChange).toHaveBeenLastCalledWith("123456");
  });

  it("moves to the previous box on backspace when current box is empty", () => {
    const onChange = vi.fn();
    render(<TotpDigitInput value="12" onChange={onChange} />);
    const inputs = screen.getAllByRole("textbox");

    fireEvent.keyDown(inputs[2]!, { key: "Backspace" });
    expect(onChange).toHaveBeenLastCalledWith("1");
  });

  it("moves focus with arrow keys", () => {
    render(<TotpDigitInput value="123" onChange={vi.fn()} />);
    const inputs = screen.getAllByRole("textbox") as HTMLInputElement[];

    inputs[2]!.focus();
    fireEvent.keyDown(inputs[2]!, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(inputs[1]);

    fireEvent.keyDown(inputs[1]!, { key: "ArrowRight" });
    expect(document.activeElement).toBe(inputs[2]);
  });

  it("accepts pasted codes", () => {
    const onChange = vi.fn();
    render(<TotpDigitInput value="" onChange={onChange} />);
    const inputs = screen.getAllByRole("textbox");

    fireEvent.paste(inputs[0]!, {
      clipboardData: { getData: () => "654321" },
    });
    expect(onChange).toHaveBeenLastCalledWith("654321");
  });

  it("ignores paste with no digits", () => {
    const onChange = vi.fn();
    render(<TotpDigitInput value="" onChange={onChange} />);
    const inputs = screen.getAllByRole("textbox");

    fireEvent.paste(inputs[0]!, {
      clipboardData: { getData: () => "no-digits" },
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("associates the label id with the first digit input", () => {
    render(<TotpDigitInput id="account-totp-code" value="" onChange={vi.fn()} />);
    const inputs = screen.getAllByRole("textbox");
    expect(inputs[0]!.id).toBe("account-totp-code");
  });
});
