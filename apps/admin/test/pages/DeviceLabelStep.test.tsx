// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/api/client.js";
import { DeviceLabelStep } from "../../src/pages/DeviceLabelStep.js";
import { deferred, isOff } from "../test-utils.js";

const { submitSessionDeviceLabel } = vi.hoisted(() => ({ submitSessionDeviceLabel: vi.fn() }));

vi.mock("../../src/api/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/api/client.js")>()),
  submitSessionDeviceLabel: (...args: unknown[]) => submitSessionDeviceLabel(...args),
}));

const field = () => screen.getByLabelText("Device label") as HTMLInputElement;

beforeEach(() => {
  submitSessionDeviceLabel.mockReset().mockResolvedValue(undefined);
});

afterEach(cleanup);

describe("DeviceLabelStep", () => {
  it("saves the label and tells the caller", async () => {
    const onSaved = vi.fn();
    render(<DeviceLabelStep onSaved={onSaved} onSkip={() => {}} />);
    fireEvent.change(field(), { target: { value: "  Tablet 1  " } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await act(async () => {});
    expect(submitSessionDeviceLabel).toHaveBeenCalledWith("Tablet 1");
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("asks for a label, or to continue without one, when the field is empty", async () => {
    render(<DeviceLabelStep onSaved={() => {}} onSkip={() => {}} />);
    fireEvent.change(field(), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByText("Enter a device label or continue without one.")).toBeTruthy();
    expect(submitSessionDeviceLabel).not.toHaveBeenCalled();
  });

  it("lets the operator continue without a label", () => {
    const onSkip = vi.fn();
    render(<DeviceLabelStep onSaved={() => {}} onSkip={onSkip} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue without label" }));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it("shows Continue busy on the button itself while the label is saved, keeps the field focused (read-only, not disabled) and the skip off", async () => {
    const saving = deferred<void>();
    submitSessionDeviceLabel.mockReturnValueOnce(saving.promise);
    render(<DeviceLabelStep onSaved={() => {}} onSkip={() => {}} />);
    fireEvent.change(field(), { target: { value: "Tablet 1" } });
    // Enter in the field submits the form: the field is where the focus is.
    field().focus();
    fireEvent.submit(field().closest("form") as HTMLFormElement);

    const busy = screen.getByRole("button", { name: "Saving…" });
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect(isOff(busy)).toBe(true);
    expect(field().readOnly).toBe(true);
    expect(field().disabled).toBe(false);
    expect(document.activeElement).toBe(field());
    expect((screen.getByRole("button", { name: "Continue without label" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(busy);
    expect(submitSessionDeviceLabel).toHaveBeenCalledTimes(1);

    await act(async () => saving.resolve());
    expect(screen.getByRole("button", { name: "Continue" }).getAttribute("aria-busy")).toBeNull();
    expect(field().readOnly).toBe(false);
  });

  it("brings Continue back with its focus when saving fails, and says why on the field", async () => {
    submitSessionDeviceLabel.mockRejectedValueOnce(new ApiError(500, "boom"));
    render(<DeviceLabelStep onSaved={() => {}} onSkip={() => {}} />);
    fireEvent.change(field(), { target: { value: "Tablet 1" } });
    const save = screen.getByRole("button", { name: "Continue" });
    save.focus();
    fireEvent.click(save);

    expect(await screen.findByText(/Could not save device label|Something went wrong/)).toBeTruthy();
    expect(save.getAttribute("aria-busy")).toBeNull();
    expect(isOff(save)).toBe(false);
    expect(document.activeElement).toBe(save);
  });
});
