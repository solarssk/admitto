const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

export type CropOutputMime = "image/png" | "image/jpeg" | "image/webp";

/** Pixel crop relative to the *displayed* image box (as produced by react-image-crop). */
export type DisplayPixelCrop = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

/** Map a source MIME (or empty) to a crop export MIME that preserves alpha when present. */
export function resolveCropOutputMime(sourceMime: string): CropOutputMime {
  const mime = sourceMime.split(";")[0]?.trim().toLowerCase() ?? "";
  if (mime === "image/jpeg" || mime === "image/jpg") return "image/jpeg";
  if (mime === "image/webp") return "image/webp";
  return "image/png";
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: CropOutputMime, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Could not encode cropped image."));
          return;
        }
        resolve(blob);
      },
      mime,
      quality,
    );
  });
}

/**
 * Crop using a displayed-pixel selection on a loaded `<img>`. Scales to natural pixels.
 * Does not fill a white background, so PNG/WebP alpha stays transparent.
 */
export async function getCroppedImageBlob(
  image: HTMLImageElement,
  displayCrop: DisplayPixelCrop,
  sourceMime: string,
): Promise<Blob> {
  if (displayCrop.width < 1 || displayCrop.height < 1) {
    throw new Error("Draw a crop area first.");
  }

  const scaleX = image.naturalWidth / image.width;
  const scaleY = image.naturalHeight / image.height;
  const sx = displayCrop.x * scaleX;
  const sy = displayCrop.y * scaleY;
  const sw = displayCrop.width * scaleX;
  const sh = displayCrop.height * scaleY;

  const canvas = document.createElement("canvas");
  const width = Math.max(1, Math.round(sw));
  const height = Math.max(1, Math.round(sh));
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not create canvas for cropping.");
  }

  // Intentionally no fillRect: a white fill would destroy PNG/WebP transparency.
  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, width, height);

  const mime = resolveCropOutputMime(sourceMime);
  if (mime === "image/png") {
    const blob = await canvasToBlob(canvas, mime, 1);
    if (blob.size > MAX_UPLOAD_BYTES) {
      throw new Error("Cropped image is larger than 2 MB. Try a tighter crop or a smaller source file.");
    }
    return blob;
  }

  for (const quality of [0.92, 0.8, 0.65, 0.5]) {
    const blob = await canvasToBlob(canvas, mime, quality);
    if (blob.size <= MAX_UPLOAD_BYTES) return blob;
  }
  throw new Error("Cropped image is larger than 2 MB. Try a tighter crop or a smaller source file.");
}
