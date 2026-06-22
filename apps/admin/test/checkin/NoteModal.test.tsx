// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NoteModal } from "../../src/checkin/NoteModal.js";

afterEach(cleanup);

describe("NoteModal", () => {
  it("renders textarea and counter when open", () => {
    render(<NoteModal open onClose={() => {}} onSubmit={() => {}} />);
    expect(screen.getByRole("textbox")).toBeTruthy();
    expect(screen.getByText("0 / 2000")).toBeTruthy();
  });

  it("renders nothing when closed", () => {
    render(<NoteModal open={false} onClose={() => {}} onSubmit={() => {}} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("updates counter as user types", () => {
    render(<NoteModal open onClose={() => {}} onSubmit={() => {}} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "hello" } });
    expect(screen.getByText("5 / 2000")).toBeTruthy();
  });

  it("disables Add note when textarea is empty", () => {
    render(<NoteModal open onClose={() => {}} onSubmit={() => {}} />);
    const btn = screen.getByRole("button", { name: "Add note" });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it("enables Add note when textarea has text", () => {
    render(<NoteModal open onClose={() => {}} onSubmit={() => {}} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "test note" } });
    const btn = screen.getByRole("button", { name: "Add note" });
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });

  it("calls onSubmit with trimmed value and resets on submit", () => {
    const onSubmit = vi.fn();
    const onClose = vi.fn();
    render(<NoteModal open onClose={onClose} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  my note  " } });
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    expect(onSubmit).toHaveBeenCalledWith("my note");
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose on Cancel click", () => {
    const onClose = vi.fn();
    render(<NoteModal open onClose={onClose} onSubmit={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });
});
