import { useEffect } from "react";
import { useBlocker } from "react-router";
import { Notice } from "@admitto/ui";
import type { EventDto, LegalDocumentDto, RegistrationSettingsDto } from "../api/types.js";
import { isEventArchived } from "../components/ArchivedGuard.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { SettingsFooter } from "../settings/mailTransportFormParts.js";
import { missingChecks } from "./accessSettings.js";
import { AccessFormCard } from "./AccessFormCard.js";
import { AccessModeCard } from "./AccessModeCard.js";
import { AccessQuestionsCard } from "./AccessQuestionsCard.js";
import { AccessReadinessCard, MissingChecks } from "./AccessReadinessCard.js";
import { AccessWayInCard } from "./AccessWayInCard.js";
import { GuestLinkField } from "./GuestLinkField.js";
import { useAccessForm, type AccessProblem } from "./useAccessForm.js";
import "./registration-access.css";

/** Why the last save did not happen, at the buttons that made it: the checks that are not met, or a sentence. Not a toast. */
function ProblemMessage({ eventId, problem }: Readonly<{ eventId: string; problem: AccessProblem }>) {
  if (problem.kind === "message") {
    return (
      <Notice variant="error" role="alert">
        {problem.text}
      </Notice>
    );
  }
  return (
    <div role="alert" className="access-problem">
      <Notice variant="error">This change needs something that is not set up yet.</Notice>
      <MissingChecks eventId={eventId} keys={problem.blockers} />
    </div>
  );
}

/** The consequences of turning registration off, from the runbook of the abuse of the form (docs/security/INCIDENT-RESPONSE.md). */
function TurnOffConsequences() {
  return (
    <ul className="access-consequences">
      <li>The requests you already have stay. You can still accept, reject and delete them on the Requests tab.</li>
      <li>Confirmation links stop working. They work again if you turn registration on before they expire.</li>
      <li>Emails that are already queued are still sent.</li>
    </ul>
  );
}

/**
 * The Access tab once its first read is in: registration mode, the way in and its password, the switches of the form, the consents,
 * the checklist of what registration needs, and the link for guests. The page holds a draft, and Save sends what changed. A
 * navigation away with changes in the draft asks first, and so does turning registration off.
 */
export function RegistrationAccessForm({
  eventId,
  event,
  settings,
  legalItems,
  refreshEvent,
}: Readonly<{
  eventId: string;
  event: EventDto;
  settings: RegistrationSettingsDto;
  legalItems: readonly LegalDocumentDto[];
  refreshEvent?: () => Promise<unknown>;
}>) {
  const form = useAccessForm({ eventId, settings, legalItems, refreshEvent });
  const { server, draft, base, dirty, saving, problem, confirmOffOpen } = form;
  const archived = isEventArchived(event);
  const missing = missingChecks(server.readiness);
  // A move between the two modes that are on is never refused, so only an event that has registration off needs to be ready.
  const canTurnOn = server.mode !== null || missing.length === 0;

  // A change of the path or of `?tab=` leaves the form: with changes in it, the person is asked first.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search),
  );
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (browserEvent: BeforeUnloadEvent) => browserEvent.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  return (
    <div className="settings-sections at-fade-in">
      {server.mode !== null && missing.length > 0 && (
        <Notice variant="warning">Registration is on, but something it needs is missing, so guests may not be able to register. The checklist says what.</Notice>
      )}
      <AccessModeCard mode={draft.mode} canTurnOn={canTurnOn} unsaved={dirty} disabled={archived || saving} onChange={(mode) => form.edit({ mode })}>
        <GuestLinkField url={server.guest_url} registrationOn={server.mode !== null} />
      </AccessModeCard>
      <AccessReadinessCard eventId={eventId} checks={server.readiness} hideArchived={archived} unsaved={dirty} />
      <AccessWayInCard
        eventId={eventId}
        event={event}
        method={draft.method}
        savedMethod={base.method}
        passwordSet={server.password_set}
        disabled={archived || saving}
        onMethodChange={(method) => form.edit({ method })}
        onPasswordChanged={form.passwordChanged}
      />
      <AccessFormCard draft={draft} legalItems={form.legalItems} disabled={archived || saving} onChange={form.edit} />
      <AccessQuestionsCard fields={server.public_fields} />
      {problem && !confirmOffOpen && <ProblemMessage eventId={eventId} problem={problem} />}
      {!archived && <SettingsFooter hasUnsavedChanges={dirty} saving={saving} onReset={form.reset} onSave={form.save} />}
      <ConfirmDialog
        open={confirmOffOpen}
        title="Turn off registration?"
        message="Guests can no longer open the form. This is what changes:"
        confirmLabel="Turn off registration"
        errorMessage={problem?.kind === "message" ? problem.text : null}
        loading={saving}
        onConfirm={form.submit}
        onCancel={form.cancelTurnOff}
      >
        <TurnOffConsequences />
      </ConfirmDialog>
      <ConfirmDialog
        open={blocker.state === "blocked"}
        title="Discard unsaved changes?"
        message="You have unsaved changes to the registration settings."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        // The same while a save is out: the person stays, and the save finishes.
        onConfirm={() => (saving ? blocker.reset?.() : blocker.proceed?.())}
        onCancel={() => blocker.reset?.()}
      />
    </div>
  );
}
