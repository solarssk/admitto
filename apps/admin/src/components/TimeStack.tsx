import type { ReactNode } from "react";
import "./time-stack.css";

/** True for the part of a zone after "UTC": "+5", "-3", "+5:30", "+02:00". Plain string work: a regular expression over free text is a lint error here. */
function isOffset(text: string): boolean {
  if (!text.startsWith("+") && !text.startsWith("-")) return false;
  const [hours, minutes, extra] = text.slice(1).split(":");
  const digits = (value: string | undefined, min: number, max: number) =>
    value !== undefined && value.length >= min && value.length <= max && [...value].every((ch) => ch >= "0" && ch <= "9");
  return extra === undefined && digits(hours, 1, 2) && (minutes === undefined || digits(minutes, 2, 2));
}

/** The clock and, last, the zone it is on: "2026-11-25 20:40:14 UTC" gives "2026-11-25 20:40:14" and " UTC"; so does "05 Jan 2026, 15:00 UTC+5:30". Null when the text does not end in one. */
function splitZone(text: string): [string, string] | null {
  const at = text.lastIndexOf(" UTC");
  if (at <= 0) return null;
  const zone = text.slice(at);
  const offset = zone.slice(" UTC".length);
  return offset === "" || isOffset(offset) ? [text.slice(0, at), zone] : null;
}

/**
 * A time as text, with its zone quiet: the digits are what a reader looks for and the zone only says which clock they are on, so "UTC" is smaller and grey
 * where the digits are dark (time-stack.css). The text is the same string, so what is copied, searched or read out does not change. A text with no zone at the
 * end is returned as it is.
 */
export function TimeWithZone({ text }: Readonly<{ text: string }>): ReactNode {
  const parts = splitZone(text);
  if (!parts) return text;
  return (
    <>
      {parts[0]}
      <span className="time-stack__zone">{parts[1]}</span>
    </>
  );
}

/**
 * A time in a row or a card: the primary text (the UTC time, as a rule `formatUtcPrimaryTime`) and under it the lines that say when it was where it happened
 * (`ActorOrViewerLocalTimeLine`, or a `LocalTimeLine` of the caller's own). One look, one stylesheet (time-stack.css), for every place that shows a time this
 * way: standards/admin-spa/time-display.md. The text each place shows is its own; never a monospace font or a hand-made "subdued" line instead.
 */
export function TimeStack({ primary, children }: Readonly<{ primary: ReactNode; children?: ReactNode }>) {
  return (
    <div className="time-stack">
      <div className="time-stack__utc">{typeof primary === "string" ? <TimeWithZone text={primary} /> : primary}</div>
      {children}
    </div>
  );
}

/** A time that is only text (a date in a list of facts, the admission time of a scan), in the same look as the primary line of a `TimeStack`. */
export function TimeText({ children }: Readonly<{ children: string }>) {
  return (
    <span className="time-text">
      <TimeWithZone text={children} />
    </span>
  );
}

/**
 * The secondary line under a time: one icon, then the time in the zone where it happened or, when none is stored, the viewer's. The icon says "local" and
 * nothing else, so one icon serves every zone (PO report: a second icon for the fallback made the reader work out a distinction that changes nothing).
 * `title` names whose time it is, for the icon's tooltip and for a screen reader.
 */
export function LocalTimeLine({ title, children }: Readonly<{ title: string; children: ReactNode }>) {
  return (
    <div className="time-stack__local">
      <i className="ti ti-user" aria-hidden="true" title={title} />
      <span className="sr-only">{title}: </span>
      {children}
    </div>
  );
}
