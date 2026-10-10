/**
 * The glyph of a failed load where the failure is a text of its own (the one-line hint, the log console, the identity editor, a dropdown):
 * the `circle-x` in the error colour that `Notice`, `Toast` and `EmptyState variant="error"` draw, so that a failure is never taken
 * for an empty list. It is decoration, hidden from assistive tech: the message beside it says what failed. Inline before the
 * message by default; `className="failure-icon--large"` puts a large one over it, for a failure that has a block of its own.
 */
export function FailureIcon({ className }: Readonly<{ className?: string }>) {
  return <i className={className ? `ti ti-circle-x failure-icon ${className}` : "ti ti-circle-x failure-icon"} aria-hidden="true" />;
}
