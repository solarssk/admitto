// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NoteModal } from "../../src/checkin/NoteModal.js";

afterEach(cleanup);

const noop = () => Promise.resolve();

describe("NoteModal", () => {
  it("renders textarea and counter when open", () => {
    render(<NoteModal open onClose={() => {}} onSubmit={noop} />);
    expect(screen.getByRole("textbox")).toBeTruthy();
    expect(screen.getByText("0 / 2000")).toBeTruthy();
  });

  it("renders nothing when closed", () => {
    render(<NoteModal open={false} onClose={() => {}} onSubmit={noop} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("updates counter as user types", () => {
    render(<NoteModal open onClose={() => {}} onSubmit={noop} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "hello" } });
    expect(screen.getByText("5 / 2000")).toBeTruthy();
  });

  it("disables Add note when textarea is empty", () => {
    render(<NoteModal open onClose={() => {}} onSubmit={noop} />);
    const btn = screen.getByRole("button", { name: "Add note" });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it("enables Add note when textarea has text", () => {
    render(<NoteModal open onClose={() => {}} onSubmit={noop} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "test note" } });
    const btn = screen.getByRole("button", { name: "Add note" });
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });

  it("calls onSubmit with trimmed value and closes on success", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<NoteModal open onClose={onClose} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  my note  " } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Add note" })); });
    expect(onSubmit).toHaveBeenCalledWith("my note");
    expect(onClose).toHaveBeenCalled();
  });

  it("keeps modal open and preserves text when onSubmit rejects", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error("network"));
    const onClose = vi.fn();
    render(<NoteModal open onClose={onClose} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "retry note" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Add note" })); });
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() =>
      expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("retry note"),
    );
  });

  it("calls onClose on Cancel click", () => {
    const onClose = vi.fn();
    render(<NoteModal open onClose={onClose} onSubmit={noop} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("resets draft on cancel so next attendee sees empty textarea", () => {
    const onClose = vi.fn();
    const { rerender } = render(<NoteModal open onClose={onClose} onSubmit={noop} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "leftover draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    rerender(<NoteModal open onClose={onClose} onSubmit={noop} />);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
  });
});
