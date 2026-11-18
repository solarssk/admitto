import { useId, useState, type HTMLAttributes, type ReactNode } from "react";

export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  padded?: boolean;
  /**
   * The card opens and closes: its whole header is the toggle (a real button, with `aria-expanded` and `aria-controls`), and a chevron
   * at the right end of the header shows the state. Closed it is the header alone, drawn like any card header with no line under it, and
   * the body is not rendered. For a long list the person needs only on demand (the steps that are done), never for what must be seen. It
   * needs a `title`. `actions` are left out of a collapsible card: a button inside a button is not allowed.
   */
  collapsible?: boolean;
  /** A collapsible card starts open. Closed by default. The state is not kept anywhere: a new visit starts as the page says. */
  defaultOpen?: boolean;
  children?: ReactNode;
}

export function Card({ title, actions, footer, padded = true, collapsible = false, defaultOpen = false, children, className, ...rest }: Readonly<CardProps>) {
  const bodyId = useId();
  const [open, setOpen] = useState(defaultOpen);
  const shown = !collapsible || open;
  const header = collapsible ? (
    <button
      type="button"
      className={["at-card__header", "at-card__header--toggle", !open && "at-card__header--closed"].filter(Boolean).join(" ")}
      aria-expanded={open}
      aria-controls={bodyId}
      onClick={() => setOpen((was) => !was)}
    >
      <span className="at-card__title">{title}</span>
      <i className="ti ti-chevron-down at-card__chevron" aria-hidden="true" />
    </button>
  ) : (
    (title || actions) && (
      <div className="at-card__header">
        {title && <div className="at-card__title">{title}</div>}
        {actions && <div className="at-card__actions">{actions}</div>}
      </div>
    )
  );
  return (
    <div className={["at-card", className].filter(Boolean).join(" ")} {...rest}>
      {header}
      {shown && (padded ? <div id={bodyId} className="at-card__body">{children}</div> : unpaddedBody(collapsible, bodyId, children))}
      {shown && footer && <div className="at-card__footer">{footer}</div>}
    </div>
  );
}

/** The body of a card with no padding: what the caller gives, as it is. A collapsible card needs the element its header controls. */
function unpaddedBody(collapsible: boolean, id: string, children: ReactNode) {
  return collapsible ? <div id={id}>{children}</div> : children;
}
