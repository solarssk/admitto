import type { HTMLAttributes, ReactNode } from "react";

export interface PageHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title: ReactNode;
  subtitle?: ReactNode;
  breadcrumb?: ReactNode[] | null;
  actions?: ReactNode;
}

export function PageHeader({ title, subtitle, breadcrumb = null, actions, className, ...rest }: PageHeaderProps) {
  return (
    <div className={["at-pageheader", className].filter(Boolean).join(" ")} {...rest}>
      {breadcrumb && breadcrumb.length > 0 && (
        <nav className="at-breadcrumb" aria-label="Breadcrumb">
          {breadcrumb.map((item, i) => (
            <span key={i} className="at-breadcrumb__item">
              {i > 0 && <span className="at-breadcrumb__sep">/</span>}
              {item}
            </span>
          ))}
        </nav>
      )}
      <div className="at-pageheader__row">
        <div>
          <h1 className="at-pageheader__title">{title}</h1>
          {subtitle && <p className="at-pageheader__subtitle">{subtitle}</p>}
        </div>
        {actions && <div className="at-pageheader__actions">{actions}</div>}
      </div>
    </div>
  );
}
