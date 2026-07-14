// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "../../src/components/ConfirmDialog.js";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
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

  it("with an empty confirmationValue, the confirm button stays disabled (fails closed, never unlocks)", () => {
    render(
      <ConfirmDialog
        open
        title="Permanently delete this event?"
        message="This cannot be undone."
        confirmLabel="Delete event"
        confirmationValue=""
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const confirmButton = screen.getByRole("button", { name: "Delete event" }) as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(true);
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

  it("disables both buttons and shows a working label with a spinner while loading", () => {
    const { container } = render(
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
    // Regression: a bulk action can take several seconds on a large event (e.g. revoking
    // thousands of attendees' check-ins) - a static "Working…" label with no motion can look
    // frozen for that long, so the confirm button also gets a spinning icon while loading.
    expect(container.querySelector(".at-spinner")).not.toBeNull();
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

  describe("confirmDelaySeconds (arming countdown)", () => {
    it("without confirmDelaySeconds, the confirm button is immediately enabled and no bar renders", () => {
      const { container } = render(
        <ConfirmDialog
          open
          title="Revoke all check-ins?"
          message="..."
          confirmLabel="Revoke all check-ins"
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
      expect(
        (screen.getByRole("button", { name: "Revoke all check-ins" }) as HTMLButtonElement).disabled,
      ).toBe(false);
      expect(container.querySelector(".confirm-dialog__arm-track")).toBeNull();
    });

    it("disables confirm and shows the depleting bar until the delay elapses, then enables it", () => {
      vi.useFakeTimers();
      const onConfirm = vi.fn();
      const { container } = render(
        <ConfirmDialog
          open
          title="Revoke all check-ins?"
          message="..."
          confirmLabel="Revoke all check-ins"
          confirmVariant="danger"
          confirmDelaySeconds={10}
          onConfirm={onConfirm}
          onCancel={vi.fn()}
        />,
      );
      const confirmButton = screen.getByRole("button", {
        name: "Revoke all check-ins",
      }) as HTMLButtonElement;
      expect(confirmButton.disabled).toBe(true);
      expect(container.querySelector(".confirm-dialog__arm-track")).toBeTruthy();

      // A native disabled button ignores clicks — confirms the guard actually blocks the action,
      // not just that the attribute is set.
      fireEvent.click(confirmButton);
      expect(onConfirm).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(9999);
      });
      expect(confirmButton.disabled).toBe(true);

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(confirmButton.disabled).toBe(false);
      expect(container.querySelector(".confirm-dialog__arm-track")).toBeNull();

      fireEvent.click(confirmButton);
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    // Regression: the component stays mounted while closed (`open=false` returns null), so
    // `armed` must be reset before paint on reopen — otherwise the confirm button is briefly
    // enabled and a queued double-click/Enter could bypass the safety pause.
    it("re-arms the countdown every time the dialog reopens", () => {
      vi.useFakeTimers();
      const { rerender } = render(
        <ConfirmDialog
          open
          title="Revoke all check-ins?"
          message="..."
          confirmLabel="Revoke all check-ins"
          confirmDelaySeconds={10}
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
      act(() => {
        vi.advanceTimersByTime(10_000);
      });
      expect(
        (screen.getByRole("button", { name: "Revoke all check-ins" }) as HTMLButtonElement).disabled,
      ).toBe(false);

      rerender(
        <ConfirmDialog
          open={false}
          title="Revoke all check-ins?"
          message="..."
          confirmLabel="Revoke all check-ins"
          confirmDelaySeconds={10}
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
      rerender(
        <ConfirmDialog
          open
          title="Revoke all check-ins?"
          message="..."
          confirmLabel="Revoke all check-ins"
          confirmDelaySeconds={10}
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
      expect(
        (screen.getByRole("button", { name: "Revoke all check-ins" }) as HTMLButtonElement).disabled,
      ).toBe(true);

      // ...and it only re-enables after the full delay elapses again.
      act(() => {
        vi.advanceTimersByTime(9999);
      });
      expect(
        (screen.getByRole("button", { name: "Revoke all check-ins" }) as HTMLButtonElement).disabled,
      ).toBe(true);

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(
        (screen.getByRole("button", { name: "Revoke all check-ins" }) as HTMLButtonElement).disabled,
      ).toBe(false);
    });
  });
});
