// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ToastProvider } from "@admitto/ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventDto } from "../../src/api/types.js";
import { ArchivedEventNotice } from "../../src/components/ArchivedEventNotice.js";
import { formatEventDateTime, formatUtcDateTime } from "../../src/utils/event-dates.js";
import { makeSuperadminAssignment } from "../test-utils.js";

let mockAssignments: Array<{ role: string; scope_type: string; scope_id: string | null }> = [];
const mockUnarchiveEvent = vi.fn();
const mockRefreshEvent = vi.fn();

vi.mock("../../src/auth/AuthProvider.js", () => ({
  useAuth: () => ({ assignments: mockAssignments }),
}));

vi.mock("../../src/api/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/api/client.js")>()),
  unarchiveEvent: (...args: unknown[]) => mockUnarchiveEvent(...args),
}));

const ARCHIVED_AT = "2026-07-02T06:03:00.000Z";

function makeEvent(overrides: Partial<EventDto> = {}): EventDto {
  return {
    id: "evt-1",
    title: "Demo Event",
    slug: "demo",
    date: "2026-07-01T18:00:00.000Z",
    timezone: "UTC",
    location: "Hall A",
    capacity: 100,
    archived_at: ARCHIVED_AT,
    archived_by_timezone: "Asia/Kolkata",
    organization_id: "org-1",
    attendee_count: 50,
    ...overrides,
  } as EventDto;
}

function tree(event: EventDto) {
  return (
    <ToastProvider>
      <ArchivedEventNotice key={event.id} event={event} refreshEvent={mockRefreshEvent} />
    </ToastProvider>
  );
}

function notice(): HTMLElement {
  return screen.getByText(/This event is archived/).closest(".at-notice") as HTMLElement;
}

async function openRestoreDialog(): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole("button", { name: "Restore event" }));
  return screen.findByRole("dialog", { name: "Restore this event?" });
}

beforeEach(() => {
  mockUnarchiveEvent.mockReset();
  mockRefreshEvent.mockReset();
  mockRefreshEvent.mockResolvedValue(undefined);
  mockAssignments = [makeSuperadminAssignment()];
});

afterEach(cleanup);

describe("ArchivedEventNotice", () => {
  it("shows nothing for an active event", () => {
    render(tree(makeEvent({ archived_at: null })));

    expect(screen.queryByText(/This event is archived/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Restore event" })).toBeNull();
  });

  it("shows a warning-toned notice with a Restore button for a superadmin", () => {
    render(tree(makeEvent()));

    const bar = notice();
    expect(bar.className).toContain("at-notice--warning");
    expect(bar.textContent).toContain("This event is archived.");
    expect(bar.textContent).toContain("editing and check-in are locked");
    expect(within(bar).getByRole("button", { name: "Restore event" })).toBeTruthy();
    expect(bar.textContent).not.toContain("Ask a superadmin");
  });

  it("hides the Restore button and points to a superadmin for everyone else", () => {
    mockAssignments = [];

    render(tree(makeEvent()));

    expect(screen.queryByRole("button", { name: "Restore event" })).toBeNull();
    expect(notice().textContent).toContain("Ask a superadmin to restore it.");
  });

  it("formats the archive time in UTC when the archiving admin's time zone is unknown", () => {
    render(tree(makeEvent({ archived_by_timezone: null })));

    expect(notice().textContent).toContain(formatUtcDateTime(ARCHIVED_AT));
  });

  it("formats the archive time in the archiving admin's own time zone when known", () => {
    render(tree(makeEvent()));

    expect(notice().textContent).toContain(formatEventDateTime(ARCHIVED_AT, "Asia/Kolkata"));
  });

  it("asks for confirmation before restoring and does nothing on Cancel", async () => {
    render(tree(makeEvent()));

    const dialog = await openRestoreDialog();
    expect(within(dialog).getByText(/"Demo Event" will become active again/)).toBeTruthy();
    expect(mockUnarchiveEvent).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mockUnarchiveEvent).not.toHaveBeenCalled();
    expect(mockRefreshEvent).not.toHaveBeenCalled();
  });

  it("restores the event on confirm, then refreshes the layout event and closes the dialog", async () => {
    mockUnarchiveEvent.mockResolvedValue(undefined);

    render(tree(makeEvent()));

    const dialog = await openRestoreDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Restore event" }));

    await waitFor(() => expect(mockUnarchiveEvent).toHaveBeenCalledWith("evt-1"));
    await waitFor(() => expect(mockRefreshEvent).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByText("Event restored.")).toBeTruthy();
  });

  it("keeps the dialog open when dismissed while the restore request is in flight", async () => {
    let resolveUnarchive!: () => void;
    mockUnarchiveEvent.mockImplementation(() => new Promise<void>((resolve) => (resolveUnarchive = resolve)));

    render(tree(makeEvent()));

    const dialog = await openRestoreDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Restore event" }));
    await waitFor(() => expect(mockUnarchiveEvent).toHaveBeenCalledTimes(1));

    // Backdrop click is the dismissal path that stays enabled while the buttons are disabled.
    fireEvent.click(document.querySelector(".at-modal-backdrop") as HTMLElement);
    expect(screen.getByRole("dialog", { name: "Restore this event?" })).toBeTruthy();

    await act(async () => {
      resolveUnarchive();
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mockRefreshEvent).toHaveBeenCalledTimes(1);
  });

  it("does not refresh the layout when the route moves to another event mid-restore", async () => {
    let resolveUnarchive!: () => void;
    mockUnarchiveEvent.mockImplementation(() => new Promise<void>((resolve) => (resolveUnarchive = resolve)));

    const view = render(tree(makeEvent()));

    const dialog = await openRestoreDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Restore event" }));
    await waitFor(() => expect(mockUnarchiveEvent).toHaveBeenCalledWith("evt-1"));

    // The route moves to another event while the request is still in flight.
    view.rerender(tree(makeEvent({ id: "evt-2", title: "Other Event" })));
    await act(async () => {
      resolveUnarchive();
    });

    expect(mockRefreshEvent).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the dialog open with an inline error when restoring fails, and does not refresh", async () => {
    mockUnarchiveEvent.mockRejectedValue(new Error("boom"));

    render(tree(makeEvent()));

    const dialog = await openRestoreDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Restore event" }));

    await waitFor(() => expect(within(dialog).getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("dialog", { name: "Restore this event?" })).toBeTruthy();
    expect(mockRefreshEvent).not.toHaveBeenCalled();
  });

  it("does not show a failed restore's error on the event the route moved to", async () => {
    let rejectUnarchive!: (err: Error) => void;
    mockUnarchiveEvent.mockImplementation(() => new Promise<void>((_, reject) => (rejectUnarchive = reject)));

    const view = render(tree(makeEvent()));

    const dialog = await openRestoreDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Restore event" }));
    await waitFor(() => expect(mockUnarchiveEvent).toHaveBeenCalledWith("evt-1"));

    view.rerender(tree(makeEvent({ id: "evt-2", title: "Other Event" })));
    await act(async () => {
      rejectUnarchive(new Error("boom"));
    });

    const reopened = await openRestoreDialog();
    expect(within(reopened).queryByRole("alert")).toBeNull();
    expect(within(reopened).getByText(/"Other Event" will become active again/)).toBeTruthy();
  });
});
