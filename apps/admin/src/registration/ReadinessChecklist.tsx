import { Link } from "react-router";
import { Badge, Card, Notice } from "@admitto/ui";
import type { RegistrationMode } from "@admitto/db/status";
import type { RegistrationSettingsDto } from "../api/types.js";
import {
  OWN_ADDRESS_KEY,
  accessMethodDetail,
  actionLabel,
  botProtectionOffText,
  checklistBanner,
  formQuestionsText,
  readinessCopy,
  remedyFor,
  splitChecklist,
  type ChecklistCheck,
  type ReadinessCopy,
  type ReadinessLink,
} from "./accessReadiness.js";
import type { AccessMethod } from "./accessSettings.js";
import { leavesPage, linkTarget } from "./AccessReadinessCard.js";
import "./registration-access.css";

/** What the rows need to word themselves besides the check: the access method and its provider, the bot switch and the questions. */
interface RowContext {
  eventId: string;
  superadmin: boolean;
  method: AccessMethod | null;
  provider: RegistrationSettingsDto["sso_provider"];
  organisationBotProtection: "required" | "not_used";
  questionCount: number;
}

type RowTone = "open" | "done" | "info";

/** How a row looks: a warning for a step that is open, a tick for one that is done, a grey dash for information such as "Off". The word is for assistive tech. */
const ROW_LOOK = {
  open: { tone: "warn", icon: "alert-triangle", prefix: "To do: " },
  done: { tone: "ok", icon: "check", prefix: "Done: " },
  info: { tone: "neutral", icon: "minus", prefix: "Off: " },
} as const;

/** The sentence of a row: the words of its check for its state, and for a few rows what is set (the access method, the bot switch, the questions). */
function rowSentence(check: ChecklistCheck, copy: ReadinessCopy, context: RowContext): string {
  if (check.key === "form_questions" && check.ok) return formQuestionsText(context.questionCount);
  if (check.key === "access_method" && check.ok) return accessMethodDetail(context.method, context.provider);
  if (check.key === "bot_protection_not_used") return botProtectionOffText(context.organisationBotProtection);
  return check.ok ? copy.met : copy.missing;
}

/** Where the button of a row leads: an open step, to where it is put right. A row that is done has nothing to do and no button. */
function actionLink(tone: RowTone, copy: ReadinessCopy, superadmin: boolean): ReadinessLink | undefined {
  return tone === "open" ? remedyFor(copy, superadmin)?.link : undefined;
}

/** The one line a row says under its name: what it is, and for an open step that has nobody here to do it, who to ask, in the same line. */
function rowDetail(check: ChecklistCheck, tone: RowTone, copy: ReadinessCopy, context: RowContext): string {
  const remedy = tone === "open" ? remedyFor(copy, context.superadmin) : undefined;
  const ask = remedy && !remedy.link ? ` ${remedy.text}` : "";
  return `${rowSentence(check, copy, context)}${ask}`;
}

/** The button of a row, at its right: a secondary small button to where the step is put right (or, for the questions, changed). One look for every row, open or done. */
function RowAction({ check, copy, link, context }: Readonly<{ check: ChecklistCheck; copy: ReadinessCopy; link: ReadinessLink; context: RowContext }>) {
  const label = actionLabel(link);
  return (
    <Link
      className="at-btn at-btn--secondary at-btn--sm access-check__action"
      to={linkTarget(link, context.eventId)}
      replace={!leavesPage(link)}
      aria-label={`${label}: ${copy.title}`}
      data-step={check.key}
    >
      {label}
    </Link>
  );
}

function StepRow({ check, tone, context }: Readonly<{ check: ChecklistCheck; tone: RowTone; context: RowContext }>) {
  const copy = readinessCopy(check.key);
  const look = ROW_LOOK[tone];
  const link = actionLink(tone, copy, context.superadmin);
  // A step that only a superadmin can put right, for somebody who is not one: marked, and it says who to ask.
  const waits = tone === "open" && copy.superadminOnly === true && !context.superadmin;
  const icon = tone === "open" && check.key === OWN_ADDRESS_KEY ? "world-off" : look.icon;
  return (
    <li className="access-check access-check--step">
      <span className={`overview-check__icon overview-check__icon--${look.tone}`} aria-hidden="true">
        <i className={`ti ti-${icon}`} />
      </span>
      <span className="overview-check__body">
        <span className="access-check__title">
          <strong>
            <span className="sr-only">{look.prefix}</span>
            {copy.title}
          </strong>
          {waits && <Badge variant="neutral">Superadmin</Badge>}
        </span>
        <span className="overview-check__detail">{rowDetail(check, tone, copy, context)}</span>
      </span>
      {link && (
        <span className="access-check__aside">
          <RowAction check={check} copy={copy} link={link} context={context} />
        </span>
      )}
    </li>
  );
}

function StepList({ checks, tone, context }: Readonly<{ checks: readonly ChecklistCheck[]; tone: (check: ChecklistCheck) => RowTone; context: RowContext }>) {
  return (
    <ul className="access-checklist">
      {checks.map((check) => (
        <StepRow key={check.key} check={check} tone={tone(check)} context={context} />
      ))}
    </ul>
  );
}

const isOpen = (): RowTone => "open";
const doneTone = (check: ChecklistCheck): RowTone => (readinessCopy(check.key).info ? "info" : "done");

/** The card that says everything is in place, in words that depend on whether registration is on, or that what is left is a superadmin's. */
function NothingToDo({ everythingDone, mode }: Readonly<{ everythingDone: boolean; mode: RegistrationMode | null }>) {
  if (!everythingDone) {
    return (
      <div className="access-ready">
        <span className="access-ready__icon access-ready__icon--info" aria-hidden="true">
          <i className="ti ti-user-check" />
        </span>
        <strong className="access-ready__title">Your steps are done</strong>
        <p>What is left needs a superadmin. It is listed below.</p>
      </div>
    );
  }
  const on = mode !== null;
  return (
    <div className="access-ready">
      <span className="access-ready__icon" aria-hidden="true">
        <i className="ti ti-circle-check" />
      </span>
      <strong className="access-ready__title">{on ? "Everything is in place" : "Everything is ready"}</strong>
      <p>{on ? "Guests can register. Check this tab again when something changes, for example an address or a key." : "Every step is done. Turn registration on in Event settings, Registration, when you want guests to start."}</p>
    </div>
  );
}

/** The steps that are done: a collapsible card (`Card collapsible`, closed until its header is pressed) with how many there are as the pill at the right of its header, as in every header of this tab. */
function DoneCard({ checks, count, context }: Readonly<{ checks: readonly ChecklistCheck[]; count: number; context: RowContext }>) {
  return (
    <Card collapsible title="Done" meta={<Badge variant="ok">{count}</Badge>}>
      <StepList checks={checks} tone={doneTone} context={context} />
    </Card>
  );
}

/** The colour of the progress bar: green when nothing is open, red when registration is on and something is, yellow otherwise. */
function barTone(open: number, mode: RegistrationMode | null): "ok" | "warn" | "error" {
  if (open === 0) return "ok";
  return mode === null ? "warn" : "error";
}

/**
 * What registration needs, as one summary (the progress and a banner for the state) and cards by who does it: "For you" (what this
 * person can put right, with a button to where), "Waiting for a superadmin" (only for somebody who is not one: what only a superadmin
 * can put right, with who to ask) and "Done" (closed until it is opened). A superadmin has every open step under "For you". It stays when
 * registration is on: an address or a key can stop working later. An archived event has only the banner and the list of what is done.
 */
export function ReadinessChecklist({
  eventId,
  checks,
  superadmin,
  mode,
  archived,
  method,
  provider,
  organisationBotProtection,
  questionCount,
}: Readonly<
  RowContext & {
    checks: readonly ChecklistCheck[];
    mode: RegistrationMode | null;
    archived: boolean;
  }
>) {
  const { forYou, waiting, done, total } = splitChecklist(checks, superadmin);
  const context: RowContext = { eventId, superadmin, method, provider, organisationBotProtection, questionCount };
  const open = forYou.length + waiting.length;
  const doneCount = total - open;
  const addressStopped = [...forYou, ...waiting].some((check) => check.key === OWN_ADDRESS_KEY);
  const banner = checklistBanner({ mode, archived, forYou: forYou.length, waiting: waiting.length, addressStopped });
  const tone = barTone(open, mode);
  return (
    <>
      <Card title="Registration checklist" actions={<Badge variant={tone}>{doneCount} of {total} done</Badge>}>
        <div className="overview-setup">
          <progress className={`overview-setup__bar overview-setup__bar--${tone}`} aria-label="Checklist progress" max={total} value={doneCount} />
          <Notice
            variant={banner.variant}
            role={banner.variant === "error" ? "alert" : undefined}
            action={
              banner.goToSettings ? (
                <Link className="at-btn at-btn--primary at-btn--sm" to={linkTarget("registration_settings", eventId)}>
                  Go to Event settings
                </Link>
              ) : undefined
            }
          >
            {banner.text}
          </Notice>
        </div>
      </Card>
      {!archived && (
        <Card title="For you" actions={<Badge variant={forYou.length > 0 ? "warn" : "ok"}>{forYou.length > 0 ? `${forYou.length} to do` : "All done"}</Badge>}>
          {forYou.length > 0 ? <StepList checks={forYou} tone={isOpen} context={context} /> : <NothingToDo everythingDone={waiting.length === 0} mode={mode} />}
        </Card>
      )}
      {!archived && waiting.length > 0 && (
        <Card title="Waiting for a superadmin" actions={<Badge variant="neutral">{waiting.length} waiting</Badge>}>
          <div className="settings-card-stack">
            <p className="settings-card-intro">Only a superadmin can put these right. Ask one to do it.</p>
            <StepList checks={waiting} tone={isOpen} context={context} />
          </div>
        </Card>
      )}
      {done.length > 0 && <DoneCard checks={done} count={doneCount} context={context} />}
    </>
  );
}
