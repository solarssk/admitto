/** Shared client-side guards for logo and event image asset uploads. */
export const MAX_BRANDING_IMAGE_UPLOAD_BYTES = 2 * 1024 * 1024;

export const ALLOWED_BRANDING_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export function extensionForBrandingImageMime(mime: string): string {
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/webp") return ".webp";
  return ".png";
}
