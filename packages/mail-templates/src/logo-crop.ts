/** Last applied free-form crop on a branding logo (percent of the original image). */
export type LogoCropMeta = {
  unit: "%";
  x: number;
  y: number;
  width: number;
  height: number;
  /** Display zoom used in the crop modal when Apply was pressed (1–3). */
  zoom: number;
};

function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/**
 * Parse API/DB JSON into a LogoCropMeta, or null to clear.
 * Throws Error with a short machine-ish message on malformed payloads.
 */
export function parseLogoCrop(value: unknown): LogoCropMeta | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("logo_crop must be an object or null");
  }
  const rec = value as Record<string, unknown>;
  if (rec.unit !== "%") throw new Error("logo_crop.unit must be \"%\"");
  if (
    !isFiniteNumber(rec.x) ||
    !isFiniteNumber(rec.y) ||
    !isFiniteNumber(rec.width) ||
    !isFiniteNumber(rec.height) ||
    !isFiniteNumber(rec.zoom)
  ) {
    throw new Error("logo_crop fields must be finite numbers");
  }
  const x = rec.x;
  const y = rec.y;
  const width = rec.width;
  const height = rec.height;
  const zoom = rec.zoom;
  if (width < 1 || height < 1) throw new Error("logo_crop size must be positive");
  if (x < 0 || y < 0) throw new Error("logo_crop origin must be non-negative");
  if (x + width > 100.5 || y + height > 100.5) {
    throw new Error("logo_crop must stay within the image");
  }
  if (zoom < 1 || zoom > 3) throw new Error("logo_crop.zoom must be between 1 and 3");
  return { unit: "%", x, y, width, height, zoom };
}

/** Serialize a stored Prisma JsonValue (or unknown) for API responses. */
export function logoCropFromDb(value: unknown): LogoCropMeta | null {
  try {
    return parseLogoCrop(value);
  } catch {
    return null;
  }
}
