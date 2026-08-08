// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AttendeePicker } from "../../src/communication/AttendeePicker.js";
import type { AttendeeRowDto } from "../../src/api/types.js";

const fetchEventAttendees = vi.fn();

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    fetchEventAttendees: (...args: unknown[]) => fetchEventAttendees(...args),
  };
});

function attendee(overrides: Partial<AttendeeRowDto> = {}): AttendeeRowDto {
  return {
    id: "att-1",
    name: "Alex Example",
    email: "alex@example.com",
    company: null,
    department: null,
    ticket_type: null,
    status: "registered",
    check_in_status: "not_admitted",
    admitted_at: null,
    updated_at: "2026-01-01T00:00:00.000Z",
    last_mail_status: null,
    rsvp_status: "none",
    has_issued_items: false,
    ...overrides,
  };
}

function Harness({ disabled = false }: { disabled?: boolean }) {
  const [selected, setSelected] = useState<AttendeeRowDto[]>([]);
  return (
    <AttendeePicker eventId="evt-1" selected={selected} onChange={setSelected} disabled={disabled} />
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

fetchEventAttendees.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 10 });

describe("AttendeePicker", () => {
  it("does not search below the two-character minimum", async () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Search attendees"), { target: { value: "A" } });

    await new Promise((r) => setTimeout(r, 400));
    expect(fetchEventAttendees).not.toHaveBeenCalled();
  });

  it("searches (debounced) once the query reaches the minimum length, and adds a pick as a chip", async () => {
    fetchEventAttendees.mockResolvedValue({
      items: [attendee()],
      total: 1,
      page: 1,
      pageSize: 10,
    });
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Search attendees"), { target: { value: "alex" } });

    await waitFor(() =>
      expect(fetchEventAttendees).toHaveBeenCalledWith("evt-1", { q: "alex", pageSize: 10 }),
    );
    fireEvent.click(await screen.findByRole("button", { name: /Alex Example/ }));

    expect(screen.getByText("Alex Example")).toBeTruthy();
    // Picking clears the search box back to empty.
    expect((screen.getByLabelText("Search attendees") as HTMLInputElement).value).toBe("");
  });

  it("excludes an already-selected attendee from the dropdown", async () => {
    fetchEventAttendees.mockResolvedValue({
      items: [attendee(), attendee({ id: "att-2", name: "Sam Sample", email: "sam@example.com" })],
      total: 2,
      page: 1,
      pageSize: 10,
    });
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Search attendees"), { target: { value: "ex" } });
    fireEvent.click(await screen.findByRole("button", { name: /Alex Example/ }));

    // Re-trigger the same search - the already-picked Alex must not reappear as a suggestion.
    fireEvent.change(screen.getByLabelText("Search attendees"), { target: { value: "ex" } });
    await waitFor(() => expect(fetchEventAttendees).toHaveBeenCalledTimes(2));

    expect(await screen.findByRole("button", { name: /^Sam Sample/ })).toBeTruthy();
    // Regex anchored at the start - a loose match would also catch the picked chip's own
    // "Remove Alex Example" button, which is expected to stay present.
    expect(screen.queryByRole("button", { name: /^Alex Example/ })).toBeNull();
  });

  it("removes a picked attendee via the chip's remove button", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [attendee()], total: 1, page: 1, pageSize: 10 });
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Search attendees"), { target: { value: "alex" } });
    fireEvent.click(await screen.findByRole("button", { name: /Alex Example/ }));
    expect(screen.getByText("Alex Example")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Remove Alex Example" }));
    expect(screen.queryByText("Alex Example")).toBeNull();
  });

  it("disables the search input and chip removal when disabled", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [attendee()], total: 1, page: 1, pageSize: 10 });
    const { rerender } = render(<Harness />);
    fireEvent.change(screen.getByLabelText("Search attendees"), { target: { value: "alex" } });
    fireEvent.click(await screen.findByRole("button", { name: /Alex Example/ }));

    rerender(<Harness disabled />);

    expect((screen.getByLabelText("Search attendees") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Remove Alex Example" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("drops a slow prior search when the query changes before the debounce fires", async () => {
    let resolveFirst: ((value: unknown) => void) | undefined;
    fetchEventAttendees.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );
    fetchEventAttendees.mockResolvedValueOnce({
      items: [attendee({ id: "att-2", name: "Sam Sample", email: "sam@example.com" })],
      total: 1,
      page: 1,
      pageSize: 10,
    });

    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Search attendees"), { target: { value: "al" } });
    await waitFor(() => expect(fetchEventAttendees).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText("Search attendees"), { target: { value: "sa" } });
    await waitFor(() => expect(fetchEventAttendees).toHaveBeenCalledTimes(2));

    await act(async () => {
      resolveFirst?.({
        items: [attendee({ id: "att-1", name: "Alex Example", email: "alex@example.com" })],
        total: 1,
        page: 1,
        pageSize: 10,
      });
      await Promise.resolve();
    });

    expect(screen.queryByRole("button", { name: /^Alex Example/ })).toBeNull();
    expect(await screen.findByRole("button", { name: /^Sam Sample/ })).toBeTruthy();
  });

  it("clears query and results when eventId changes", async () => {
    fetchEventAttendees.mockResolvedValue({
      items: [attendee()],
      total: 1,
      page: 1,
      pageSize: 10,
    });
    const { rerender } = render(
      <AttendeePicker eventId="evt-a" selected={[]} onChange={() => {}} />,
    );
    fireEvent.change(screen.getByLabelText("Search attendees"), { target: { value: "alex" } });
    expect(await screen.findByRole("button", { name: /^Alex Example/ })).toBeTruthy();

    rerender(<AttendeePicker eventId="evt-b" selected={[]} onChange={() => {}} />);

    expect((screen.getByLabelText("Search attendees") as HTMLInputElement).value).toBe("");
    expect(screen.queryByRole("button", { name: /^Alex Example/ })).toBeNull();
  });
});
