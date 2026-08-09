// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeliveryRowMenu } from "../../src/communication/DeliveryRowMenu.js";
import type { DeliveryDto } from "../../src/api/types.js";

const row: DeliveryDto = {
  id: "dlv-1",
  attendee_id: "att-1",
  attendee_name: "Guest One",
  purpose: "initial",
  status: "sent",
  provider: "smtp",
  provider_message_id: null,
  attempts: 1,
  retryable: null,
  recipient_email: "guest@example.com",
  rendered_subject: "Your ticket",
  template_id: null,
  template_name: null,
  queued_at: "2026-09-01T12:00:00.000Z",
  accepted_at: "2026-09-01T12:00:00.000Z",
  sent_at: "2026-09-01T12:00:00.000Z",
  failed_at: null,
  error_code: null,
  error: null,
  client_timezone: null,
};

/** Stubs getBoundingClientRect so the trigger and the menu panel each report a fixed, realistic
 * size - jsdom's real layout engine always returns all-zero rects, which would hide every
 * viewport-collision case this suite exists to catch (everything trivially "fits" at 0x0). Same
 * approach as packages/ui/test/tooltip.test.tsx, distinguishing by role="menu" instead of
 * role="tooltip". */
function stubRects(triggerRect: Partial<DOMRect>, panelRect: Partial<DOMRect>) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const rect = this.getAttribute("role") === "menu" ? panelRect : triggerRect;
    return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {}, ...rect };
  });
}

describe("DeliveryRowMenu", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("opens on trigger click and calls the right callback for each action, closing after", () => {
    const onViewSentMessage = vi.fn();
    const onViewDetails = vi.fn();
    render(<DeliveryRowMenu row={row} onViewSentMessage={onViewSentMessage} onViewDetails={onViewDetails} />);

    fireEvent.click(screen.getByRole("button", { name: "Actions for Guest One's message" }));
    expect(screen.getByRole("menu")).toBeTruthy();

    fireEvent.click(screen.getByRole("menuitem", { name: "View sent message" }));
    expect(onViewSentMessage).toHaveBeenCalledWith(row);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("positions the panel above the trigger when there isn't enough room below", () => {
    stubRects(
      { top: 700, bottom: 720, left: 270, right: 300 },
      { height: 100, width: 220 },
    );
    vi.stubGlobal("innerHeight", 730);
    vi.stubGlobal("innerWidth", 1024);

    const onViewDetails = vi.fn();
    render(<DeliveryRowMenu row={row} onViewSentMessage={vi.fn()} onViewDetails={onViewDetails} />);
    fireEvent.click(screen.getByRole("button", { name: "Actions for Guest One's message" }));

    const panel = screen.getByRole("menu");
    // placeAbove: spaceAbove (700) > spaceBelow (730-720=10) - top = 700 - 100 - MARGIN(5).
    expect(panel.style.top).toBe("595px");

    fireEvent.click(screen.getByRole("menuitem", { name: "View delivery details" }));
    expect(onViewDetails).toHaveBeenCalledWith(row);
  });

  it("positions the panel below the trigger when there's more room below than above", () => {
    stubRects(
      { top: 20, bottom: 40, left: 270, right: 300 },
      { height: 100, width: 220 },
    );
    vi.stubGlobal("innerHeight", 730);
    vi.stubGlobal("innerWidth", 1024);

    render(<DeliveryRowMenu row={row} onViewSentMessage={vi.fn()} onViewDetails={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Actions for Guest One's message" }));

    const panel = screen.getByRole("menu");
    // Not placeAbove: bottom (40) + MARGIN(5).
    expect(panel.style.top).toBe("45px");
  });

  it("closes when a scrolling ancestor scrolls while open", () => {
    stubRects({ top: 20, bottom: 40, left: 270, right: 300 }, { height: 100, width: 220 });
    vi.stubGlobal("innerHeight", 730);
    vi.stubGlobal("innerWidth", 1024);

    render(<DeliveryRowMenu row={row} onViewSentMessage={vi.fn()} onViewDetails={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Actions for Guest One's message" }));
    expect(screen.getByRole("menu")).toBeTruthy();

    fireEvent.scroll(window);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("shows Resend and Dismiss bounce for a bounced row when both callbacks are supplied", () => {
    const bouncedRow = { ...row, status: "bounced" };
    const onResend = vi.fn();
    const onDismiss = vi.fn();
    render(
      <DeliveryRowMenu
        row={bouncedRow}
        onViewSentMessage={vi.fn()}
        onViewDetails={vi.fn()}
        onResend={onResend}
        onDismiss={onDismiss}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Actions for Guest One's message" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Resend" }));
    expect(onResend).toHaveBeenCalledWith(bouncedRow);
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Actions for Guest One's message" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Dismiss bounce" }));
    expect(onDismiss).toHaveBeenCalledWith(bouncedRow);
  });

  it("does not show Resend/Dismiss for a non-bounced row even when both callbacks are supplied", () => {
    render(
      <DeliveryRowMenu
        row={row}
        onViewSentMessage={vi.fn()}
        onViewDetails={vi.fn()}
        onResend={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Actions for Guest One's message" }));
    expect(screen.queryByRole("menuitem", { name: "Resend" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Dismiss bounce" })).toBeNull();
  });

  it("does not offer Resend when the delivery template was deleted", () => {
    const bouncedDeletedTemplateRow = {
      ...row,
      status: "bounced" as const,
      template_id: null,
      template_name: "Deleted event template",
    };
    render(
      <DeliveryRowMenu
        row={bouncedDeletedTemplateRow}
        onViewSentMessage={vi.fn()}
        onViewDetails={vi.fn()}
        onResend={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Actions for Guest One's message" }));

    expect(screen.queryByRole("menuitem", { name: "Resend" })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Dismiss bounce" })).toBeTruthy();
  });

  it("does not show Resend/Dismiss for a bounced row when the callbacks are omitted (Attendee Detail's own delivery card)", () => {
    const bouncedRow = { ...row, status: "bounced" };
    render(<DeliveryRowMenu row={bouncedRow} onViewSentMessage={vi.fn()} onViewDetails={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Actions for Guest One's message" }));
    expect(screen.queryByRole("menuitem", { name: "Resend" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Dismiss bounce" })).toBeNull();
  });

  it("greys out both Resend and Dismiss bounce once bounceResolved is true, without hiding them", () => {
    const bouncedRow = { ...row, status: "bounced" };
    const onResend = vi.fn();
    const onDismiss = vi.fn();
    render(
      <DeliveryRowMenu
        row={bouncedRow}
        onViewSentMessage={vi.fn()}
        onViewDetails={vi.fn()}
        onResend={onResend}
        onDismiss={onDismiss}
        bounceResolved
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Actions for Guest One's message" }));
    const resendItem = screen.getByRole("menuitem", { name: "Resend" }) as HTMLButtonElement;
    const dismissItem = screen.getByRole("menuitem", { name: "Dismiss bounce" }) as HTMLButtonElement;
    expect(resendItem.disabled).toBe(true);
    expect(dismissItem.disabled).toBe(true);

    fireEvent.click(resendItem);
    fireEvent.click(dismissItem);
    expect(onResend).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("greys out both Resend and Dismiss bounce while bouncePending is true", () => {
    const bouncedRow = { ...row, status: "bounced" };
    const onResend = vi.fn();
    const onDismiss = vi.fn();
    render(
      <DeliveryRowMenu
        row={bouncedRow}
        onViewSentMessage={vi.fn()}
        onViewDetails={vi.fn()}
        onResend={onResend}
        onDismiss={onDismiss}
        bouncePending
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Actions for Guest One's message" }));
    const resendItem = screen.getByRole("menuitem", { name: "Resend" }) as HTMLButtonElement;
    const dismissItem = screen.getByRole("menuitem", { name: "Dismiss bounce" }) as HTMLButtonElement;
    expect(resendItem.disabled).toBe(true);
    expect(dismissItem.disabled).toBe(true);
    expect(resendItem.title).toBe("Working…");

    fireEvent.click(resendItem);
    fireEvent.click(dismissItem);
    expect(onResend).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
