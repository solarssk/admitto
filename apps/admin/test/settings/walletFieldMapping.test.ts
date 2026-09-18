import { describe, expect, it } from "vitest";
import type { EventCustomFieldDto } from "../../src/api/types.js";
import {
  buildWalletCustomFieldOptions,
  computeWalletFieldMappingErrors,
  WALLET_CUSTOM_FIELD_PLACEHOLDER_PREFIX,
  type WalletFieldMappingRow,
} from "../../src/settings/walletFieldMapping.js";

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

describe("buildWalletCustomFieldOptions", () => {
  it("returns an empty list while the custom fields are still loading (undefined)", () => {
    expect(buildWalletCustomFieldOptions(undefined)).toEqual([]);
  });

  it("namespaces a select field's id under custom:<source_field>", () => {
    const options = buildWalletCustomFieldOptions([makeField()]);
    expect(options).toEqual([
      { id: `${WALLET_CUSTOM_FIELD_PLACEHOLDER_PREFIX}t_shirt_size`, icon: "forms", label: "T-Shirt size" },
    ]);
  });

  it("includes boolean fields alongside select fields", () => {
    const options = buildWalletCustomFieldOptions([
      makeField({ source_field: "vip_access", label: "VIP access", type: "boolean", options: null }),
    ]);
    expect(options).toEqual([{ id: "custom:vip_access", icon: "forms", label: "VIP access" }]);
  });

  it("excludes text-type custom fields entirely", () => {
    const options = buildWalletCustomFieldOptions([
      makeField({ source_field: "dietary", label: "Dietary requirements", type: "text", options: null }),
    ]);
    expect(options).toEqual([]);
  });

  it("returns one option per mappable field, preserving the source order", () => {
    const options = buildWalletCustomFieldOptions([
      makeField({ source_field: "dietary", label: "Dietary requirements", type: "text", options: null }),
      makeField({ source_field: "t_shirt_size", label: "T-Shirt size", type: "select" }),
      makeField({ source_field: "vip_access", label: "VIP access", type: "boolean", options: null }),
    ]);
    expect(options.map((o) => o.id)).toEqual(["custom:t_shirt_size", "custom:vip_access"]);
  });

  it("appends the source_field slug when two mappable fields share the same label (bot review)", () => {
    const options = buildWalletCustomFieldOptions([
      makeField({ source_field: "shirt_size", label: "Size", type: "select", options: ["S", "M", "L"] }),
      makeField({ source_field: "shoe_size", label: "Size", type: "select", options: ["8", "9", "10"] }),
    ]);
    expect(options).toEqual([
      { id: "custom:shirt_size", icon: "forms", label: "Size (shirt_size)" },
      { id: "custom:shoe_size", icon: "forms", label: "Size (shoe_size)" },
    ]);
  });

  it("leaves a unique label alone even when another field shares its label but isn't mappable (text-type)", () => {
    const options = buildWalletCustomFieldOptions([
      makeField({ source_field: "shirt_size", label: "Size", type: "select", options: ["S", "M", "L"] }),
      makeField({ source_field: "notes_size", label: "Size", type: "text", options: null }),
    ]);
    // Only one mappable field is actually named "Size" once the text-type sibling is filtered out
    // - no collision among the options actually offered, so no disambiguation is needed.
    expect(options).toEqual([{ id: "custom:shirt_size", icon: "forms", label: "Size" }]);
  });
});

describe("computeWalletFieldMappingErrors — custom field label lookup", () => {
  it("falls back to the raw placeholder id when no extraOptions are given (unchanged default behavior)", () => {
    const rows: WalletFieldMappingRow[] = [{ id: "r1", key: "", value: "custom:t_shirt_size" }];
    expect(computeWalletFieldMappingErrors(rows)).toEqual([
      `"custom:t_shirt_size" has no PassCreator field key - this row won't be saved.`,
    ]);
  });

  it("resolves a custom field's human label via extraOptions instead of the raw namespaced id", () => {
    const rows: WalletFieldMappingRow[] = [{ id: "r1", key: "", value: "custom:t_shirt_size" }];
    const extraOptions = buildWalletCustomFieldOptions([makeField()]);
    expect(computeWalletFieldMappingErrors(rows, extraOptions)).toEqual([
      `"T-Shirt size" has no PassCreator field key - this row won't be saved.`,
    ]);
  });

  it("still prefers the fixed WALLET_PLACEHOLDER_OPTIONS label over extraOptions for a non-custom id", () => {
    const rows: WalletFieldMappingRow[] = [{ id: "r1", key: "", value: "full_name" }];
    expect(computeWalletFieldMappingErrors(rows, [{ id: "full_name", label: "Should not win" }])).toEqual([
      `"Attendee full name" has no PassCreator field key - this row won't be saved.`,
    ]);
  });
});
