// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommunicationSendPanel } from "../../src/communication/CommunicationSendPanel.js";

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

const activeEvent = { archived_at: null };
const archivedEvent = { archived_at: "2026-01-01T00:00:00.000Z" };

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("CommunicationSendPanel", () => {
  it("shows a placeholder instead of the form when the editor snapshot failed to load", () => {
    render(<CommunicationSendPanel event={activeEvent} eventId="evt-1" snapshotMissing isDirty={false} />);

    expect(screen.getByText("Could not load the ticket template. Reload the page.")).toBeTruthy();
    expect(screen.queryByLabelText("Recipients")).toBeNull();
  });

  it("still shows the send form with no explicit template override (backend falls back to the built-in default)", () => {
    render(<CommunicationSendPanel event={activeEvent} eventId="evt-1" snapshotMissing={false} isDirty={false} />);

    expect(screen.getByLabelText("Recipients")).toBeTruthy();
    expect(screen.queryByText("Could not load the ticket template. Reload the page.")).toBeNull();
  });

  it("uses attendance labels for the attendance recipient filter", () => {
    render(<CommunicationSendPanel event={activeEvent} snapshotMissing={false} isDirty={false} eventId="evt-1" templateId="tpl-1" />);

    fireEvent.click(screen.getByRole("radio", { name: "By attendance status" }));

    expect(screen.getByRole("button", { name: /^Attendance status,/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Attendance status,/ }));
    expect(screen.getByRole("button", { name: "Registered" })).toBeTruthy();
    expect(screen.queryByText("RSVP status")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Confirmed" }));
    expect(screen.getByRole("button", { name: "Attendance status, Confirmed" })).toBeTruthy();
  });

  it("disables send until ticket type is non-empty", async () => {
    render(<CommunicationSendPanel event={activeEvent} snapshotMissing={false} isDirty={false} eventId="evt-1" templateId="tpl-1" />);

    fireEvent.click(screen.getByRole("radio", { name: "By ticket type" }));

    const sendBtn = screen.getByRole("button", { name: "Send" });
    const countBtn = screen.getByRole("button", { name: "Count recipients" });
    expect((sendBtn as HTMLButtonElement).disabled).toBe(true);
    expect((countBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it("disables Send but not Count recipients for an archived event", () => {
    render(<CommunicationSendPanel event={archivedEvent} snapshotMissing={false} isDirty={false} eventId="evt-1" templateId="tpl-1" />);

    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Count recipients" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("disables Send but not Count recipients while the template has unsaved changes", () => {
    render(<CommunicationSendPanel event={activeEvent} snapshotMissing={false} isDirty eventId="evt-1" templateId="tpl-1" />);

    expect(screen.getByText(/unsaved template changes/i)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Count recipients" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("ignores late runSend results after the selected template changes", async () => {
    let resolveSend: ((value: unknown) => void) | undefined;
    sendEventBulk.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSend = resolve;
        }),
    );

    const { rerender } = render(
      <CommunicationSendPanel event={activeEvent} snapshotMissing={false} isDirty={false} eventId="evt-1" templateId="tpl-1" />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Sending…" })).toBeTruthy();
    });

    // Switching to a different template mid-send is the inline-panel equivalent of closing
    // the old modal - it must reset the form and ignore whatever the stale request resolves to.
    rerender(<CommunicationSendPanel event={activeEvent} snapshotMissing={false} isDirty={false} eventId="evt-1" templateId="tpl-2" />);

    await act(async () => {
      resolveSend?.({ batchId: "batch-1", queued: 3, skipped: 0, failed: 0 });
      await Promise.resolve();
    });

    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
    expect(screen.queryByText(/sending in progress/i)).toBeNull();
    expect(fetchBulkSendStatus).not.toHaveBeenCalled();
  });

  it("shows detail when send returns queued zero with skipped/failed counts", async () => {
    sendEventBulk.mockResolvedValue({ batchId: "batch-1", queued: 0, skipped: 2, failed: 1 });

    render(<CommunicationSendPanel event={activeEvent} snapshotMissing={false} isDirty={false} eventId="evt-1" templateId="tpl-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(screen.getByText(/No emails queued \(2 skipped, 1 failed\)/i)).toBeTruthy();
    });
  });

  it("summarizes a completed batch after polling, including both sent and failed counts", async () => {
    sendEventBulk.mockResolvedValue({ batchId: "batch-1", queued: 2, skipped: 0, failed: 0 });
    fetchBulkSendStatus.mockResolvedValue({ queued: 0, sent: 1, failed: 1 });

    render(<CommunicationSendPanel event={activeEvent} snapshotMissing={false} isDirty={false} eventId="evt-1" templateId="tpl-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("Send complete: 1 sent, 1 failed.")).toBeTruthy();
    expect(fetchBulkSendStatus).toHaveBeenCalledWith("evt-1", "batch-1", expect.any(AbortSignal));
  });

  it("keeps polling on a timer while emails are still queued", async () => {
    vi.useFakeTimers();
    try {
      sendEventBulk.mockResolvedValue({ batchId: "batch-1", queued: 2, skipped: 0, failed: 0 });
      fetchBulkSendStatus
        .mockResolvedValueOnce({ queued: 2, sent: 0, failed: 0 })
        .mockResolvedValueOnce({ queued: 0, sent: 2, failed: 0 });

      render(<CommunicationSendPanel event={activeEvent} snapshotMissing={false} isDirty={false} eventId="evt-1" templateId="tpl-1" />);
      fireEvent.click(screen.getByRole("button", { name: "Send" }));

      // Flush the initial sendEventBulk call and the first poll() it triggers.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(fetchBulkSendStatus).toHaveBeenCalledTimes(1);

      // Advance past the 2s retry delay and flush the second poll.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(fetchBulkSendStatus).toHaveBeenCalledTimes(2);
      expect(screen.getByText("Send complete: 2 sent, 0 failed.")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows an error and stops polling when the status check fails", async () => {
    sendEventBulk.mockResolvedValue({ batchId: "batch-1", queued: 2, skipped: 0, failed: 0 });
    fetchBulkSendStatus.mockRejectedValue(new Error("network down"));

    render(<CommunicationSendPanel event={activeEvent} snapshotMissing={false} isDirty={false} eventId="evt-1" templateId="tpl-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe("Failed to load send status.");
    });
  });

  it("aborts polling when the selected template changes", async () => {
    let pollSignal: AbortSignal | undefined;
    sendEventBulk.mockResolvedValue({ batchId: "batch-1", queued: 2, skipped: 0, failed: 0 });
    fetchBulkSendStatus.mockImplementation(
      (_eventId: string, _batchId: string, signal?: AbortSignal) => {
        pollSignal = signal;
        return new Promise(() => {});
      },
    );

    const { rerender } = render(
      <CommunicationSendPanel event={activeEvent} snapshotMissing={false} isDirty={false} eventId="evt-1" templateId="tpl-1" />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(fetchBulkSendStatus).toHaveBeenCalled();
    });

    rerender(<CommunicationSendPanel event={activeEvent} snapshotMissing={false} isDirty={false} eventId="evt-1" templateId="tpl-2" />);

    expect(pollSignal?.aborted).toBe(true);
  });

  it("resets to the form after switching templates and back mid-send", async () => {
    sendEventBulk.mockResolvedValue({ batchId: null, queued: 0, skipped: 0, failed: 0 });

    const { rerender } = render(
      <CommunicationSendPanel event={activeEvent} snapshotMissing={false} isDirty={false} eventId="evt-1" templateId="tpl-1" />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(screen.getByText(/No recipients matched/i)).toBeTruthy();
    });

    rerender(<CommunicationSendPanel event={activeEvent} snapshotMissing={false} isDirty={false} eventId="evt-1" templateId="tpl-2" />);
    rerender(<CommunicationSendPanel event={activeEvent} snapshotMissing={false} isDirty={false} eventId="evt-1" templateId="tpl-1" />);

    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
    expect(screen.queryByText(/No recipients matched/i)).toBeNull();
  });

  it("shows the recipient count after a successful dry run", async () => {
    sendEventBulk.mockResolvedValueOnce({ recipientCount: 5 });
    render(<CommunicationSendPanel event={activeEvent} snapshotMissing={false} isDirty={false} eventId="evt-1" templateId="tpl-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Count recipients" }));
    expect(await screen.findByText(/recipients matched/)).toBeTruthy();
    expect(screen.getByText("5")).toBeTruthy();
    expect(sendEventBulk).toHaveBeenCalledWith("evt-1", {
      templateId: "tpl-1",
      filter: { type: "all" },
      dryRun: true,
    });
  });

  it("shows operator-safe dry run failure", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    sendEventBulk.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    render(<CommunicationSendPanel event={activeEvent} snapshotMissing={false} isDirty={false} eventId="evt-1" templateId="tpl-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Count recipients" }));
    await waitFor(() => {
      expect(screen.getByText(/Dry run failed/)).toBeTruthy();
    });
    expect(screen.queryByText("secret_internal")).toBeNull();
  });

  it("shows operator-safe send failure", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    sendEventBulk.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    render(<CommunicationSendPanel event={activeEvent} snapshotMissing={false} isDirty={false} eventId="evt-1" templateId="tpl-1" />);
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
    render(<CommunicationSendPanel event={activeEvent} snapshotMissing={false} isDirty={false} eventId="evt-1" templateId="tpl-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect(screen.getByText(/Instance URL/)).toBeTruthy();
    });
    expect(screen.queryByText(/Send failed/)).toBeNull();
  });

  it("clears stale ticket types when eventId changes while the panel stays mounted", async () => {
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
      <CommunicationSendPanel event={activeEvent} snapshotMissing={false} isDirty={false} eventId="evt-a" templateId="tpl-1" />,
    );

    fireEvent.click(screen.getByRole("radio", { name: "By ticket type" }));

    fireEvent.click(screen.getByRole("button", { name: /^Ticket type,/ }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "VIP (Event A)" })).toBeTruthy();
    });

    rerender(<CommunicationSendPanel event={activeEvent} snapshotMissing={false} isDirty={false} eventId="evt-b" templateId="tpl-1" />);

    await waitFor(() => {
      expect(fetchTicketTypes).toHaveBeenCalledWith("evt-b");
    });

    // Event A's ticket type must not be selectable while Event B's fetch is still in flight.
    expect(screen.queryByRole("button", { name: "VIP (Event A)" })).toBeNull();

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

    expect(screen.getByRole("button", { name: "General (Event B)" })).toBeTruthy();
  });

  it("clears the selected ticket type (not just the options list) when eventId changes", async () => {
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
    fetchTicketTypes.mockImplementationOnce(async () => [
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

    const { rerender } = render(
      <CommunicationSendPanel event={activeEvent} snapshotMissing={false} isDirty={false} eventId="evt-a" templateId="tpl-1" />,
    );

    fireEvent.click(screen.getByRole("radio", { name: "By ticket type" }));

    fireEvent.click(screen.getByRole("button", { name: /^Ticket type,/ }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "VIP (Event A)" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "VIP (Event A)" }));

    // Selecting a value makes Count/Send actionable.
    await waitFor(() => {
      expect(
        (screen.getByRole("button", { name: "Count recipients" }) as HTMLButtonElement).disabled,
      ).toBe(false);
    });

    rerender(<CommunicationSendPanel event={activeEvent} snapshotMissing={false} isDirty={false} eventId="evt-b" templateId="tpl-1" />);

    fireEvent.click(screen.getByRole("button", { name: /^Ticket type,/ }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "General (Event B)" })).toBeTruthy();
    });

    // The stale "vip" selection from event A must not still be silently active on event B -
    // the select reverts to its placeholder and Count/Send disable again until re-chosen.
    expect(screen.getByRole("button", { name: "Ticket type, none selected" })).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Count recipients" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("shows a retry control when ticket types fail to load, and retries on click", async () => {
    fetchTicketTypes.mockRejectedValueOnce(new Error("network down"));
    fetchTicketTypes.mockResolvedValueOnce([
      {
        id: "tt-a",
        key: "vip",
        label: "VIP",
        color: "purple",
        sort_order: 0,
        attendee_count: 0,
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ]);

    render(<CommunicationSendPanel event={activeEvent} snapshotMissing={false} isDirty={false} eventId="evt-1" templateId="tpl-1" />);
    fireEvent.click(screen.getByRole("radio", { name: "By ticket type" }));

    expect(await screen.findByText("Failed to load ticket types.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(fetchTicketTypes).toHaveBeenCalledTimes(2);
    });
    expect(screen.queryByText("Failed to load ticket types.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Ticket type,/ }));
    expect(await screen.findByRole("button", { name: "VIP" })).toBeTruthy();
  });

  it("posts ticket_type / rsvp_status / no_delivery filters from Count recipients", async () => {
    fetchTicketTypes.mockResolvedValue([
      {
        id: "tt-1",
        key: "vip",
        label: "VIP",
        color: "purple",
        sort_order: 0,
        attendee_count: 0,
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ]);
    sendEventBulk.mockResolvedValue({ recipientCount: 2 });

    render(
      <CommunicationSendPanel
        event={activeEvent}
        snapshotMissing={false}
        isDirty={false}
        eventId="evt-1"
        templateId="tpl-1"
      />,
    );

    fireEvent.click(screen.getByRole("radio", { name: "By ticket type" }));
    fireEvent.click(await screen.findByRole("button", { name: /^Ticket type,/ }));
    fireEvent.click(await screen.findByRole("button", { name: "VIP" }));
    fireEvent.click(screen.getByRole("button", { name: "Count recipients" }));
    await waitFor(() => {
      expect(sendEventBulk).toHaveBeenLastCalledWith("evt-1", {
        templateId: "tpl-1",
        filter: { type: "ticket_type", value: "vip" },
        dryRun: true,
      });
    });

    fireEvent.click(screen.getByRole("radio", { name: "By attendance status" }));
    fireEvent.click(screen.getByRole("button", { name: /^Attendance status,/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmed" }));
    fireEvent.click(screen.getByRole("button", { name: "Count recipients" }));
    await waitFor(() => {
      expect(sendEventBulk).toHaveBeenLastCalledWith("evt-1", {
        templateId: "tpl-1",
        filter: { type: "rsvp_status", value: "confirmed" },
        dryRun: true,
      });
    });

    fireEvent.click(screen.getByRole("radio", { name: "Not yet emailed" }));
    fireEvent.click(screen.getByRole("button", { name: "Count recipients" }));
    await waitFor(() => {
      expect(sendEventBulk).toHaveBeenLastCalledWith("evt-1", {
        templateId: "tpl-1",
        filter: { type: "no_delivery" },
        dryRun: true,
      });
    });
  });

  it("shows the empty and singular dry-run recipient notices", async () => {
    let dryRuns = 0;
    sendEventBulk.mockImplementation(async () => {
      dryRuns += 1;
      return { recipientCount: dryRuns === 1 ? 0 : 1 };
    });

    render(
      <CommunicationSendPanel
        event={activeEvent}
        snapshotMissing={false}
        isDirty={false}
        eventId="evt-1"
        templateId="tpl-1"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Count recipients" }));
    expect(await screen.findByText("No recipients match this filter.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Count recipients" }));
    await waitFor(() => {
      expect(document.body.textContent).toMatch(/1 recipient matched/);
    });
  });

  it("ignores a dry-run body without recipientCount and late dry-run results after a template switch", async () => {
    let resolveDry: ((value: unknown) => void) | undefined;
    let calls = 0;
    sendEventBulk.mockImplementation(() => {
      calls += 1;
      if (calls === 1) return Promise.resolve({});
      return new Promise((resolve) => {
        resolveDry = resolve;
      });
    });

    const { rerender } = render(
      <CommunicationSendPanel
        event={activeEvent}
        snapshotMissing={false}
        isDirty={false}
        eventId="evt-1"
        templateId="tpl-1"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Count recipients" }));
    await waitFor(() => {
      expect(sendEventBulk).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText("No recipients match this filter.")).toBeNull();
    expect(screen.queryByText(/recipients matched/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Count recipients" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Checking…" })).toBeTruthy();
    });
    rerender(
      <CommunicationSendPanel
        event={activeEvent}
        snapshotMissing={false}
        isDirty={false}
        eventId="evt-1"
        templateId="tpl-2"
      />,
    );
    await act(async () => {
      resolveDry?.({ recipientCount: 9 });
      await Promise.resolve();
    });
    expect(screen.queryByText("9")).toBeNull();
    expect(screen.getByRole("button", { name: "Count recipients" })).toBeTruthy();
  });

  it("ignores a late dry-run failure after the selected template changes", async () => {
    let rejectDry: ((reason?: unknown) => void) | undefined;
    sendEventBulk.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectDry = reject;
        }),
    );

    const { rerender } = render(
      <CommunicationSendPanel
        event={activeEvent}
        snapshotMissing={false}
        isDirty={false}
        eventId="evt-1"
        templateId="tpl-1"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Count recipients" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Checking…" })).toBeTruthy();
    });
    rerender(
      <CommunicationSendPanel
        event={activeEvent}
        snapshotMissing={false}
        isDirty={false}
        eventId="evt-1"
        templateId="tpl-2"
      />,
    );
    await act(async () => {
      rejectDry?.(new Error("network"));
      await Promise.resolve();
    });
    expect(screen.queryByText(/Dry run failed/)).toBeNull();
  });

  it("ignores a late send failure after the selected template changes", async () => {
    let rejectSend: ((reason?: unknown) => void) | undefined;
    sendEventBulk.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectSend = reject;
        }),
    );

    const { rerender } = render(
      <CommunicationSendPanel
        event={activeEvent}
        snapshotMissing={false}
        isDirty={false}
        eventId="evt-1"
        templateId="tpl-1"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Sending…" })).toBeTruthy();
    });
    rerender(
      <CommunicationSendPanel
        event={activeEvent}
        snapshotMissing={false}
        isDirty={false}
        eventId="evt-1"
        templateId="tpl-2"
      />,
    );
    await act(async () => {
      rejectSend?.(new Error("network"));
      await Promise.resolve();
    });
    expect(screen.queryByText(/Send failed/)).toBeNull();
  });

  it("reports queued-zero with skipped-only, failed-only, and neither detail", async () => {
    sendEventBulk
      .mockResolvedValueOnce({ batchId: "b1", queued: 0, skipped: 3, failed: 0 })
      .mockResolvedValueOnce({ batchId: "b2", queued: 0, skipped: 0, failed: 2 })
      .mockResolvedValueOnce({ batchId: "b3", queued: 0, skipped: 0, failed: 0 });

    const { rerender } = render(
      <CommunicationSendPanel
        event={activeEvent}
        snapshotMissing={false}
        isDirty={false}
        eventId="evt-1"
        templateId="tpl-1"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("No emails queued (3 skipped).")).toBeTruthy();

    rerender(
      <CommunicationSendPanel
        event={activeEvent}
        snapshotMissing={false}
        isDirty={false}
        eventId="evt-1"
        templateId="tpl-2"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("No emails queued (2 failed).")).toBeTruthy();

    rerender(
      <CommunicationSendPanel
        event={activeEvent}
        snapshotMissing={false}
        isDirty={false}
        eventId="evt-1"
        templateId="tpl-3"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("No emails queued.")).toBeTruthy();
  });

  it("ignores ticket-type fetch failures after the panel unmounts", async () => {
    let rejectTypes: ((reason?: unknown) => void) | undefined;
    fetchTicketTypes.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectTypes = reject;
        }),
    );

    const { unmount } = render(
      <CommunicationSendPanel
        event={activeEvent}
        snapshotMissing={false}
        isDirty={false}
        eventId="evt-1"
        templateId="tpl-1"
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "By ticket type" }));
    expect(fetchTicketTypes).toHaveBeenCalled();
    unmount();
    await act(async () => {
      rejectTypes?.(new Error("gone"));
      await Promise.resolve();
    });
    // Cancelled path must not resurrect error UI after unmount.
    expect(screen.queryByText("Failed to load ticket types.")).toBeNull();
  });

  it("ignores poll results and poll failures after the panel unmounts mid-send", async () => {
    let resolveStatus: ((value: unknown) => void) | undefined;
    let rejectStatus: ((reason?: unknown) => void) | undefined;
    sendEventBulk.mockReset();
    fetchBulkSendStatus.mockReset();
    sendEventBulk.mockResolvedValue({ batchId: "batch-1", queued: 2, skipped: 0, failed: 0 });
    fetchBulkSendStatus.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStatus = resolve;
        }),
    );

    const first = render(
      <CommunicationSendPanel
        event={activeEvent}
        snapshotMissing={false}
        isDirty={false}
        eventId="evt-1"
        templateId="tpl-1"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect(fetchBulkSendStatus).toHaveBeenCalled();
    });
    first.unmount();
    await act(async () => {
      resolveStatus?.({ queued: 0, sent: 2, failed: 0 });
      await Promise.resolve();
    });

    fetchBulkSendStatus.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectStatus = reject;
        }),
    );
    const second = render(
      <CommunicationSendPanel
        event={activeEvent}
        snapshotMissing={false}
        isDirty={false}
        eventId="evt-1"
        templateId="tpl-1"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect(fetchBulkSendStatus).toHaveBeenCalledTimes(2);
    });
    second.unmount();
    await act(async () => {
      rejectStatus?.(new Error("network"));
      await Promise.resolve();
    });
  });

  it("ignores a scheduled poll tick after the panel unmounts", async () => {
    // Kept as a regression: cleanup must clear the 2s poll timer so a late tick cannot
    // call fetchBulkSendStatus after unmount (the cancelled guard at the top of poll was
    // removed as dead - clearTimeout already prevents re-entry).
    vi.useFakeTimers({ shouldAdvanceTime: true });
    sendEventBulk.mockReset();
    fetchBulkSendStatus.mockReset();
    sendEventBulk.mockResolvedValue({ batchId: "batch-1", queued: 2, skipped: 0, failed: 0 });
    fetchBulkSendStatus.mockResolvedValueOnce({ queued: 1, sent: 1, failed: 0 });

    const view = render(
      <CommunicationSendPanel
        event={activeEvent}
        snapshotMissing={false}
        isDirty={false}
        eventId="evt-1"
        templateId="tpl-1"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect(fetchBulkSendStatus).toHaveBeenCalledTimes(1);
    });
    view.unmount();
    fetchBulkSendStatus.mockClear();
    await act(async () => {
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
    });
    expect(fetchBulkSendStatus).not.toHaveBeenCalled();
  });
});
