import { useEffect } from "react";
import { Link, useBlocker } from "react-router";
import { Notice } from "@admitto/ui";
import { useOptionalAuth } from "../auth/AuthProvider.js";
import { isSuperadmin } from "../auth/capabilities.js";
import type { EventDto, LegalDocumentDto, RegistrationSettingsDto } from "../api/types.js";
import { isEventArchived } from "../components/ArchivedGuard.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { SettingsFooter } from "../settings/mailTransportFormParts.js";
import { checklistFromSettings, type ChecklistCheck } from "./accessReadiness.js";
import { missingChecks } from "./accessSettings.js";
import { AccessFormCard } from "./AccessFormCard.js";
import { AccessModeCard } from "./AccessModeCard.js";
import { MissingChecks } from "./AccessReadinessCard.js";
import { GuestLinkField } from "./GuestLinkField.js";
import { hasStopped, stoppedWarning } from "./ownAddress.js";
import { useAccessForm, type AccessProblem } from "./useAccessForm.js";
import "./registration-access.css";

/** Why the last save did not happen, at the buttons that made it: the checks that are not met, or a sentence. Not a toast. */
function ProblemMessage({ eventId, problem, superadmin }: Readonly<{ eventId: string; problem: AccessProblem; superadmin: boolean }>) {
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
 * The Access tab once its first read is in: registration mode, the link for guests, the switches of the form and the consents. What
 * registration needs is the Checklist tab's, and this tab only points to it. The page holds a draft, and Save sends what changed. A
 * navigation away with changes in the draft asks first, and so does turning registration off.
 */
export function RegistrationAccessForm({
  eventId,
  event,
  settings,
  legalItems,
  refreshEvent,
  onReadiness,
}: Readonly<{
  eventId: string;
  event: EventDto;
  settings: RegistrationSettingsDto;
  legalItems: readonly LegalDocumentDto[];
  refreshEvent?: () => Promise<unknown>;
  /** Told what the checklist is now, so that the number on the Checklist tab follows a save. */
  onReadiness?: (readiness: ChecklistCheck[]) => void;
}>) {
  const form = useAccessForm({ eventId, settings, legalItems, refreshEvent });
  const { server, draft, dirty, saving, problem, confirmOffOpen } = form;
  const archived = isEventArchived(event);
  const missing = missingChecks(server.readiness);
  // A move between the two modes that are on is never refused, so only an event that has registration off needs to be ready.
  const canTurnOn = server.mode !== null || missing.length === 0;
  const superadmin = isSuperadmin(useOptionalAuth()?.assignments ?? []);
  useEffect(() => onReadiness?.(checklistFromSettings(server)), [server, onReadiness]);

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
        <Notice variant="warning">
          Registration is on, but something it needs is missing, so guests may not be able to register.{" "}
          <Link className="access-text-link" to={{ search: "?tab=checklist" }} replace>
            The Checklist tab says what.
          </Link>
        </Notice>
      )}
      {hasStopped(server.own_address) && <Notice variant="warning">{stoppedWarning(server.own_address)}</Notice>}
      <AccessModeCard mode={draft.mode} canTurnOn={canTurnOn} unsaved={dirty} disabled={archived || saving} onChange={(mode) => form.edit({ mode })}>
        <GuestLinkField url={server.guest_url} registrationOn={server.mode !== null} />
      </AccessModeCard>
      <AccessFormCard draft={draft} legalItems={form.legalItems} disabled={archived || saving} onChange={form.edit} />
      {problem && !confirmOffOpen && <ProblemMessage eventId={eventId} problem={problem} superadmin={superadmin} />}
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
