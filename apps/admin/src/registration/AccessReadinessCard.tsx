import { Link } from "react-router";
import { Card } from "@admitto/ui";
import type { RegistrationReadinessCheckDto } from "../api/types.js";
import { readinessCopy, remedyFor, type ReadinessCopy, type ReadinessLink } from "./accessReadiness.js";
import "./registration-access.css";

/** Where a link of a missing check goes: another tab of this page (the address keeps its path), or the settings of the event. */
function linkTarget(link: ReadinessLink, eventId: string) {
  const settings = `/admin/events/${encodeURIComponent(eventId)}/settings`;
  if (link === "event_settings") return settings;
  return link === "registration_settings" ? `${settings}?tab=registration` : { search: `?tab=${link}` };
}

/** Whether a link leaves this page for the settings of the event. */
const leavesPage = (link: ReadinessLink) => link === "event_settings" || link === "registration_settings";

/** What to do about a check that is not met: a plain sentence, or a link to the tab that puts it right. */
export function ReadinessRemedy({ eventId, remedy }: Readonly<{ eventId: string; remedy: ReadinessCopy["remedy"] }>) {
  if (!remedy) return null;
  if (!remedy.link) return <span className="access-check__remedy">{remedy.text}</span>;
  // A tab of this page replaces the entry of the history, as the tab strip does; the settings of the event are another page.
  return (
    <Link className="access-check__remedy" to={linkTarget(remedy.link, eventId)} replace={!leavesPage(remedy.link)}>
      {remedy.text}
    </Link>
  );
}

/** The checks that are not met, each with its sentence and what to do: what a refused save names (the keys come from the server). */
export function MissingChecks({ eventId, keys, superadmin }: Readonly<{ eventId: string; keys: readonly string[]; superadmin: boolean }>) {
  return (
    <ul className="access-missing">
      {keys.map((key) => {
        const copy = readinessCopy(key);
        return (
          <li key={key}>
            {copy.missing} <ReadinessRemedy eventId={eventId} remedy={remedyFor(copy, superadmin)} />
          </li>
        );
      })}
    </ul>
  );
}

/** How a row looks: a tick for a check that is met, a warning for one that is not, a grey dash for information such as "Off". */
const ROW_LOOK = {
  done: { tone: "ok", icon: "check", prefix: "Done: " },
  todo: { tone: "warn", icon: "alert-triangle", prefix: "To do: " },
  info: { tone: "neutral", icon: "minus", prefix: "Off: " },
} as const;

function rowLook(check: RegistrationReadinessCheckDto, copy: ReadinessCopy) {
  if (copy.info) return ROW_LOOK.info;
  return check.ok ? ROW_LOOK.done : ROW_LOOK.todo;
}

function ReadinessRow({ eventId, check, superadmin }: Readonly<{ eventId: string; check: RegistrationReadinessCheckDto; superadmin: boolean }>) {
  const copy = readinessCopy(check.key);
  const look = rowLook(check, copy);
  return (
    <li className="access-check">
      <span className={`overview-check__icon overview-check__icon--${look.tone}`} aria-hidden="true">
        <i className={`ti ti-${look.icon}`} />
      </span>
      <span className="overview-check__body">
        <strong>
          <span className="sr-only">{look.prefix}</span>
          {copy.title}
        </strong>
        <span className="overview-check__detail">{check.ok ? copy.met : copy.missing}</span>
        {!check.ok && <ReadinessRemedy eventId={eventId} remedy={remedyFor(copy, superadmin)} />}
      </span>
    </li>
  );
}

/**
 * What registration needs before it can be on, one row for each check the server reports: met or not, in a sentence, with what to
 * do about it when it is not. What is missing comes first. The list is of the settings that are saved, so it says so while the form
 * holds changes that are not.
 */
export function AccessReadinessCard({
  eventId,
  checks,
  hideArchived,
  unsaved,
  superadmin,
}: Readonly<{
  eventId: string;
  /** A superadmin is sent to the settings that put a check right, anybody else is told to ask. */
  superadmin: boolean;
  checks: readonly RegistrationReadinessCheckDto[];
  /** The event is archived and the page above says so: the checklist does not say it again. */
  hideArchived: boolean;
  unsaved: boolean;
}>) {
  const shown = checks.filter((check) => !(hideArchived && check.key === "event_not_archived"));
  // A row that is information (bot protection "not used") is listed last and is not a task, so it is not counted.
  const tasks = shown.filter((check) => !readinessCopy(check.key).info);
  const info = shown.filter((check) => readinessCopy(check.key).info);
  const missing = tasks.filter((check) => !check.ok);
  const ordered = [...missing, ...tasks.filter((check) => check.ok), ...info];
  return (
    <Card title="Setup checklist" actions={<span className="overview-readiness-score">{tasks.length - missing.length} of {tasks.length} done</span>}>
      <div className="settings-card-stack">
        {unsaved && <p className="settings-card-intro">The checklist shows what is saved. Save your changes to update it.</p>}
        <ul className="access-checklist">
          {ordered.map((check) => (
            <ReadinessRow key={check.key} eventId={eventId} check={check} superadmin={superadmin} />
          ))}
        </ul>
      </div>
    </Card>
  );
}
