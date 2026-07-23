import { describe, expect, it } from "vitest";
import { attachmentContentDisposition } from "../src/admin/content-disposition.js";

describe("attachmentContentDisposition", () => {
  it("escapes backslashes before quotes inside an attachment filename", () => {
    expect(attachmentContentDisposition(String.raw`export\"2026.csv`)).toBe(
      String.raw`attachment; filename="export\\\"2026.csv"`,
    );
  });
});
