import type { HTMLAttributes, ReactNode } from "react";

export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  padded?: boolean;
  children?: ReactNode;
}

export function Card({ title, actions, footer, padded = true, children, className, ...rest }: CardProps) {
  return (
    <div className={["at-card", className].filter(Boolean).join(" ")} {...rest}>
      {(title || actions) && (
        <div className="at-card__header">
          {title && <div className="at-card__title">{title}</div>}
          {actions && <div style={{ display: "flex", gap: "var(--space-2)" }}>{actions}</div>}
        </div>
      )}
      {padded ? <div className="at-card__body">{children}</div> : children}
      {footer && <div className="at-card__footer">{footer}</div>}
    </div>
  );
}
