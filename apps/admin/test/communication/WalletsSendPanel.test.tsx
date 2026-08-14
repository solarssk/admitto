// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WalletsSendPanel } from "../../src/communication/WalletsSendPanel.js";

const sendWalletMessage = vi.fn();
const fetchWalletMessageJob = vi.fn();
const fetchTicketTypes = vi.fn();
const fetchWalletMessageAttendees = vi.fn();

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    sendWalletMessage: (...args: unknown[]) => sendWalletMessage(...args),
    fetchWalletMessageJob: (...args: unknown[]) => fetchWalletMessageJob(...args),
    fetchTicketTypes: (...args: [string]) => fetchTicketTypes(...args),
    fetchWalletMessageAttendees: (...args: unknown[]) => fetchWalletMessageAttendees(...args),
  };
});

fetchTicketTypes.mockResolvedValue([]);
fetchWalletMessageAttendees.mockResolvedValue({ items: [] });

const activeEvent = { archived_at: null };
const archivedEvent = { archived_at: "2026-01-01T00:00:00.000Z" };

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

// The "shows a retry control..." test below calls fetchTicketTypes.mockReset(), which wipes the
// implementation entirely (not just call history, unlike vi.clearAllMocks() above) - restore the
// module-scope defaults before every test so later tests don't inherit that reset state.
beforeEach(() => {
  fetchTicketTypes.mockResolvedValue([]);
  fetchWalletMessageAttendees.mockResolvedValue({ items: [] });
});

describe("WalletsSendPanel", () => {
  it("shows the three wallet-scoped recipient filters, not mail's rsvp/no_delivery options", () => {
    render(<WalletsSendPanel event={activeEvent} eventId="evt-1" text="Hi" />);

    expect(screen.getByRole("radio", { name: "All attendees with a wallet" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "By ticket type" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Specific attendees" })).toBeTruthy();
    expect(screen.queryByRole("radio", { name: "By attendance status" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "Not yet emailed" })).toBeNull();
  });

  it("disables Send while the message text is empty, with a warning notice", () => {
    render(<WalletsSendPanel event={activeEvent} eventId="evt-1" text="" />);

    expect(screen.getByText("Write a message above before sending.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("disables Send but not Count recipients for an archived event", () => {
    render(<WalletsSendPanel event={archivedEvent} eventId="evt-1" text="Hi" />);

    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Count recipients" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("disables send until ticket type is chosen", () => {
    render(<WalletsSendPanel event={activeEvent} eventId="evt-1" text="Hi" />);
    fireEvent.click(screen.getByRole("radio", { name: "By ticket type" }));

    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Count recipients" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("shows the resolved recipient count from a dry run", async () => {
    sendWalletMessage.mockResolvedValue({ recipientCount: 42 });
    render(<WalletsSendPanel event={activeEvent} eventId="evt-1" text="Hi" />);

    fireEvent.click(screen.getByRole("button", { name: "Count recipients" }));

    expect(await screen.findByText("42")).toBeTruthy();
    expect(sendWalletMessage).toHaveBeenCalledWith("evt-1", {
      filter: { type: "all" },
      text: "Hi",
      dryRun: true,
    });
  });

  it("shows an error when the dry-run count request itself fails", async () => {
    sendWalletMessage.mockRejectedValue(new Error("network down"));
    render(<WalletsSendPanel event={activeEvent} eventId="evt-1" text="Hi" />);

    fireEvent.click(screen.getByRole("button", { name: "Count recipients" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
  });

  it("shows an error when the send request itself fails", async () => {
    sendWalletMessage.mockRejectedValue(new Error("network down"));
    render(<WalletsSendPanel event={activeEvent} eventId="evt-1" text="Hi" />);

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
  });

  it("reports zero matches distinctly from a positive count", async () => {
    sendWalletMessage.mockResolvedValue({ recipientCount: 0 });
    render(<WalletsSendPanel event={activeEvent} eventId="evt-1" text="Hi" />);

    fireEvent.click(screen.getByRole("button", { name: "Count recipients" }));

    expect(await screen.findByText("No recipients match this filter.")).toBeTruthy();
  });

  it("reports no recipients matched when send itself resolves a null jobId", async () => {
    sendWalletMessage.mockResolvedValue({ jobId: null, recipientCount: 0 });
    render(<WalletsSendPanel event={activeEvent} eventId="evt-1" text="Hi" />);

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("No recipients matched.")).toBeTruthy();
    expect(fetchWalletMessageJob).not.toHaveBeenCalled();
  });

  it("polls the job to completion and reports sent/skipped/errored counts", async () => {
    sendWalletMessage.mockResolvedValue({ jobId: "job-1", recipientCount: 5 });
    fetchWalletMessageJob.mockResolvedValue({
      jobId: "job-1",
      status: "succeeded",
      error: null,
      progressTotal: 5,
      progressDone: 5,
      sent: 4,
      skipped: 1,
      errored: 0,
      created_at: "2026-08-14T10:00:00.000Z",
      started_at: "2026-08-14T10:00:00.000Z",
    });

    render(<WalletsSendPanel event={activeEvent} eventId="evt-1" text="Hi" />);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("Sent to 4, 1 skipped.")).toBeTruthy();
    expect(fetchWalletMessageJob).toHaveBeenCalledWith("evt-1", "job-1", expect.any(AbortSignal));
  });

  it("shows the job's error and does not report a success message when the job fails", async () => {
    sendWalletMessage.mockResolvedValue({ jobId: "job-1", recipientCount: 5 });
    fetchWalletMessageJob.mockResolvedValue({
      jobId: "job-1",
      status: "failed",
      error: "wallet_not_configured",
      progressTotal: null,
      progressDone: null,
      sent: null,
      skipped: null,
      errored: null,
      created_at: "2026-08-14T10:00:00.000Z",
      started_at: null,
    });

    render(<WalletsSendPanel event={activeEvent} eventId="evt-1" text="Hi" />);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("wallet_not_configured")).toBeTruthy();
  });

  it("keeps polling on a timer while the job is still pending/running", async () => {
    vi.useFakeTimers();
    try {
      sendWalletMessage.mockResolvedValue({ jobId: "job-1", recipientCount: 2 });
      fetchWalletMessageJob
        .mockResolvedValueOnce({
          jobId: "job-1",
          status: "running",
          error: null,
          progressTotal: 2,
          progressDone: 0,
          sent: null,
          skipped: null,
          errored: null,
          created_at: "2026-08-14T10:00:00.000Z",
          started_at: "2026-08-14T10:00:00.000Z",
        })
        .mockResolvedValueOnce({
          jobId: "job-1",
          status: "succeeded",
          error: null,
          progressTotal: 2,
          progressDone: 2,
          sent: 2,
          skipped: 0,
          errored: 0,
          created_at: "2026-08-14T10:00:00.000Z",
          started_at: "2026-08-14T10:00:00.000Z",
        });

      render(<WalletsSendPanel event={activeEvent} eventId="evt-1" text="Hi" />);
      fireEvent.click(screen.getByRole("button", { name: "Send" }));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(fetchWalletMessageJob).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(fetchWalletMessageJob).toHaveBeenCalledTimes(2);
      expect(screen.getByText("Sent to 2.")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows an error and stops polling when the status check itself fails", async () => {
    sendWalletMessage.mockResolvedValue({ jobId: "job-1", recipientCount: 2 });
    fetchWalletMessageJob.mockRejectedValue(new Error("network down"));

    render(<WalletsSendPanel event={activeEvent} eventId="evt-1" text="Hi" />);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe("Failed to load send status.");
    });
  });

  it("resets the form via Send another after completion", async () => {
    sendWalletMessage.mockResolvedValue({ jobId: null, recipientCount: 0 });
    render(<WalletsSendPanel event={activeEvent} eventId="evt-1" text="Hi" />);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("No recipients matched.");

    fireEvent.click(screen.getByRole("button", { name: "Send another" }));

    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
    expect(screen.queryByText("No recipients matched.")).toBeNull();
  });

  it("uses the wallet-scoped attendee search, not the general one, for Specific attendees", async () => {
    render(<WalletsSendPanel event={activeEvent} eventId="evt-1" text="Hi" />);
    fireEvent.click(screen.getByRole("radio", { name: "Specific attendees" }));

    fireEvent.change(screen.getByLabelText("Search attendees"), { target: { value: "al" } });

    await waitFor(() =>
      expect(fetchWalletMessageAttendees).toHaveBeenCalledWith("evt-1", { q: "al", pageSize: 10 }),
    );
  });

  it("picking a specific attendee enables Send and builds an attendee_ids filter", async () => {
    fetchWalletMessageAttendees.mockResolvedValue({
      items: [{ id: "att-1", name: "Alex Example", email: "alex@example.com" }],
    });
    sendWalletMessage.mockResolvedValue({ recipientCount: 1 });

    render(<WalletsSendPanel event={activeEvent} eventId="evt-1" text="Hi" />);
    fireEvent.click(screen.getByRole("radio", { name: "Specific attendees" }));
    fireEvent.change(screen.getByLabelText("Search attendees"), { target: { value: "alex" } });
    fireEvent.click(await screen.findByRole("button", { name: /Alex Example/ }));

    expect(screen.getByText("Alex Example")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Count recipients" }));

    await waitFor(() =>
      expect(sendWalletMessage).toHaveBeenCalledWith("evt-1", {
        filter: { type: "attendee_ids", ids: ["att-1"] },
        text: "Hi",
        dryRun: true,
      }),
    );
  });

  it("picking a ticket type from a loaded catalog builds a ticket_type filter", async () => {
    fetchTicketTypes.mockResolvedValueOnce([
      { id: "tt-1", key: "vip", label: "VIP", color: "purple", sort_order: 0, attendee_count: 0, created_at: "2026-01-01T00:00:00.000Z" },
    ]);
    sendWalletMessage.mockResolvedValue({ recipientCount: 3 });

    render(<WalletsSendPanel event={activeEvent} eventId="evt-1" text="Hi" />);
    fireEvent.click(screen.getByRole("radio", { name: "By ticket type" }));

    fireEvent.click(await screen.findByRole("button", { name: /^Ticket type,/ }));
    fireEvent.click(await screen.findByRole("button", { name: "VIP" }));

    fireEvent.click(screen.getByRole("button", { name: "Count recipients" }));

    await waitFor(() =>
      expect(sendWalletMessage).toHaveBeenCalledWith("evt-1", {
        filter: { type: "ticket_type", value: "vip" },
        text: "Hi",
        dryRun: true,
      }),
    );
  });

  it("shows a retry control when the ticket type catalog fails to load, and retries the fetch on click", async () => {
    fetchTicketTypes.mockReset();
    fetchTicketTypes.mockRejectedValueOnce(new Error("network down"));
    fetchTicketTypes.mockResolvedValueOnce([]);

    render(<WalletsSendPanel event={activeEvent} eventId="evt-1" text="Hi" />);
    fireEvent.click(screen.getByRole("radio", { name: "By ticket type" }));

    await screen.findByRole("alert");
    expect(fetchTicketTypes).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(fetchTicketTypes).toHaveBeenCalledTimes(2));
  });

  it("shows a warning notice and reports the failed count when the job succeeds with some errors", async () => {
    sendWalletMessage.mockResolvedValue({ jobId: "job-1", recipientCount: 5 });
    fetchWalletMessageJob.mockResolvedValue({
      jobId: "job-1",
      status: "succeeded",
      error: null,
      progressTotal: 5,
      progressDone: 5,
      sent: 3,
      skipped: 0,
      errored: 2,
      created_at: "2026-08-14T10:00:00.000Z",
      started_at: "2026-08-14T10:00:00.000Z",
    });

    render(<WalletsSendPanel event={activeEvent} eventId="evt-1" text="Hi" />);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    const notice = await screen.findByText("Sent to 3, 2 failed.");
    expect(notice.closest(".at-notice--warning")).toBeTruthy();
  });

  it("falls back to a generic message when a failed job has no error detail", async () => {
    sendWalletMessage.mockResolvedValue({ jobId: "job-1", recipientCount: 5 });
    fetchWalletMessageJob.mockResolvedValue({
      jobId: "job-1",
      status: "failed",
      error: null,
      progressTotal: null,
      progressDone: null,
      sent: null,
      skipped: null,
      errored: null,
      created_at: "2026-08-14T10:00:00.000Z",
      started_at: null,
    });

    render(<WalletsSendPanel event={activeEvent} eventId="evt-1" text="Hi" />);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("Send failed.")).toBeTruthy();
  });

  it("ignores a ticket-type fetch failure after the panel unmounts", async () => {
    let rejectTypes: ((reason?: unknown) => void) | undefined;
    fetchTicketTypes.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectTypes = reject;
        }),
    );

    const { unmount } = render(<WalletsSendPanel event={activeEvent} eventId="evt-1" text="Hi" />);
    await waitFor(() => expect(fetchTicketTypes).toHaveBeenCalled());
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
    sendWalletMessage.mockResolvedValue({ jobId: "job-1", recipientCount: 2 });
    fetchWalletMessageJob.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStatus = resolve;
        }),
    );

    const first = render(<WalletsSendPanel event={activeEvent} eventId="evt-1" text="Hi" />);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(fetchWalletMessageJob).toHaveBeenCalled());
    first.unmount();
    await act(async () => {
      resolveStatus?.({
        jobId: "job-1",
        status: "succeeded",
        error: null,
        progressTotal: 2,
        progressDone: 2,
        sent: 2,
        skipped: 0,
        errored: 0,
        created_at: "2026-08-14T10:00:00.000Z",
        started_at: "2026-08-14T10:00:00.000Z",
      });
      await Promise.resolve();
    });

    fetchWalletMessageJob.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectStatus = reject;
        }),
    );
    const second = render(<WalletsSendPanel event={activeEvent} eventId="evt-1" text="Hi" />);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(fetchWalletMessageJob).toHaveBeenCalledTimes(2));
    second.unmount();
    await act(async () => {
      rejectStatus?.(new Error("network"));
      await Promise.resolve();
    });
  });

  it("ignores a late dry-run count after the event changes mid-request", async () => {
    let resolveDryRun: ((value: unknown) => void) | undefined;
    sendWalletMessage.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveDryRun = resolve;
        }),
    );

    const { rerender } = render(<WalletsSendPanel event={activeEvent} eventId="evt-1" text="Hi" />);
    fireEvent.click(screen.getByRole("button", { name: "Count recipients" }));
    await waitFor(() => expect(sendWalletMessage).toHaveBeenCalled());

    rerender(<WalletsSendPanel event={activeEvent} eventId="evt-2" text="Hi" />);

    await act(async () => {
      resolveDryRun?.({ recipientCount: 99 });
      await Promise.resolve();
    });

    expect(screen.queryByText("99")).toBeNull();
  });

  it("ignores a late dry-run failure after the event changes mid-request", async () => {
    let rejectDryRun: ((reason?: unknown) => void) | undefined;
    sendWalletMessage.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectDryRun = reject;
        }),
    );

    const { rerender } = render(<WalletsSendPanel event={activeEvent} eventId="evt-1" text="Hi" />);
    fireEvent.click(screen.getByRole("button", { name: "Count recipients" }));
    await waitFor(() => expect(sendWalletMessage).toHaveBeenCalled());

    rerender(<WalletsSendPanel event={activeEvent} eventId="evt-2" text="Hi" />);

    await act(async () => {
      rejectDryRun?.(new Error("stale failure"));
      await Promise.resolve();
    });

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("ignores a late send result after the event changes mid-send", async () => {
    let resolveSend: ((value: unknown) => void) | undefined;
    sendWalletMessage.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSend = resolve;
        }),
    );

    const { rerender } = render(<WalletsSendPanel event={activeEvent} eventId="evt-1" text="Hi" />);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(sendWalletMessage).toHaveBeenCalled());

    rerender(<WalletsSendPanel event={activeEvent} eventId="evt-2" text="Hi" />);

    await act(async () => {
      resolveSend?.({ jobId: "job-stale", recipientCount: 7 });
      await Promise.resolve();
    });

    expect(fetchWalletMessageJob).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
  });

  it("ignores a late send failure after the event changes mid-send", async () => {
    let rejectSend: ((reason?: unknown) => void) | undefined;
    sendWalletMessage.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectSend = reject;
        }),
    );

    const { rerender } = render(<WalletsSendPanel event={activeEvent} eventId="evt-1" text="Hi" />);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(sendWalletMessage).toHaveBeenCalled());

    rerender(<WalletsSendPanel event={activeEvent} eventId="evt-2" text="Hi" />);

    await act(async () => {
      rejectSend?.(new Error("stale failure"));
      await Promise.resolve();
    });

    expect(screen.queryByRole("alert")).toBeNull();
  });
});
