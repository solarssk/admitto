// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommunicationSendDialog } from "../../src/communication/CommunicationSendDialog.js";

const sendEventBulk = vi.fn();
const fetchBulkSendStatus = vi.fn();

vi.mock("../../src/api/client.js", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  sendEventBulk: (...args: unknown[]) => sendEventBulk(...args),
  fetchBulkSendStatus: (...args: unknown[]) => fetchBulkSendStatus(...args),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CommunicationSendDialog", () => {
  it("disables send until ticket type is non-empty", async () => {
    render(
      <CommunicationSendDialog
        open
        eventId="evt-1"
        templateId="tpl-1"
        onClose={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Recipients"), { target: { value: "ticket_type" } });

    const sendBtn = screen.getByRole("button", { name: "Send" });
    const countBtn = screen.getByRole("button", { name: "Count recipients" });
    expect((sendBtn as HTMLButtonElement).disabled).toBe(true);
    expect((countBtn as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Enter a ticket type/i)).toBeTruthy();
  });

  it("ignores late runSend results after close", async () => {
    let resolveSend: ((value: unknown) => void) | undefined;
    sendEventBulk.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSend = resolve;
        }),
    );

    const onClose = vi.fn();
    const { rerender } = render(
      <CommunicationSendDialog
        open
        eventId="evt-1"
        templateId="tpl-1"
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Sending…" })).toBeTruthy();
    });

    rerender(
      <CommunicationSendDialog
        open={false}
        eventId="evt-1"
        templateId="tpl-1"
        onClose={onClose}
      />,
    );

    await act(async () => {
      resolveSend?.({ batchId: "batch-1", queued: 3, skipped: 0, failed: 0 });
      await Promise.resolve();
    });

    rerender(
      <CommunicationSendDialog
        open
        eventId="evt-1"
        templateId="tpl-1"
        onClose={onClose}
      />,
    );

    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
    expect(screen.queryByText(/sending in progress/i)).toBeNull();
    expect(fetchBulkSendStatus).not.toHaveBeenCalled();
  });

  it("blocks backdrop close while send is in flight", async () => {
    let resolveSend: ((value: unknown) => void) | undefined;
    sendEventBulk.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSend = resolve;
        }),
    );

    const onClose = vi.fn();
    render(
      <CommunicationSendDialog
        open
        eventId="evt-1"
        templateId="tpl-1"
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    fireEvent.click(document.querySelector(".add-attendee-modal__backdrop")!);

    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      resolveSend?.({ batchId: null, queued: 0, skipped: 0, failed: 0 });
      await Promise.resolve();
    });

    fireEvent.click(document.querySelector(".add-attendee-modal__backdrop")!);
    expect(onClose).toHaveBeenCalled();
  });
});
