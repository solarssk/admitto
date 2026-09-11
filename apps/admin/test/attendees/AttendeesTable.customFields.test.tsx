// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AttendeesTable } from "../../src/attendees/AttendeesTable.js";
import { mockMatchMedia } from "../test-utils.js";
import type { AttendeeRowDto, EventCustomFieldDto } from "../../src/api/types.js";

const baseRow: AttendeeRowDto = {
  id: "att-1",
  name: "Jane Doe",
  email: "jane@example.com",
  company: "Acme",
  department: null,
  ticket_type: "VIP",
  status: "registered",
  check_in_status: "not_admitted",
  admitted_at: null,
  updated_at: "2026-06-01T10:00:00.000Z",
  last_mail_status: "sent",
  rsvp_status: "confirmed",
  has_issued_items: false,
  wallet_status: null,
};

function textField(): EventCustomFieldDto {
  return {
    id: "cf-notes",
    source_field: "notes",
    label: "Dietary notes",
    description: null,
    type: "text",
    required: false,
    options: null,
    created_at: "2026-01-01T00:00:00.000Z",
  };
}

function selectField(): EventCustomFieldDto {
  return {
    id: "cf-shirt",
    source_field: "shirt_size",
    label: "T-Shirt size",
    description: null,
    type: "select",
    required: false,
    options: ["S", "M", "L"],
    created_at: "2026-01-01T00:00:00.000Z",
  };
}

function booleanField(): EventCustomFieldDto {
  return {
    id: "cf-dinner",
    source_field: "dinner",
    label: "Networking dinner",
    description: null,
    type: "boolean",
    required: false,
    options: null,
    created_at: "2026-01-01T00:00:00.000Z",
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test fixture only, not type-checked by the build (tsconfig's "include" excludes test/)
function baseProps(overrides: Record<string, any> = {}) {
  return {
    total: 1,
    page: 1,
    pageSize: 25,
    loading: false,
    hasLoadedOnce: true,
    isUnfilteredEmpty: false,
    items: [baseRow],
    searchInput: "",
    statusFilter: "all" as const,
    ticketTypeFilter: [],
    rsvpStatusFilter: [],
    mailStatusFilter: [],
    availableTypes: [] as string[],
    onSearchChange: vi.fn(),
    onStatusFilterChange: vi.fn(),
    onTicketTypeFilterChange: vi.fn(),
    onRsvpStatusFilterChange: vi.fn(),
    onMailStatusFilterChange: vi.fn(),
    customFields: [] as EventCustomFieldDto[],
    customFieldSelectValues: {},
    onCustomFieldSelectChange: vi.fn(),
    customFieldTextInputs: {},
    onCustomFieldTextInputChange: vi.fn(),
    sortBy: "name" as const,
    sortDir: "asc" as const,
    onSortChange: vi.fn(),
    onViewAttendee: vi.fn(),
    onPageChange: vi.fn(),
    onPageSizeChange: vi.fn(),
    selectedIds: new Set<string>(),
    onToggleRow: vi.fn(),
    onToggleSelectAll: vi.fn(),
    onClearSelection: vi.fn(),
    onBulkSendTickets: vi.fn(),
    bulkSendBusy: false,
    canBulkSend: true,
    eventTimezone: "UTC",
    event: { archived_at: null as string | null },
    walletPlatforms: { apple: true, google: true, samsung: false, any: true },
    ...overrides,
  };
}

function openFilters() {
  // Matched by regex, not the exact string "Filters" - the trigger's accessible name becomes
  // "Filters" immediately followed by the active-count badge's own text (e.g. "Filters1") once
  // any filter (including one of these tests' own pre-set values) is already active.
  fireEvent.click(screen.getByRole("button", { name: /^Filters/ }));
}

beforeEach(() => {
  mockMatchMedia(true);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AttendeesTable custom-field filter rows", () => {
  it("renders no 'Custom fields' section when the event has none", () => {
    render(<AttendeesTable {...baseProps()} />);
    openFilters();
    expect(screen.queryByText("Custom fields")).toBeNull();
  });

  it("renders a text field as an input and reports each keystroke", () => {
    const onCustomFieldTextInputChange = vi.fn();
    render(
      <AttendeesTable
        {...baseProps({ customFields: [textField()], onCustomFieldTextInputChange })}
      />,
    );
    openFilters();

    expect(screen.getByText("Custom fields")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Dietary notes"), { target: { value: "vegan" } });
    expect(onCustomFieldTextInputChange).toHaveBeenCalledWith("notes", "vegan");
  });

  it("shows the text field's current committed value", () => {
    render(
      <AttendeesTable
        {...baseProps({
          customFields: [textField()],
          customFieldTextInputs: { notes: "vegan" },
        })}
      />,
    );
    openFilters();
    expect((screen.getByLabelText("Dietary notes") as HTMLInputElement).value).toBe("vegan");
  });

  it("renders a select field as a multi-select and reports a toggled option", () => {
    const onCustomFieldSelectChange = vi.fn();
    render(
      <AttendeesTable
        {...baseProps({ customFields: [selectField()], onCustomFieldSelectChange })}
      />,
    );
    openFilters();

    fireEvent.click(screen.getByRole("button", { name: /^T-Shirt size,/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "M" }));
    expect(onCustomFieldSelectChange).toHaveBeenCalledWith("shirt_size", ["M"]);
  });

  it("renders a boolean field as an Any/Yes/No toggle and reports Yes as [\"true\"]", () => {
    const onCustomFieldSelectChange = vi.fn();
    render(
      <AttendeesTable
        {...baseProps({ customFields: [booleanField()], onCustomFieldSelectChange })}
      />,
    );
    openFilters();

    fireEvent.click(screen.getByRole("radio", { name: "Yes" }));
    expect(onCustomFieldSelectChange).toHaveBeenCalledWith("dinner", ["true"]);
  });

  it("reports No as [\"false\"] and Any (from an active selection) as []", () => {
    const onCustomFieldSelectChange = vi.fn();
    render(
      <AttendeesTable
        {...baseProps({
          customFields: [booleanField()],
          customFieldSelectValues: { dinner: ["true"] },
          onCustomFieldSelectChange,
        })}
      />,
    );
    openFilters();

    fireEvent.click(screen.getByRole("radio", { name: "No" }));
    expect(onCustomFieldSelectChange).toHaveBeenLastCalledWith("dinner", ["false"]);

    fireEvent.click(screen.getByRole("radio", { name: "Any" }));
    expect(onCustomFieldSelectChange).toHaveBeenLastCalledWith("dinner", []);
  });

  it("shows No as the active toggle when the boolean field's own value is [\"false\"]", () => {
    render(
      <AttendeesTable
        {...baseProps({
          customFields: [booleanField()],
          customFieldSelectValues: { dinner: ["false"] },
        })}
      />,
    );
    openFilters();

    expect(screen.getByRole("radio", { name: "No" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "Any" }).getAttribute("aria-checked")).toBe("false");
  });

  it("renders a select field with no options at all as an empty (not crashing) multi-select", () => {
    // The backend's own create-field validation never allows this in practice (a select field
    // always has at least one option), but the DTO's own type (string[] | null) allows it, and
    // this row must still render rather than throw on a null `.map()`.
    render(<AttendeesTable {...baseProps({ customFields: [{ ...selectField(), options: null }] })} />);
    openFilters();

    fireEvent.click(screen.getByRole("button", { name: /^T-Shirt size,/ }));
    expect(screen.getByText("No options found")).toBeTruthy();
  });

  it("counts an active custom-field filter toward the Filters badge", () => {
    render(
      <AttendeesTable
        {...baseProps({
          customFields: [selectField(), booleanField()],
          customFieldSelectValues: { shirt_size: ["M"] },
        })}
      />,
    );
    expect(screen.getByRole("button", { name: /Filters/ }).textContent).toContain("1");
  });

  it("shows a retry action when custom fields failed to load", () => {
    const onRetryCustomFields = vi.fn();
    render(
      <AttendeesTable
        {...baseProps({
          customFields: [],
          customFieldsError: "Could not load custom fields.",
          onRetryCustomFields,
        })}
      />,
    );
    openFilters();

    expect(screen.getByText("Could not load custom fields.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetryCustomFields).toHaveBeenCalledOnce();
  });
});
