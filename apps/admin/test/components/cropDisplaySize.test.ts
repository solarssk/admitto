import { describe, expect, it } from "vitest";
import {
  clampCropZoom,
  cropViewportLimits,
  displaySizeAtZoom,
  fitNaturalSize,
  isRestorablePercentCrop,
  CROP_ZOOM_MAX,
  CROP_ZOOM_MIN,
} from "../../src/components/crop/CropImageModal.js";

describe("fitNaturalSize", () => {
  it("keeps small logos at 1:1 (no empty upscale frame)", () => {
    expect(fitNaturalSize(400, 80, 880, 560)).toEqual({ width: 400, height: 80 });
  });

  it("scales down large photos to fit the viewport", () => {
    expect(fitNaturalSize(4000, 3000, 880, 560)).toEqual({ width: 746, height: 560 });
  });
});

describe("displaySizeAtZoom", () => {
  it("multiplies fit size by zoom so wheel/slider enlarge the bitmap", () => {
    expect(displaySizeAtZoom({ width: 400, height: 80 }, 1)).toEqual({ width: 400, height: 80 });
    expect(displaySizeAtZoom({ width: 400, height: 80 }, 2)).toEqual({ width: 800, height: 160 });
  });
});

describe("clampCropZoom", () => {
  it("always allows 1×–3× (large photos can still zoom for precision)", () => {
    expect(clampCropZoom(0.5)).toBe(CROP_ZOOM_MIN);
    expect(clampCropZoom(1)).toBe(1);
    expect(clampCropZoom(2.04)).toBe(2.05);
    expect(clampCropZoom(9)).toBe(CROP_ZOOM_MAX);
  });
});

describe("isRestorablePercentCrop", () => {
  it("accepts a normal percent selection from a previous Apply", () => {
    expect(isRestorablePercentCrop({ unit: "%", x: 10, y: 5, width: 80, height: 70 })).toBe(true);
  });

  it("rejects pixel crops and empty selections", () => {
    expect(isRestorablePercentCrop({ unit: "px", x: 0, y: 0, width: 10, height: 10 })).toBe(false);
    expect(isRestorablePercentCrop({ unit: "%", x: 0, y: 0, width: 0, height: 50 })).toBe(false);
  });
});

describe("cropViewportLimits", () => {
  it("leaves room for panel chrome and crop handles", () => {
    const limits = cropViewportLimits({ innerWidth: 1280, innerHeight: 800 });
    expect(limits.width).toBeLessThanOrEqual(920 - 40 - 24);
    expect(limits.height).toBeLessThanOrEqual(560);
    expect(limits.width).toBeGreaterThan(100);
    expect(limits.height).toBeGreaterThan(80);
  });
});
