// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AddAttendeeModal } from "../../src/attendees/AddAttendeeModal.js";
import { LOAD_TIMEOUT_MESSAGE, LOAD_TIMEOUT_MS, SLOW_NOTICE_MS, SLOW_NOTICE_TEXT } from "../../src/utils/loading-timing.js";
import { deferred } from "../test-utils.js";

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    createAttendee: vi.fn(),
    fetchEventCustomFields: vi.fn().mockResolvedValue([]),
    fetchTicketTypes: vi.fn().mockResolvedValue([]),
  };
});

import { ApiError, createAttendee, fetchEventCustomFields, fetchTicketTypes } from "../../src/api/client.js";

const mockCreateAttendee = vi.mocked(createAttendee);
const mockFetchEventCustomFields = vi.mocked(fetchEventCustomFields);
const mockFetchTicketTypes = vi.mocked(fetchTicketTypes);

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("AddAttendeeModal delayed loading", () => {
  const skeleton = () => screen.queryByText("Loading attendee form");
  const fields = () => document.querySelector(".add-attendee-modal__fields") as HTMLElement;

  function renderWithPendingFetches() {
    mockFetchEventCustomFields.mockImplementation(() => new Promise(() => {}));
    mockFetchTicketTypes.mockImplementation(() => new Promise(() => {}));
    vi.useFakeTimers();
    render(<AddAttendeeModal eventId="evt-1" open onClose={() => {}} onCreated={() => {}} />);
  }

  afterEach(() => {
    // Never-resolving mocks would otherwise leak into every later test in this file.
    mockFetchEventCustomFields.mockResolvedValue([]);
    mockFetchTicketTypes.mockResolvedValue([]);
  });

  it("holds the whole form back, invisible, while the catalogs load, and draws a skeleton over it after 200ms", () => {
    renderWithPendingFetches();
    act(() => {
      vi.advanceTimersByTime(199);
    });
    expect(fields().className).toContain("at-loading-hold");
    expect(fields().getAttribute("aria-busy")).toBe("true");
    expect(skeleton()).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(skeleton()).toBeTruthy();
    expect(fields().className).toContain("at-loading-hold");
    // The two lines of text and the loader that used to sit in the middle of the form are gone.
    expect(screen.queryByText(/Loading attribute fields/)).toBeNull();
    expect(screen.queryByText(/Loading ticket types/)).toBeNull();
    expect(screen.queryByRole("status", { name: "Loading fields" })).toBeNull();
  });

  it("says it is taking longer than usual after 8 seconds, in the placeholder's one status region, between the form and its buttons", () => {
    renderWithPendingFetches();
    act(() => {
      vi.advanceTimersByTime(SLOW_NOTICE_MS - 1);
    });
    expect(skeleton()).toBeTruthy();
    expect(screen.queryByText(SLOW_NOTICE_TEXT)).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    const note = screen.getByText(SLOW_NOTICE_TEXT);
    // The label that names what is loading and the note are one status region, so assistive tech hears both. It follows the fields in
    // the page's flow (the skeleton over them has exactly their size and cannot make room for a line) and comes before the buttons.
    const region = note.closest("output") as HTMLElement;
    expect(region.textContent).toContain("Loading attendee form");
    expect(fields().contains(region)).toBe(false);
    expect(fields().compareDocumentPosition(region) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const actions = document.querySelector(".add-attendee-modal__actions") as HTMLElement;
    expect(region.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("takes the note away as soon as the catalogs have answered, though the placeholder goes a moment later", async () => {
    const fieldsAnswer = deferred<never[]>();
    const typesAnswer = deferred<never[]>();
    mockFetchEventCustomFields.mockReturnValue(fieldsAnswer.promise);
    mockFetchTicketTypes.mockReturnValue(typesAnswer.promise);
    vi.useFakeTimers();
    render(<AddAttendeeModal eventId="evt-1" open onClose={() => {}} onCreated={() => {}} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SLOW_NOTICE_MS + 500);
    });
    expect(screen.getByText(SLOW_NOTICE_TEXT)).toBeTruthy();

    await act(async () => {
      fieldsAnswer.resolve([]);
      typesAnswer.resolve([]);
      await vi.advanceTimersByTimeAsync(0);
    });
    // The note belongs to the wait, which is over; the placeholder itself leaves on the next tick (it has been up for more than 400ms).
    expect(screen.queryByText(SLOW_NOTICE_TEXT)).toBeNull();
    expect(skeleton()).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(skeleton()).toBeNull();
    expect(fields().className).toContain("at-fade-in");
  });

  it("counts the 8 seconds again when the dialog is opened again, also though the close left a read unfinished", () => {
    mockFetchEventCustomFields.mockImplementation(() => new Promise(() => {}));
    mockFetchTicketTypes.mockImplementation(() => new Promise(() => {}));
    vi.useFakeTimers();
    const props = { eventId: "evt-1", onClose: () => {}, onCreated: () => {} };
    const { rerender } = render(<AddAttendeeModal {...props} open />);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    rerender(<AddAttendeeModal {...props} open={false} />);
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    rerender(<AddAttendeeModal {...props} open />);

    // 9 seconds have passed since the first opening, but the wait of this one is what counts.
    act(() => {
      vi.advanceTimersByTime(SLOW_NOTICE_MS - 1);
    });
    expect(skeleton()).toBeTruthy();
    expect(screen.queryByText(SLOW_NOTICE_TEXT)).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByText(SLOW_NOTICE_TEXT)).toBeTruthy();
  });

  it("counts the 8 seconds again for another event that replaces one still on its way", () => {
    mockFetchEventCustomFields.mockImplementation(() => new Promise(() => {}));
    mockFetchTicketTypes.mockImplementation(() => new Promise(() => {}));
    vi.useFakeTimers();
    const props = { onClose: () => {}, onCreated: () => {} };
    const { rerender } = render(<AddAttendeeModal {...props} eventId="evt-1" open />);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    rerender(<AddAttendeeModal {...props} eventId="evt-2" open />);

    act(() => {
      vi.advanceTimersByTime(SLOW_NOTICE_MS - 1);
    });
    expect(screen.queryByText(SLOW_NOTICE_TEXT)).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByText(SLOW_NOTICE_TEXT)).toBeTruthy();
  });

  it("shows the whole form at once, fading in, when the catalogs arrive before the 200ms are up", async () => {
    mockFetchEventCustomFields.mockResolvedValue([]);
    mockFetchTicketTypes.mockResolvedValue([]);
    render(<AddAttendeeModal eventId="evt-1" open onClose={() => {}} onCreated={() => {}} />);
    await waitFor(() => expect(fields().className).toContain("at-fade-in"));
    expect(fields().className).not.toContain("at-loading-hold");
    expect(fields().getAttribute("aria-busy")).toBeNull();
    expect(skeleton()).toBeNull();
  });
});

describe("AddAttendeeModal when a catalog request stalls", () => {
  /** A request that never answers but, like fetch, rejects when its signal is aborted. */
  function stalledUntilAborted() {
    const signals: AbortSignal[] = [];
    const impl = (_eventId: string, signal?: AbortSignal) =>
      new Promise<never>((_resolve, reject) => {
        if (signal) signals.push(signal);
        signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
      });
    return { signals, impl };
  }

  afterEach(() => {
    mockFetchEventCustomFields.mockResolvedValue([]);
    mockFetchTicketTypes.mockResolvedValue([]);
  });

  it("gives up after the load timeout, shows why, and releases the form it was holding back", async () => {
    const stalled = stalledUntilAborted();
    mockFetchEventCustomFields.mockImplementation(stalled.impl as never);
    mockFetchTicketTypes.mockImplementation(stalled.impl as never);
    vi.useFakeTimers();
    render(<AddAttendeeModal eventId="evt-1" open onClose={() => {}} onCreated={() => {}} />);
    const fields = () => document.querySelector(".add-attendee-modal__fields") as HTMLElement;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS - 1);
    });
    expect(fields().className).toContain("at-loading-hold");
    expect(screen.queryByText(new RegExp(LOAD_TIMEOUT_MESSAGE))).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fields().className).not.toContain("at-loading-hold");
    expect(screen.queryByText("Loading attendee form")).toBeNull();
    // Both failures are said, with the reason and what to do: each has its own Retry.
    expect(screen.getByText(new RegExp(`Could not load ticket types. ${LOAD_TIMEOUT_MESSAGE}`))).toBeTruthy();
    expect(screen.getByText(new RegExp(`Could not load custom fields. ${LOAD_TIMEOUT_MESSAGE}`))).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Retry" })).toHaveLength(2);
    expect(screen.queryByText(/Reopen the dialog/)).toBeNull();
  });

  it.each([
    ["custom fields", mockFetchEventCustomFields, "Could not load custom fields."],
    ["ticket types", mockFetchTicketTypes, "Could not load ticket types."],
  ])("gives a retry of the %s its own 30 seconds, with the Retry button busy meanwhile", async (_name, mock, message) => {
    const stalled = stalledUntilAborted();
    mock.mockImplementation(stalled.impl as never);
    vi.useFakeTimers();
    render(<AddAttendeeModal eventId="evt-1" open onClose={() => {}} onCreated={() => {}} />);
    const settle = async (ms: number) => {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
    };
    const retry = () => screen.getByRole("button", { name: "Retry" });

    await settle(LOAD_TIMEOUT_MS);
    expect(retry().getAttribute("aria-busy")).toBeNull();

    fireEvent.click(retry());
    expect(stalled.signals).toHaveLength(2);
    expect(retry().getAttribute("aria-busy")).toBe("true");
    // The error stays on screen while the retry runs, so the notice does not jump.
    expect(screen.getByText(new RegExp(message))).toBeTruthy();

    await settle(LOAD_TIMEOUT_MS - 1);
    expect(retry().getAttribute("aria-busy")).toBe("true");
    await settle(1);
    expect(retry().getAttribute("aria-busy")).toBeNull();
    expect(stalled.signals[0]?.aborted).toBe(true);
    expect(stalled.signals[1]?.aborted).toBe(true);
  });

  it("aborts both requests when the dialog goes away, and says nothing about it", async () => {
    const stalled = stalledUntilAborted();
    mockFetchEventCustomFields.mockImplementation(stalled.impl as never);
    mockFetchTicketTypes.mockImplementation(stalled.impl as never);
    const { rerender } = render(<AddAttendeeModal eventId="evt-1" open onClose={() => {}} onCreated={() => {}} />);
    expect(stalled.signals).toHaveLength(2);
    expect(stalled.signals.every((s) => !s.aborted)).toBe(true);

    rerender(<AddAttendeeModal eventId="evt-1" open={false} onClose={() => {}} onCreated={() => {}} />);
    expect(stalled.signals.every((s) => s.aborted)).toBe(true);
    await act(async () => {});
    expect(screen.queryByText(new RegExp(LOAD_TIMEOUT_MESSAGE))).toBeNull();
  });

  it("leaves no timeout behind once the catalogs have answered", async () => {
    vi.useFakeTimers();
    render(<AddAttendeeModal eventId="evt-1" open onClose={() => {}} onCreated={() => {}} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    // The 30 second timeouts are cleared; only the loading gates' own short timers may remain.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS + 1000);
    });
    expect(screen.queryByText(new RegExp(LOAD_TIMEOUT_MESSAGE))).toBeNull();
  });
});

describe("AddAttendeeModal Retry for a failed catalog", () => {
  const dietary = {
    id: "fld-1",
    source_field: "dietary",
    label: "Dietary",
    description: null,
    type: "text" as const,
    required: false,
    options: null,
    created_at: "2026-01-01T00:00:00.000Z",
  };
  const vip = { id: "tt-1", key: "vip", label: "VIP", color: "purple", sort_order: 0, attendee_count: 0, created_at: "2026-01-01T00:00:00.000Z" };
  const fieldsWrapper = () => document.querySelector(".add-attendee-modal__fields") as HTMLElement;
  const addButton = () => screen.getByRole("button", { name: "Add attendee" }) as HTMLButtonElement;

  function typeAttendee() {
    fireEvent.change(screen.getByLabelText("First name *"), { target: { value: "Jan" } });
    fireEvent.change(screen.getByLabelText("Last name *"), { target: { value: "Kowalski" } });
    fireEvent.change(screen.getByLabelText("Email *"), { target: { value: "jan@example.com" } });
  }

  function expectTypedAttendeeKept() {
    expect((screen.getByLabelText("First name *") as HTMLInputElement).value).toBe("Jan");
    expect((screen.getByLabelText("Last name *") as HTMLInputElement).value).toBe("Kowalski");
    expect((screen.getByLabelText("Email *") as HTMLInputElement).value).toBe("jan@example.com");
  }

  afterEach(() => {
    mockFetchEventCustomFields.mockReset().mockResolvedValue([]);
    mockFetchTicketTypes.mockReset().mockResolvedValue([]);
  });

  /** What must hold for the whole time a Retry is running: the form stays as it is, the error stays, and the button is busy. */
  async function expectFormUntouchedWhileRetrying(errorText: string) {
    const retry = screen.getByRole("button", { name: "Retry" }) as HTMLButtonElement;
    expect(retry.getAttribute("aria-busy")).toBe("true");
    expect(retry.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText(errorText)).toBeTruthy();
    // What is on screen stays on screen: no invisible form, no skeleton over it (not even once the
    // 200ms a skeleton would wait for have passed).
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });
    expect(fieldsWrapper().className).not.toContain("at-loading-hold");
    expect(fieldsWrapper().getAttribute("aria-busy")).toBeNull();
    expect(screen.queryByText("Loading attendee form")).toBeNull();
    expectTypedAttendeeKept();
  }

  it("reruns only the custom fields in place, keeping what was typed and not holding the form back again", async () => {
    let answerRetry!: (fields: unknown[]) => void;
    mockFetchEventCustomFields
      .mockRejectedValueOnce(new Error("network down"))
      .mockReturnValueOnce(new Promise((resolve) => (answerRetry = resolve)) as never);
    render(<AddAttendeeModal eventId="evt-1" open onClose={() => {}} onCreated={() => {}} />);
    await screen.findByText("Could not load custom fields.");
    typeAttendee();
    // The failed custom fields keep the form from being submitted: that is what Retry is for.
    expect(addButton().disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await expectFormUntouchedWhileRetrying("Could not load custom fields.");
    expect(addButton().disabled).toBe(true);

    await act(async () => answerRetry([dietary]));
    await waitFor(() => expect(screen.queryByText("Could not load custom fields.")).toBeNull());
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.getByLabelText("Dietary")).toBeTruthy();
    expectTypedAttendeeKept();
    await waitFor(() => expect(addButton().disabled).toBe(false));
    // Only the catalog that failed was asked again.
    expect(mockFetchEventCustomFields).toHaveBeenCalledTimes(2);
    expect(mockFetchTicketTypes).toHaveBeenCalledTimes(1);
  });

  it("reruns only the ticket types in place, keeping what was typed and not holding the form back again", async () => {
    let answerRetry!: (types: unknown[]) => void;
    mockFetchEventCustomFields.mockResolvedValue([dietary]);
    mockFetchTicketTypes
      .mockRejectedValueOnce(new Error("network down"))
      .mockReturnValueOnce(new Promise((resolve) => (answerRetry = resolve)) as never);
    render(<AddAttendeeModal eventId="evt-1" open onClose={() => {}} onCreated={() => {}} />);
    await screen.findByText("Could not load ticket types.");
    typeAttendee();
    fireEvent.change(screen.getByLabelText("Dietary"), { target: { value: "vegan" } });

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await expectFormUntouchedWhileRetrying("Could not load ticket types.");
    expect((screen.getByLabelText("Dietary") as HTMLInputElement).value).toBe("vegan");

    await act(async () => answerRetry([vip]));
    await waitFor(() => expect(screen.queryByText("Could not load ticket types.")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: /^Ticket type,/ }));
    expect(await screen.findByRole("button", { name: "VIP" })).toBeTruthy();
    expectTypedAttendeeKept();
    expect((screen.getByLabelText("Dietary") as HTMLInputElement).value).toBe("vegan");
    // Only the catalog that failed was asked again, and what loaded the first time was not touched.
    expect(mockFetchTicketTypes).toHaveBeenCalledTimes(2);
    expect(mockFetchEventCustomFields).toHaveBeenCalledTimes(1);
  });

  it("keeps keyboard focus on a busy Retry, and a second press on it does not ask again", async () => {
    let answerRetry!: (fields: unknown[]) => void;
    mockFetchEventCustomFields
      .mockRejectedValueOnce(new Error("network down"))
      .mockReturnValueOnce(new Promise((resolve) => (answerRetry = resolve)) as never);
    render(<AddAttendeeModal eventId="evt-1" open onClose={() => {}} onCreated={() => {}} />);
    await screen.findByText("Could not load custom fields.");
    const retry = screen.getByRole("button", { name: "Retry" }) as HTMLButtonElement;
    retry.focus();

    fireEvent.click(retry);
    await waitFor(() => expect(retry.getAttribute("aria-busy")).toBe("true"));
    fireEvent.click(retry);
    fireEvent.click(retry);

    // Not `disabled`: a browser would have moved focus to <body> the moment the button turned busy.
    expect(retry.disabled).toBe(false);
    expect(document.activeElement).toBe(retry);
    expect(mockFetchEventCustomFields).toHaveBeenCalledTimes(2);
    await act(async () => answerRetry([dietary]));
  });

  it("keeps the error, and lets the operator try again, when the retry fails too", async () => {
    mockFetchEventCustomFields
      .mockRejectedValueOnce(new Error("network down"))
      .mockRejectedValueOnce(new Error("still down"))
      .mockResolvedValueOnce([]);
    render(<AddAttendeeModal eventId="evt-1" open onClose={() => {}} onCreated={() => {}} />);
    await screen.findByText("Could not load custom fields.");

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(mockFetchEventCustomFields).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry" }).getAttribute("aria-busy")).toBeNull(), {
      timeout: 2000,
    });
    expect(screen.getByText("Could not load custom fields.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.queryByText("Could not load custom fields.")).toBeNull());
    expect(mockFetchEventCustomFields).toHaveBeenCalledTimes(3);
  });

  it("keeps focus inside the dialog when a successful Retry removes the notice that held it", async () => {
    let answerRetry!: (fields: unknown[]) => void;
    mockFetchEventCustomFields
      .mockRejectedValueOnce(new Error("network down"))
      .mockReturnValueOnce(new Promise((resolve) => (answerRetry = resolve)) as never);
    render(<AddAttendeeModal eventId="evt-1" open onClose={() => {}} onCreated={() => {}} />);
    await screen.findByText("Could not load custom fields.");
    const retry = screen.getByRole("button", { name: "Retry" });
    retry.focus();
    expect(document.activeElement).toBe(retry);

    fireEvent.click(retry);
    await act(async () => answerRetry([dietary]));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Retry" })).toBeNull());

    // Not on <body>: the next Tab would start from the page behind the dialog.
    expect(document.activeElement).not.toBe(document.body);
    expect(document.querySelector(".add-attendee-modal__panel")?.contains(document.activeElement)).toBe(true);
  });

  describe("announcing a repeat failure", () => {
    /** Every distinct node that carried `message` since watching began: each one is a fresh addition to the alert, so a screen reader reads it. */
    function watchMessage(message: string) {
      const seen = new Set<Element>();
      const scan = () => {
        for (const node of document.querySelectorAll(".at-notice__body")) {
          if (node.textContent === message) seen.add(node);
        }
      };
      scan();
      const observer = new MutationObserver(scan);
      observer.observe(document.body, { childList: true, subtree: true });
      return {
        mounts() {
          observer.takeRecords();
          scan();
          return seen.size;
        },
        stop: () => observer.disconnect(),
      };
    }

    it.each([
      ["custom fields", () => mockFetchEventCustomFields, "Could not load custom fields."],
      ["ticket types", () => mockFetchTicketTypes, "Could not load ticket types."],
    ])("says the %s error again when the retry fails with the very same message, without remounting Retry", async (_name, mock, message) => {
      mock().mockRejectedValueOnce(new Error("offline")).mockRejectedValueOnce(new Error("offline"));
      render(<AddAttendeeModal eventId="evt-1" open onClose={() => {}} onCreated={() => {}} />);
      await screen.findByText(message);
      const alert = screen.getByText(message).closest("[role='alert']");
      const retry = screen.getByRole("button", { name: "Retry" });
      const before = screen.getByText(message);
      const watch = watchMessage(message);
      expect(watch.mounts()).toBe(1);

      fireEvent.click(retry);
      await waitFor(() => expect(mock()).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(screen.getByRole("button", { name: "Retry" }).getAttribute("aria-busy")).toBeNull(), {
        timeout: 2000,
      });

      // Same text, so a live region would stay silent unless the message is a new addition.
      expect(screen.getByText(message).textContent).toBe(before.textContent);
      expect(screen.getByText(message)).not.toBe(before);
      expect(watch.mounts()).toBe(2);
      expect(screen.getByText(message).closest("[role='alert']")).toBe(alert);
      expect(screen.getByRole("button", { name: "Retry" })).toBe(retry);
      watch.stop();
    });

    it("does not say a failure twice while it is still the first one", async () => {
      mockFetchEventCustomFields.mockRejectedValueOnce(new Error("offline"));
      const watch = watchMessage("Could not load custom fields.");
      render(<AddAttendeeModal eventId="evt-1" open onClose={() => {}} onCreated={() => {}} />);
      await screen.findByText("Could not load custom fields.");
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });
      expect(watch.mounts()).toBe(1);
      watch.stop();
    });
  });

  it.each([
    ["custom fields", () => mockFetchEventCustomFields, "Retry", "Could not load custom fields."],
    ["ticket types", () => mockFetchTicketTypes, "Retry", "Could not load ticket types."],
  ])("shows a retry of the %s running for at least 400ms even when it fails again at once", async (_name, mock, label, message) => {
    mock().mockRejectedValue(new Error("offline"));
    vi.useFakeTimers();
    render(<AddAttendeeModal eventId="evt-1" open onClose={() => {}} onCreated={() => {}} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const retry = () => screen.getByRole("button", { name: label });
    expect(retry().getAttribute("aria-busy")).toBeNull();

    fireEvent.click(retry());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    // The request has already failed again, with the same text as before.
    expect(screen.getByText(message)).toBeTruthy();
    expect(retry().getAttribute("aria-busy")).toBe("true");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(398);
    });
    expect(retry().getAttribute("aria-busy")).toBe("true");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2);
    });
    expect(retry().getAttribute("aria-busy")).toBeNull();
  });

  it.each([
    [
      "custom fields",
      () => mockFetchEventCustomFields,
      () => mockFetchTicketTypes,
      "Could not load custom fields.",
    ],
    [
      "ticket types",
      () => mockFetchTicketTypes,
      () => mockFetchEventCustomFields,
      "Could not load ticket types.",
    ],
  ])(
    "starts the next opening clean after the %s were retried: old error gone, form held back again",
    async (_name, retried, other, message) => {
      // The retried catalog fails twice, so its error is on screen when the dialog is closed.
      retried().mockRejectedValueOnce(new Error("network down")).mockRejectedValueOnce(new Error("still down"));
      const { rerender } = render(<AddAttendeeModal eventId="evt-1" open onClose={() => {}} onCreated={() => {}} />);
      await screen.findByText(message);
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      await waitFor(() => expect(retried()).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(screen.getByRole("button", { name: "Retry" }).getAttribute("aria-busy")).toBeNull(), {
        timeout: 2000,
      });
      expect(screen.getByText(message)).toBeTruthy();

      rerender(<AddAttendeeModal eventId="evt-1" open={false} onClose={() => {}} onCreated={() => {}} />);
      // On the next opening the retried catalog never answers and the other one answers at once:
      // the form may only be held back by the one that was retried, so its counter must be back at 0.
      retried().mockImplementation(() => new Promise(() => {}));
      other().mockResolvedValue([]);
      rerender(<AddAttendeeModal eventId="evt-1" open onClose={() => {}} onCreated={() => {}} />);
      await act(async () => {});
      expect(screen.queryByText(message)).toBeNull();
      expect(fieldsWrapper().className).toContain("at-loading-hold");
      expect(fieldsWrapper().getAttribute("aria-busy")).toBe("true");
    },
  );
});

describe("AddAttendeeModal", () => {
  it("keeps submit disabled until email, name, and attribute fields are ready", async () => {
    render(
      <AddAttendeeModal
        eventId="evt-1"
        open
        onClose={() => {}}
        onCreated={() => {}}
      />,
    );

    const submit = screen.getByRole("button", { name: "Add attendee" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("First name *"), { target: { value: "Jan" } });
    expect(submit.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Email *"), {
      target: { value: "jan@example.com" },
    });
    expect(submit.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Last name *"), { target: { value: "Kowalski" } });

    await waitFor(() => {
      expect(submit.disabled).toBe(false);
    });
  });

  it("keeps Email out of browser/password-manager email autofill, and moves the Required hint down to the actions row", () => {
    render(
      <AddAttendeeModal eventId="evt-1" open onClose={() => {}} onCreated={() => {}} />,
    );

    const email = screen.getByLabelText("Email *") as HTMLInputElement;
    expect(email.type).toBe("text");
    expect(email.inputMode).toBe("email");
    expect(email.autocomplete).toBe("off");
    expect(email.getAttribute("data-1p-ignore")).toBe("true");
    expect(email.getAttribute("data-lpignore")).toBe("true");

    expect(screen.getByText(/enter their email, first name, and last name/i)).toBeTruthy();

    const requiredHint = screen.getByText("* Required");
    const addButton = screen.getByRole("button", { name: "Add attendee" });
    // Same row as the action buttons, not up near the title.
    expect(requiredHint.parentElement).toBe(addButton.closest(".add-attendee-modal__actions"));
  });

  it("shows operator-safe add failure", async () => {
    mockCreateAttendee.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    render(
      <AddAttendeeModal eventId="evt-1" open onClose={() => {}} onCreated={() => {}} />,
    );
    fireEvent.change(screen.getByLabelText("First name *"), { target: { value: "Jan" } });
    fireEvent.change(screen.getByLabelText("Last name *"), { target: { value: "Kowalski" } });
    fireEvent.change(screen.getByLabelText("Email *"), { target: { value: "jan@example.com" } });
    await waitFor(() => {
      expect((screen.getByRole("button", { name: "Add attendee" }) as HTMLButtonElement).disabled).toBe(
        false,
      );
    });
    fireEvent.click(screen.getByRole("button", { name: "Add attendee" }));
    await waitFor(() => {
      expect(screen.getByText(/Failed to add attendee/)).toBeTruthy();
    });
  });

  it("shows the duplicate-email message for a plain 409 email_taken response", async () => {
    mockCreateAttendee.mockRejectedValueOnce(new ApiError(409, "email_taken", "email_taken"));
    render(<AddAttendeeModal eventId="evt-1" open onClose={() => {}} onCreated={() => {}} />);
    fireEvent.change(screen.getByLabelText("First name *"), { target: { value: "Jan" } });
    fireEvent.change(screen.getByLabelText("Last name *"), { target: { value: "Kowalski" } });
    fireEvent.change(screen.getByLabelText("Email *"), { target: { value: "jan@example.com" } });
    await waitFor(() => {
      expect((screen.getByRole("button", { name: "Add attendee" }) as HTMLButtonElement).disabled).toBe(
        false,
      );
    });
    fireEvent.click(screen.getByRole("button", { name: "Add attendee" }));
    expect(await screen.findByText("This email is already registered for this event.")).toBeTruthy();
  });

  it("shows the capacity message, not the duplicate-email one, for a 409 event_full response (bug: both used to render the same 'already registered' text)", async () => {
    mockCreateAttendee.mockRejectedValueOnce(
      new ApiError(409, "Event has reached its capacity limit.", "event_full", {
        capacity: 400,
        current: 400,
      }),
    );
    render(<AddAttendeeModal eventId="evt-1" open onClose={() => {}} onCreated={() => {}} />);
    fireEvent.change(screen.getByLabelText("First name *"), { target: { value: "Jan" } });
    fireEvent.change(screen.getByLabelText("Last name *"), { target: { value: "Kowalski" } });
    fireEvent.change(screen.getByLabelText("Email *"), { target: { value: "jan@example.com" } });
    await waitFor(() => {
      expect((screen.getByRole("button", { name: "Add attendee" }) as HTMLButtonElement).disabled).toBe(
        false,
      );
    });
    fireEvent.click(screen.getByRole("button", { name: "Add attendee" }));
    expect(
      await screen.findByText(
        "Event is at capacity (400/400). Free a slot or increase capacity before adding this attendee.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("This email is already registered for this event.")).toBeNull();
  });

  const dietaryField = {
    id: "fld-1",
    source_field: "dietary",
    label: "Dietary",
    description: null,
    type: "text" as const,
    required: false,
    options: null,
    created_at: "2026-01-01T00:00:00.000Z",
  };

  it.each([
    ["unknown_custom_data_field", undefined, "One of the attribute fields was removed from this event. Refresh and try again."],
    ["required_custom_data_field_missing", "dietary", "Dietary is required."],
    ["validation_failed", "dietary", "Dietary has an invalid value."],
    // The slug no longer matches any current field (not just a since-changed one) - there's no
    // per-field message to build, so this falls back to the generic retry copy.
    ["validation_failed", "ghost_field", "Check the attribute fields and try again."],
  ])("explains the %s custom-data validation response inline for the specific field", async (code, field, message) => {
    // Re-fetched after the error too (the submit handler re-derives the message from current
    // field defs, not the form's stale load) - same list both times here since this case is
    // about the message text, not the refetch-on-race behavior covered separately below.
    mockFetchEventCustomFields.mockResolvedValue([dietaryField]);
    mockCreateAttendee.mockRejectedValueOnce(new ApiError(400, code, code, undefined, field));
    render(<AddAttendeeModal eventId="evt-1" open onClose={() => {}} onCreated={() => {}} />);
    fireEvent.change(screen.getByLabelText("First name *"), { target: { value: "Jan" } });
    fireEvent.change(screen.getByLabelText("Last name *"), { target: { value: "Kowalski" } });
    fireEvent.change(screen.getByLabelText("Email *"), { target: { value: "jan@example.com" } });
    await waitFor(() => {
      expect((screen.getByRole("button", { name: "Add attendee" }) as HTMLButtonElement).disabled).toBe(
        false,
      );
    });
    fireEvent.click(screen.getByRole("button", { name: "Add attendee" }));
    expect(await screen.findByText(message)).toBeTruthy();
  });

  it("re-fetches field defs before describing a validation failure, so a since-removed option isn't quoted as still valid", async () => {
    // Loaded with "S"/"M"/"L"; another admin removes "L" before this submit lands, so the server
    // rejects "L" against its now-current ["S", "M"] - the message must reflect that, not the
    // options this form loaded with.
    mockFetchEventCustomFields
      .mockResolvedValueOnce([{ ...dietaryField, type: "select", options: ["S", "M", "L"] }])
      .mockResolvedValueOnce([{ ...dietaryField, type: "select", options: ["S", "M"] }]);
    mockCreateAttendee.mockRejectedValueOnce(
      new ApiError(400, "validation_failed", "validation_failed", undefined, "dietary"),
    );
    render(<AddAttendeeModal eventId="evt-1" open onClose={() => {}} onCreated={() => {}} />);
    fireEvent.change(screen.getByLabelText("First name *"), { target: { value: "Jan" } });
    fireEvent.change(screen.getByLabelText("Last name *"), { target: { value: "Kowalski" } });
    fireEvent.change(screen.getByLabelText("Email *"), { target: { value: "jan@example.com" } });
    await waitFor(() => {
      expect((screen.getByRole("button", { name: "Add attendee" }) as HTMLButtonElement).disabled).toBe(
        false,
      );
    });
    fireEvent.click(screen.getByRole("button", { name: "Add attendee" }));
    // Only reachable if the error handler re-fetched: the field's initial load had "L" as a
    // valid option, so this message can only name the current ["S", "M"] if it re-derived from
    // the second, post-error mockResolvedValueOnce rather than the form's original load.
    expect(await screen.findByText("Dietary must be one of: S, M.")).toBeTruthy();
  });

  it("populates the Ticket type dropdown from the event's catalog and submits the selected key (batch 04 / #351)", async () => {
    vi.mocked(fetchTicketTypes).mockResolvedValueOnce([
      { id: "tt-1", key: "vip", label: "VIP", color: "purple", sort_order: 0, attendee_count: 0, created_at: "2026-01-01T00:00:00.000Z" },
    ]);
    mockCreateAttendee.mockResolvedValueOnce({} as never);
    render(
      <AddAttendeeModal eventId="evt-1" open onClose={() => {}} onCreated={() => {}} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Ticket type,/ }));
    await screen.findByRole("button", { name: "VIP" });

    fireEvent.change(screen.getByLabelText("First name *"), { target: { value: "Jan" } });
    fireEvent.change(screen.getByLabelText("Last name *"), { target: { value: "Kowalski" } });
    fireEvent.change(screen.getByLabelText("Email *"), { target: { value: "jan@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "VIP" }));
    await waitFor(() => {
      expect((screen.getByRole("button", { name: "Add attendee" }) as HTMLButtonElement).disabled).toBe(
        false,
      );
    });
    fireEvent.click(screen.getByRole("button", { name: "Add attendee" }));

    await waitFor(() =>
      expect(mockCreateAttendee).toHaveBeenCalledWith(
        "evt-1",
        expect.objectContaining({ ticket_type: "vip" }),
      ),
    );
  });

  // Closing and reopening the dialog re-runs both loads; the Retry buttons in each notice (covered
  // below) rerun just the one that failed.
  async function expectDismissableLoadErrorAlert(message: string) {
    const { rerender } = render(
      <AddAttendeeModal eventId="evt-1" open onClose={() => {}} onCreated={() => {}} />,
    );

    const alertText = await screen.findByText(message);
    expect(alertText.closest('[role="alert"]')).toBeTruthy();

    rerender(
      <AddAttendeeModal eventId="evt-1" open={false} onClose={() => {}} onCreated={() => {}} />,
    );
    rerender(
      <AddAttendeeModal eventId="evt-1" open onClose={() => {}} onCreated={() => {}} />,
    );

    await waitFor(() => {
      expect(screen.queryByText(message)).toBeNull();
    });
  }

  it("shows an inline alert when the attribute-field registry fails to load, and clears it on reopen", async () => {
    mockFetchEventCustomFields.mockRejectedValueOnce(new Error("network down"));
    await expectDismissableLoadErrorAlert("Could not load custom fields.");
  });

  it("shows an inline alert when the ticket-type catalog fails to load, and clears it on reopen", async () => {
    vi.mocked(fetchTicketTypes).mockRejectedValueOnce(new Error("network down"));
    await expectDismissableLoadErrorAlert("Could not load ticket types.");
  });

  it("still allows submitting a typeless attendee while the ticket-type catalog failed to load (PO follow-up)", async () => {
    vi.mocked(fetchTicketTypes).mockRejectedValueOnce(new Error("network down"));
    render(<AddAttendeeModal eventId="evt-1" open onClose={() => {}} onCreated={() => {}} />);

    await screen.findByText("Could not load ticket types.");

    fireEvent.change(screen.getByLabelText("First name *"), { target: { value: "Jan" } });
    fireEvent.change(screen.getByLabelText("Last name *"), { target: { value: "Kowalski" } });
    fireEvent.change(screen.getByLabelText("Email *"), { target: { value: "jan@example.com" } });

    // ticket_type is optional - a broken catalog fetch must not block adding an attendee with no
    // type, even though the dropdown itself has nothing but the blank option to offer right now.
    await waitFor(() => {
      expect((screen.getByRole("button", { name: "Add attendee" }) as HTMLButtonElement).disabled).toBe(
        false,
      );
    });
  });

  it("still allows submitting a typeless attendee while the ticket-type catalog is still loading (PO follow-up)", async () => {
    let resolveTicketTypes!: (types: unknown[]) => void;
    vi.mocked(fetchTicketTypes).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveTicketTypes = resolve;
      }),
    );
    render(<AddAttendeeModal eventId="evt-1" open onClose={() => {}} onCreated={() => {}} />);

    await screen.findByText("Loading attendee form");
    fireEvent.change(screen.getByLabelText("First name *"), { target: { value: "Jan" } });
    fireEvent.change(screen.getByLabelText("Last name *"), { target: { value: "Kowalski" } });
    fireEvent.change(screen.getByLabelText("Email *"), { target: { value: "jan@example.com" } });

    // Same reasoning as the load-failure case above - loading is a transient state, not a reason
    // to block adding a typeless attendee.
    expect((screen.getByRole("button", { name: "Add attendee" }) as HTMLButtonElement).disabled).toBe(
      false,
    );

    resolveTicketTypes([]);
    // The loader has been up since 200ms, so it stays for its 400ms minimum before it leaves.
    await waitFor(() => {
      expect(screen.queryByText("Loading attendee form")).toBeNull();
    });
    expect((screen.getByRole("button", { name: "Add attendee" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("does not submit event A's selected ticket type after switching to event B while the modal stays open (audit review)", async () => {
    vi.mocked(fetchTicketTypes).mockResolvedValueOnce([
      { id: "tt-a", key: "vip", label: "VIP", color: "purple", sort_order: 0, attendee_count: 0, created_at: "2026-01-01T00:00:00.000Z" },
    ]);
    const { rerender } = render(
      <AddAttendeeModal eventId="evt-a" open onClose={() => {}} onCreated={() => {}} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Ticket type,/ }));
    await screen.findByRole("button", { name: "VIP" });
    fireEvent.change(screen.getByLabelText("First name *"), { target: { value: "Jan" } });
    fireEvent.change(screen.getByLabelText("Last name *"), { target: { value: "Kowalski" } });
    fireEvent.change(screen.getByLabelText("Email *"), { target: { value: "jan@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "VIP" }));
    expect(screen.getByRole("button", { name: "Ticket type, VIP" })).toBeTruthy();

    // Event B's own catalog fetch never settles in this test - submitting must still be allowed
    // (ticket_type is optional), but the "vip" selection from event A must not leak through to it.
    vi.mocked(fetchTicketTypes).mockReturnValueOnce(new Promise(() => {}));
    mockCreateAttendee.mockResolvedValueOnce({} as never);
    rerender(<AddAttendeeModal eventId="evt-b" open onClose={() => {}} onCreated={() => {}} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Ticket type, none selected" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Add attendee" }));

    await waitFor(() => expect(mockCreateAttendee).toHaveBeenCalled());
    expect(mockCreateAttendee).toHaveBeenCalledWith(
      "evt-b",
      expect.objectContaining({ ticket_type: undefined }),
    );
  });
});
