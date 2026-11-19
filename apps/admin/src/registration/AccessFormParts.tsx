import { Notice } from "@admitto/ui";
import { MissingChecks } from "./AccessReadinessCard.js";
import type { AccessProblem } from "./useAccessForm.js";
import "./registration-access.css";

/** Why the last save did not happen, at the buttons that made it: the checks that are not met, or a sentence. Not a toast. */
export function ProblemMessage({ eventId, problem, superadmin }: Readonly<{ eventId: string; problem: AccessProblem; superadmin: boolean }>) {
  if (problem.kind === "message") {
    return (
      <Notice variant="error" role="alert" className="access-balanced">
        {problem.text}
      </Notice>
    );
  }
  return (
    <div role="alert" className="access-problem">
      <Notice variant="error" className="access-balanced">
        This change needs something that is not set up yet.
      </Notice>
      <MissingChecks eventId={eventId} keys={problem.blockers} superadmin={superadmin} />
    </div>
  );
}

/** What turning registration off does, in the dialog that asks first (the runbook is docs/security/INCIDENT-RESPONSE.md). */
export const TURN_OFF_MESSAGE =
  "Guests can no longer open the form, and confirmation links stop working until you turn registration on again. Requests you already have stay on the Requests tab.";
