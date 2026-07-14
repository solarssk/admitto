// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommunicationSendDialog } from "../../src/communication/CommunicationSendDialog.js";

const sendEventBulk = vi.fn();
const fetchBulkSendStatus = vi.fn();
const fetchTicketTypes = vi.fn();

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    sendEventBulk: (...args: unknown[]) => sendEventBulk(...args),
    fetchBulkSendStatus: (...args: unknown[]) => fetchBulkSendStatus(...args),
    fetchTicketTypes: (...args: [string]) => fetchTicketTypes(...args),
  };
});

fetchTicketTypes.mockResolvedValue([]);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
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
    expect(screen.getByText(/Choose a ticket type/i)).toBeTruthy();
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

  it("shows detail when send returns queued zero with skipped/failed counts", async () => {
    sendEventBulk.mockResolvedValue({ batchId: "batch-1", queued: 0, skipped: 2, failed: 1 });

    render(
      <CommunicationSendDialog
        open
        eventId="evt-1"
        templateId="tpl-1"
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(screen.getByText(/No emails queued \(2 skipped, 1 failed\)/i)).toBeTruthy();
    });
  });

  it("aborts polling when the dialog closes", async () => {
    let pollSignal: AbortSignal | undefined;
    sendEventBulk.mockResolvedValue({ batchId: "batch-1", queued: 2, skipped: 0, failed: 0 });
    fetchBulkSendStatus.mockImplementation(
      (_eventId: string, _batchId: string, signal?: AbortSignal) => {
        pollSignal = signal;
        return new Promise(() => {});
      },
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
      expect(fetchBulkSendStatus).toHaveBeenCalled();
    });

    rerender(
      <CommunicationSendDialog
        open={false}
        eventId="evt-1"
        templateId="tpl-1"
        onClose={onClose}
      />,
    );

    expect(pollSignal?.aborted).toBe(true);
  });

  it("resets to the form when reopened after closing mid-send", async () => {
    sendEventBulk.mockResolvedValue({ batchId: null, queued: 0, skipped: 0, failed: 0 });

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
      expect(screen.getByText(/No recipients matched/i)).toBeTruthy();
    });

    rerender(
      <CommunicationSendDialog
        open={false}
        eventId="evt-1"
        templateId="tpl-1"
        onClose={onClose}
      />,
    );

    rerender(
      <CommunicationSendDialog
        open
        eventId="evt-1"
        templateId="tpl-1"
        onClose={onClose}
      />,
    );

    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
    expect(screen.queryByText(/No recipients matched/i)).toBeNull();
  });

  it("shows operator-safe dry run failure", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    sendEventBulk.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    render(
      <CommunicationSendDialog open eventId="evt-1" templateId="tpl-1" onClose={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Count recipients" }));
    await waitFor(() => {
      expect(screen.getByText(/Dry run failed/)).toBeTruthy();
    });
    expect(screen.queryByText("secret_internal")).toBeNull();
  });

  it("shows operator-safe send failure", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    sendEventBulk.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    render(
      <CommunicationSendDialog open eventId="evt-1" templateId="tpl-1" onClose={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect(screen.getByText(/Send failed/)).toBeTruthy();
    });
  });

  it("shows instance URL guidance when mail base URL is unset", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    sendEventBulk.mockRejectedValueOnce(
      new ApiError(422, "instance_url_required", "instance_url_required"),
    );
    render(
      <CommunicationSendDialog open eventId="evt-1" templateId="tpl-1" onClose={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect(screen.getByText(/Instance URL/)).toBeTruthy();
    });
    expect(screen.queryByText(/Send failed/)).toBeNull();
  });

  it("clears stale ticket types when eventId changes while the dialog stays open", async () => {
    let resolveEventB: ((value: unknown) => void) | undefined;
    fetchTicketTypes.mockImplementationOnce(async () => [
      {
        id: "tt-a",
        key: "vip",
        label: "VIP (Event A)",
        color: "purple",
        sort_order: 0,
        attendee_count: 0,
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ]);
    fetchTicketTypes.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveEventB = resolve;
        }),
    );

    const { rerender } = render(
      <CommunicationSendDialog open eventId="evt-a" templateId="tpl-1" onClose={vi.fn()} />,
    );

    fireEvent.change(screen.getByLabelText("Recipients"), { target: { value: "ticket_type" } });

    await waitFor(() => {
      expect(screen.getByRole("option", { name: "VIP (Event A)" })).toBeTruthy();
    });

    rerender(
      <CommunicationSendDialog open eventId="evt-b" templateId="tpl-1" onClose={vi.fn()} />,
    );

    await waitFor(() => {
      expect(fetchTicketTypes).toHaveBeenCalledWith("evt-b");
    });

    // Event A's ticket type must not be selectable while Event B's fetch is still in flight.
    expect(screen.queryByRole("option", { name: "VIP (Event A)" })).toBeNull();

    await act(async () => {
      resolveEventB?.([
        {
          id: "tt-b",
          key: "ga",
          label: "General (Event B)",
          color: "blue",
          sort_order: 0,
          attendee_count: 0,
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ]);
      await Promise.resolve();
    });

    expect(screen.getByRole("option", { name: "General (Event B)" })).toBeTruthy();
  });
});
