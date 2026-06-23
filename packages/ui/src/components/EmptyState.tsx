import type { ReactNode } from "react";

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

/** Centered empty-list placeholder with optional icon, description, and action slot. */
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  const cls = ["at-empty-state", className].filter(Boolean).join(" ");
  return (
    <div className={cls} role="status">
      {icon && (
        <div className="at-empty-state__icon" aria-hidden="true">
          {icon}
        </div>
      )}
      <p className="at-empty-state__title">{title}</p>
      {description && <p className="at-empty-state__desc">{description}</p>}
      {action && <div className="at-empty-state__action">{action}</div>}
    </div>
  );
}
