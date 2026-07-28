import { NavLink } from "react-router";
import { BrandMark } from "./BrandMark.js";

type BrandLinkProps = Readonly<{
  to: string;
  end?: boolean;
  className: string;
  markClassName?: string;
}>;

/** Admitto brand mark + wordmark link. Shared by every shell's sidebar brand row, and by
 * StaffShell's topbar (shown only on mobile/tablet while the drawer is closed, so the brand
 * stays visible without opening it — CSS toggles which instance is shown, see shell.css). */
export function BrandLink({ to, end, className, markClassName }: BrandLinkProps) {
  return (
    <NavLink to={to} className={className} end={end}>
      <BrandMark className={markClassName} />
      <span className="brand-link__label">Admitto</span>
    </NavLink>
  );
}
