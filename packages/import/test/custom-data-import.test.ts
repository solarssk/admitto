import { describe, expect, it } from "vitest";
import {
  buildAttributeHeaderKeys,
  extractCustomDataFromRow,
} from "../src/custom-data-import.js";

describe("buildAttributeHeaderKeys", () => {
  it("treats labels that differ only by case as duplicates", () => {
    const { duplicateLabels } = buildAttributeHeaderKeys([
      { label: "Sock Size", source_field: "sock_size" },
      { label: "sock size", source_field: "sock_size_alt" },
    ]);
    expect(duplicateLabels.has("sock size")).toBe(true);
  });
});

describe("extractCustomDataFromRow", () => {
  it("does not map canonical import columns via export-style label headers", () => {
    const result = extractCustomDataFromRow(
      {
        first_name: "Jan",
        last_name: "K",
        email: "jan@example.com",
      },
      [{ label: "Email", source_field: "vendor_ref", type: "text" }],
      new Set<string>(),
    );
    expect(result).toEqual({ ok: true, custom_data: undefined });
  });
});
