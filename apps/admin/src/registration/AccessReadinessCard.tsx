import { Link } from "react-router";
import { Card } from "@admitto/ui";
import type { RegistrationReadinessCheckDto, RegistrationSettingsDto } from "../api/types.js";
import type { AccessMethod } from "./accessSettings.js";
import { ACCESS_METHOD_SET_BY, accessMethodDetail, botProtectionOffText, readinessCopy, remedyFor, splitChecklist, type ReadinessCopy, type ReadinessLink } from "./accessReadiness.js";
import "./registration-access.css";

/** Where a link of a missing check goes: another tab of this page (the address keeps its path), the settings of the event, or the settings of the organisation. */
function linkTarget(link: ReadinessLink, eventId: string) {
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
      return { search: `?tab=${link}` };
  }
}

/** Whether a link leaves this page: only the Legal and Fields tabs are on it. */
const leavesPage = (link: ReadinessLink) => link !== "legal" && link !== "fields";

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

/** What the row "Access method" says that is met: what is set, then who sets it. Static: the choice is made in Event settings. */
interface AccessMethodState {
  method: AccessMethod | null;
  provider: RegistrationSettingsDto["sso_provider"];
}

/** The sentence of a row: what the access method is, for that row when it is met; else the words of the check for its state. */
function rowSentence(check: RegistrationReadinessCheckDto, copy: ReadinessCopy, accessMethod: AccessMethodState | null, organisationBotProtection: "required" | "not_used"): string {
  if (accessMethod !== null) return accessMethodDetail(accessMethod.method, accessMethod.provider);
  if (check.key === "bot_protection_not_used") return botProtectionOffText(organisationBotProtection);
  return check.ok ? copy.met : copy.missing;
}

function ReadinessRow({
  eventId,
  check,
  superadmin,
  accessMethod,
  organisationBotProtection,
}: Readonly<{
  eventId: string;
  check: RegistrationReadinessCheckDto;
  superadmin: boolean;
  accessMethod: AccessMethodState;
  organisationBotProtection: "required" | "not_used";
}>) {
  const states = check.key === "access_method" && check.ok;
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
        <span className="overview-check__detail">{rowSentence(check, copy, states ? accessMethod : null, organisationBotProtection)}</span>
        {states && <span className="overview-check__detail">{ACCESS_METHOD_SET_BY}</span>}
        {!check.ok && <ReadinessRemedy eventId={eventId} remedy={remedyFor(copy, superadmin)} />}
      </span>
    </li>
  );
}

/** The rows of one card of the checklist. */
function ChecklistRows({
  eventId,
  checks,
  superadmin,
  accessMethod,
  organisationBotProtection,
}: Readonly<{
  eventId: string;
  checks: readonly RegistrationReadinessCheckDto[];
  superadmin: boolean;
  accessMethod: AccessMethodState;
  organisationBotProtection: "required" | "not_used";
}>) {
  return (
    <ul className="access-checklist">
      {checks.map((check) => (
        <ReadinessRow key={check.key} eventId={eventId} check={check} superadmin={superadmin} accessMethod={accessMethod} organisationBotProtection={organisationBotProtection} />
      ))}
    </ul>
  );
}

/**
 * What registration needs, one row for each check the server reports, in cards by who does it: "For you" (what this person can put
 * right, a link to where), "Waiting for a superadmin" (only for somebody who is not one: what only a superadmin can put right, with
 * who to ask) and "Done" (what is met, and the information rows). A superadmin has every open step under "For you". The checklist stays
 * when registration is on: an address or a key can stop working later.
 */
export function ReadinessChecklist({
  eventId,
  checks,
  superadmin,
  method,
  provider,
  organisationBotProtection,
}: Readonly<{
  /** What the organisation's switch says: the row about the bot check tells who turned it off. */
  organisationBotProtection: "required" | "not_used";
  /** The access method the event has, and its identity provider: the row "Access method" says them, to read. */
  method: AccessMethod | null;
  provider: RegistrationSettingsDto["sso_provider"];
  eventId: string;
  /** A superadmin is sent to the settings that put a check right, anybody else is told to ask. */
  superadmin: boolean;
  checks: readonly RegistrationReadinessCheckDto[];
}>) {
  const { forYou, waiting, done, total } = splitChecklist(checks, superadmin);
  const rows = { eventId, superadmin, accessMethod: { method, provider }, organisationBotProtection };
  return (
    <>
      <Card title="For you" actions={<span className="overview-readiness-score">{forYou.length === 0 ? "Nothing to do" : `${forYou.length} to do`}</span>}>
        {forYou.length === 0 ? (
          <p className="settings-card-intro">There is nothing for you to do right now.</p>
        ) : (
          <ChecklistRows checks={forYou} {...rows} />
        )}
      </Card>
      {waiting.length > 0 && (
        <Card title="Waiting for a superadmin" actions={<span className="overview-readiness-score">{waiting.length} to do</span>}>
          <div className="settings-card-stack">
            <p className="settings-card-intro">Only a superadmin can put these right. Ask one to do it.</p>
            <ChecklistRows checks={waiting} {...rows} />
          </div>
        </Card>
      )}
      {done.length > 0 && (
        <Card title="Done" actions={<span className="overview-readiness-score">{total - forYou.length - waiting.length} of {total} done</span>}>
          <ChecklistRows checks={done} {...rows} />
        </Card>
      )}
    </>
  );
}
