import { useState } from "react";

export type MockCropMeta = { unit: "%"; x: number; y: number; width: number; height: number };
export type MockApplyMeta = { crop: MockCropMeta; zoom: number };

type MockCropImageModalProps = {
  open: boolean;
  imageSrc: string;
  initialCrop?: MockCropMeta;
  initialZoom?: number;
  onApply: (blob: Blob, meta: MockApplyMeta) => void | Promise<void>;
  onCancel: () => void;
};

/**
 * Mirrors the real CropImageModal's own async onApply handling (catches a thrown Error and shows
 * its message inline) so a rejected onApply can be asserted on without the real component. Shared
 * by every test that mocks the crop modal (LogoUploadZone, EventImageAssetLibrary) - `buildApplyMeta`
 * lets each caller control exactly what crop/zoom "Apply changes" sends back.
 */
export function createCropImageModalMock(
  buildApplyMeta: (initialCrop: MockCropMeta | undefined) => MockApplyMeta,
) {
  return function MockCropImageModal({
    open,
    imageSrc,
    initialCrop,
    initialZoom,
    onApply,
    onCancel,
  }: MockCropImageModalProps) {
    const [error, setError] = useState<string | null>(null);
    if (!open) return null;
    return (
      <div
        role="dialog"
        aria-label="Adjust image"
        data-image-src={imageSrc}
        data-initial-crop={initialCrop ? JSON.stringify(initialCrop) : ""}
        data-initial-zoom={initialZoom ?? ""}
      >
        {error ? <p role="alert">{error}</p> : null}
        <button
          type="button"
          onClick={() => {
            setError(null);
            Promise.resolve(onApply(new Blob(["x"], { type: "image/png" }), buildApplyMeta(initialCrop))).catch(
              (err: unknown) => {
                setError(err instanceof Error ? err.message : "Could not crop image.");
              },
            );
          }}
        >
          Apply changes
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    );
  };
}
