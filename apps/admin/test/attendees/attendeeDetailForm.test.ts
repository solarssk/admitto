import { describe, expect, it, vi } from "vitest";

const mockFetchAttendeeDetail = vi.fn();
const mockFetchAttendeeCustomFields = vi.fn();

vi.mock("../../src/api/client.js", () => ({
  fetchAttendeeDetail: (...args: unknown[]) => mockFetchAttendeeDetail(...args),
}));
vi.mock("../../src/attendees/customData.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/attendees/customData.js")>();
  return {
    ...actual,
    fetchAttendeeCustomFields: (...args: unknown[]) => mockFetchAttendeeCustomFields(...args),
  };
});

const {
  ITEMS_LOAD_WARNING,
  formatDateTime,
  loadAttendeeDetailData,
  mergeFormAfterReload,
  toAttendeeForm,
} = await import("../../src/attendees/attendeeDetailForm.js");

import type { AttendeeDetailDto } from "../../src/api/types.js";
import type { CustomDataFieldDef } from "../../src/attendees/customData.js";

function detail(partial: Partial<AttendeeDetailDto> = {}): AttendeeDetailDto {
  return {
    id: "att-1",
    name: "Anna Alpha",
    email: "anna@example.com",
    company: null,
    department: null,
    ticket_type: null,
    status: "registered",
    check_in_status: "not_admitted",
    admitted_at: null,
    updated_at: "2026-01-01T00:00:00.000Z",
    rsvp_status: "none",
    rsvp_updated_at: null,
    rsvp_source: null,
    ticket_ref: null,
    custom_data: null,
    deliveries: [],
    action_log: [],
    ...partial,
  };
}

const sizeField: CustomDataFieldDef = {
  id: "f1",
  source_field: "size",
  label: "Size",
  type: "text",
  required: false,
  options: null,
  created_at: "2026-01-01T00:00:00.000Z",
};

describe("loadAttendeeDetailData", () => {
  it("returns the detail and attribute fields when both requests succeed", async () => {
    mockFetchAttendeeDetail.mockResolvedValueOnce(detail());
    mockFetchAttendeeCustomFields.mockResolvedValueOnce([sizeField]);

    const result = await loadAttendeeDetailData("evt-1", "att-1");

    expect(result.detail.id).toBe("att-1");
    expect(result.attributeFields).toEqual([sizeField]);
    expect(result.itemsWarning).toBeNull();
  });

  it("falls back to an empty field list and a warning when the custom fields fetch fails", async () => {
    mockFetchAttendeeDetail.mockResolvedValueOnce(detail());
    mockFetchAttendeeCustomFields.mockRejectedValueOnce(new Error("network"));

    const result = await loadAttendeeDetailData("evt-1", "att-1");

    expect(result.attributeFields).toEqual([]);
    expect(result.itemsWarning).toBe(ITEMS_LOAD_WARNING);
  });

  it("passes an explicitly selected notes page to the detail request", async () => {
    mockFetchAttendeeDetail.mockResolvedValueOnce(detail());
    mockFetchAttendeeCustomFields.mockResolvedValueOnce([]);

    await loadAttendeeDetailData("evt-1", "att-1", 3);

    expect(mockFetchAttendeeDetail).toHaveBeenCalledWith("evt-1", "att-1", undefined, 3);
  });
});

describe("mergeFormAfterReload", () => {
  it("keeps an in-progress custom field edit that diverged since the last load", () => {
    const previousDetail = detail({ custom_data: { size: "M" } });
    const reloaded = detail({ custom_data: { size: "L" } });
    const currentForm = toAttendeeForm(previousDetail, [sizeField]);
    currentForm.customFields.size = "XL"; // operator is mid-edit, hasn't saved yet

    const merged = mergeFormAfterReload(currentForm, previousDetail, reloaded, [sizeField]);

    expect(merged.customFields.size).toBe("XL");
  });

  it("takes the reloaded value for a custom field the operator hasn't touched", () => {
    const previousDetail = detail({ custom_data: { size: "M" } });
    const reloaded = detail({ custom_data: { size: "L" } });
    const currentForm = toAttendeeForm(previousDetail, [sizeField]);

    const merged = mergeFormAfterReload(currentForm, previousDetail, reloaded, [sizeField]);

    expect(merged.customFields.size).toBe("L");
  });

  it("keeps an in-progress attendance (rsvp_status) edit that diverged since the last load (Codecov review)", () => {
    const previousDetail = detail({ rsvp_status: "none" });
    const reloaded = detail({ rsvp_status: "declined" });
    const currentForm = toAttendeeForm(previousDetail, []);
    currentForm.rsvp_status = "confirmed"; // operator picked this mid-edit, hasn't saved yet

    const merged = mergeFormAfterReload(currentForm, previousDetail, reloaded, []);

    expect(merged.rsvp_status).toBe("confirmed");
  });

  it("takes the reloaded attendance (rsvp_status) value when the operator hasn't touched it", () => {
    const previousDetail = detail({ rsvp_status: "none" });
    const reloaded = detail({ rsvp_status: "declined" });
    const currentForm = toAttendeeForm(previousDetail, []);

    const merged = mergeFormAfterReload(currentForm, previousDetail, reloaded, []);

    expect(merged.rsvp_status).toBe("declined");
  });
});

describe("formatDateTime", () => {
  it("returns a dash placeholder for a null timestamp", () => {
    expect(formatDateTime(null)).toBe("-");
  });
});
