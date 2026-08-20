import type { ReactNode } from "react";
import { IconButton } from "@admitto/ui";

/** Shared header for the identity provider / Cloudflare Access editor modals — title (always
 * rendered, since it's the dialog's aria-labelledby target) + close button, plus an optional
 * leading entity icon, status badge next to the title, and subtitle line below, all conditional
 * on the caller's own loaded/ready state. `icon` matches the same per-provider-type glyph
 * IdentityProvidersPanel's own list rows already use (.identity-row-icon: shield-lock for OIDC,
 * brand-cloudflare for Cloudflare Access) - carrying that same visual anchor from the list row
 * into the editor gives continuity between the two instead of the editor reading as unrelated to
 * which row opened it (PO report: a standard other popups already follow). */
export function IdentityModalHeader({
  titleId,
  title,
  icon,
  badge,
  subtitle,
  onClose,
  closeDisabled = false,
}: Readonly<{
  titleId: string;
  title: string;
  icon?: ReactNode;
  badge?: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  closeDisabled?: boolean;
}>) {
  const titleEl = (
    <h2 className="identity-editor__title" id={titleId}>
      {title}
    </h2>
  );
  return (
    <div className="identity-editor__header">
      <div className="identity-editor__header-row">
        <div className="identity-editor__header-title">
          {icon && (
            <div className="identity-row-icon" aria-hidden="true">
              {icon}
            </div>
          )}
          {titleEl}
          {badge}
        </div>
        <IconButton label="Close" onClick={onClose} disabled={closeDisabled} icon={<i className="ti ti-x" />} />
      </div>
      {subtitle && <p className="identity-editor__subtitle">{subtitle}</p>}
    </div>
  );
}
