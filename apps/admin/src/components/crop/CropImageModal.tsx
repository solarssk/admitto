import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
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
import { brandingLogoImgSrc } from "../../utils/safeBrandingLogoHref.js";
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
  if (crop?.unit !== "%") return false;
  const { x, y, width, height } = crop;
  if (![x, y, width, height].every((n) => Number.isFinite(n))) return false;
  if (width < 1 || height < 1) return false;
  if (x < 0 || y < 0) return false;
  return x + width <= 100.5 && y + height <= 100.5;
}

/**
 * Preview URL for the crop `<img>`.
 * - `data:image/…` — unit-test fixtures only (never from `input.files`).
 * - `/uploads/…` — via {@link brandingLogoImgSrc} (same CodeQL-safe pathname barrier as logo previews).
 * Deliberately rejects `blob:` so callers cannot feed `URL.createObjectURL(File)` into `img.src`
 * (that path is CodeQL `js/xss-through-dom` FilesSource → URL sink).
 */
export function trustedCropPreviewSrc(src: string): string | null {
  if (src.startsWith("data:image/")) return src;
  const safe = brandingLogoImgSrc(src);
  // Crop preview is same-origin uploads only (not external HTTPS).
  if (safe?.startsWith("/uploads/")) return safe;
  return null;
}

function scrollStageToCropCenter(
  stage: HTMLElement,
  pixel: { x: number; y: number; width: number; height: number },
): void {
  stage.scrollLeft = Math.max(0, pixel.x + pixel.width / 2 - stage.clientWidth / 2);
  stage.scrollTop = Math.max(0, pixel.y + pixel.height / 2 - stage.clientHeight / 2);
}

function cropStageClassName(zoomed: boolean, hasFit: boolean): string {
  if (zoomed) return "crop-image-modal__stage crop-image-modal__stage--zoomed";
  if (hasFit) return "crop-image-modal__stage";
  return "crop-image-modal__stage crop-image-modal__stage--loading";
}

function percentCropForApply(
  crop: Crop | undefined,
  completedCrop: PixelCrop,
  img: HTMLImageElement,
): PercentCrop {
  if (crop?.unit === "%") return crop as PercentCrop;
  return convertToPercentCrop(completedCrop, img.width, img.height);
}

/** @internal Exported for unit tests covering pixel-unit conversion. */
export { percentCropForApply as percentCropForApplyForTest };

/** Crop + call onApply; returns an operator-facing error string, or null on success. */
async function runCropApply(
  img: HTMLImageElement,
  completedCrop: PixelCrop,
  crop: Crop | undefined,
  zoom: number,
  sourceMime: string,
  onApply: CropImageModalProps["onApply"],
): Promise<string | null> {
  if (completedCrop.width < 1 || completedCrop.height < 1) {
    return "Drag the edges to select the area you want to keep.";
  }
  try {
    const blob = await getCroppedImageBlob(img, completedCrop, sourceMime);
    await onApply(blob, {
      crop: percentCropForApply(crop, completedCrop, img),
      zoom,
    });
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : "Could not crop image.";
  }
}

/** @internal Exported for unit tests covering empty-selection Apply. */
export { runCropApply as runCropApplyForTest };

function cropPanelWidthPx(fit: FitSize | null, viewportWidthCap: number): number | undefined {
  if (!fit) return undefined;
  return Math.min(
    920,
    viewportWidthCap,
    Math.max(320, fit.width + HANDLE_INSET_PX * 2 + PANEL_PAD_X_PX),
  );
}

type SeedCropSetters = {
  setFitSize: (fit: FitSize) => void;
  setZoom: (z: number) => void;
  setPrevZoom: (z: number) => void;
  setCrop: (c: Crop) => void;
  setCompletedCrop: (c: PixelCrop) => void;
  setError: (msg: string | null) => void;
};

/** Seed fit/zoom/crop after the preview image reports natural size. */
function seedCropFromLoadedImage(
  img: HTMLImageElement,
  options: {
    initialCrop: PercentCrop | undefined;
    initialZoom: number | undefined;
    stage: HTMLElement | null;
  },
  setters: SeedCropSetters,
): void {
  if (img.naturalWidth < 1 || img.naturalHeight < 1) {
    setters.setError("Could not read this image.");
    return;
  }
  const limits = cropViewportLimits();
  const fit = fitNaturalSize(img.naturalWidth, img.naturalHeight, limits.width, limits.height);
  const restoredZoom = clampCropZoom(options.initialZoom ?? CROP_ZOOM_MIN);
  setters.setFitSize(fit);
  setters.setZoom(restoredZoom);
  setters.setPrevZoom(restoredZoom);
  requestAnimationFrame(() => {
    if (img.width < 1 || img.height < 1) return;
    const initial = isRestorablePercentCrop(options.initialCrop)
      ? options.initialCrop
      : centerCrop({ unit: "%", width: 92, height: 92 }, img.width, img.height);
    setters.setCrop(initial);
    setters.setCompletedCrop(convertToPixelCrop(initial, img.width, img.height));
    if (restoredZoom > 1 && options.stage) {
      scrollStageToCropCenter(options.stage, convertToPixelCrop(initial, img.width, img.height));
    }
  });
}

type CropImageModalViewProps = {
  title: string;
  titleId: string;
  zoomId: string;
  panelRef: RefObject<HTMLDivElement | null>;
  stageRef: RefObject<HTMLDivElement | null>;
  imgRef: RefObject<HTMLImageElement | null>;
  crop: Crop | undefined;
  completedCrop: PixelCrop | null;
  fitSize: FitSize | null;
  zoom: number;
  applying: boolean;
  error: string | null;
  previewSrc: string | null;
  display: FitSize | null;
  panelWidthPx: number | undefined;
  stageClassName: string;
  onCancel: () => void;
  onApplyClick: () => void;
  onImageLoad: (e: SyntheticEvent<HTMLImageElement>) => void;
  adjustZoom: (next: number) => void;
  setCrop: (c: Crop) => void;
  setCompletedCrop: (c: PixelCrop) => void;
  onStagePointerDownCapture: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onStagePointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void;
  endPan: (e: ReactPointerEvent<HTMLDivElement>) => void;
};

function cropImgStyle(display: FitSize | null, fitSize: FitSize | null): CSSProperties {
  return {
    width: display ? `${display.width}px` : undefined,
    height: display ? `${display.height}px` : undefined,
    visibility: fitSize ? "visible" : "hidden",
    position: fitSize ? "static" : "absolute",
  };
}

function CropImageModalView({
  title,
  titleId,
  zoomId,
  panelRef,
  stageRef,
  imgRef,
  crop,
  completedCrop,
  fitSize,
  zoom,
  applying,
  error,
  previewSrc,
  display,
  panelWidthPx,
  stageClassName,
  onCancel,
  onApplyClick,
  onImageLoad,
  adjustZoom,
  setCrop,
  setCompletedCrop,
  onStagePointerDownCapture,
  onStagePointerMove,
  endPan,
}: Readonly<CropImageModalViewProps>) {
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
          className={stageClassName}
          style={
            fitSize
              ? {
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
          {previewSrc ? (
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
                src={previewSrc}
                alt=""
                className="crop-image-modal__img"
                width={display?.width}
                height={display?.height}
                style={cropImgStyle(display, fitSize)}
                onLoad={onImageLoad}
                crossOrigin="anonymous"
                draggable={false}
              />
            </ReactCrop>
          ) : null}
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
            onClick={onApplyClick}
          >
            {applying ? "Working…" : "Apply changes"}
          </Button>
        </div>
      </div>
    </dialog>
  );
}

/**
 * Free-form crop modal: edge/corner handles.
 * Stage viewport stays at fit size; zoom magnifies the bitmap inside it.
 * When zoomed, drag (not on handles) pans - wheel zooms.
 *
 * Callers must pass a same-origin `/uploads/…` URL (upload the file first) or a `data:image/`
 * test fixture — never a `blob:` from `createObjectURL(File)`.
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

  useLayoutEffect(() => {
    const img = imgRef.current;
    if (!img || !crop || img.width < 1 || img.height < 1) return;
    setCompletedCrop(convertToPixelCrop(crop, img.width, img.height));
  }, [zoom, fitSize, crop]);

  useLayoutEffect(() => {
    if (prevZoomRef.current === zoom) return;
    prevZoomRef.current = zoom;
    const img = imgRef.current;
    const stage = stageRef.current;
    if (!img || !stage || !crop || img.width < 1) return;
    scrollStageToCropCenter(stage, convertToPixelCrop(crop, img.width, img.height));
  }, [zoom, crop]);

  const onImageLoad = (e: SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    imgRef.current = img;
    seedCropFromLoadedImage(
      img,
      { initialCrop, initialZoom, stage: stageRef.current },
      {
        setFitSize,
        setZoom,
        setPrevZoom: (z) => {
          prevZoomRef.current = z;
        },
        setCrop,
        setCompletedCrop,
        setError,
      },
    );
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

  const handleApply = () => {
    const img = imgRef.current;
    if (!img || !completedCrop || applying) return;
    setApplying(true);
    setError(null);
    runCropApply(img, completedCrop, crop, zoom, sourceMime, onApply)
      .then((errMsg) => {
        if (errMsg) setError(errMsg);
      })
      .finally(() => {
        setApplying(false);
      });
  };

  if (!open) return null;

  const display = fitSize ? displaySizeAtZoom(fitSize, zoom) : null;
  const zoomed = zoom > 1.001;
  const previewSrc = trustedCropPreviewSrc(imageSrc);
  const viewportWidthCap = typeof window !== "undefined" ? window.innerWidth - 32 : 920;

  return (
    <CropImageModalView
      title={title}
      titleId={titleId}
      zoomId={zoomId}
      panelRef={panelRef}
      stageRef={stageRef}
      imgRef={imgRef}
      crop={crop}
      completedCrop={completedCrop}
      fitSize={fitSize}
      zoom={zoom}
      applying={applying}
      error={error}
      previewSrc={previewSrc}
      display={display}
      panelWidthPx={cropPanelWidthPx(fitSize, viewportWidthCap)}
      stageClassName={cropStageClassName(zoomed, Boolean(fitSize))}
      onCancel={onCancel}
      onApplyClick={handleApply}
      onImageLoad={onImageLoad}
      adjustZoom={adjustZoom}
      setCrop={setCrop}
      setCompletedCrop={setCompletedCrop}
      onStagePointerDownCapture={onStagePointerDownCapture}
      onStagePointerMove={onStagePointerMove}
      endPan={endPan}
    />
  );
}
