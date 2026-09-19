// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotificationDetailDialog } from "../../src/components/NotificationDetailDialog.js";
import type { NotificationDto } from "../../src/api/types.js";

function makeNotification(overrides: Partial<NotificationDto> = {}): NotificationDto {
  return {
    id: "notif-1",
    organization_name: "Demo Org",
    notification_type: "auth.login.new_country",
    severity: "warn",
    title: "You signed in from a new location",
    body: "Your account signed in from Singapore. If this wasn't you, secure your account immediately.",
    created_at: "2026-09-18T05:39:23.000Z",
    read_at: null,
    ...overrides,
  };
}

afterEach(() => cleanup());

describe("NotificationDetailDialog", () => {
  it("renders nothing without a notification", () => {
    const { container } = render(<NotificationDetailDialog notification={null} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the full title, body, organisation, and both timestamps", () => {
    render(<NotificationDetailDialog notification={makeNotification()} onClose={vi.fn()} />);

    const dialog = screen.getByRole("dialog", { name: "You signed in from a new location" });
    expect(dialog.textContent).toContain("If this wasn't you, secure your account immediately.");
    expect(dialog.textContent).toContain("Demo Org");
    expect(dialog.textContent).toContain("2026");
    expect(dialog.textContent).toContain("UTC");
    expect(dialog.textContent).toContain("Your local time:");
  });

  it("uses the severity's icon, falling back to a generic one for an unknown severity", () => {
    const { rerender } = render(<NotificationDetailDialog notification={makeNotification()} onClose={vi.fn()} />);
    expect(document.querySelector(".ti-alert-triangle")).toBeTruthy();

    rerender(
      <NotificationDetailDialog
        notification={makeNotification({ severity: "mystery" as NotificationDto["severity"] })}
        onClose={vi.fn()}
      />,
    );
    expect(document.querySelector(".ti-info-circle")).toBeTruthy();
  });

  it("calls onClose from the Close button", () => {
    const onClose = vi.fn();
    render(<NotificationDetailDialog notification={makeNotification()} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose on Escape", () => {
    const onClose = vi.fn();
    render(<NotificationDetailDialog notification={makeNotification()} onClose={onClose} />);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
