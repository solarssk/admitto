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
    expect(eventImageAssetLibraryTestUtils.tokenFromDisplayName("__logo__")).toBe("logo");
    expect(eventImageAssetLibraryTestUtils.tokenFromDisplayName("123abc")).toBe("abc");
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

  it("returns null when no valid preview token can be allocated", () => {
    const taken = new Set(["sponsor_logo"]);
    for (let n = 2; n < 100; n += 1) {
      taken.add(`sponsor_logo_${n}`);
    }
    expect(
      eventImageAssetLibraryTestUtils.allocatePreviewToken("sponsor_logo", taken),
    ).toBeNull();
  });

  it("rejects overlong image names with a length-specific message", () => {
    const long = "a".repeat(eventImageAssetLibraryTestUtils.DISPLAY_NAME_MAX + 1);
    expect(eventImageAssetLibraryTestUtils.imageNameValidationError(long, true)).toMatch(/80 characters/);
    expect(eventImageAssetLibraryTestUtils.imageNameValidationError("!!!", true)).toMatch(/letter/);
    expect(eventImageAssetLibraryTestUtils.imageNameValidationError("ok", false)).toBeUndefined();
  });

  it("sniffs MIME from declared type or filename extension", () => {
    expect(
      eventImageAssetLibraryTestUtils.sniffImageMime(new File([], "x.png", { type: "image/png" })),
    ).toBe("image/png");
    expect(
      eventImageAssetLibraryTestUtils.sniffImageMime(new File([], "logo.SVG", { type: "" })),
    ).toBe("image/svg+xml");
    expect(
      eventImageAssetLibraryTestUtils.sniffImageMime(new File([], "logo.webp", { type: "" })),
    ).toBe("image/webp");
    expect(
      eventImageAssetLibraryTestUtils.sniffImageMime(new File([], "logo.jpeg", { type: "" })),
    ).toBe("image/jpeg");
    expect(
      eventImageAssetLibraryTestUtils.sniffImageMime(
        new File([], "logo.svg", { type: "image/png" }),
      ),
    ).toBe("image/svg+xml");
  });

  it("strips extension for basename and clamps display names", () => {
    expect(eventImageAssetLibraryTestUtils.basenameWithoutExt("sponsor.logo.png")).toBe("sponsor.logo");
    expect(eventImageAssetLibraryTestUtils.basenameWithoutExt(".hidden")).toBe(".hidden");
    const max = eventImageAssetLibraryTestUtils.DISPLAY_NAME_MAX;
    expect(eventImageAssetLibraryTestUtils.clampDisplayName("a".repeat(max + 5))).toHaveLength(max);
  });

  it("varies delete notice copy when the token is blocked by a template", () => {
    const asset = {
      id: "a1",
      token: "sponsor_logo",
      filename: "sponsor.png",
      url: "/uploads/x.png",
      size_bytes: 1,
      mime_type: "image/png",
      created_at: "2026-01-01T00:00:00.000Z",
    };
    expect(eventImageAssetLibraryTestUtils.deleteNoticeForAsset(asset, false)).toMatch(/If \{\{sponsor_logo\}\}/);
    expect(eventImageAssetLibraryTestUtils.deleteNoticeForAsset(asset, true)).toMatch(
      /still used in this event's email template/,
    );
  });
});
