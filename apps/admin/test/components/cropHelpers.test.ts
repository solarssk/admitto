import { describe, expect, it, vi } from "vitest";
import {
  clampCropZoom,
  cropViewportLimits,
  displaySizeAtZoom,
  fitNaturalSize,
  isRestorablePercentCrop,
  percentCropForApplyForTest,
  runCropApplyForTest,
  trustedCropPreviewSrc,
} from "../../src/components/crop/CropImageModal.js";

describe("CropImageModal helpers", () => {
  it("fitNaturalSize scales down and never upscales past 1:1", () => {
    expect(fitNaturalSize(800, 400, 400, 400)).toEqual({ width: 400, height: 200 });
    expect(fitNaturalSize(100, 50, 400, 400)).toEqual({ width: 100, height: 50 });
  });

  it("displaySizeAtZoom treats non-finite or non-positive zoom as 1", () => {
    expect(displaySizeAtZoom({ width: 100, height: 40 }, 2)).toEqual({ width: 200, height: 80 });
    expect(displaySizeAtZoom({ width: 100, height: 40 }, Number.NaN)).toEqual({
      width: 100,
      height: 40,
    });
    expect(displaySizeAtZoom({ width: 100, height: 40 }, 0)).toEqual({ width: 100, height: 40 });
  });

  it("clampCropZoom clamps, steps, and rejects non-finite values", () => {
    expect(clampCropZoom(Number.NaN)).toBe(1);
    expect(clampCropZoom(0.5)).toBe(1);
    expect(clampCropZoom(4)).toBe(3);
    expect(clampCropZoom(1.53)).toBe(1.55);
  });

  it("cropViewportLimits uses window size with a floor", () => {
    const limits = cropViewportLimits({ innerWidth: 320, innerHeight: 400 });
    expect(limits.width).toBeGreaterThanOrEqual(120);
    expect(limits.height).toBeGreaterThanOrEqual(80);
  });

  it("cropViewportLimits leaves room for panel chrome and crop handles", () => {
    const limits = cropViewportLimits({ innerWidth: 1280, innerHeight: 800 });
    expect(limits.width).toBeLessThanOrEqual(920 - 40 - 24);
    expect(limits.height).toBeLessThanOrEqual(560);
    expect(limits.width).toBeGreaterThan(100);
    expect(limits.height).toBeGreaterThan(80);
  });

  it("fitNaturalSize scales a large photo into the viewport without upscaling small logos", () => {
    expect(fitNaturalSize(4000, 3000, 880, 560)).toEqual({ width: 746, height: 560 });
    expect(fitNaturalSize(400, 80, 880, 560)).toEqual({ width: 400, height: 80 });
  });

  it("isRestorablePercentCrop accepts in-bounds % crops and rejects junk", () => {
    expect(
      isRestorablePercentCrop({ unit: "%", x: 0, y: 0, width: 50, height: 50 }),
    ).toBe(true);
    expect(isRestorablePercentCrop({ unit: "px", x: 0, y: 0, width: 10, height: 10 })).toBe(false);
    expect(isRestorablePercentCrop({ unit: "%", x: 0, y: 0, width: 0, height: 10 })).toBe(false);
    expect(isRestorablePercentCrop({ unit: "%", x: -1, y: 0, width: 10, height: 10 })).toBe(false);
    expect(isRestorablePercentCrop({ unit: "%", x: 90, y: 0, width: 20, height: 10 })).toBe(false);
    expect(
      isRestorablePercentCrop({ unit: "%", x: Number.NaN, y: 0, width: 10, height: 10 }),
    ).toBe(false);
  });

  it("trustedCropPreviewSrc allows data:image and /uploads, rejects blob and https", () => {
    expect(trustedCropPreviewSrc("data:image/png;base64,aa")).toBe("data:image/png;base64,aa");
    expect(
      trustedCropPreviewSrc("/uploads/default/a1b2c3d4-e5f6-7890-abcd-ef1234567890.png"),
    ).toBe("/uploads/default/a1b2c3d4-e5f6-7890-abcd-ef1234567890.png");
    expect(trustedCropPreviewSrc("blob:https://example.com/x")).toBeNull();
    expect(trustedCropPreviewSrc("https://cdn.example.com/logo.png")).toBeNull();
    expect(trustedCropPreviewSrc("javascript:alert(1)")).toBeNull();
  });

  it("percentCropForApply converts pixel crops to percent", () => {
    const img = { width: 200, height: 100 } as HTMLImageElement;
    const pixel = { unit: "px" as const, x: 20, y: 10, width: 100, height: 50 };
    const pct = percentCropForApplyForTest(pixel, pixel, img);
    expect(pct.unit).toBe("%");
    expect(pct.width).toBeCloseTo(50);
    expect(pct.height).toBeCloseTo(50);
  });

  it("runCropApply rejects a zero-size selection without exporting", async () => {
    const onApply = vi.fn();
    const msg = await runCropApplyForTest(
      { width: 100, height: 50 } as HTMLImageElement,
      { x: 0, y: 0, width: 0, height: 10, unit: "px" },
      undefined,
      1,
      "image/png",
      onApply,
    );
    expect(msg).toMatch(/Drag the edges/i);
    expect(onApply).not.toHaveBeenCalled();
  });
});
