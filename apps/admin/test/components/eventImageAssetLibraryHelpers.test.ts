import { describe, expect, it } from "vitest";
import { eventImageAssetLibraryTestUtils } from "../../src/components/EventImageAssetLibrary.js";

describe("EventImageAssetLibrary helpers", () => {
  it("pluralSuffix is empty only for count 1", () => {
    expect(eventImageAssetLibraryTestUtils.pluralSuffix(1)).toBe("");
    expect(eventImageAssetLibraryTestUtils.pluralSuffix(0)).toBe("s");
    expect(eventImageAssetLibraryTestUtils.pluralSuffix(2)).toBe("s");
  });

  it("maps MIME types to extensions", () => {
    expect(eventImageAssetLibraryTestUtils.extensionForMime("image/jpeg")).toBe(".jpg");
    expect(eventImageAssetLibraryTestUtils.extensionForMime("image/webp")).toBe(".webp");
    expect(eventImageAssetLibraryTestUtils.extensionForMime("image/png")).toBe(".png");
  });
});
