import { describe, expect, it, vi } from "vitest";

vi.mock("../src/event-custom-fields.js", () => ({ loadEventCustomDataFields: vi.fn() }));

import { loadEventCustomDataFields } from "../src/event-custom-fields.js";
import { resolveWalletCustomFieldPlaceholders, WALLET_CUSTOM_FIELD_PLACEHOLDER_PREFIX } from "../src/wallet-custom-fields.js";

const db = {} as never;

const SHIRT_MAPPING = { shirt: "custom:t_shirt_size" };
const VIP_MAPPING = { vip: "custom:vip_access" };
const SHIRT_AND_VIP_MAPPING = { shirt: "custom:t_shirt_size", vip: "custom:vip_access" };

describe("resolveWalletCustomFieldPlaceholders", () => {
  it("namespaces a select field's answer under custom:<source_field>, using the raw value as-is", async () => {
    vi.mocked(loadEventCustomDataFields).mockResolvedValueOnce([
      { label: "T-Shirt size", source_field: "t_shirt_size", type: "select", options: ["S", "M", "L"] },
    ]);

    const result = await resolveWalletCustomFieldPlaceholders(db, "evt-1", { t_shirt_size: "L" }, SHIRT_MAPPING);

    expect(result).toEqual({ [`${WALLET_CUSTOM_FIELD_PLACEHOLDER_PREFIX}t_shirt_size`]: "L" });
  });

  it("renders a boolean field's stored 'true'/'false' as Yes/No", async () => {
    const boolField = [{ label: "VIP access", source_field: "vip_access", type: "boolean" as const }];
    vi.mocked(loadEventCustomDataFields).mockResolvedValueOnce(boolField);
    const yes = await resolveWalletCustomFieldPlaceholders(db, "evt-1", { vip_access: "true" }, VIP_MAPPING);
    vi.mocked(loadEventCustomDataFields).mockResolvedValueOnce(boolField);
    const no = await resolveWalletCustomFieldPlaceholders(db, "evt-1", { vip_access: "false" }, VIP_MAPPING);

    expect(yes).toEqual({ "custom:vip_access": "Yes" });
    expect(no).toEqual({ "custom:vip_access": "No" });
  });

  it("omits a boolean field's stale, non-true/false stored value instead of treating it as No (bot review)", async () => {
    vi.mocked(loadEventCustomDataFields).mockResolvedValueOnce([
      { label: "VIP access", source_field: "vip_access", type: "boolean" },
    ]);

    // "Maybe" can't come from a live boolean field's own input (only true/false are accepted at
    // write time) - it's what's left over from before this field was retyped from select/text to
    // boolean, and no longer means anything.
    const result = await resolveWalletCustomFieldPlaceholders(db, "evt-1", { vip_access: "Maybe" }, VIP_MAPPING);

    expect(result).toEqual({});
  });

  it("excludes text-type fields entirely, even when the attendee has an answer", async () => {
    vi.mocked(loadEventCustomDataFields).mockResolvedValueOnce([
      { label: "Dietary requirements", source_field: "dietary", type: "text" },
    ]);

    const result = await resolveWalletCustomFieldPlaceholders(
      db,
      "evt-1",
      { dietary: "Vegan" },
      { diet: "custom:dietary" },
    );

    expect(result).toEqual({});
  });

  it("skips a mappable field the attendee left unanswered", async () => {
    vi.mocked(loadEventCustomDataFields).mockResolvedValueOnce([
      { label: "T-Shirt size", source_field: "t_shirt_size", type: "select", options: ["S", "M", "L"] },
    ]);

    const result = await resolveWalletCustomFieldPlaceholders(db, "evt-1", {}, SHIRT_MAPPING);

    expect(result).toEqual({});
  });

  it("returns an empty object when the mapped custom field no longer exists in the event's registry", async () => {
    vi.mocked(loadEventCustomDataFields).mockResolvedValueOnce([]);

    const result = await resolveWalletCustomFieldPlaceholders(db, "evt-1", { t_shirt_size: "L" }, SHIRT_MAPPING);

    expect(result).toEqual({});
  });

  it("builds one entry per mappable field when the attendee answered several", async () => {
    vi.mocked(loadEventCustomDataFields).mockResolvedValueOnce([
      { label: "T-Shirt size", source_field: "t_shirt_size", type: "select", options: ["S", "M", "L"] },
      { label: "VIP access", source_field: "vip_access", type: "boolean" },
      { label: "Dietary requirements", source_field: "dietary", type: "text" },
    ]);

    const result = await resolveWalletCustomFieldPlaceholders(
      db,
      "evt-1",
      { t_shirt_size: "M", vip_access: "true", dietary: "Vegan" },
      SHIRT_AND_VIP_MAPPING,
    );

    expect(result).toEqual({ "custom:t_shirt_size": "M", "custom:vip_access": "Yes" });
  });

  describe("skips the EventCustomField query entirely when the mapping has no custom: entry (bot review - bulk push N+1)", () => {
    it("when fieldMapping is null", async () => {
      const result = await resolveWalletCustomFieldPlaceholders(db, "evt-1", { t_shirt_size: "L" }, null);

      expect(result).toEqual({});
      expect(loadEventCustomDataFields).not.toHaveBeenCalled();
    });

    it("when fieldMapping only maps fixed WALLET_MAPPING_PLACEHOLDERS entries", async () => {
      const result = await resolveWalletCustomFieldPlaceholders(
        db,
        "evt-1",
        { t_shirt_size: "L" },
        { name: "full_name", type: "event_type" },
      );

      expect(result).toEqual({});
      expect(loadEventCustomDataFields).not.toHaveBeenCalled();
    });
  });
});
