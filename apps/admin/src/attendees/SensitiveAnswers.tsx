import { useEffect, useRef } from "react";
import { Button, Notice } from "@admitto/ui";
import { revealAttendeeSensitive, revealRegistrationSensitive } from "../api/client.js";
import type { SensitiveRevealDto } from "../api/types.js";
import { formatAnswerFor, type CustomDataFieldDef } from "./customData.js";
import { companionAnswers, guestAnswers, useSensitiveReveal } from "./useSensitiveReveal.js";
import "./sensitive-answers.css";

/** What the confirmation says before the first answer is shown (D-E6): what the audit log keeps of the click. */
export const REVEAL_CONFIRM_TEXT = "Showing sensitive answers is recorded in the audit log: who, when and which questions, never the answers.";

export interface SensitiveAnswersProps {
  /** The sensitive questions that are asked of this person, in the order of the form. */
  fields: readonly CustomDataFieldDef[];
  /** An administrator of the organization or a superadmin: the others see the questions, hidden, and no button. The server refuses them as well. */
  canReveal: boolean;
  /** Reads this person's answers, by the key of the question: it is the one request of "Show", and the audit entry is written by it. */
  load: () => Promise<Record<string, string>>;
  /** Names the person where the page has more than one ("guest", "companion"), so the buttons are told apart. */
  who?: string;
  /** The event's time zone, for a date and time answer. */
  timezone: string;
}

/** The answer to `field` among the answers "Show" returned, as a reader sees it; undefined when there is none (an empty one is none). */
function shownAnswer(field: CustomDataFieldDef, answers: Readonly<Record<string, string>>, timezone: string): string | undefined {
  const value = answerText(Object.hasOwn(answers, field.source_field) ? answers[field.source_field] : undefined);
  return value.trim() === "" ? undefined : formatAnswerFor(field, value, timezone);
}

/** The text of an answer as the server hands it back, which is the JSON as it is stored: a text, or the text of a number or a yes or no
 * should it ever be one; anything else is no answer, and never a failure of the screen. */
function answerText(raw: unknown): string {
  if (typeof raw === "string") return raw;
  return typeof raw === "number" || typeof raw === "boolean" ? String(raw) : "";
}

/** The value cell of one question: hidden until "Show" has answered, then the answer, or "No answer". */
function AnswerValue({ shown, value }: Readonly<{ shown: boolean; value: string | undefined }>) {
  if (!shown) {
    return (
      <span className="sensitive-answers__mask">
        <i className="ti ti-lock" aria-hidden="true" /> Hidden
      </span>
    );
  }
  return value === undefined ? <span className="sensitive-answers__none">No answer</span> : <span className="sensitive-answers__value">{value}</span>;
}

/**
 * The sensitive questions of one person with a mask for each answer, and one button for the person: the server hands back every sensitive
 * answer of the person at once and writes one audit entry for the click (D-E6). The button asks first, in place (a dialog would suspend the
 * focus trap of the window this sits in), and the answers are held only in the state of this component (`useSensitiveReveal`).
 */
export function SensitiveAnswers({ fields, canReveal, load, who, timezone }: Readonly<SensitiveAnswersProps>) {
  const reveal = useSensitiveReveal(load, canReveal);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { step } = reveal.state;
  const wasAsking = useRef(false);
  // The keyboard follows the control that took the place of the one pressed, in the effect that follows the render.
  useEffect(() => {
    if (step === "asking") confirmRef.current?.focus();
    else if (wasAsking.current) triggerRef.current?.focus();
    wasAsking.current = step === "asking";
  }, [step]);

  if (fields.length === 0) return null;
  const answers = reveal.state.step === "shown" ? reveal.state.answers : {};
  const named = who ? ` of ${who}` : "";
  const showing = step === "shown";
  return (
    <div className="sensitive-answers">
      <div className="sensitive-answers__head">
        <span className="sensitive-answers__title">
          <i className="ti ti-lock" aria-hidden="true" /> Sensitive answers
        </span>
        {canReveal && step !== "asking" ? (
          <Button
            ref={triggerRef}
            variant="secondary"
            size="sm"
            icon={<i className={`ti ${showing ? "ti-eye-off" : "ti-eye"}`} aria-hidden="true" />}
            loading={step === "loading"}
            aria-label={`${showing ? "Hide" : "Show"} sensitive answers${named}`}
            onClick={showing ? reveal.hide : reveal.ask}
          >
            {showing ? "Hide" : "Show"}
          </Button>
        ) : null}
      </div>
      {step === "asking" ? (
        <fieldset className="sensitive-answers__confirm">
          <legend className="sr-only">{`Show sensitive answers${named}?`}</legend>
          <p className="sensitive-answers__confirm-text">{REVEAL_CONFIRM_TEXT}</p>
          <div className="sensitive-answers__confirm-actions">
            <Button ref={confirmRef} size="sm" onClick={reveal.confirm}>
              Show
            </Button>
            <Button variant="ghost" size="sm" onClick={reveal.cancel}>
              Cancel
            </Button>
          </div>
        </fieldset>
      ) : null}
      {reveal.error ? (
        <Notice variant="error" role="alert">
          {reveal.error}
        </Notice>
      ) : null}
      <dl className="sensitive-answers__list">
        {fields.map((field) => (
          <div className="sensitive-answers__row" key={field.source_field}>
            <dt>{field.label}</dt>
            <dd>
              <AnswerValue shown={showing} value={shownAnswer(field, answers, timezone)} />
            </dd>
          </div>
        ))}
      </dl>
      <span className="sr-only" aria-live="polite">
        {reveal.hiddenNotice}
      </span>
    </div>
  );
}

/** The sensitive questions among `fields` (those the person is asked), in the order they are given. */
export function sensitiveQuestions(fields: readonly CustomDataFieldDef[]): CustomDataFieldDef[] {
  return fields.filter((field) => field.sensitive === true);
}

/** The part of the answer of "Show" that is this person's: the guest's, or the companion's of this slot. */
function personAnswers(slot: number | null): (dto: SensitiveRevealDto) => Record<string, string> {
  return slot === null ? guestAnswers : (dto) => companionAnswers(dto, slot);
}

export interface PersonSensitiveAnswersProps extends Omit<SensitiveAnswersProps, "load" | "fields"> {
  eventId: string;
  /** The questions about this person; the sensitive ones are drawn, and nothing at all when there are none. */
  questions: readonly CustomDataFieldDef[];
  /** The companion's place (1 in 0.8), or null for the guest's own answers. */
  slot: number | null;
}

/** "Show" for a person of an attendee. */
export function AttendeeSensitiveAnswers({ eventId, attendeeId, questions, slot, ...rest }: Readonly<PersonSensitiveAnswersProps & { attendeeId: string }>) {
  const pick = personAnswers(slot);
  return <SensitiveAnswers {...rest} fields={sensitiveQuestions(questions)} load={async () => pick(await revealAttendeeSensitive(eventId, attendeeId))} />;
}

/** "Show" for a person of a request: the guest, or the companion at `slot`. */
export function RequestSensitiveAnswers({ eventId, requestId, questions, slot, ...rest }: Readonly<PersonSensitiveAnswersProps & { requestId: string }>) {
  const pick = personAnswers(slot);
  return <SensitiveAnswers {...rest} fields={sensitiveQuestions(questions)} load={async () => pick(await revealRegistrationSensitive(eventId, requestId))} />;
}
