export interface ModalBackdropProps {
  /** Click-outside-to-close. Omit (or pass undefined, e.g. while a save is in flight) to disable. */
  onClose?: () => void;
}

/**
 * Full-bleed overlay behind a modal's panel, absolutely positioned inside the modal's own
 * `<dialog>`. `role="presentation"` since it carries no content of its own - the native
 * `<dialog>` already handles focus trapping and Escape; this is purely a mouse-only convenience.
 */
export function ModalBackdrop({ onClose }: Readonly<ModalBackdropProps>) {
  return (
    <div // NOSONAR — plain decorative click-catcher div, not an <img>; the enclosing <dialog> already handles focus/Escape, this only adds a mouse-only click-outside-to-close convenience
      className="at-modal-backdrop"
      role="presentation"
      onClick={onClose}
    />
  );
}
