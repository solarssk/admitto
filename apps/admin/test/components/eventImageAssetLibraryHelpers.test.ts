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

  it("slugifies a display name into a template token", () => {
    expect(eventImageAssetLibraryTestUtils.tokenFromDisplayName("Sponsor Logo")).toBe("sponsor_logo");
    expect(eventImageAssetLibraryTestUtils.tokenFromDisplayName("!!!")).toBe("");
  });

  it("allocates a suffixed preview token when the base is taken or reserved", () => {
    expect(
      eventImageAssetLibraryTestUtils.allocatePreviewToken("sponsor_logo", new Set(["sponsor_logo"])),
    ).toBe("sponsor_logo_2");
    // Built-in mail placeholder names are skipped the same way as on the server.
    expect(eventImageAssetLibraryTestUtils.allocatePreviewToken("event_name", new Set())).toMatch(
      /^event_name_/,
    );
  });

  it("rejects overlong image names with a length-specific message", () => {
    const long = "a".repeat(eventImageAssetLibraryTestUtils.DISPLAY_NAME_MAX + 1);
    expect(eventImageAssetLibraryTestUtils.imageNameValidationError(long, true)).toMatch(/80 characters/);
    expect(eventImageAssetLibraryTestUtils.imageNameValidationError("!!!", true)).toMatch(/letter/);
    expect(eventImageAssetLibraryTestUtils.imageNameValidationError("ok", false)).toBeUndefined();
  });
});
