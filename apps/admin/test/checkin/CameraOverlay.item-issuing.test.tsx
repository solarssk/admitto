// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CameraOverlay } from "../../src/checkin/CameraOverlay.js";
import type { AttendeeCardDto, AttendeeCardItemDto, CheckInScanResponse } from "../../src/api/types.js";

vi.mock("../../src/checkin/CameraScanner.js", () => ({
  CameraScanner: () => <div data-testid="camera-scanner" />,
}));

function item(overrides: Partial<AttendeeCardItemDto> = {}): AttendeeCardItemDto {
  return {
    key: "badge",
    label: "Badge",
    icon: "id-badge-2",
    state: "pending",
    actions: ["issued"],
    detail: null,
    ...overrides,
  };
}

function attendeeCard(overrides: Partial<AttendeeCardDto> = {}): AttendeeCardDto {
  return {
    id: "att-1",
    name: "Alice Smith",
    company: null,
    department: null,
    ticket_type: "VIP",
    check_in_status: "admitted",
    admitted_at: "2026-07-09T10:00:00.000Z",
    items: [item()],
    notes: [],
    warnings: [],
    ...overrides,
  };
}

const validResult: CheckInScanResponse = { status: "VALID", confirmed: true, admittedAt: "2026-07-09T10:00:00.000Z" };
const alreadyCheckedInResult: CheckInScanResponse = { status: "ALREADY_CHECKED_IN", confirmed: true };
const previewResult: CheckInScanResponse = { status: "PREVIEW", confirmed: false };

const baseProps = {
  open: true,
  eventTimezone: "UTC",
  admittedCount: 0,
  history: [],
  wedgeActive: false,
  onClose: () => {},
  onScan: vi.fn(),
  allowManualLookup: true,
  onSearch: vi.fn().mockResolvedValue([]),
  onSelectAttendee: vi.fn(),
  onManualEntry: vi.fn(),
  onClearManualError: () => {},
  pending: false,
  canAct: true,
  onReset: vi.fn(),
};

afterEach(() => {
  cleanup();
});

describe("CameraOverlay item issuing (#434)", () => {
  it("shows the item-issuing step after a confirmed VALID check-in with pending items", () => {
    render(
      <CameraOverlay
        {...baseProps}
        scanResult={validResult}
        card={attendeeCard()}
        onItemAction={vi.fn().mockResolvedValue(true)}
      />,
    );

    expect(screen.getByText("Item 1 of 1")).toBeTruthy();
    expect(screen.getByText("Badge")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Issue badge" })).toBeTruthy();
  });

  it("ALREADY_CHECKED_IN keeps the standard result card, with a small Issue items entry point", () => {
    // Re-scanning someone already admitted is usually about verifying, not
    // re-issuing — so the item flow must not take over the screen; it opens
    // only from the small button, and only when something is still pending.
    render(
      <CameraOverlay
        {...baseProps}
        scanResult={alreadyCheckedInResult}
        card={attendeeCard()}
        onItemAction={vi.fn().mockResolvedValue(true)}
      />,
    );

    expect(screen.queryByText(/Item 1 of/)).toBeNull();
    expect(screen.getByRole("heading", { name: "Already checked in" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Issue items/ }));
    expect(screen.getByText("Item 1 of 1")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Issue badge" })).toBeTruthy();
  });

  it("ALREADY_CHECKED_IN with nothing left to issue does not offer the Issue items button", () => {
    render(
      <CameraOverlay
        {...baseProps}
        scanResult={alreadyCheckedInResult}
        card={attendeeCard({ items: [item({ actions: [], state: "issued" })] })}
        onItemAction={vi.fn().mockResolvedValue(true)}
      />,
    );

    expect(screen.queryByRole("button", { name: /Issue items/ })).toBeNull();
  });

  it("shows the item's admin-configured description on its step", () => {
    render(
      <CameraOverlay
        {...baseProps}
        scanResult={validResult}
        card={attendeeCard({
          items: [item({ description: "Hand out at the badge desk by the entrance" })],
        })}
        onItemAction={vi.fn().mockResolvedValue(true)}
      />,
    );

    expect(screen.getByText("Hand out at the badge desk by the entrance")).toBeTruthy();
  });

  it("does not trigger for PREVIEW — the confirm card renders unchanged", () => {
    render(
      <CameraOverlay
        {...baseProps}
        scanResult={previewResult}
        card={attendeeCard()}
        onConfirm={vi.fn()}
        onItemAction={vi.fn().mockResolvedValue(true)}
      />,
    );

    expect(screen.getByRole("button", { name: "Confirm check-in" })).toBeTruthy();
    expect(screen.queryByText(/Item 1 of/)).toBeNull();
  });

  it("skips the item step entirely when the event has no items configured", () => {
    render(
      <CameraOverlay
        {...baseProps}
        scanResult={validResult}
        card={attendeeCard({ items: [] })}
        onItemAction={vi.fn().mockResolvedValue(true)}
      />,
    );

    expect(screen.queryByText(/Item 1 of/)).toBeNull();
    expect(screen.getByRole("button", { name: "Scan next" })).toBeTruthy();
  });

  it("still shows an item already resolved before this screen opened, as a hand-over reminder", () => {
    // e.g. Badge auto-issued via "Issue badge at entry" — the system action
    // is done, but the operator still needs to physically hand it over.
    render(
      <CameraOverlay
        {...baseProps}
        scanResult={validResult}
        card={attendeeCard({ items: [item({ actions: [], state: "issued" })] })}
        onItemAction={vi.fn().mockResolvedValue(true)}
      />,
    );

    expect(screen.getByText("Item 1 of 1")).toBeTruthy();
    expect(screen.getByText("Badge")).toBeTruthy();
    expect(screen.getByText(/Already issued/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Next" })).toBeTruthy();
  });

  it("Issue action calls onItemAction and advances to the next item, then to the summary", () => {
    const onItemAction = vi.fn().mockResolvedValue(true);
    render(
      <CameraOverlay
        {...baseProps}
        scanResult={validResult}
        card={attendeeCard({
          items: [item(), item({ key: "gift_bag", label: "Gift bag", actions: ["issued"] })],
        })}
        onItemAction={onItemAction}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Issue badge" }));
    expect(onItemAction).toHaveBeenCalledWith("badge", "issued");
    expect(screen.getByText("Item 2 of 2")).toBeTruthy();
    expect(screen.getByText("Gift bag")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Give gift bag" }));
    expect(onItemAction).toHaveBeenCalledWith("gift_bag", "issued");
    // onItemAction is a bare spy here (doesn't update `card`), so the
    // `items` prop still shows both as pending — the summary reads them as
    // done anyway, from a local optimistic mark taken at click time. That
    // mark is what avoids a real-app flicker: onItemAction's API call
    // resolves asynchronously and updates `card` a tick later, so without
    // it the summary would render "skipped" first against the stale prop,
    // then flip to "issued" once the prop catches up (PO review — issue
    // items end-to-end). Full success/failure reconciliation against the
    // live prop is covered by the Harness-based tests below.
    expect(screen.getByText("All items issued")).toBeTruthy();
  });

  it("reverts the optimistic issued mark when onItemAction resolves false (the request actually failed)", async () => {
    // card never updates — stands in for a failed submitItemAction that
    // left the server-side state unchanged (CheckInPage's real onItemAction
    // catches the error, shows a toast, and resolves false instead of
    // throwing — see its own comment).
    let resolveAction!: (success: boolean) => void;
    const onItemAction = vi.fn(() => new Promise<boolean>((resolve) => { resolveAction = resolve; }));
    render(
      <CameraOverlay
        {...baseProps}
        scanResult={validResult}
        card={attendeeCard({ items: [item()] })}
        onItemAction={onItemAction}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Issue badge" }));
    // Optimistic mark from the click — the flicker fix — shows success
    // immediately, before onItemAction's promise has settled.
    expect(screen.getByText("All items issued")).toBeTruthy();

    await act(async () => {
      resolveAction(false);
      await Promise.resolve();
    });
    // `items` still shows the badge as pending (the update never landed) —
    // the optimistic mark must be dropped, or a false "issued" would
    // misrepresent the item as actually handed out and recorded.
    await waitFor(() => expect(screen.getByText("1 item skipped")).toBeTruthy());
  });

  it("summary reads as a genuine success only when every item was actually issued, not just skipped through", () => {
    function Harness() {
      const [card, setCard] = useState(
        attendeeCard({
          items: [item(), item({ key: "gift_bag", label: "Gift bag", actions: ["issued"] })],
        }),
      );
      return (
        <CameraOverlay
          {...baseProps}
          scanResult={validResult}
          card={card}
          onItemAction={async (key, action) => {
            setCard((c) => ({
              ...c,
              items: c.items.map((i) => (i.key === key ? { ...i, actions: [], state: action } : i)),
            }));
            return true;
          }}
        />
      );
    }
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "Issue badge" }));
    fireEvent.click(screen.getByRole("button", { name: "Give gift bag" }));

    expect(screen.getByText("All items issued")).toBeTruthy();
    expect(document.querySelector(".ck-items--incomplete")).toBeNull();
  });

  it("does not present a false success when everything was skipped — no items actually issued", () => {
    render(
      <CameraOverlay
        {...baseProps}
        scanResult={validResult}
        card={attendeeCard({
          items: [item(), item({ key: "gift_bag", label: "Gift bag", actions: ["issued"] })],
        })}
        onItemAction={vi.fn().mockResolvedValue(true)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));

    expect(screen.getByText("2 items skipped")).toBeTruthy();
    expect(screen.queryByText("All items issued")).toBeNull();
    expect(document.querySelector(".ck-items--incomplete")).toBeTruthy();
  });

  it("Skip advances without calling onItemAction", () => {
    const onItemAction = vi.fn().mockResolvedValue(true);
    render(
      <CameraOverlay
        {...baseProps}
        scanResult={validResult}
        card={attendeeCard({
          items: [item(), item({ key: "gift_bag", label: "Gift bag", actions: ["issued"] })],
        })}
        onItemAction={onItemAction}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(onItemAction).not.toHaveBeenCalled();
    expect(screen.getByText("Item 2 of 2")).toBeTruthy();
  });

  it("Back returns to the previous item", () => {
    render(
      <CameraOverlay
        {...baseProps}
        scanResult={validResult}
        card={attendeeCard({
          items: [item(), item({ key: "gift_bag", label: "Gift bag", actions: ["issued"] })],
        })}
        onItemAction={vi.fn().mockResolvedValue(true)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(screen.getByText("Item 2 of 2")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Back/ }));
    expect(screen.getByText("Item 1 of 2")).toBeTruthy();
    expect(screen.getByText("Badge")).toBeTruthy();
  });

  it("summary lists issued items with a check and skipped items with a dash, and Next scan calls onReset", () => {
    // onItemAction must actually update `card` for the summary to tell
    // issued vs. skipped apart — CameraOverlay is a controlled component,
    // so this mirrors what CheckInPage's real onItemAction/setCard does.
    const onReset = vi.fn();
    function Harness() {
      const [card, setCard] = useState(
        attendeeCard({
          items: [item(), item({ key: "gift_bag", label: "Gift bag", actions: ["issued"] })],
        }),
      );
      return (
        <CameraOverlay
          {...baseProps}
          scanResult={validResult}
          card={card}
          onItemAction={async (key, action) => {
            setCard((c) => ({
              ...c,
              items: c.items.map((i) => (i.key === key ? { ...i, actions: [], state: action } : i)),
            }));
            return true;
          }}
          onReset={onReset}
        />
      );
    }
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "Issue badge" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));

    const summary = screen.getByText("1 item skipped").closest(".ck-items") as HTMLElement;
    expect(summary.querySelector("li.is-done")?.textContent).toContain("Badge");
    expect(summary.querySelector("li.is-skipped")?.textContent).toContain("Gift bag");

    fireEvent.click(screen.getByRole("button", { name: "Next scan" }));
    expect(onReset).toHaveBeenCalled();
  });

  it("Back to an already-issued item shows an informational state with Next, not Skip/re-issue", () => {
    // Harness so onItemAction actually resolves the item, matching how
    // CheckInPage's real onItemAction/setCard updates the card.
    function Harness() {
      const [card, setCard] = useState(
        attendeeCard({
          items: [item(), item({ key: "gift_bag", label: "Gift bag", actions: ["issued"] })],
        }),
      );
      return (
        <CameraOverlay
          {...baseProps}
          scanResult={validResult}
          card={card}
          onItemAction={async (key, action) => {
            setCard((c) => ({
              ...c,
              items: c.items.map((i) => (i.key === key ? { ...i, actions: [], state: action } : i)),
            }));
            return true;
          }}
        />
      );
    }
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "Issue badge" }));
    expect(screen.getByText("Item 2 of 2")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Back/ }));
    expect(screen.getByText("Item 1 of 2")).toBeTruthy();
    expect(screen.getByText(/Already issued/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Issue badge" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Skip" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Item 2 of 2")).toBeTruthy();
  });

  it("keeps a Badge step even when it was auto-issued (badge_at_entry) before Confirm resolved", () => {
    // Both items exist on the card from the very first fetch (PREVIEW) —
    // only Badge's actions change once Confirm resolves and auto-issues it
    // server-side. The step must still appear (as a hand-over reminder),
    // not get dropped just because its action is gone.
    const items = [item(), item({ key: "gift_bag", label: "Gift bag", actions: ["issued"] })];
    const { rerender } = render(
      <CameraOverlay
        {...baseProps}
        scanResult={previewResult}
        card={attendeeCard({ items })}
        onConfirm={vi.fn()}
        onItemAction={vi.fn().mockResolvedValue(true)}
      />,
    );
    expect(screen.queryByText(/Item 1 of/)).toBeNull();

    rerender(
      <CameraOverlay
        {...baseProps}
        scanResult={validResult}
        card={attendeeCard({
          items: [{ ...items[0], actions: [], state: "issued" }, items[1]],
        })}
        onConfirm={vi.fn()}
        onItemAction={vi.fn().mockResolvedValue(true)}
      />,
    );

    expect(screen.getByText("Item 1 of 2")).toBeTruthy();
    expect(screen.getByText("Badge")).toBeTruthy();
    expect(screen.getByText(/Already issued/)).toBeTruthy();
  });

  it("shows Undo last check-in on the summary only when showUndo is set", () => {
    const onUndo = vi.fn();
    render(
      <CameraOverlay
        {...baseProps}
        scanResult={validResult}
        card={attendeeCard()}
        onItemAction={vi.fn().mockResolvedValue(true)}
        onUndo={onUndo}
        showUndo
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Issue badge" }));
    fireEvent.click(screen.getByRole("button", { name: "Undo last check-in" }));
    expect(onUndo).toHaveBeenCalled();
  });
});
