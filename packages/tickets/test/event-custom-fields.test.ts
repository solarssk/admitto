import { describe, expect, it } from "vitest";
import { UnknownContentFieldError, validateContentFieldReferences } from "../src/event-custom-fields.js";

describe("validateContentFieldReferences", () => {
  it("passes when every content_fields entry is in the allowed set", () => {
    expect(() =>
      validateContentFieldReferences(new Set(["shirt_size", "dietary"]), ["shirt_size"]),
    ).not.toThrow();
  });

  it("passes for an empty content_fields list regardless of the allowed set", () => {
    expect(() => validateContentFieldReferences(new Set(), [])).not.toThrow();
  });

  it("throws UnknownContentFieldError for a reference not in the allowed set", () => {
    expect(() => validateContentFieldReferences(new Set(["shirt_size"]), ["dietary"])).toThrow(
      UnknownContentFieldError,
    );
  });

  it("error carries the offending source_field", () => {
    try {
      validateContentFieldReferences(new Set(), ["deleted_field"]);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(UnknownContentFieldError);
      expect((err as UnknownContentFieldError).sourceField).toBe("deleted_field");
      expect((err as Error).message).toBe("unknown_content_field:deleted_field");
    }
  });

  it("checks every entry, not just the first", () => {
    expect(() =>
      validateContentFieldReferences(new Set(["a", "b"]), ["a", "b", "c"]),
    ).toThrow(UnknownContentFieldError);
  });
});
