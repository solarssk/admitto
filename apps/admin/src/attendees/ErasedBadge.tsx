import "./attendees.css";

/** The dashed "Erased" mark beside the name of an erased entry: dashed because the entry is a
 * placeholder, not a person. */
export function ErasedBadge() {
  return <span className="erased-badge">Erased</span>;
}
