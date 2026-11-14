import { Link } from "react-router";
import { Card } from "@admitto/ui";
import type { RegistrationReadinessCheckDto } from "../api/types.js";
import { readinessCopy, type ReadinessCopy, type ReadinessLink } from "./accessReadiness.js";
import "./registration-access.css";

/** Where a link of a missing check goes: another tab of this page (the address keeps its path), or the settings of the event. */
function linkTarget(link: ReadinessLink, eventId: string) {
  return link === "event_settings" ? `/admin/events/${encodeURIComponent(eventId)}/settings` : { search: `?tab=${link}` };
}

/** What to do about a check that is not met: a plain sentence, or a link to the tab that puts it right. */
export function ReadinessRemedy({ eventId, remedy }: Readonly<{ eventId: string; remedy: ReadinessCopy["remedy"] }>) {
  if (!remedy) return null;
  if (!remedy.link) return <span className="access-check__remedy">{remedy.text}</span>;
  // A tab of this page replaces the entry of the history, as the tab strip does; the settings of the event are another page.
  return (
    <Link className="access-check__remedy" to={linkTarget(remedy.link, eventId)} replace={remedy.link !== "event_settings"}>
      {remedy.text}
    </Link>
  );
}

/** The checks that are not met, each with its sentence and what to do: what a refused save names (the keys come from the server). */
export function MissingChecks({ eventId, keys }: Readonly<{ eventId: string; keys: readonly string[] }>) {
  return (
    <ul className="access-missing">
      {keys.map((key) => {
        const copy = readinessCopy(key);
        return (
          <li key={key}>
            {copy.missing} <ReadinessRemedy eventId={eventId} remedy={copy.remedy} />
          </li>
        );
      })}
    </ul>
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
}: Readonly<{
  eventId: string;
  checks: readonly RegistrationReadinessCheckDto[];
  /** The event is archived and the page above says so: the checklist does not say it again. */
  hideArchived: boolean;
  unsaved: boolean;
}>) {
  const shown = checks.filter((check) => !(hideArchived && check.key === "event_not_archived"));
  const missing = shown.filter((check) => !check.ok);
  const ordered = [...missing, ...shown.filter((check) => check.ok)];
  return (
    <Card title="Setup checklist" actions={<span className="overview-readiness-score">{shown.length - missing.length} of {shown.length} done</span>}>
      <div className="settings-card-stack">
        {unsaved && <p className="settings-card-intro">The checklist shows what is saved. Save your changes to update it.</p>}
        <ul className="access-checklist">
          {ordered.map((check) => {
            const copy = readinessCopy(check.key);
            return (
              <li key={check.key} className="access-check">
                <span className={`overview-check__icon overview-check__icon--${check.ok ? "ok" : "warn"}`} aria-hidden="true">
                  <i className={`ti ti-${check.ok ? "check" : "alert-triangle"}`} />
                </span>
                <span className="overview-check__body">
                  <strong>
                    <span className="sr-only">{check.ok ? "Done: " : "To do: "}</span>
                    {copy.title}
                  </strong>
                  <span className="overview-check__detail">{check.ok ? copy.met : copy.missing}</span>
                  {!check.ok && <ReadinessRemedy eventId={eventId} remedy={copy.remedy} />}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </Card>
  );
}
