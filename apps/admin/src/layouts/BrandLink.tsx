import { NavLink } from "react-router";
import { BrandMark } from "./BrandMark.js";
import admittoWordmarkUrl from "../assets/admitto-wordmark.svg";

type BrandLinkProps = Readonly<{
  to: string;
  end?: boolean;
  className: string;
  markClassName?: string;
}>;

/** Admitto brand link: fixed-size mark always, plus text-only wordmark when the chrome
 * has room (desktop sidebar / mobile topbar). Tablet rail hides the wordmark via CSS so
 * the mark never changes size when collapsing. */
export function BrandLink({ to, end, className, markClassName }: BrandLinkProps) {
  const markClass = ["brand-link__mark", markClassName].filter(Boolean).join(" ");
  return (
    <NavLink to={to} className={className} end={end} aria-label="Admitto">
      <BrandMark className={markClass} />
      <img
        className="brand-link__wordmark"
        src={admittoWordmarkUrl}
        width={78}
        height={36}
        alt=""
        decoding="async"
      />
    </NavLink>
  );
}
