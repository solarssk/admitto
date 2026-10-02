// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@admitto/ui";
import type { EventSettingsDto, TicketTypeDto } from "../../src/api/types.js";
import { TicketTypesCard } from "../../src/settings/TicketTypesCard.js";
import { advanceTimers, deferred, hangUntilAborted, isOff } from "../test-utils.js";

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return { ...actual, fetchTicketTypes: vi.fn() };
});

import { fetchTicketTypes } from "../../src/api/client.js";

const event = { id: "evt-1", status: "active" } as EventSettingsDto;
const vip: TicketTypeDto = { id: "tt-vip", key: "vip", label: "VIP", color: "purple", sort_order: 0, attendee_count: 2, created_at: "2026-01-01T00:00:00.000Z" };
const staff: TicketTypeDto = { ...vip, id: "tt-staff", key: "staff", label: "Staff", color: "blue" };

function ui(eventId = "evt-1") {
  return (
    <ToastProvider>
      <div role="tabpanel" aria-label="Ticket types">
        <TicketTypesCard eventId={eventId} event={event} />
      </div>
    </ToastProvider>
  );
}

const placeholder = () => screen.queryByRole("status", { name: "Loading ticket types" });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("TicketTypesCard first load on the loading standard", () => {
  it("keeps the card's title and Add button from the first frame, holds the rows' room for 200ms, then draws rows and says it is taking longer after 8 seconds", async () => {
    vi.mocked(fetchTicketTypes).mockImplementation(hangUntilAborted as never);
    render(ui());

    expect(screen.getByText("Ticket types")).toBeTruthy();
    expect(placeholder()?.className).toContain("at-loading-hold");
    // No count before there is one to tell, and nothing to add to a list that is not there.
    expect(screen.queryByText(/^\d+ types?$/)).toBeNull();
    expect(isOff(screen.getByRole("button", { name: "Add ticket type" }))).toBe(true);

    await advanceTimers(200);
    expect(placeholder()?.className).not.toContain("at-loading-hold");
    expect(placeholder()?.textContent).not.toContain("Taking longer than usual");
    await advanceTimers(7_800);
    expect(placeholder()?.textContent).toContain("Taking longer than usual");
  });

  it("never draws the rows for an answer within 200ms, and then shows the count and an Add button that works", async () => {
    const answer = deferred<TicketTypeDto[]>();
    vi.mocked(fetchTicketTypes).mockReturnValue(answer.promise);
    render(ui());

    await advanceTimers(100);
    await act(async () => answer.resolve([vip]));
    expect(placeholder()).toBeNull();
    expect(screen.getByDisplayValue("VIP")).toBeTruthy();
    expect(screen.getByText("1 type")).toBeTruthy();
    expect(isOff(screen.getByRole("button", { name: "Add ticket type" }))).toBe(false);
  });

  it("ends in an error with a Retry after 30 seconds, and a Retry that stays on screen, busy, until the answer is in", async () => {
    vi.mocked(fetchTicketTypes).mockImplementation(hangUntilAborted as never);
    render(ui());
    await advanceTimers(30_000);
    await advanceTimers(0);

    expect(placeholder()).toBeNull();
    expect(screen.getByText("Could not load ticket types")).toBeTruthy();
    expect(screen.getByText(/The server did not answer in time/)).toBeTruthy();
    const retry = screen.getByRole("button", { name: "Retry" });
    retry.focus();
    const answer = deferred<TicketTypeDto[]>();
    vi.mocked(fetchTicketTypes).mockReturnValueOnce(answer.promise);
    fireEvent.click(retry);
    await advanceTimers(0);

    expect(screen.getByRole("button", { name: "Retry" })).toBe(retry);
    expect(retry.getAttribute("aria-busy")).toBe("true");
    expect(retry.hasAttribute("disabled")).toBe(false);
    expect(placeholder()).toBeNull();
    fireEvent.click(retry);
    expect(fetchTicketTypes).toHaveBeenCalledTimes(2);

    await act(async () => answer.resolve([vip]));
    await advanceTimers(0);
    expect(screen.getByDisplayValue("VIP")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("tabpanel", { name: "Ticket types" }));
  });

  it("is a fresh card for another event: the previous event's rows are gone at once", async () => {
    const second = deferred<TicketTypeDto[]>();
    vi.mocked(fetchTicketTypes).mockReturnValueOnce(Promise.resolve([vip])).mockReturnValueOnce(second.promise);
    const { rerender } = render(ui("evt-1"));
    await advanceTimers(0);
    expect(screen.getByDisplayValue("VIP")).toBeTruthy();

    rerender(ui("evt-2"));
    expect(screen.queryByDisplayValue("VIP")).toBeNull();
    expect(placeholder()).not.toBeNull();
    await act(async () => second.resolve([staff]));
    await advanceTimers(0);
    expect(screen.getByDisplayValue("Staff")).toBeTruthy();
  });

  it("drops the answer of the event that was open when it arrives after the next one was asked for", async () => {
    const first = deferred<TicketTypeDto[]>();
    const second = deferred<TicketTypeDto[]>();
    vi.mocked(fetchTicketTypes).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { rerender } = render(ui("evt-1"));
    await advanceTimers(0);

    rerender(ui("evt-2"));
    await act(async () => first.resolve([vip]));
    await advanceTimers(0);
    expect(screen.queryByDisplayValue("VIP")).toBeNull();
    expect(placeholder()).not.toBeNull();

    await act(async () => second.resolve([staff]));
    await advanceTimers(0);
    expect(screen.getByDisplayValue("Staff")).toBeTruthy();
    expect(screen.queryByDisplayValue("VIP")).toBeNull();
  });

  it("shows no count and no working Add button over the error, nor while its Retry runs", async () => {
    vi.mocked(fetchTicketTypes).mockRejectedValueOnce(new Error("network down"));
    render(ui());
    await advanceTimers(0);

    expect(screen.getByText("Could not load ticket types")).toBeTruthy();
    expect(screen.queryByText(/^\d+ types?$/)).toBeNull();
    expect(isOff(screen.getByRole("button", { name: "Add ticket type" }))).toBe(true);

    const answer = deferred<TicketTypeDto[]>();
    vi.mocked(fetchTicketTypes).mockReturnValueOnce(answer.promise);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await advanceTimers(0);
    expect(screen.queryByText(/^\d+ types?$/)).toBeNull();
    expect(isOff(screen.getByRole("button", { name: "Add ticket type" }))).toBe(true);
  });
});
