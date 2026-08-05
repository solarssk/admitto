import { NavLink } from "react-router";
import { BrandMark } from "./BrandMark.js";
import admittoLogoUrl from "../assets/admitto-logo.svg";

type BrandLinkProps = Readonly<{
  to: string;
  end?: boolean;
  className: string;
  markClassName?: string;
}>;

/** Admitto product brand link. Expanded chrome shows the full wordmark SVG; the collapsed
 * rail and icon-only contexts keep the mark alone (CSS toggles which child is visible). */
export function BrandLink({ to, end, className, markClassName }: BrandLinkProps) {
  const markClass = ["brand-link__mark", markClassName].filter(Boolean).join(" ");
  return (
    <NavLink to={to} className={className} end={end} aria-label="Admitto">
      <BrandMark className={markClass} />
      <img
        className="brand-link__logo"
        src={admittoLogoUrl}
        width={118}
        height={36}
        alt=""
        decoding="async"
      />
    </NavLink>
  );
}
