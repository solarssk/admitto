import { describe, expect, it } from "vitest";
import type { EventCustomFieldDto } from "../../src/api/types.js";
import {
  computeWalletCustomFieldPreview,
  computeWalletPlaceholderPreview,
  WALLET_VALUE_NOT_LOADED,
  WALLET_VALUE_NOT_SET,
} from "../../src/settings/EventWalletPanel.js";

function makeField(overrides: Partial<EventCustomFieldDto> = {}): EventCustomFieldDto {
  return {
    id: "cf-1",
    source_field: "t_shirt_size",
    label: "T-Shirt size",
    description: null,
    type: "select",
    required: false,
    options: ["S", "M", "L"],
    created_at: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("computeWalletCustomFieldPreview", () => {
  it("returns undefined for a non-custom placeholder id, so the caller falls through", () => {
    expect(computeWalletCustomFieldPreview("full_name", [makeField()])).toBeUndefined();
  });

  it("says 'Not loaded yet.', not 'not set', while the event's custom fields haven't resolved yet", () => {
    expect(computeWalletCustomFieldPreview("custom:t_shirt_size", undefined)).toBe("Not loaded yet.");
  });

  it("shows an example of the select field's first option", () => {
    expect(computeWalletCustomFieldPreview("custom:t_shirt_size", [makeField()])).toBe("e.g. S");
  });

  it("shows 'e.g. Yes' for a boolean field regardless of its (unused) options", () => {
    const field = makeField({ source_field: "vip_access", type: "boolean", options: null });
    expect(computeWalletCustomFieldPreview("custom:vip_access", [field])).toBe("e.g. Yes");
  });

  it("falls back to an ellipsis placeholder when a select field has no options configured", () => {
    const field = makeField({ options: [] });
    expect(computeWalletCustomFieldPreview("custom:t_shirt_size", [field])).toBe("e.g. …");
  });

  it("shows WALLET_VALUE_NOT_SET for a stale mapping (field deleted after being mapped)", () => {
    expect(computeWalletCustomFieldPreview("custom:removed_field", [makeField()])).toBe(WALLET_VALUE_NOT_SET);
  });

  it("shows WALLET_VALUE_NOT_SET for a stale mapping (field retyped to text after being mapped)", () => {
    const field = makeField({ type: "text", options: null });
    expect(computeWalletCustomFieldPreview("custom:t_shirt_size", [field])).toBe(WALLET_VALUE_NOT_SET);
  });
});

describe("computeWalletPlaceholderPreview while the location has not arrived", () => {
  const form = { title: "Summit", date: "2026-06-01", eventHoursStart: "", eventHoursEnd: "", timezone: "Europe/Warsaw", eventType: "" as const };

  it("says 'Not loaded yet.' for a location field, never 'not set', until the location has been read", () => {
    expect(computeWalletPlaceholderPreview("venue_name", form, undefined, [])).toBe(WALLET_VALUE_NOT_LOADED);
    expect(WALLET_VALUE_NOT_LOADED).toBe("Not loaded yet.");
  });

  it("says a location field is not set once the location has been read and holds nothing", () => {
    expect(computeWalletPlaceholderPreview("venue_name", form, null, [])).toBe(WALLET_VALUE_NOT_SET);
  });

  it("does not depend on the location for an event field", () => {
    expect(computeWalletPlaceholderPreview("event_name", form, undefined, [])).toBe("Summit");
  });
});
