import { describe, expect, it } from "vitest";
import { formatFileSize } from "../../src/utils/formatFileSize.js";

describe("formatFileSize", () => {
  it("formats bytes under 1 KB", () => {
    expect(formatFileSize(60)).toBe("60 B");
  });

  it("formats sizes under 1 MB in KB", () => {
    expect(formatFileSize(15 * 1024)).toBe("15.0 KB");
  });

  it("formats sizes of 1 MB and above in MB", () => {
    expect(formatFileSize(1048576)).toBe("1.0 MB");
    expect(formatFileSize(5242880)).toBe("5.0 MB");
  });
});
