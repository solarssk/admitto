// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CameraOverlayManualSearch } from "../../src/checkin/CameraOverlayManualSearch.js";
import type { LookupAttendeeResult } from "../../src/api/types.js";
import { makeTicketType } from "../test-utils.js";

const SEARCH_DEBOUNCE_MS = 300;

function hit(overrides: Partial<LookupAttendeeResult> = {}): LookupAttendeeResult {
  return {
    id: "att-1",
    name: "Alice Smith",
    ticket_type: "vip",
    company: "Acme",
    department: null,
    check_in_status: "not_admitted",
    ...overrides,
  };
}

const baseProps = {
  allowManualLookup: true,
  onSelectAttendee: vi.fn(),
  onManualEntry: vi.fn(),
  onBack: vi.fn(),
};

async function search(query: string) {
  const input = screen.getByLabelText<HTMLInputElement>("Search by name or email");
  fireEvent.change(input, { target: { value: query } });
  await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("CameraOverlayManualSearch ticket type catalog resolution", () => {
  it("resolves a result's raw ticket_type key to the catalog's current label instead of the key (batch 04 / #351)", async () => {
    const onSearch = vi.fn().mockResolvedValue([hit({ ticket_type: "vip" })]);
    render(
      <CameraOverlayManualSearch
        {...baseProps}
        onSearch={onSearch}
        ticketTypes={[makeTicketType("vip", "VIP Guest")]}
      />,
    );

    await search("Alice");

    await waitFor(() => expect(screen.getByText("Alice Smith")).toBeTruthy());
    expect(screen.getByText("Acme · VIP Guest")).toBeTruthy();
    expect(screen.queryByText("Acme · vip")).toBeNull();
  });

  it("still shows an orphaned/unmatched ticket_type key rather than hiding it (fail-open)", async () => {
    const onSearch = vi.fn().mockResolvedValue([hit({ ticket_type: "staff_2" })]);
    render(
      <CameraOverlayManualSearch
        {...baseProps}
        onSearch={onSearch}
        ticketTypes={[makeTicketType("vip", "VIP Guest")]}
      />,
    );

    await search("Alice");

    await waitFor(() => expect(screen.getByText("Alice Smith")).toBeTruthy());
    expect(screen.getByText("Acme · staff_2")).toBeTruthy();
  });

  it("falls back to the raw key when no catalog is supplied at all (default prop)", async () => {
    const onSearch = vi.fn().mockResolvedValue([hit({ ticket_type: "vip" })]);
    render(<CameraOverlayManualSearch {...baseProps} onSearch={onSearch} />);

    await search("Alice");

    await waitFor(() => expect(screen.getByText("Alice Smith")).toBeTruthy());
    expect(screen.getByText("Acme · vip")).toBeTruthy();
  });
});
