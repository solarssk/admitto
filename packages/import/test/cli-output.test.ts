import { describe, expect, it } from "vitest";
import { formatSkippedImportRow } from "../src/cli-output.js";

describe("formatSkippedImportRow", () => {
  it("redacts attendee email addresses in CLI output", () => {
    const output = formatSkippedImportRow({
      email: "attendee@example.com",
      reason: "duplicate",
    });

    expect(output).toBe("  a***@example.com — duplicate");
    expect(output).not.toContain("attendee@example.com");
  });
});
