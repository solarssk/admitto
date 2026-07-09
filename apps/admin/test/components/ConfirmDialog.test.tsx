// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "../../src/components/ConfirmDialog.js";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ConfirmDialog", () => {
  it("renders nothing when closed", () => {
    render(
      <ConfirmDialog
        open={false}
        title="Delete?"
        message="Are you sure?"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders title, message, and calls onConfirm/onCancel", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Archive this event?"
        message="Archived events become read-only."
        confirmLabel="Archive event"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Archive this event?")).toBeTruthy();
    expect(screen.getByText("Archived events become read-only.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Archive event" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("without confirmationValue, the confirm button is enabled and no typed-input is rendered", () => {
    render(
      <ConfirmDialog
        open
        title="Archive this event?"
        message="..."
        confirmLabel="Archive event"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const confirmButton = screen.getByRole("button", { name: "Archive event" }) as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(false);
    expect(screen.queryByLabelText(/Type .* to confirm/)).toBeNull();
  });

  it("with confirmationValue, disables confirm until the exact value is typed (case-sensitive)", () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Permanently delete this event?"
        message="This cannot be undone."
        confirmLabel="Delete event"
        confirmationValue="My Real Event"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    const confirmButton = screen.getByRole("button", { name: "Delete event" }) as HTMLButtonElement;
    const input = screen.getByLabelText('Type "My Real Event" to confirm') as HTMLInputElement;
    expect(confirmButton.disabled).toBe(true);

    fireEvent.change(input, { target: { value: "my real event" } });
    expect(confirmButton.disabled).toBe(true);

    fireEvent.change(input, { target: { value: "My Real Even" } });
    expect(confirmButton.disabled).toBe(true);

    fireEvent.change(input, { target: { value: "My Real Event" } });
    expect(confirmButton.disabled).toBe(false);

    fireEvent.click(confirmButton);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("uses a custom confirmationLabel when provided", () => {
    render(
      <ConfirmDialog
        open
        title="Permanently delete this event?"
        message="..."
        confirmationValue="Summit 2026"
        confirmationLabel='Type the event title to confirm: "Summit 2026"'
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Type the event title to confirm: "Summit 2026"')).toBeTruthy();
  });

  it("resets the typed value each time the dialog reopens", () => {
    const { rerender } = render(
      <ConfirmDialog
        open
        title="Permanently delete this event?"
        message="..."
        confirmLabel="Delete event"
        confirmationValue="Summit"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText('Type "Summit" to confirm'), {
      target: { value: "Summit" },
    });
    expect((screen.getByRole("button", { name: "Delete event" }) as HTMLButtonElement).disabled).toBe(
      false,
    );

    rerender(
      <ConfirmDialog
        open={false}
        title="Permanently delete this event?"
        message="..."
        confirmLabel="Delete event"
        confirmationValue="Summit"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    rerender(
      <ConfirmDialog
        open
        title="Permanently delete this event?"
        message="..."
        confirmLabel="Delete event"
        confirmationValue="Summit"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const reopenedInput = screen.getByLabelText('Type "Summit" to confirm') as HTMLInputElement;
    expect(reopenedInput.value).toBe("");
    expect((screen.getByRole("button", { name: "Delete event" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("disables both buttons and shows a working label while loading", () => {
    render(
      <ConfirmDialog
        open
        title="Permanently delete this event?"
        message="..."
        confirmLabel="Delete event"
        loading
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect((screen.getByRole("button", { name: "Working…" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows an error message when provided", () => {
    render(
      <ConfirmDialog
        open
        title="Permanently delete this event?"
        message="..."
        errorMessage="Delete failed: event still has attendees"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert").textContent).toBe("Delete failed: event still has attendees");
  });
});
