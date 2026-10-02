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
    // Nothing in the panel can take focus while a message is on its way, so it takes the panel itself.
    nextControl: () => document.querySelector(".settings-card-stack") as HTMLElement,
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

  it("keeps the focus in the panel when the Retry of the ticket type hint works and the hint goes away", async () => {
    mockTicketTypes.mockRejectedValueOnce(new Error("network down"));
    render(panel.element());
    fireEvent.click(screen.getByRole("radio", { name: "By ticket type" }));
    await advanceTimers(0);
    const retry = screen.getByRole("button", { name: "Retry loading ticket types" });
    retry.focus();

    mockTicketTypes.mockResolvedValueOnce([makeTicketType("vip", "VIP")]);
    fireEvent.click(retry);
    // Busy for at least 400ms from the click.
    await advanceTimers(500);

    expect(screen.queryByRole("button", { name: "Retry loading ticket types" })).toBeNull();
    expect(document.activeElement).not.toBe(document.body);
    expect(document.querySelector(".settings-card-stack")?.contains(document.activeElement)).toBe(true);
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

describe("CommunicationSendPanel focus when a send that is draining ends", () => {
  it("hands the focus of the Stop button to Send another when the batch finishes", async () => {
    vi.mocked(sendEventBulk).mockResolvedValueOnce({ batchId: "batch-1", queued: 1, skipped: 0, failed: 0 });
    vi.mocked(fetchBulkSendStatus).mockResolvedValue({ batchId: "batch-1", queued: 0, sent: 1, failed: 0, cancelled: 0 } as never);
    render(<CommunicationSendPanel event={event} eventId="evt-1" templateId="tpl-1" snapshotMissing={false} isDirty={false} />);
    const send = screen.getByRole("button", { name: "Send" });
    send.focus();
    fireEvent.click(send);
    await advanceTimers(0);

    // The first status read already says it is done, so the Stop button that took the focus was only there for a moment.
    const another = screen.getByRole("button", { name: "Send another" });
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
    expect(document.activeElement).toBe(another);
  });

  it("returns the focus to the form's first control after Send another", async () => {
    vi.mocked(sendEventBulk).mockResolvedValueOnce({ batchId: null, queued: 0, skipped: 0, failed: 0 });
    render(<CommunicationSendPanel event={event} eventId="evt-1" templateId="tpl-1" snapshotMissing={false} isDirty={false} />);
    const send = screen.getByRole("button", { name: "Send" });
    send.focus();
    fireEvent.click(send);
    await advanceTimers(0);
    const another = screen.getByRole("button", { name: "Send another" });
    expect(document.activeElement).toBe(another);

    fireEvent.click(another);
    await advanceTimers(0);

    // The button that held the focus is gone with the result, and the focus is on the form that took its place.
    expect(screen.queryByRole("button", { name: "Send another" })).toBeNull();
    expect(document.activeElement).not.toBe(document.body);
    expect(document.querySelector(".settings-card-stack")?.contains(document.activeElement)).toBe(true);
  });
});
