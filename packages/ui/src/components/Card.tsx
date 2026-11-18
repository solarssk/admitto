import { useId, useState, type HTMLAttributes, type ReactNode } from "react";

export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  padded?: boolean;
  /**
   * The card opens and closes: its whole header is the toggle (a real button, with `aria-expanded` and `aria-controls`), and a chevron
   * at the right end of the header shows the state. Closed it is the header alone, drawn like any card header with no line under it, and
   * the body can neither be seen nor reached (`inert`, and `visibility: hidden` once the closing has finished). It opens and closes
   * smoothly, and at once for a person who asked for less motion. For a long list the person needs only on demand (the steps that are
   * done), never for what must be seen. It needs a `title`. `actions` are left out of a collapsible card: a button inside a button is not
   * allowed.
   */
  collapsible?: boolean;
  /** A collapsible card starts open. Closed by default. The state is not kept anywhere: a new visit starts as the page says. */
  defaultOpen?: boolean;
  children?: ReactNode;
}

export function Card({ title, actions, footer, padded = true, collapsible = false, defaultOpen = false, children, className, ...rest }: Readonly<CardProps>) {
  const bodyId = useId();
  const [open, setOpen] = useState(defaultOpen);
  // The body is mounted when the card is first opened and stays: closing needs it to shrink, and opening again is then instant.
  const [opened, setOpened] = useState(defaultOpen);
  const toggle = () => {
    setOpened(true);
    setOpen((was) => !was);
  };
  const header = collapsible ? (
    <button
      type="button"
      className={["at-card__header", "at-card__header--toggle", !open && "at-card__header--closed"].filter(Boolean).join(" ")}
      aria-expanded={open}
      aria-controls={bodyId}
      onClick={toggle}
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
  const body = padded ? <div className="at-card__body">{children}</div> : children;
  return (
    <div className={["at-card", className].filter(Boolean).join(" ")} {...rest}>
      {header}
      {collapsible ? (
        <div id={bodyId} className="at-card__collapse" data-open={open} inert={!open}>
          <div className="at-card__collapse-inner">
            {opened && body}
            {opened && footer && <div className="at-card__footer">{footer}</div>}
          </div>
        </div>
      ) : (
        <>
          {body}
          {footer && <div className="at-card__footer">{footer}</div>}
        </>
      )}
    </div>
  );
}
