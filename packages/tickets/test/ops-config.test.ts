import { describe, expect, it } from "vitest";
import { parseEventOpsConfig } from "../src/ops-config.js";

describe("parseEventOpsConfig", () => {
  it("defaults new flags to true when omitted", () => {
    expect(parseEventOpsConfig({ badge_at_entry: true, require_confirm_on_scan: false })).toEqual({
      badge_at_entry: true,
      require_confirm_on_scan: false,
      allow_manual_lookup: true,
      auto_advance_on_valid: true,
    });
  });

  it("respects explicit false for new flags", () => {
    expect(
      parseEventOpsConfig({
        allow_manual_lookup: false,
        auto_advance_on_valid: false,
      }),
    ).toEqual({
      require_confirm_on_scan: false,
      badge_at_entry: true,
      allow_manual_lookup: false,
      auto_advance_on_valid: false,
    });
  });

  it("returns full defaults for invalid input", () => {
    expect(parseEventOpsConfig(null)).toEqual({
      require_confirm_on_scan: false,
      badge_at_entry: true,
      allow_manual_lookup: true,
      auto_advance_on_valid: true,
    });
  });
});
