import { describe, expect, it } from "vitest";
import { logoUploadZoneTestUtils } from "../../src/components/LogoUploadZone.js";

const {
  extensionForMime,
  mimeFromUploadPath,
  cropMetaToPercent,
  toLogoCropMeta,
  buildLogoZoneClassName,
} = logoUploadZoneTestUtils;

describe("LogoUploadZone helpers", () => {
  it("maps MIME types to extensions", () => {
    expect(extensionForMime("image/jpeg")).toBe(".jpg");
    expect(extensionForMime("image/webp")).toBe(".webp");
    expect(extensionForMime("image/png")).toBe(".png");
    expect(extensionForMime("image/gif")).toBe(".png");
  });

  it("infers MIME from upload path extensions", () => {
    expect(mimeFromUploadPath("/uploads/default/a.jpg")).toBe("image/jpeg");
    expect(mimeFromUploadPath("/uploads/default/a.JPEG")).toBe("image/jpeg");
    expect(mimeFromUploadPath("/uploads/default/a.webp")).toBe("image/webp");
    expect(mimeFromUploadPath("/uploads/default/a.png")).toBe("image/png");
  });

  it("converts crop meta only when unit is percent", () => {
    expect(cropMetaToPercent(null)).toBeUndefined();
    expect(
      cropMetaToPercent({ unit: "px", x: 0, y: 0, width: 10, height: 10, zoom: 1 } as never),
    ).toBeUndefined();
    expect(
      cropMetaToPercent({ unit: "%", x: 1, y: 2, width: 3, height: 4, zoom: 1.5 }),
    ).toEqual({ unit: "%", x: 1, y: 2, width: 3, height: 4 });
  });

  it("builds LogoCropMeta from apply meta", () => {
    expect(
      toLogoCropMeta({
        crop: { unit: "%", x: 1, y: 2, width: 3, height: 4 },
        zoom: 2,
      }),
    ).toEqual({ unit: "%", x: 1, y: 2, width: 3, height: 4, zoom: 2 });
  });

  it("composes zone class names from flags", () => {
    expect(
      buildLogoZoneClassName({
        uploading: true,
        dragging: true,
        hasPreview: true,
        hasError: true,
        disabled: true,
      }),
    ).toBe(
      "logo-upload__zone logo-upload__zone--busy logo-upload__zone--dragging logo-upload__zone--has-preview logo-upload__zone--invalid logo-upload__zone--disabled",
    );
    expect(
      buildLogoZoneClassName({
        uploading: false,
        dragging: false,
        hasPreview: false,
        hasError: false,
        disabled: false,
      }),
    ).toBe("logo-upload__zone");
  });
});
