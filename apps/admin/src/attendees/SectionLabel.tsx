import type { ReactNode } from "react";
import "./section-label.css";

/** A labelled break between two groups of fields: the label, and a rule that fills the rest of the row. The Filters panel and the
 * forms of an attendee use it to set the custom fields apart. */
export function SectionLabel({ children, className }: Readonly<{ children: ReactNode; className?: string }>) {
  return <p className={className ? `attendees-section-label ${className}` : "attendees-section-label"}>{children}</p>;
}
