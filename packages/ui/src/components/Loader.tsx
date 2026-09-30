import type { CSSProperties, HTMLAttributes } from "react";

export interface LoaderProps extends Omit<HTMLAttributes<HTMLOutputElement>, "children"> {
  /** Accessible name announced to assistive tech. Visible text is only ever the optional `caption`. */
  label?: string;
  /** Short visible line under the mark. Reserved for the "taking longer than usual" message. */
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
 * `loader.css` (brand colour follows the organisation theme). */
const MARK = (
  <svg className="at-loader__mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
    <rect className="at-loader__tile" x="1" y="1" width="30" height="30" rx="7.5" />
    <path className="at-loader__check" pathLength="1" d="M9.5 16.5l4.2 4.2 7.5-9" />
    <rect className="at-loader__dot" x="22.5" y="6" width="4" height="4" rx="1" />
  </svg>
);

function LoaderBody({
  size,
  label = "Loading",
  caption,
  className,
  style,
  ...rest
}: Readonly<LoaderProps & { size: "page" | "section"; style?: CSSProperties }>) {
  const cls = ["at-loader", `at-loader--${size}`, className].filter(Boolean).join(" ");
  return (
    <output className={cls} aria-label={label} style={style} {...rest}>
      {MARK}
      {caption ? <span className="at-loader__caption">{caption}</span> : null}
    </output>
  );
}

/**
 * Loading state for a whole screen (app start, session check, switching event): the Admitto mark
 * at 88px, centred in whatever box it fills. Never use it below 40px or inside a button; for those
 * use `Spinner`.
 */
export function PageLoader(props: Readonly<LoaderProps>) {
  return <LoaderBody size="page" {...props} />;
}

/**
 * Loading state for a panel, card or dialog whose final shape is not known (settings panels,
 * editors in dialogs): the mark at 52px inside a region that keeps `minHeight`. When the shape is
 * known, use `Skeleton` instead.
 */
export function SectionLoader({ minHeight = "12rem", style, ...props }: Readonly<SectionLoaderProps>) {
  return <LoaderBody size="section" style={{ minHeight, ...style }} {...props} />;
}
