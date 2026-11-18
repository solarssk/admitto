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

/** The consequences of turning registration off, from the runbook of the abuse of the form (docs/security/INCIDENT-RESPONSE.md). */
export function TurnOffConsequences() {
  return (
    <ul className="access-consequences">
      <li>The requests you already have stay. You can still accept, reject and delete them on the Requests tab.</li>
      <li>Confirmation links stop working. They work again if you turn registration on before they expire.</li>
      <li>Emails that are already queued are still sent.</li>
    </ul>
  );
}
