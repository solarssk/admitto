import type { PercentCrop } from "react-image-crop";
import type { LogoCropMeta } from "../../api/types.js";
import type { CropApplyMeta } from "./CropImageModal.js";

/** Restore a stored crop as a modal's `initialCrop` - percentages only make sense against the
 * same original they were captured from. Shared by LogoUploadZone and EventImageAssetLibrary. */
export function cropMetaToPercent(meta: LogoCropMeta | null | undefined): PercentCrop | undefined {
  if (meta?.unit !== "%") return undefined;
  return { unit: "%", x: meta.x, y: meta.y, width: meta.width, height: meta.height };
}

/** Converts CropImageModal's own apply-time metadata into the persisted LogoCropMeta shape. */
export function toLogoCropMeta(meta: CropApplyMeta): LogoCropMeta {
  return {
    unit: "%",
    x: meta.crop.x,
    y: meta.crop.y,
    width: meta.crop.width,
    height: meta.crop.height,
    zoom: meta.zoom,
  };
}
