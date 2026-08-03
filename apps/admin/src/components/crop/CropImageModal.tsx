import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type SyntheticEvent,
} from "react";
import ReactCrop, {
  centerCrop,
  convertToPercentCrop,
  convertToPixelCrop,
  type Crop,
  type PercentCrop,
  type PixelCrop,
} from "react-image-crop";
import { Button, ModalBackdrop, Spinner } from "@admitto/ui";
import { useModalFocusTrap } from "../useModalFocusTrap.js";
import { getCroppedImageBlob } from "./getCroppedImageBlob.js";
import "react-image-crop/dist/ReactCrop.css";
import "./crop-image-modal.css";

/** Percent crop + zoom returned with Apply so Edit can restore the last framing. */
export type CropApplyMeta = {
  crop: PercentCrop;
  zoom: number;
};

export type CropImageModalProps = {
  open: boolean;
  title?: string;
  imageSrc: string;
  /** Source MIME used to pick an export format that preserves alpha when present. */
  sourceMime: string;
  /** Last applied percent crop (from a previous Edit in this session). */
  initialCrop?: PercentCrop;
  /** Last zoom level to restore with `initialCrop`. */
  initialZoom?: number;
  onCancel: () => void;
  onApply: (blob: Blob, meta: CropApplyMeta) => void | Promise<void>;
};

export type FitSize = { width: number; height: number };

/** Padding around the image so crop handles are not clipped. */
const HANDLE_INSET_PX = 12;
/** Panel horizontal padding (space-5 × 2) reserved when sizing the image. */
const PANEL_PAD_X_PX = 40;
/** Title + hint + zoom + actions vertical chrome reserved inside the dialog. */
const PANEL_CHROME_Y_PX = 220;

export const CROP_ZOOM_MIN = 1;
export const CROP_ZOOM_MAX = 3;
export const CROP_ZOOM_STEP = 0.05;

/** Scale natural pixels to fit inside the available box (never upscale past 1:1). */
export function fitNaturalSize(
  naturalWidth: number,
  naturalHeight: number,
  maxWidth: number,
  maxHeight: number,
): FitSize {
  const scale = Math.min(1, maxWidth / naturalWidth, maxHeight / naturalHeight);
  return {
    width: Math.max(1, Math.floor(naturalWidth * scale)),
    height: Math.max(1, Math.floor(naturalHeight * scale)),
  };
}

/** Display size after zoom (fit × zoom). */
export function displaySizeAtZoom(fit: FitSize, zoom: number): FitSize {
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return {
    width: Math.max(1, Math.round(fit.width * z)),
    height: Math.max(1, Math.round(fit.height * z)),
  };
}

/** Clamp zoom to the supported range (slider + mouse wheel). */
export function clampCropZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return CROP_ZOOM_MIN;
  const stepped = Math.round(zoom / CROP_ZOOM_STEP) * CROP_ZOOM_STEP;
  return Math.min(CROP_ZOOM_MAX, Math.max(CROP_ZOOM_MIN, Number(stepped.toFixed(2))));
}

/** Available image viewport inside the dialog for the current window. */
export function cropViewportLimits(win: Pick<Window, "innerWidth" | "innerHeight"> = window): FitSize {
  const maxPanelW = Math.min(920, Math.max(280, win.innerWidth - 32));
  const maxPanelH = Math.min(880, Math.floor(win.innerHeight * 0.92));
  return {
    width: Math.max(120, maxPanelW - PANEL_PAD_X_PX - HANDLE_INSET_PX * 2),
    height: Math.max(80, Math.min(560, maxPanelH - PANEL_CHROME_Y_PX - HANDLE_INSET_PX * 2)),
  };
}

function isCropHandleTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    Boolean(target.closest(".ReactCrop__drag-handle, .ReactCrop__drag-bar"))
  );
}

/** True when a percent crop can be shown again on Edit (within the image bounds). */
export function isRestorablePercentCrop(crop: Crop | null | undefined): crop is PercentCrop {
  if (!crop || crop.unit !== "%") return false;
  const { x, y, width, height } = crop;
  if (![x, y, width, height].every((n) => Number.isFinite(n))) return false;
  if (width < 1 || height < 1) return false;
  if (x < 0 || y < 0) return false;
  return x + width <= 100.5 && y + height <= 100.5;
}

/**
 * Free-form crop modal: edge/corner handles.
 * Stage viewport stays at fit size; zoom magnifies the bitmap inside it.
 * When zoomed, drag (not on handles) pans — wheel zooms.
 */
export function CropImageModal({
  open,
  title = "Adjust image",
  imageSrc,
  sourceMime,
  initialCrop,
  initialZoom,
  onCancel,
  onApply,
}: Readonly<CropImageModalProps>) {
  const titleId = useId();
  const zoomId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const panRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const prevZoomRef = useRef(CROP_ZOOM_MIN);
  const [crop, setCrop] = useState<Crop>();
  const [completedCrop, setCompletedCrop] = useState<PixelCrop | null>(null);
  const [fitSize, setFitSize] = useState<FitSize | null>(null);
  const [zoom, setZoom] = useState(CROP_ZOOM_MIN);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useModalFocusTrap(panelRef, open, onCancel);

  useEffect(() => {
    if (!open) return;
    setCrop(undefined);
    setCompletedCrop(null);
    setFitSize(null);
    setZoom(CROP_ZOOM_MIN);
    prevZoomRef.current = CROP_ZOOM_MIN;
    setError(null);
    setApplying(false);
    imgRef.current = null;
    panRef.current = null;
  }, [open, imageSrc]);

  // % crop stays correct across zoom; refresh pixel crop for Apply from current display size.
  useLayoutEffect(() => {
    const img = imgRef.current;
    if (!img || !crop || img.width < 1 || img.height < 1) return;
    setCompletedCrop(convertToPixelCrop(crop, img.width, img.height));
  }, [zoom, fitSize, crop]);

  // After zoom, keep the selection centered in the viewport.
  useLayoutEffect(() => {
    if (prevZoomRef.current === zoom) return;
    prevZoomRef.current = zoom;
    const img = imgRef.current;
    const stage = stageRef.current;
    if (!img || !stage || !crop || img.width < 1) return;
    const pixel = convertToPixelCrop(crop, img.width, img.height);
    stage.scrollLeft = Math.max(0, pixel.x + pixel.width / 2 - stage.clientWidth / 2);
    stage.scrollTop = Math.max(0, pixel.y + pixel.height / 2 - stage.clientHeight / 2);
  }, [zoom, crop]);

  const onImageLoad = (e: SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    imgRef.current = img;
    if (img.naturalWidth < 1 || img.naturalHeight < 1) {
      setError("Could not read this image.");
      return;
    }
    const limits = cropViewportLimits();
    const fit = fitNaturalSize(img.naturalWidth, img.naturalHeight, limits.width, limits.height);
    const restoredZoom = clampCropZoom(initialZoom ?? CROP_ZOOM_MIN);
    setFitSize(fit);
    setZoom(restoredZoom);
    prevZoomRef.current = restoredZoom;
    // Next paint has explicit width/height; then seed the % crop (restored or default).
    requestAnimationFrame(() => {
      const el = imgRef.current;
      if (!el || el.width < 1 || el.height < 1) return;
      const initial = isRestorablePercentCrop(initialCrop)
        ? initialCrop
        : centerCrop({ unit: "%", width: 92, height: 92 }, el.width, el.height);
      setCrop(initial);
      setCompletedCrop(convertToPixelCrop(initial, el.width, el.height));
      if (restoredZoom > 1) {
        const pixel = convertToPixelCrop(initial, el.width, el.height);
        const stage = stageRef.current;
        if (stage) {
          stage.scrollLeft = Math.max(0, pixel.x + pixel.width / 2 - stage.clientWidth / 2);
          stage.scrollTop = Math.max(0, pixel.y + pixel.height / 2 - stage.clientHeight / 2);
        }
      }
    });
  };

  const adjustZoom = useCallback((next: number) => {
    setZoom(clampCropZoom(next));
  }, []);

  useEffect(() => {
    if (!open || !fitSize) return;
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (ev: WheelEvent) => {
      if (applying) return;
      ev.preventDefault();
      ev.stopPropagation();
      const direction = ev.deltaY > 0 ? -1 : 1;
      const step = CROP_ZOOM_STEP * (ev.shiftKey ? 4 : 1);
      setZoom((z) => clampCropZoom(z + direction * step));
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [open, applying, fitSize]);

  const beginPan = (e: ReactPointerEvent<HTMLDivElement>) => {
    const stage = stageRef.current;
    if (!stage) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    panRef.current = {
      x: e.clientX,
      y: e.clientY,
      left: stage.scrollLeft,
      top: stage.scrollTop,
    };
  };

  const onStagePointerDownCapture = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (applying || zoom <= 1) return;
    if (e.button !== 0 && e.button !== 1) return;
    if (e.button === 0 && isCropHandleTarget(e.target)) return;
    beginPan(e);
  };

  const onStagePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const pan = panRef.current;
    const stage = stageRef.current;
    if (!pan || !stage) return;
    e.preventDefault();
    e.stopPropagation();
    stage.scrollLeft = pan.left - (e.clientX - pan.x);
    stage.scrollTop = pan.top - (e.clientY - pan.y);
  };

  const endPan = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!panRef.current) return;
    panRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const handleApply = async () => {
    const img = imgRef.current;
    if (!img || !completedCrop || applying) return;
    if (completedCrop.width < 1 || completedCrop.height < 1) {
      setError("Drag the edges to select the area you want to keep.");
      return;
    }
    setApplying(true);
    setError(null);
    try {
      const blob = await getCroppedImageBlob(img, completedCrop, sourceMime);
      const percent =
        crop && crop.unit === "%"
          ? (crop as PercentCrop)
          : convertToPercentCrop(completedCrop, img.width, img.height);
      await onApply(blob, { crop: percent, zoom });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not crop image.");
    } finally {
      setApplying(false);
    }
  };

  if (!open) return null;

  const display = fitSize ? displaySizeAtZoom(fitSize, zoom) : null;
  const zoomed = zoom > 1.001;
  const panelWidthPx = fitSize
    ? Math.min(
        920,
        typeof window !== "undefined" ? window.innerWidth - 32 : 920,
        Math.max(320, fitSize.width + HANDLE_INSET_PX * 2 + PANEL_PAD_X_PX),
      )
    : undefined;

  return (
    <dialog open className="crop-image-modal" aria-modal="true" aria-labelledby={titleId}>
      <ModalBackdrop onClose={applying ? undefined : onCancel} />
      <div
        ref={panelRef}
        className="crop-image-modal__panel"
        style={panelWidthPx ? { width: `${panelWidthPx}px` } : undefined}
      >
        <h2 id={titleId} className="crop-image-modal__title">
          {title}
        </h2>
        <p className="crop-image-modal__hint">
          Drag the blue handles to trim margins. Mouse wheel zooms. When zoomed, drag the image to
          pan (handles still resize the crop). PNG/WebP stay transparent.
        </p>
        <div
          ref={stageRef}
          className={
            zoomed
              ? "crop-image-modal__stage crop-image-modal__stage--zoomed"
              : fitSize
                ? "crop-image-modal__stage"
                : "crop-image-modal__stage crop-image-modal__stage--loading"
          }
          style={
            fitSize
              ? {
                  // content-box: width/height are the image viewport; padding is extra for handles.
                  width: `${fitSize.width}px`,
                  height: `${fitSize.height}px`,
                }
              : undefined
          }
          onPointerDownCapture={onStagePointerDownCapture}
          onPointerMove={onStagePointerMove}
          onPointerUp={endPan}
          onPointerCancel={endPan}
        >
          {!fitSize ? <Spinner size="sm" label="Loading image" /> : null}
          <ReactCrop
            crop={crop}
            onChange={(_pixel, percent) => setCrop(percent)}
            onComplete={(pixel, percent) => {
              setCrop(percent);
              setCompletedCrop(pixel);
            }}
            minWidth={8}
            minHeight={8}
            keepSelection
          >
            <img
              ref={imgRef}
              src={imageSrc}
              alt=""
              className="crop-image-modal__img"
              width={display?.width}
              height={display?.height}
              style={{
                width: display ? `${display.width}px` : undefined,
                height: display ? `${display.height}px` : undefined,
                // Hide until fitted so the full-res file never flashes then shrinks.
                visibility: fitSize ? "visible" : "hidden",
                position: fitSize ? "static" : "absolute",
              }}
              onLoad={onImageLoad}
              crossOrigin="anonymous"
              draggable={false}
            />
          </ReactCrop>
        </div>
        <div className="crop-image-modal__zoom">
          <label className="crop-image-modal__zoom-label" htmlFor={zoomId}>
            Zoom
          </label>
          <input
            id={zoomId}
            className="crop-image-modal__zoom-input"
            type="range"
            min={CROP_ZOOM_MIN}
            max={CROP_ZOOM_MAX}
            step={CROP_ZOOM_STEP}
            value={zoom}
            disabled={applying || !fitSize}
            onChange={(e) => adjustZoom(Number(e.target.value))}
          />
        </div>
        {error ? (
          <p className="crop-image-modal__error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="crop-image-modal__actions">
          <Button type="button" variant="secondary" disabled={applying} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={!completedCrop || applying}
            icon={applying ? <Spinner size="sm" label="Working" /> : undefined}
            onClick={() => void handleApply()}
          >
            {applying ? "Working…" : "Apply changes"}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
