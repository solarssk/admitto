import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Notice, type BadgeVariant } from "@admitto/ui";
import { planSuggestedFields } from "@admitto/shared";
import { addSuggestedEventCustomFields } from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { AddSuggestedFieldsResponse, EventCustomFieldDto } from "../api/types.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { confirmLabel, dialogMessage, limitMessage, suggestedRows, type SuggestedRowState } from "./suggestedQuestions.js";
import "./suggested-questions.css";

const STATE_BADGE: Record<SuggestedRowState, { variant: BadgeVariant; text: string }> = {
  add: { variant: "ok", text: "Will be added" },
  present: { variant: "neutral", text: "Already in your list" },
  blocked: { variant: "warn", text: "Not added" },
};

/** What the badge of a question says when the questions would not all fit: it is the one that would be added, not the one that will be. */
const WOULD_BE_ADDED = { variant: "info", text: "Would be added" } as const;

export interface SuggestedQuestionsDialogProps {
  readonly eventId: string;
  /** The fields the event has now: what the questions are added to, and which of them are there already. */
  readonly fields: readonly EventCustomFieldDto[];
  readonly onClose: () => void;
  /** The server answered: the questions it added, and those it left out. */
  readonly onAdded: (outcome: AddSuggestedFieldsResponse) => void;
}

/**
 * Lists the suggested questions (parking, travel, accommodation) before they are added to the event, and adds them when the organiser
 * confirms. It says first what will happen to each: it is added, the event has a field under that key already and it stays as it is, or
 * it cannot be added because the field it depends on is something else. The plan is the server's own rule (`planSuggestedFields`), so
 * what the window promises is what the request does. When the questions would not all fit in the event's limit of fields it says by how
 * much and offers no button: the server adds all or none. A refusal that comes back anyway (the list was out of date) is told in the
 * window, which stays open. Mounted only while it is open, so each opening starts clean.
 */
export function SuggestedQuestionsDialog({ eventId, fields, onClose, onAdded }: Readonly<SuggestedQuestionsDialogProps>) {
  const plan = useMemo(() => planSuggestedFields(fields), [fields]);
  const rows = useMemo(() => suggestedRows(plan, fields), [plan, fields]);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const tooMany = limitMessage(plan, fields.length);
  const cannotConfirm = plan.add.length === 0 || tooMany !== "";
  const badgeOf = (state: SuggestedRowState) => (state === "add" && tooMany !== "" ? WOULD_BE_ADDED : STATE_BADGE[state]);

  // On a screen too short for the whole window it scrolls (suggested-questions.css), and the browser has scrolled it to the button that took
  // the focus when it opened: start at the title instead, which is where a person starts reading.
  useEffect(() => {
    const panel = contentRef.current?.closest(".confirm-dialog__panel");
    if (panel) panel.scrollTop = 0;
  }, []);

  async function add() {
    if (adding || cannotConfirm) return;
    setAdding(true);
    setError(null);
    try {
      onAdded(await addSuggestedEventCustomFields(eventId));
    } catch (err) {
      setError(operatorApiErrorMessage(err, "Could not add the suggested questions."));
    } finally {
      setAdding(false);
    }
  }

  return (
    <ConfirmDialog
      open
      wide
      icon={<i className="ti ti-wand" aria-hidden="true" />}
      title="Add suggested questions"
      message={dialogMessage(plan)}
      confirmLabel={confirmLabel(plan.add.length)}
      cancelLabel={cannotConfirm ? "Close" : "Cancel"}
      loading={adding}
      disableConfirm={cannotConfirm}
      errorMessage={error}
      onConfirm={() => void add()}
      onCancel={onClose}
    >
      <div ref={contentRef} className="suggested-questions">
        <ul className="suggested-questions__list" aria-label="Suggested questions">
          {rows.map((row) => (
            <li key={row.key} className={`suggested-questions__row suggested-questions__row--${row.state}`}>
              <div className="suggested-questions__text">
                <span className="suggested-questions__title">{row.label}</span>
                <span className="suggested-questions__meta">{row.meta}</span>
                {row.note !== "" && <span className="suggested-questions__note">{row.note}</span>}
              </div>
              <Badge variant={badgeOf(row.state).variant}>{badgeOf(row.state).text}</Badge>
            </li>
          ))}
        </ul>
        {tooMany !== "" && <Notice variant="warning">{tooMany}</Notice>}
      </div>
    </ConfirmDialog>
  );
}
