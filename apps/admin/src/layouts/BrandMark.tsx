import admittoMarkUrl from "@admitto/ui/assets/admitto-mark.svg";

type BrandMarkProps = Readonly<{ className?: string }>;

/** Shared Admitto brand mark. SVG source of truth: `@admitto/ui/assets/admitto-mark.svg`. */
export function BrandMark({ className = "sidebar__brand-mark" }: BrandMarkProps) {
  return (
    <img
      className={className}
      src={admittoMarkUrl}
      width={32}
      height={32}
      alt=""
      decoding="async"
    />
  );
}
