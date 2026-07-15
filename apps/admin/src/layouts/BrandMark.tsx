type BrandMarkProps = Readonly<{ className?: string }>;

/** Shared Admitto brand mark SVG used in all sidebar shells (and, via `className`, elsewhere). */
export function BrandMark({ className = "sidebar__brand-mark" }: BrandMarkProps) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="1" width="30" height="30" rx="7.5" fill="#066fd1" />
      <path d="M9.5 16.5l4.2 4.2 7.5-9" stroke="#ffffff" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="22.5" y="6" width="4" height="4" rx="1" fill="#ffffff" fillOpacity="0.55" />
    </svg>
  );
}
