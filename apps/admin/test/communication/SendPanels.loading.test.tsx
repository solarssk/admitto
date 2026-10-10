// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommunicationSendPanel } from "../../src/communication/CommunicationSendPanel.js";
import { WalletsSendPanel } from "../../src/communication/WalletsSendPanel.js";
import { advanceTimers, deferred, hangUntilAborted, isOff, makeTicketType } from "../test-utils.js";

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    sendEventBulk: vi.fn(),
    fetchBulkSendStatus: vi.fn(),
    cancelBulkSend: vi.fn(),
    sendWalletMessage: vi.fn(),
    fetchWalletMessageJob: vi.fn(),
    fetchWalletMessageAttendees: vi.fn(),
    fetchEventAttendees: vi.fn(),
    fetchTicketTypes: vi.fn(),
  };
});

import {
  fetchBulkSendStatus,
  fetchEventAttendees,
  fetchTicketTypes,
  fetchWalletMessageJob,
  sendEventBulk,
  sendWalletMessage,
} from "../../src/api/client.js";

const mockTicketTypes = vi.mocked(fetchTicketTypes);
const event = { archived_at: null };

/** The two send panels share the Count recipients / Send pair and the ticket type lookup, so they share these tests. */
const PANELS = [
  {
    name: "CommunicationSendPanel",
    element: (): ReactElement => <CommunicationSendPanel event={event} eventId="evt-1" templateId="tpl-1" snapshotMissing={false} isDirty={false} />,
    send: sendEventBulk as ReturnType<typeof vi.fn>,
    // A send that starts a job to watch, and the status read that never answers while the test looks at the panel.
    started: { batchId: "batch-1", queued: 3, skipped: 0, failed: 0 },
    watch: () => vi.mocked(fetchBulkSendStatus).mockImplementation(hangUntilAborted as never),
    // What the focus moves to once the form's own buttons are gone: the Stop button of a send that is draining.
    nextControl: () => screen.getByRole("button", { name: "Stop" }),
  },
  {
    name: "WalletsSendPanel",
    element: (): ReactElement => <WalletsSendPanel event={event} eventId="evt-1" text="Hi" />,
    send: sendWalletMessage as ReturnType<typeof vi.fn>,
    started: { jobId: "job-1", recipientCount: 3 },
    watch: () => vi.mocked(fetchWalletMessageJob).mockImplementation(hangUntilAborted as never),
    // Nothing in the panel can take focus while a message is on its way but the status that says so.
    nextControl: () => document.querySelector("output.at-notice") as HTMLElement,
  },
] as const;

beforeEach(() => {
  vi.useFakeTimers();
  mockTicketTypes.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe.each(PANELS)("$name on the loading standard", (panel) => {
  it("gives Count recipients a busy flag of its own: it works and keeps its focus while Send is only off", async () => {
    const answer = deferred<unknown>();
    panel.send.mockReturnValueOnce(answer.promise);
    render(panel.element());
    const count = screen.getByRole("button", { name: "Count recipients" });
    count.focus();

    fireEvent.click(count);
    await advanceTimers(0);

    // The same button, saying what it does, still focusable; Send neither says it works nor takes the click.
    expect(screen.getByRole("button", { name: "Checking…" })).toBe(count);
    expect(count.getAttribute("aria-busy")).toBe("true");
    expect(isOff(count)).toBe(true);
    expect(count.hasAttribute("disabled")).toBe(false);
    expect(document.activeElement).toBe(count);
    const send = screen.getByRole("button", { name: "Send" });
    expect(send.getAttribute("aria-busy")).toBeNull();
    expect((send as HTMLButtonElement).disabled).toBe(true);

    // A second click on the busy button does not count again.
    fireEvent.click(count);
    expect(panel.send).toHaveBeenCalledTimes(1);

    await act(async () => answer.resolve({ recipientCount: 2 }));
    expect(screen.getByRole("button", { name: "Count recipients" })).toBe(count);
    expect(count.getAttribute("aria-busy")).toBeNull();
    expect(document.activeElement).toBe(count);
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("gives Send a busy flag of its own: it keeps its label and its focus while Count recipients is only off", async () => {
    const answer = deferred<unknown>();
    panel.send.mockReturnValueOnce(answer.promise);
    render(panel.element());
    const send = screen.getByRole("button", { name: "Send" });
    send.focus();

    fireEvent.click(send);
    await advanceTimers(0);

    expect(screen.getByRole("button", { name: "Send" })).toBe(send);
    expect(send.getAttribute("aria-busy")).toBe("true");
    expect(isOff(send)).toBe(true);
    expect(send.hasAttribute("disabled")).toBe(false);
    expect(document.activeElement).toBe(send);
    const count = screen.getByRole("button", { name: "Count recipients" });
    expect(count.getAttribute("aria-busy")).toBeNull();
    expect((count as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(send);
    expect(panel.send).toHaveBeenCalledTimes(1);

    // The send failed: both buttons are as they were, and Send still has the focus.
    await act(async () => answer.reject(new Error("network down")));
    expect(screen.getByRole("button", { name: "Send" })).toBe(send);
    expect(send.getAttribute("aria-busy")).toBeNull();
    expect(document.activeElement).toBe(send);
    expect((screen.getByRole("button", { name: "Count recipients" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("moves the focus on, not to the page, when the send starts and the form's buttons give way to its progress", async () => {
    panel.watch();
    panel.send.mockResolvedValueOnce(panel.started);
    render(panel.element());
    const send = screen.getByRole("button", { name: "Send" });
    send.focus();

    fireEvent.click(send);
    await advanceTimers(0);

    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(panel.nextControl());
  });

  it("gives the ticket type field a placeholder while its lookup is on its way, held for the first 200ms", async () => {
    const types = deferred<ReturnType<typeof makeTicketType>[]>();
    mockTicketTypes.mockReturnValue(types.promise);
    render(panel.element());
    fireEvent.click(screen.getByRole("radio", { name: "By ticket type" }));

    const slot = screen.getByRole("status", { name: "Loading ticket types" });
    expect(slot.className).toContain("at-loading-hold");
    expect(screen.queryByRole("button", { name: /^Ticket type,/ })).toBeNull();
    await advanceTimers(200);
    expect(slot.className).not.toContain("at-loading-hold");

    // The answer comes after the placeholder has been drawn, so it stays for its minimum time.
    await act(async () => types.resolve([makeTicketType("vip", "VIP")]));
    expect(screen.queryByRole("button", { name: /^Ticket type,/ })).toBeNull();
    await advanceTimers(400);
    expect(screen.queryByRole("status", { name: "Loading ticket types" })).toBeNull();
    expect((screen.getByRole("button", { name: /^Ticket type,/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("reads the ticket types with a signal, so a lookup that never answers ends in a failure with a Retry after 30 seconds", async () => {
    mockTicketTypes.mockImplementation(hangUntilAborted as never);
    render(panel.element());
    fireEvent.click(screen.getByRole("radio", { name: "By ticket type" }));
    expect(mockTicketTypes).toHaveBeenCalledWith("evt-1", expect.any(AbortSignal));

    await advanceTimers(30_000);
    await advanceTimers(0);
    expect(screen.getByRole("alert").textContent).toContain("The server did not answer in time");
    expect(screen.getByRole("button", { name: "Retry loading ticket types" })).toBeTruthy();
    // A failed lookup is not an empty list: the field is there, off.
    expect((screen.getByRole("button", { name: /^Ticket type,/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("the hand-over of the keyboard focus through the steps of a send", () => {
  it("moves the focus from Send to Stop, from Stop to Send another when the batch ends, and from Send another back to the recipients (email)", async () => {
    sendEventBulk.mockResolvedValueOnce({ batchId: "batch-1", queued: 1, skipped: 0, failed: 0 });
    vi.mocked(fetchBulkSendStatus)
      .mockResolvedValueOnce({ batchId: "batch-1", queued: 1, sent: 0, failed: 0, cancelled: 0 } as never)
      .mockResolvedValue({ batchId: "batch-1", queued: 0, sent: 1, failed: 0, cancelled: 0 } as never);
    render(<CommunicationSendPanel event={event} eventId="evt-1" templateId="tpl-1" snapshotMissing={false} isDirty={false} />);
    const send = screen.getByRole("button", { name: "Send" });
    send.focus();
    fireEvent.click(send);
    await advanceTimers(0);

    // The batch is draining: the Stop button holds the focus that Send had.
    const stop = screen.getByRole("button", { name: "Stop" });
    expect(document.activeElement).toBe(stop);

    // It ends on its own while the operator waits on Stop: the focus goes on to Send another, not to the page.
    await advanceTimers(2_000);
    const another = screen.getByRole("button", { name: "Send another" });
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
    expect(document.activeElement).toBe(another);

    fireEvent.click(another);
    await advanceTimers(0);
    expect(screen.queryByRole("button", { name: "Send another" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "All attendees" }));
  });

  it("moves the focus from Send to the status that says it is under way, then to Send another, then back to the recipients (wallets)", async () => {
    vi.mocked(sendWalletMessage).mockResolvedValueOnce({ jobId: "job-1", recipientCount: 1 });
    vi.mocked(fetchWalletMessageJob)
      .mockResolvedValueOnce({ jobId: "job-1", status: "running" } as never)
      .mockResolvedValue({ jobId: "job-1", status: "succeeded", error: null, sent: 1, skipped: 0, errored: 0 } as never);
    render(<WalletsSendPanel event={event} eventId="evt-1" text="Hi" />);
    const send = screen.getByRole("button", { name: "Send" });
    send.focus();
    fireEvent.click(send);
    await advanceTimers(0);

    const status = document.querySelector("output.at-notice") as HTMLElement;
    expect(status.textContent).toContain("Sending to 1");
    expect(document.activeElement).toBe(status);

    await advanceTimers(2_000);
    const another = screen.getByRole("button", { name: "Send another" });
    // The operator was on the status, which stays; nothing took the focus away from it, so it stays where it was.
    expect(document.activeElement).toBe(document.querySelector("output.at-notice"));

    another.focus();
    fireEvent.click(another);
    await advanceTimers(0);
    expect(screen.queryByRole("button", { name: "Send another" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "All attendees with a wallet" }));
  });

  it("moves focus straight from Send to Send another when no wallet recipients match", async () => {
    vi.mocked(sendWalletMessage).mockResolvedValueOnce({ jobId: null, recipientCount: 0 });
    render(<WalletsSendPanel event={event} eventId="evt-1" text="Hi" />);
    const send = screen.getByRole("button", { name: "Send" });
    send.focus();
    fireEvent.click(send);
    await advanceTimers(0);

    expect(screen.getByText("No recipients matched.")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Send another" }));
  });

  it("moves focus from the disappearing wallet status to Send another when the job fails", async () => {
    vi.mocked(sendWalletMessage).mockResolvedValueOnce({ jobId: "job-1", recipientCount: 1 });
    const outcome = deferred<unknown>();
    vi.mocked(fetchWalletMessageJob).mockReturnValueOnce(outcome.promise as never);
    render(<WalletsSendPanel event={event} eventId="evt-1" text="Hi" />);
    const send = screen.getByRole("button", { name: "Send" });
    send.focus();
    fireEvent.click(send);
    await advanceTimers(0);

    const status = document.querySelector("output.at-notice") as HTMLElement;
    expect(document.activeElement).toBe(status);
    await act(async () => outcome.resolve({ jobId: "job-1", status: "failed", error: "Send failed." }));
    expect(screen.getByRole("alert").textContent).toContain("Send failed.");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Send another" }));
  });

  it("does not take the focus when the operator has put it on the page after a hand-over (wallets)", async () => {
    vi.mocked(sendWalletMessage).mockResolvedValueOnce({ jobId: "job-1", recipientCount: 1 });
    vi.mocked(fetchWalletMessageJob)
      .mockResolvedValueOnce({ jobId: "job-1", status: "running" } as never)
      .mockResolvedValue({ jobId: "job-1", status: "succeeded", error: null, sent: 1, skipped: 0, errored: 0 } as never);
    render(<WalletsSendPanel event={event} eventId="evt-1" text="Hi" />);
    const send = screen.getByRole("button", { name: "Send" });
    send.focus();
    fireEvent.click(send);
    await advanceTimers(0);
    expect(document.activeElement).toBe(document.querySelector("output.at-notice"));

    // The operator clicks on text of the page: nothing holds the focus now, and the result must not take it either, since
    // what they were on (the status) was not the control the hand-over was for.
    (document.activeElement as HTMLElement).blur();
    await advanceTimers(2_000);
    expect(screen.getByRole("button", { name: "Send another" })).toBeTruthy();
    expect(document.activeElement).toBe(document.body);
  });

  it("hands the focus on only for a step that a control holding it started: an earlier step's arming is spent", async () => {
    sendEventBulk.mockResolvedValue({ batchId: null, queued: 0, skipped: 0, failed: 0 });
    render(<CommunicationSendPanel event={event} eventId="evt-1" templateId="tpl-1" snapshotMissing={false} isDirty={false} />);
    const first = screen.getByRole("button", { name: "Send" });
    first.focus();
    fireEvent.click(first);
    await advanceTimers(0);
    const another = screen.getByRole("button", { name: "Send another" });
    expect(document.activeElement).toBe(another);
    fireEvent.click(another);
    await advanceTimers(0);
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "All attendees" }));

    // A send that starts without any of the flow's controls holding the focus (it is on the page, as after a click on a
    // part of the page that cannot take it): the first cycle's arming is spent, so the result does not take the focus.
    (document.activeElement as HTMLElement).blur();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await advanceTimers(0);
    expect(screen.getByRole("button", { name: "Send another" })).toBeTruthy();
    expect(document.activeElement).toBe(document.body);
  });

  it("leaves the focus where the operator moved it meanwhile", async () => {
    const answer = deferred<unknown>();
    sendEventBulk.mockReturnValueOnce(answer.promise);
    vi.mocked(fetchBulkSendStatus).mockImplementation(hangUntilAborted as never);
    render(<CommunicationSendPanel event={event} eventId="evt-1" templateId="tpl-1" snapshotMissing={false} isDirty={false} />);
    const send = screen.getByRole("button", { name: "Send" });
    send.focus();
    fireEvent.click(send);
    await advanceTimers(0);

    // The send is on its way and the operator has moved on to another control: the progress must not take it back.
    const radio = screen.getByRole("radio", { name: "By attendance status" });
    radio.focus();
    await act(async () => answer.resolve({ batchId: "batch-1", queued: 3, skipped: 0, failed: 0 }));
    expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
    expect(document.activeElement).toBe(radio);
  });

  it("does not move the focus for what is not a step: removing a chip, or a list closing, never throws it to the first recipient card", async () => {
    vi.mocked(fetchEventAttendees).mockResolvedValue({
      items: [
        { id: "att-1", name: "Alice Example", email: "alice@example.com" },
        { id: "att-2", name: "Bob Example", email: "bob@example.com" },
      ],
      total: 2,
      page: 1,
      pageSize: 10,
    } as never);
    render(<CommunicationSendPanel event={event} eventId="evt-1" templateId="tpl-1" snapshotMissing={false} isDirty={false} />);
    fireEvent.click(screen.getByRole("radio", { name: "Specific attendees" }));
    for (const name of ["Alice Example", "Bob Example"]) {
      fireEvent.change(screen.getByLabelText("Search attendees"), { target: { value: name.split(" ")[0] } });
      await advanceTimers(500);
      fireEvent.click(screen.getByRole("button", { name: new RegExp(name) }));
    }
    const remove = screen.getByRole("button", { name: "Remove Alice Example" });
    remove.focus();

    fireEvent.click(remove);
    await advanceTimers(0);

    expect(screen.queryByRole("button", { name: "Remove Alice Example" })).toBeNull();
    // What a browser does with a removed control: the focus is on the page. It is not taken to the top of the panel.
    expect(document.activeElement).not.toBe(screen.getByRole("radio", { name: "All attendees" }));
    expect(document.activeElement).toBe(document.body);
  });
});
