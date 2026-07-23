import type { CSSProperties } from "react";

export type SkeletonVariant = "text" | "rect" | "circle";

export interface SkeletonProps {
  variant?: SkeletonVariant;
  width?: string | number;
  height?: string | number;
  lines?: number;
  className?: string;
}

/** Shimmer placeholder for loading content; supports text lines, rectangles, and circles. */
export function Skeleton({
  variant = "text",
  width,
  height,
  lines = 1,
  className,
}: Readonly<SkeletonProps>) {
  const style: CSSProperties = {};
  if (width) style.width = typeof width === "number" ? `${width}px` : width;
  if (height) style.height = typeof height === "number" ? `${height}px` : height;

  const cls = ["at-skeleton", `at-skeleton--${variant}`, className].filter(Boolean).join(" ");

  if (variant === "text" && lines > 1) {
    return (
      <div className="at-skeleton-stack">
        {Array.from({ length: lines }, (_, i) => (
          <span
            key={`skeleton-${i}`}
            className={cls}
            style={i === lines - 1 ? { ...style, width: "60%" } : style}
            aria-hidden="true"
          />
        ))}
      </div>
    );
  }

  return <span className={cls} style={style} aria-hidden="true" />;
}
