import { Link } from "react-router";
import { readinessCopy, remedyFor, type ReadinessCopy, type ReadinessLink } from "./accessReadiness.js";
import { registrationTabPath } from "./registrationTabs.js";
import "./registration-access.css";

/** Where a link of a missing check goes: another tab of the Registration page, the settings of the event, or the settings of the organisation. */
export function linkTarget(link: ReadinessLink, eventId: string) {
  const settings = `/admin/events/${encodeURIComponent(eventId)}/settings`;
  switch (link) {
    case "event_settings":
      return settings;
    case "registration_settings":
      return `${settings}?tab=registration`;
    case "organisation_general":
      return "/admin/settings?tab=general";
    case "organisation_mail":
      return "/admin/settings?tab=mail";
    case "organisation_external":
      return "/admin/settings?tab=external";
    default:
      return registrationTabPath(eventId, link);
  }
}

/** Whether a link leaves this page: only the Legal and Fields tabs are on it. */
export const leavesPage = (link: ReadinessLink) => link !== "legal" && link !== "fields";

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
