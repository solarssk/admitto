import type { ReactNode } from "react";
import "./section-label.css";

/** A labelled break between two groups of fields: the label, and a rule that fills the rest of the row. The Filters panel, the
 * forms of an attendee and the field editor use it to set a group apart. `id` lets the group's fieldset be named by it. */
export function SectionLabel({ children, className, id }: Readonly<{ children: ReactNode; className?: string; id?: string }>) {
  return (
    <p id={id} className={className ? `attendees-section-label ${className}` : "attendees-section-label"}>
      {children}
    </p>
  );
}
