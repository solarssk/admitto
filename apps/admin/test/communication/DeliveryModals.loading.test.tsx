// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeliveryDetailDto, DeliveryDto, RenderedDeliveryDto } from "../../src/api/types.js";
import { DeliveryDetailsModal } from "../../src/communication/DeliveryDetailsModal.js";
import { SentMessagePreviewModal } from "../../src/communication/SentMessagePreviewModal.js";
import { advanceTimers, deferred, hangUntilAborted, isOff } from "../test-utils.js";

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return { ...actual, fetchEventDelivery: vi.fn(), fetchRenderedDelivery: vi.fn() };
});

import { fetchEventDelivery, fetchRenderedDelivery } from "../../src/api/client.js";

const mockDetail = vi.mocked(fetchEventDelivery);
const mockRendered = vi.mocked(fetchRenderedDelivery);

const row: DeliveryDto = {
  id: "del-1",
  attendee_id: "att-1",
  attendee_name: "Jane Doe",
  purpose: "initial",
  status: "accepted",
  provider: "graph",
  provider_message_id: "msg-1",
  attempts: 1,
  retryable: null,
  recipient_email: "jane@example.com",
  rendered_subject: "Your ticket",
  template_id: null,
  template_name: null,
  queued_at: "2026-06-01T10:00:00.000Z",
  accepted_at: "2026-06-01T10:00:05.000Z",
  sent_at: null,
  failed_at: null,
  error_code: null,
  error: null,
  client_timezone: "Europe/Warsaw",
};
const detail: DeliveryDetailDto = { ...row, batch_id: null, actor_user_id: null, actor_display: "Sam Staff", session_id: null, timeline: [row] };
const rendered: RenderedDeliveryDto = { subject: "Your ticket", html: "<p>Hello Jane</p>" };

/** The two modals read one record when they open and share their loading behaviour; each case says how to open one. */
const CASES = [
  {
    name: "DeliveryDetailsModal",
    region: "Loading delivery details",
    title: "Delivery details",
    fetch: mockDetail as ReturnType<typeof vi.fn>,
    answer: detail as unknown,
    failure: "Could not load delivery details.",
    // Something only the loaded modal shows.
    loaded: () => screen.queryByText("Provider message ID"),
    open: (id = row.id) => (
      <MemoryRouter>
        <DeliveryDetailsModal eventId="evt-1" eventTimezone="Europe/Warsaw" row={{ ...row, id }} onClose={vi.fn()} onViewSentMessage={vi.fn()} />
      </MemoryRouter>
    ),
  },
  {
    name: "SentMessagePreviewModal",
    region: "Loading sent message",
    title: "Sent message preview",
    fetch: mockRendered as ReturnType<typeof vi.fn>,
    answer: rendered as unknown,
    failure: "Could not load the sent message.",
    loaded: () => screen.queryByText("Subject"),
    open: (id = row.id) => <SentMessagePreviewModal eventId="evt-1" row={{ ...row, id }} onClose={vi.fn()} />,
  },
] as const;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

const placeholder = (region: string) => screen.queryByRole("status", { name: region });

describe.each(CASES)("$name on the loading standard", (kase) => {
  it("keeps its header on screen, holds the room invisibly for 200ms, then draws the shapes of what it will show", async () => {
    kase.fetch.mockImplementation(hangUntilAborted as never);
    render(kase.open());

    // The header, with the title and the recipient, does not wait for the answer.
    expect(screen.getByRole("heading", { name: kase.title })).toBeTruthy();
    expect(screen.getByText(/Jane Doe/)).toBeTruthy();
    expect(placeholder(kase.region)?.className).toContain("at-loading-hold");

    await advanceTimers(200);
    expect(placeholder(kase.region)?.className).not.toContain("at-loading-hold");
    expect(kase.loaded()).toBeNull();
    // The shapes (and the titles drawn over them) are decoration for assistive tech: the region is named by its label.
    expect(within(placeholder(kase.region) as HTMLElement).queryAllByRole("heading")).toEqual([]);
    expect(screen.queryByText(/Taking longer than usual/)).toBeNull();
  });

  it("never draws the placeholder for an answer that comes within 200ms", async () => {
    const answer = deferred<unknown>();
    kase.fetch.mockReturnValue(answer.promise);
    render(kase.open());

    await advanceTimers(100);
    await act(async () => answer.resolve(kase.answer));
    expect(placeholder(kase.region)).toBeNull();
    expect(kase.loaded()).not.toBeNull();
  });

  it("keeps a placeholder that did show for at least 400ms before the answer replaces it", async () => {
    const answer = deferred<unknown>();
    kase.fetch.mockReturnValue(answer.promise);
    render(kase.open());

    await advanceTimers(250);
    await act(async () => answer.resolve(kase.answer));
    expect(placeholder(kase.region)).not.toBeNull();
    expect(kase.loaded()).toBeNull();

    // It was drawn at 200ms, so it stays until 600ms.
    await advanceTimers(349);
    expect(placeholder(kase.region)).not.toBeNull();
    await advanceTimers(1);
    expect(placeholder(kase.region)).toBeNull();
    expect(kase.loaded()).not.toBeNull();
  });

  it("says it is taking longer than usual after 8 seconds", async () => {
    kase.fetch.mockImplementation(hangUntilAborted as never);
    render(kase.open());

    await advanceTimers(7_999);
    expect(screen.queryByText(/Taking longer than usual/)).toBeNull();
    await advanceTimers(1);
    expect(placeholder(kase.region)?.textContent).toMatch(/Taking longer than usual/);
  });

  it("ends in an error with a Retry when the server does not answer in 30 seconds", async () => {
    kase.fetch.mockImplementation(hangUntilAborted as never);
    render(kase.open());

    await advanceTimers(30_000);
    await advanceTimers(0);
    expect(placeholder(kase.region)).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("The server did not answer in time");
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("shows the reason of a failed load, and a Retry that keeps the error on screen, busy, until the answer is in", async () => {
    kase.fetch.mockRejectedValueOnce(new Error("network down"));
    render(kase.open());
    await advanceTimers(0);

    expect(screen.getByRole("alert").textContent).toContain(kase.failure);
    const retry = screen.getByRole("button", { name: "Retry" });
    const answer = deferred<unknown>();
    kase.fetch.mockReturnValueOnce(answer.promise);
    retry.focus();
    fireEvent.click(retry);
    await advanceTimers(0);

    // The same button, busy, with its focus and the error still there, and no placeholder in its place.
    expect(screen.getByRole("button", { name: "Retry" })).toBe(retry);
    expect(retry.getAttribute("aria-busy")).toBe("true");
    expect(isOff(retry)).toBe(true);
    expect(retry.hasAttribute("disabled")).toBe(false);
    expect(document.activeElement).toBe(retry);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(placeholder(kase.region)).toBeNull();

    // A second click on the busy Retry does not start another request.
    fireEvent.click(retry);
    expect(kase.fetch).toHaveBeenCalledTimes(2);

    await act(async () => answer.resolve(kase.answer));
    // The answer is in: the error goes, the modal shows it, and the focus stays inside the dialog (not on <body>).
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(kase.loaded()).not.toBeNull();
    expect(document.querySelector(".delivery-modal__panel")?.contains(document.activeElement)).toBe(true);
  });

  it("announces a failure again when the retry fails with the same message", async () => {
    kase.fetch.mockRejectedValue(new Error("network down"));
    render(kase.open());
    await advanceTimers(0);

    const retry = screen.getByRole("button", { name: "Retry" });
    const message = screen.getByRole("alert").querySelector(".at-notice__body");
    fireEvent.click(retry);
    // Busy for at least 400ms from the click, so a retry that fails at once still shows that it ran.
    await advanceTimers(100);
    expect(retry.getAttribute("aria-busy")).toBe("true");
    await advanceTimers(500);

    expect(retry.getAttribute("aria-busy")).toBeNull();
    expect(screen.getByRole("button", { name: "Retry" })).toBe(retry);
    // The same text, in a new node: that is what a live region announces.
    expect(screen.getByRole("alert").querySelector(".at-notice__body")).not.toBe(message);
  });

  it("reads another delivery afresh, with its own placeholder, when it is opened for a different row", async () => {
    kase.fetch.mockResolvedValueOnce(kase.answer).mockImplementation(hangUntilAborted as never);
    const { rerender } = render(kase.open("del-1"));
    await advanceTimers(0);
    expect(kase.loaded()).not.toBeNull();

    rerender(kase.open("del-2"));
    // The first delivery's answer must not stay under the second delivery's header.
    expect(kase.loaded()).toBeNull();
    expect(placeholder(kase.region)).not.toBeNull();
    expect(kase.fetch).toHaveBeenCalledTimes(2);
    expect(kase.fetch.mock.calls[1]?.slice(0, 2)).toEqual(["evt-1", "del-2"]);
  });
});

describe("the placeholders have the shape of what they stand in for (measured against the real modals in Chrome)", () => {
  it("draws twelve pairs and the outcome line under Overview, then six pairs under Raw fields, for the details", async () => {
    mockDetail.mockImplementation(hangUntilAborted as never);
    render(
      <MemoryRouter>
        <DeliveryDetailsModal eventId="evt-1" eventTimezone="Europe/Warsaw" row={row} onClose={vi.fn()} onViewSentMessage={vi.fn()} />
      </MemoryRouter>,
    );
    await advanceTimers(200);

    const sections = [...document.querySelectorAll(".delivery-modal-kv--skeleton")];
    expect(sections.map((grid) => grid.querySelectorAll(".delivery-modal-skeleton-pair").length)).toEqual([12, 6]);
    expect(screen.getByText("Overview")).toBeTruthy();
    expect(screen.getByText("Raw fields")).toBeTruthy();
    expect(document.querySelectorAll(".delivery-modal-skeleton-notice")).toHaveLength(1);
  });

  it("draws the subject lines and the frame of the message for the sent message", async () => {
    mockRendered.mockImplementation(hangUntilAborted as never);
    render(<SentMessagePreviewModal eventId="evt-1" row={row} onClose={vi.fn()} />);
    await advanceTimers(200);

    expect(document.querySelectorAll(".delivery-modal-preview-subject .delivery-modal-skeleton-line")).toHaveLength(2);
    expect(document.querySelectorAll(".delivery-modal-skeleton-frame")).toHaveLength(1);
  });
});

describe("DeliveryDetailsModal footer", () => {
  it("offers Export as .txt only once the details are shown, and the other two actions from the start", async () => {
    const answer = deferred<unknown>();
    mockDetail.mockReturnValue(answer.promise as never);
    const onViewSentMessage = vi.fn();
    render(
      <MemoryRouter>
        <DeliveryDetailsModal eventId="evt-1" eventTimezone="Europe/Warsaw" row={row} onClose={vi.fn()} onViewSentMessage={onViewSentMessage} />
      </MemoryRouter>,
    );

    expect(screen.queryByRole("button", { name: "Export as .txt" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "View sent message" }));
    expect(onViewSentMessage).toHaveBeenCalledWith(row);
    expect(screen.getByRole("link", { name: "Open attendee" })).toBeTruthy();

    // The answer is in, but the placeholder that did not get its minimum time yet still covers the page.
    await advanceTimers(250);
    await act(async () => answer.resolve(detail));
    expect(screen.queryByRole("button", { name: "Export as .txt" })).toBeNull();
    await advanceTimers(400);
    expect(screen.getByRole("button", { name: "Export as .txt" })).toBeTruthy();
  });
});

describe("SentMessagePreviewModal answer without a stored message", () => {
  it("says the stored content is no longer available instead of an empty frame", async () => {
    mockRendered.mockResolvedValue({ subject: null, html: null });
    render(<SentMessagePreviewModal eventId="evt-1" row={row} onClose={vi.fn()} />);
    await advanceTimers(0);

    expect(screen.getByText(/stored content is no longer available/)).toBeTruthy();
    expect(document.querySelector("iframe")).toBeNull();
  });
});
