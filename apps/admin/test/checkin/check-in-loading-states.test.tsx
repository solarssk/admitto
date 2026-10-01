// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AttendeeCardDto } from "../../src/api/types.js";
import { AttendeeCard } from "../../src/checkin/AttendeeCard.js";
import { CheckInCameraResultPanel } from "../../src/checkin/CheckInCameraResultPanel.js";
import { CkRecentScans } from "../../src/checkin/CkRecentScans.js";
import { CkStats } from "../../src/checkin/CkStats.js";
import { NoteModal } from "../../src/checkin/NoteModal.js";
import { ScanHistoryError, ScanHistoryList, type ScanHistoryStatus } from "../../src/checkin/ScanHistoryList.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

describe("CkStats while the counts are unknown", () => {
  it("puts a placeholder where the numbers go, never a 0, and hides the empty progress bar from assistive tech", () => {
    const { container } = render(<CkStats admitted={0} total={0} loading />);
    expect(container.querySelectorAll(".at-skeleton")).toHaveLength(3);
    expect(container.querySelector(".ck-stats")?.getAttribute("aria-busy")).toBe("true");
    expect(container.textContent).not.toMatch(/\d/);
    expect(container.querySelector("progress")?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.queryByLabelText(/expected guests admitted/)).toBeNull();
  });

  it("holds its space without painting when held", () => {
    const { container } = render(<CkStats admitted={0} total={0} loading held />);
    expect(container.querySelector(".ck-stats")?.className).toContain("at-loading-hold");
  });

  it("shows the numbers as before when not loading", () => {
    const { container } = render(<CkStats admitted={7} total={20} />);
    expect(container.textContent).toContain("7");
    expect(container.textContent).toContain("35%");
    expect(container.querySelector(".at-skeleton")).toBeNull();
    expect(container.querySelector(".ck-stats")?.getAttribute("aria-busy")).toBeNull();
    expect(screen.getByLabelText("35% of expected guests admitted")).toBeTruthy();
  });
});

describe("CkRecentScans while the history is unknown", () => {
  it("shows rows of placeholder instead of 'No scans yet', capped by the limit", () => {
    const { container, rerender } = render(<CkRecentScans history={[]} loading />);
    expect(screen.queryByText("No scans yet")).toBeNull();
    expect(container.querySelectorAll(".ck-recent__row--skeleton")).toHaveLength(4);
    expect(container.querySelector(".ck-recent")?.getAttribute("aria-busy")).toBe("true");
    // The count badge is a placeholder too, not a 0.
    expect(container.querySelector(".ck-recent__count")).toBeNull();

    rerender(<CkRecentScans history={[]} loading limit={3} />);
    expect(container.querySelectorAll(".ck-recent__row--skeleton")).toHaveLength(3);
  });

  it("holds its space without painting when held, and says 'No scans yet' only once it is really empty", () => {
    const { container, rerender } = render(<CkRecentScans history={[]} loading held />);
    expect(container.querySelector(".ck-recent")?.className).toContain("at-loading-hold");
    rerender(<CkRecentScans history={[]} />);
    expect(screen.getByText("No scans yet")).toBeTruthy();
    expect(container.querySelector(".at-skeleton")).toBeNull();
  });
});

describe("ScanHistoryList first load", () => {
  const list = (status: ScanHistoryStatus, extra: Partial<Parameters<typeof ScanHistoryList>[0]> = {}) => (
    <ScanHistoryList admittedCount={7} totalCount={20} history={[]} status={status} {...extra} />
  );

  it("holds the space for 200ms, draws the placeholder, keeps it for 400ms, then fades the numbers in", async () => {
    const { container, rerender } = render(list("loading"));
    expect(container.querySelector(".ck-stats")?.className).toContain("at-loading-hold");
    await advance(199);
    expect(container.querySelector(".ck-stats")?.className).toContain("at-loading-hold");
    await advance(1);
    expect(container.querySelector(".ck-stats")?.className).not.toContain("at-loading-hold");
    expect(container.querySelector(".at-skeleton")).toBeTruthy();

    // The answer comes after 250ms of placeholder: it stays until 400ms have passed.
    await advance(250);
    rerender(list("ready"));
    expect(container.querySelector(".at-skeleton")).toBeTruthy();
    await advance(149);
    expect(container.querySelector(".at-skeleton")).toBeTruthy();
    await advance(1);
    expect(container.querySelector(".at-skeleton")).toBeNull();
    expect(container.textContent).toContain("7");
    expect(container.firstElementChild?.className).toContain("at-fade-in");
  });

  it("draws no placeholder at all when the answer comes inside the 200ms", async () => {
    const { container, rerender } = render(list("loading"));
    await advance(150);
    rerender(list("ready"));
    await advance(1000);
    expect(container.querySelector(".at-skeleton")).toBeNull();
    expect(container.textContent).toContain("7");
  });

  it("does not fade in a list that never waited", () => {
    const { container } = render(list("ready"));
    expect(container.firstElementChild?.className ?? "").not.toContain("at-fade-in");
    expect(container.textContent).toContain("7");
  });

  it("says it could not load, with a Retry that is busy for at least 400ms and leaves the numbers out", async () => {
    const onRetry = vi.fn();
    const { container, rerender } = render(list("loading", { onRetry }));
    await advance(10);
    rerender(list("error", { onRetry }));
    await advance(10);
    expect(screen.getByText("Could not load the counts and recent scans.")).toBeTruthy();
    expect(container.querySelector(".ck-stats")).toBeNull();
    expect(screen.queryByText("No scans yet")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    rerender(list("error", { onRetry, retrying: true }));
    expect(screen.getByRole("button", { name: "Retry" }).getAttribute("aria-busy")).toBe("true");
    // The retry fails again at once: the button still shows it ran.
    rerender(list("error", { onRetry, retrying: false }));
    await advance(399);
    expect(screen.getByRole("button", { name: "Retry" }).getAttribute("aria-busy")).toBe("true");
    await advance(1);
    expect(screen.getByRole("button", { name: "Retry" }).getAttribute("aria-busy")).toBeNull();
    expect(screen.getByText("Could not load the counts and recent scans.")).toBeTruthy();
  });

  it("shows the numbers again once a retry succeeds", async () => {
    const { container, rerender } = render(list("error", { onRetry: vi.fn() }));
    await advance(10);
    rerender(list("ready", { onRetry: vi.fn() }));
    await advance(10);
    expect(container.textContent).toContain("7");
    expect(screen.queryByText("Could not load the counts and recent scans.")).toBeNull();
  });
});

describe("ScanHistoryList without an event id, and the error card without a Retry", () => {
  it("draws the default placeholder and remembers nothing when it is not told which event it is for", async () => {
    const { container, rerender } = render(<ScanHistoryList admittedCount={0} totalCount={0} history={[]} status="loading" />);
    await advance(200);
    expect(container.querySelectorAll(".ck-recent__row--skeleton")).toHaveLength(4);
    rerender(<ScanHistoryList admittedCount={0} totalCount={0} history={[]} status="ready" />);
    await advance(500);
    expect(localStorage).toHaveLength(0);
  });

  it("says it again, for assistive tech, when a retry fails with the same message (Notice's actionBusy)", async () => {
    const { container, rerender } = render(<ScanHistoryError onRetry={vi.fn()} retrying={false} />);
    const before = container.querySelector(".at-notice__body")?.firstElementChild ?? container.querySelector(".at-notice__body");
    expect(before).not.toBeNull();

    rerender(<ScanHistoryError onRetry={vi.fn()} retrying />);
    rerender(<ScanHistoryError onRetry={vi.fn()} retrying={false} />);
    await advance(500);
    const after = container.querySelector(".at-notice__body")?.firstElementChild ?? container.querySelector(".at-notice__body");
    // The message is a new node, so the live region announces it again; the Retry button is the same one.
    expect(after).not.toBe(before);
    expect(screen.getByText("Could not load the counts and recent scans.")).toBeTruthy();
  });

  it("shows only the message when there is nothing to retry", () => {
    render(<ScanHistoryError />);
    expect(screen.getByText("Could not load the counts and recent scans.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });
});

describe("ScanHistoryList placeholder rows follow what this event's list had last time", () => {
  const entry = (i: number) => ({
    id: `h${i}`,
    event_id: "evt-1",
    attendee_id: `att-${i}`,
    status: "admitted",
    checked_in_at: "2026-09-01T09:44:00.000Z",
    checked_in_by: null,
    device_id: null,
    source: null,
    attendee: { name: `Person ${i}`, ticket_type: null },
  });
  const rows = (container: HTMLElement) => container.querySelectorAll(".ck-recent__row--skeleton").length;

  afterEach(() => localStorage.clear());

  it("draws that many rows, capped at what the list can show, and a few when nothing is remembered", async () => {
    localStorage.setItem("admitto_checkin_scans_rows_evt-1", "2");
    const first = render(<ScanHistoryList eventId="evt-1" admittedCount={0} totalCount={0} history={[]} status="loading" />);
    await advance(200);
    expect(rows(first.container)).toBe(2);
    first.unmount();

    localStorage.setItem("admitto_checkin_scans_rows_evt-1", "30");
    const capped = render(<ScanHistoryList eventId="evt-1" admittedCount={0} totalCount={0} history={[]} status="loading" />);
    await advance(200);
    expect(rows(capped.container)).toBe(8);
    capped.unmount();

    const unknown = render(<ScanHistoryList eventId="evt-other" admittedCount={0} totalCount={0} history={[]} status="loading" />);
    await advance(200);
    expect(rows(unknown.container)).toBe(4);
  });

  it("uses each event's own remembered size when the same list switches to another event", async () => {
    localStorage.setItem("admitto_checkin_scans_rows_evt-1", "8");
    localStorage.setItem("admitto_checkin_scans_rows_evt-2", "1");
    const { container, rerender } = render(<ScanHistoryList eventId="evt-1" admittedCount={0} totalCount={0} history={[]} status="loading" />);
    await advance(200);
    expect(rows(container)).toBe(8);

    rerender(<ScanHistoryList eventId="evt-2" admittedCount={0} totalCount={0} history={[]} status="loading" />);
    await advance(10);
    expect(rows(container)).toBe(1);
  });

  it("remembers how many rows it showed once loaded, per event, and not before", async () => {
    const { rerender } = render(
      <ScanHistoryList eventId="evt-1" admittedCount={3} totalCount={9} history={[entry(1), entry(2), entry(3)]} status="loading" />,
    );
    await advance(10);
    expect(localStorage.getItem("admitto_checkin_scans_rows_evt-1")).toBeNull();

    rerender(<ScanHistoryList eventId="evt-1" admittedCount={3} totalCount={9} history={[entry(1), entry(2), entry(3)]} status="ready" />);
    await advance(10);
    expect(localStorage.getItem("admitto_checkin_scans_rows_evt-1")).toBe("3");
    expect(localStorage.getItem("admitto_checkin_scans_rows_evt-2")).toBeNull();
    // The Attendees list keeps its own number for the same event.
    expect(localStorage.getItem("admitto_attendees_rows_evt-1")).toBeNull();
  });
});

const previewCard: AttendeeCardDto = {
  id: "att-1",
  name: "Anna Alpha",
  company: null,
  department: null,
  ticket_type: "vip",
  check_in_status: "not_admitted",
  admitted_at: null,
  items: [],
  notes: [],
  blocked: false,
};

describe("Confirm check-in is busy as soon as that request is in flight", () => {
  it("on the attendee card: a spinner, disabled, same button", () => {
    const { rerender } = render(
      <AttendeeCard card={previewCard} scanStatus="PREVIEW" canAct pending={false} onCheckIn={vi.fn()} />,
    );
    const idle = screen.getByRole("button", { name: "Confirm check-in" });
    expect(idle.getAttribute("aria-busy")).toBeNull();
    expect((idle as HTMLButtonElement).disabled).toBe(false);

    rerender(<AttendeeCard card={previewCard} scanStatus="PREVIEW" canAct={false} pending={false} admitting onCheckIn={vi.fn()} />);
    const busy = screen.getByRole("button", { name: /Confirm check-in|Checking in/ });
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect((busy as HTMLButtonElement).disabled).toBe(true);
  });

  it("on the camera result panel", () => {
    const { rerender } = render(
      <CheckInCameraResultPanel
        scanResult={{ status: "PREVIEW", confirmed: false }}
        card={previewCard}
        pending={false}
        canAct
        eventTimezone="UTC"
        onConfirm={vi.fn()}
        onReset={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Confirm check-in" }).getAttribute("aria-busy")).toBeNull();
    rerender(
      <CheckInCameraResultPanel
        scanResult={{ status: "PREVIEW", confirmed: false }}
        card={previewCard}
        pending={false}
        canAct={false}
        admitting
        eventTimezone="UTC"
        onConfirm={vi.fn()}
        onReset={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /Confirm check-in|Checking in/ }).getAttribute("aria-busy")).toBe("true");
  });
});

describe("NoteModal while the note is being saved", () => {
  it("keeps the button, marks it busy and disables it, instead of swapping its text", async () => {
    let finish!: () => void;
    const onSubmit = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    render(<NoteModal open onClose={() => {}} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "allergic to nuts" } });
    const add = screen.getByRole("button", { name: "Add note" });
    expect(add.getAttribute("aria-busy")).toBeNull();

    fireEvent.click(add);
    const busy = screen.getByRole("button", { name: /Add note|Saving/ });
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    await act(async () => finish());
  });
});

describe("Undo check-in is busy while the undo is being sent", () => {
  it("shows a spinner on that button, keeps it in place, and puts it back when the undo is done", async () => {
    let finish!: () => void;
    const onUndo = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    render(
      <AttendeeCard
        card={{ ...previewCard, check_in_status: "admitted", admitted_at: "2026-09-01T09:44:00.000Z" }}
        canAct
        showUndo
        onUndo={onUndo}
      />,
    );
    const undo = screen.getByRole("button", { name: "Undo check-in" });
    expect(undo.getAttribute("aria-busy")).toBeNull();

    fireEvent.click(undo);
    expect(screen.getByRole("button", { name: /Undo check-in/ }).getAttribute("aria-busy")).toBe("true");
    expect(onUndo).toHaveBeenCalledTimes(1);

    await act(async () => finish());
    expect(screen.getByRole("button", { name: "Undo check-in" }).getAttribute("aria-busy")).toBeNull();
  });
});

describe("an item's action and its Revoke share a guard, but the spinner goes on the pressed one", () => {
  const issuedItem = {
    key: "badge",
    label: "Badge",
    icon: null,
    detail: null,
    description: null,
    state: "issued",
    actions: ["returned"],
  };
  const card: AttendeeCardDto = {
    ...previewCard,
    check_in_status: "admitted",
    admitted_at: "2026-09-01T09:44:00.000Z",
    items: [issuedItem],
  } as AttendeeCardDto;

  it("Mark returned: only that button is busy, the Revoke beside it only disabled", async () => {
    let finish!: (ok: boolean) => void;
    const onItemAction = vi.fn(() => new Promise<boolean>((resolve) => (finish = resolve)));
    render(<AttendeeCard card={card} canAct onItemAction={onItemAction} onRevokeItem={vi.fn()} />);
    const mark = screen.getByRole("button", { name: "Mark badge returned" });
    const revoke = screen.getByRole("button", { name: "Revoke Badge" });

    fireEvent.click(mark);
    expect(mark.getAttribute("aria-busy")).toBe("true");
    expect(revoke.getAttribute("aria-busy")).toBeNull();
    expect((revoke as HTMLButtonElement).disabled).toBe(true);

    await act(async () => finish(true));
    expect(mark.getAttribute("aria-busy")).toBeNull();
    expect((revoke as HTMLButtonElement).disabled).toBe(false);
  });

  it("Revoke: only that button is busy, the Mark returned beside it only disabled", async () => {
    let finish!: (ok: boolean) => void;
    const onRevokeItem = vi.fn(() => new Promise<boolean>((resolve) => (finish = resolve)));
    render(<AttendeeCard card={card} canAct onItemAction={vi.fn()} onRevokeItem={onRevokeItem} />);
    const mark = screen.getByRole("button", { name: "Mark badge returned" });
    const revoke = screen.getByRole("button", { name: "Revoke Badge" });

    fireEvent.click(revoke);
    expect(revoke.getAttribute("aria-busy")).toBe("true");
    expect(mark.getAttribute("aria-busy")).toBeNull();
    expect((mark as HTMLButtonElement).disabled).toBe(true);

    await act(async () => finish(true));
    expect(revoke.getAttribute("aria-busy")).toBeNull();
  });
});
