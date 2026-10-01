import { useState, type CSSProperties, type HTMLAttributes } from "react";
import { LOADER_CYCLE_MS, loaderElapsedMs } from "../loader-clock.js";

export interface LoaderProps extends Omit<HTMLAttributes<HTMLOutputElement>, "children"> {
  /**
   * What is loading ("Loading sessions", without a closing ellipsis): the accessible name, and the line
   * shown under the mark or ring. Required: a loader that does not say what it waits for is what
   * operators complain about.
   */
  label: string;
  /** The "taking longer than usual" message, shown under the label. */
  caption?: string;
}

export interface SectionLoaderProps extends LoaderProps {
  /**
   * Height the region always reserves, so the card or dialog around it never changes size when
   * the real content arrives. Defaults to 12rem.
   */
  minHeight?: number | string;
}

/** The Admitto mark, drawn from the same paths as `assets/admitto-mark.svg`. Colours come from
 * `loader.css` (brand colour follows the organisation theme). `pathLength="1"` lets the tick's
 * draw-in animation use dash values that do not depend on the real path length. */
const MARK = (
  <svg className="at-loader__mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
    <rect className="at-loader__tile" x="1" y="1" width="30" height="30" rx="7.5" />
    <path className="at-loader__check" pathLength="1" d="M9.5 16.5l4.2 4.2 7.5-9" />
    <rect className="at-loader__dot" x="22.5" y="6" width="4" height="4" rx="1" />
  </svg>
);

/** A plain ring for panels. The logo is for whole screens only: in every card it is too much, and its
 * drawn tick looks like a checkbox the user is meant to tick. Not `Spinner`: that one is a status region
 * of its own, and this ring sits inside the loader's. Styled in `loader.css` (brand colour). */
const RING = <span className="at-loader__ring" aria-hidden="true" />;

function LoaderBody({
  size,
  label,
  caption,
  className,
  style,
  ...rest
}: Readonly<LoaderProps & { size: "page" | "section" }>) {
  // Start this loader's animation mid-cycle, at the phase the shared clock is at, so swapping one
  // loader for another (splash, boot, event, route) keeps drawing instead of restarting the tick.
  const [phaseMs] = useState(() => loaderElapsedMs() % LOADER_CYCLE_MS);
  const cls = ["at-loader", `at-loader--${size}`, className].filter(Boolean).join(" ");
  const merged = { "--at-loader-phase": `-${Math.round(phaseMs)}ms`, ...style } as CSSProperties;
  return (
    <output className={cls} aria-label={label} style={merged} {...rest}>
      <span className="at-loader__stack">
        {size === "page" ? MARK : RING}
        <span className="at-loader__text">
          {/* The name is already in aria-label: this line is for everyone else. */}
          <span className="at-loader__label" aria-hidden="true">
            {label}…
          </span>
          {caption ? <span className="at-loader__caption">{caption}</span> : null}
        </span>
      </span>
    </output>
  );
}

/**
 * Loading state for a whole screen (app start, session check, switching event): the Admitto mark
 * at 88px, centred in whatever box it fills, with a line under it saying what is loading. Never use
 * it inside a card or a button; for a panel use `SectionLoader`, `Skeleton` or `Spinner`.
 */
export function PageLoader(props: Readonly<LoaderProps>) {
  return <LoaderBody size="page" {...props} />;
}

/**
 * Loading state for a panel, card or dialog whose final shape is not known (settings panels,
 * editors in dialogs): a 32px ring and the line saying what is loading, inside a region that keeps
 * `minHeight` (not less than 8rem, so the line and the "taking longer" message fit under the ring).
 * Use it at most once per view. When the shape is known, or a view has several cards, use `Skeleton`
 * instead.
 */
export function SectionLoader({ minHeight = "12rem", style, ...props }: Readonly<SectionLoaderProps>) {
  return <LoaderBody size="section" style={{ minHeight, ...style }} {...props} />;
}
