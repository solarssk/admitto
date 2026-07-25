import type { ReactNode } from "react";
import { IconButton } from "@admitto/ui";

/** Shared header for the identity provider / Cloudflare Access editor modals — title (always
 * rendered, since it's the dialog's aria-labelledby target) + close button + an optional
 * status badge next to the title and subtitle line below, both of which stay conditional on
 * the caller's own loaded/ready state. */
export function IdentityModalHeader({
  titleId,
  title,
  badge,
  subtitle,
  onClose,
}: Readonly<{
  titleId: string;
  title: string;
  badge?: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
}>) {
  const titleEl = (
    <h2 className="identity-editor__title" id={titleId}>
      {title}
    </h2>
  );
  return (
    <div className="identity-editor__header">
      <div className="identity-editor__header-row">
        {badge ? (
          <div className="identity-editor__header-title">
            {titleEl}
            {badge}
          </div>
        ) : (
          titleEl
        )}
        <IconButton label="Close" onClick={onClose} icon={<i className="ti ti-x" />} />
      </div>
      {subtitle && <p className="identity-editor__subtitle">{subtitle}</p>}
    </div>
  );
}
