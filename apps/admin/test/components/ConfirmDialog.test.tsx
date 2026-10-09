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

  it("keeps the confirm button where it is, busy and aria-disabled, and switches Cancel off, while loading", () => {
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
    const confirm = screen.getByRole("button", { name: "Delete event" }) as HTMLButtonElement;
    // `aria-disabled`, never `disabled`: a button that becomes `disabled` drops keyboard focus.
    expect(confirm.disabled).toBe(false);
    expect(confirm.getAttribute("aria-busy")).toBe("true");
    expect(confirm.getAttribute("aria-disabled")).toBe("true");
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
    // Regression: a bulk action can take several seconds on a large event (e.g. revoking
    // thousands of attendees' check-ins) - a button with no motion can look frozen for that
    // long, so the confirm button also shows a spinner while loading.
    expect(container.querySelector(".at-btn__spinner")).not.toBeNull();
  });

  it("does not run the confirmation a second time when the busy confirm button is pressed again", () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog open title="Delete" message="..." confirmLabel="Delete" loading onConfirm={onConfirm} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("keeps keyboard focus on the confirm button when it becomes busy", () => {
    const { rerender } = render(<ConfirmDialog open title="Delete" message="..." confirmLabel="Delete" onConfirm={vi.fn()} onCancel={vi.fn()} />);
    const confirm = screen.getByRole("button", { name: "Delete" });
    confirm.focus();
    rerender(<ConfirmDialog open title="Delete" message="..." confirmLabel="Delete" loading onConfirm={vi.fn()} onCancel={vi.fn()} />);
    const busy = screen.getByRole("button", { name: "Delete" });
    // The same element, still focused, and a real button that is only marked off (a `disabled` one would lose focus).
    expect(busy).toBe(confirm);
    expect(document.activeElement).toBe(busy);
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect((busy as HTMLButtonElement).disabled).toBe(false);
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

    // Regression: the wait message must go through the shared Tooltip (portal + role="tooltip"),
    // not a native `title` attribute — a native tooltip renders inconsistently with the rest of
    // the app's disabled-control hints.
    it("shows the wait message via the shared Tooltip, not a native title attribute", () => {
      vi.useFakeTimers();
      render(
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
      const confirmButton = screen.getByRole("button", { name: "Revoke all check-ins" });
      expect(confirmButton.getAttribute("title")).toBeNull();
      expect(screen.queryByRole("tooltip")).toBeNull();

      fireEvent.mouseEnter(confirmButton.closest(".at-tooltip-trigger")!);
      expect(screen.getByRole("tooltip").textContent).toBe("Please wait 10s before confirming");
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

describe("ConfirmDialog: a retry that fails again", () => {
  const dialog = (loading: boolean, errorMessage: string | null) => (
    <ConfirmDialog
      open
      title="Personal data erased"
      message="Everything personal is gone."
      errorMessage={errorMessage}
      confirmLabel="Try again"
      loading={loading}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
    />
  );

  it("keeps the error on screen while the confirm button works, and mounts it afresh when it fails again", () => {
    const { rerender } = render(dialog(false, "Could not try again."));
    const before = screen.getByText("Could not try again.");

    rerender(dialog(true, "Could not try again."));
    expect(screen.getByText("Could not try again.")).toBe(before);

    rerender(dialog(false, "Could not try again."));
    expect(screen.getByText("Could not try again.")).not.toBe(before);
  });

  it("does not mount the error again when the work ends without one", () => {
    const { rerender } = render(dialog(true, null));

    rerender(dialog(false, null));

    expect(screen.queryByRole("alert")).toBeNull();
  });
});
