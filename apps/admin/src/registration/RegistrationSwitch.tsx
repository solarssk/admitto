import { useState } from "react";
import { Link } from "react-router";
import { Button, Skeleton, Switch, Tooltip, useToast } from "@admitto/ui";
import type { RegistrationMode } from "@admitto/db/status";
import { ApiError, fetchRegistrationSettings, saveRegistrationSettings } from "../api/client.js";
import { hasApiErrorCode, operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { RegistrationSettingsDto } from "../api/types.js";
import { ArchivedGuard } from "../components/ArchivedGuard.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { redirectToLogin } from "../identity/loginRedirect.js";
import { missingChecks } from "./accessSettings.js";
import { ProblemMessage, TurnOffConsequences } from "./AccessFormParts.js";
import type { AccessProblem } from "./useAccessForm.js";
import "./registration-access.css";

/** The mode registration starts in when it is turned on with the switch: every request waits for a decision. The Form card of Event settings changes it. */
export const MODE_ON_START: RegistrationMode = "approval";

const NO_LINK = "There is no link yet, because the address of this instance is not set. Ask a superadmin to set it up.";
const LINK_WHEN_OFF = "This link works once registration is on.";

export interface RegistrationSwitchState {
  /** The settings as the page last read or saved them; null until the first read. */
  settings: RegistrationSettingsDto | null;
  /** Registration is on. */
  on: boolean;
  /** A request of the switch is out. */
  busy: boolean;
  problem: AccessProblem | null;
  confirmOffOpen: boolean;
  /** Turn registration on (`MODE_ON_START`), or off with `null`, which asks first. */
  request: (mode: RegistrationMode | null) => void;
  confirmOff: () => void;
  cancelOff: () => void;
}

/**
 * One switch for registration, for the whole Registration page: the header and the Checklist tab both use it, so there is one state.
 * It saves `mode` alone, and what the server answers (the settings, with the checks) goes to `onSettings`, which is how the number on
 * the Checklist tab and the banner follow it. A refusal is a 409 `registration_not_ready` with the keys of the checks that are not
 * met; turning off asks first.
 */
export function useRegistrationSwitch({
  eventId,
  settings,
  onSettings,
  refreshEvent,
}: Readonly<{
  eventId: string | undefined;
  settings: RegistrationSettingsDto | null;
  onSettings: (settings: RegistrationSettingsDto) => void;
  refreshEvent?: () => Promise<unknown>;
}>): RegistrationSwitchState {
  const { addToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<AccessProblem | null>(null);
  const [confirmOffOpen, setConfirmOffOpen] = useState(false);

  /** What the screen shows is out of date (the event lost something, or was archived): read it again, quietly. */
  async function reread(id: string) {
    try {
      onSettings(await fetchRegistrationSettings(id));
    } catch {
      // What the page shows stays as it is, and so does the message that sent us here.
    }
  }

  function fail(id: string, err: unknown) {
    if (err instanceof ApiError && err.status === 401) {
      redirectToLogin();
      return;
    }
    if (hasApiErrorCode(err, "event_archived")) void refreshEvent?.();
    if (hasApiErrorCode(err, "registration_not_ready") || hasApiErrorCode(err, "event_archived")) void reread(id);
    // Only a 409 `registration_not_ready` carries `blockers`: the keys of the checks that are not met, which the screen words itself.
    const blockers = err instanceof ApiError ? err.blockers : undefined;
    if (blockers && blockers.length > 0) setProblem({ kind: "not_ready", blockers });
    else setProblem({ kind: "message", text: operatorApiErrorMessage(err, "Could not save the registration settings.") });
  }

  async function submit(mode: RegistrationMode | null) {
    if (busy || !eventId) return;
    setBusy(true);
    setProblem(null);
    try {
      const answer = await saveRegistrationSettings(eventId, { mode });
      addToast(mode === null ? "Registration is off." : "Registration is on.", "success");
      onSettings(answer);
      setConfirmOffOpen(false);
    } catch (err) {
      fail(eventId, err);
    } finally {
      setBusy(false);
    }
  }

  return {
    settings,
    on: settings?.mode != null,
    busy,
    problem,
    confirmOffOpen,
    request: (mode) => {
      if (mode === null) setConfirmOffOpen(true);
      else void submit(mode);
    },
    confirmOff: () => void submit(null),
    cancelOff: () => {
      setConfirmOffOpen(false);
      setProblem(null);
    },
  };
}

async function copyLink(link: string, addToast: ReturnType<typeof useToast>["addToast"]) {
  try {
    await navigator.clipboard.writeText(link);
    addToast("Link copied.", "success");
  } catch {
    addToast("Could not copy the link.", "error");
  }
}

/** The button that copies the link for guests: it works while registration is on, and says why it does not otherwise. */
function CopyLinkButton({ url, on }: Readonly<{ url: string | null; on: boolean }>) {
  const { addToast } = useToast();
  const reason = url === null ? NO_LINK : on ? undefined : LINK_WHEN_OFF;
  const button = (
    <Button type="button" variant="secondary" size="sm" icon={<i className="ti ti-copy" />} disabled={reason !== undefined} onClick={() => url !== null && void copyLink(url, addToast)}>
      Copy link
    </Button>
  );
  return <Tooltip content={reason}>{button}</Tooltip>;
}

/**
 * The header of the Registration page, on every tab: the switch "Registration" (On or Off) and the button that copies the link for
 * guests. While the event is not ready the switch is greyed, with the number of open steps in its tooltip and a link to the Checklist
 * tab; an archived event says it is archived. While the first read is on its way a grey pill holds the room, so the header does not jump.
 */
export function RegistrationSwitchControl({
  reg,
  eventId,
  archived,
  openSteps,
  onChecklist,
}: Readonly<{ reg: RegistrationSwitchState; eventId: string; archived: boolean; openSteps: number | undefined; onChecklist: boolean }>) {
  const { settings, on, busy } = reg;
  if (settings === null) {
    return (
      <div className="registration-switch" role="status" aria-label="Loading the registration switch">
        <Skeleton variant="rect" width={150} height={32} />
      </div>
    );
  }
  // A move between the two modes that are on is never refused, so only an event that has registration off needs to be ready.
  const missing = missingChecks(settings.readiness).length;
  const notReady = !on && missing > 0;
  const open = openSteps && openSteps > 0 ? openSteps : missing;
  const tooltip = `${open} ${open === 1 ? "step is" : "steps are"} open. See the Checklist.`;
  return (
    <div className="registration-switch">
      <span className="registration-switch__title">Registration</span>
      <ArchivedGuard event={{ archived_at: archived ? "archived" : null }} reasonId={`registration-switch-${eventId}`} disabled={notReady} tooltip={tooltip}>
        {(guard) => (
          <Switch
            label={on ? "On" : "Off"}
            aria-label="Registration"
            checked={on}
            {...guard}
            aria-disabled={busy || undefined}
            onChange={(event) => {
              if (!busy && !guard.disabled) reg.request(event.target.checked ? MODE_ON_START : null);
            }}
          />
        )}
      </ArchivedGuard>
      {notReady && !archived && !onChecklist && (
        <Link className="at-btn at-btn--ghost at-btn--sm" to={{ search: "?tab=checklist" }} replace>
          See the Checklist
        </Link>
      )}
      <CopyLinkButton url={settings.guest_url} on={on} />
    </div>
  );
}

/** What the switch says outside the header: the question before registration is turned off, and why a change did not happen. */
export function RegistrationSwitchOverlays({ reg, eventId, superadmin }: Readonly<{ reg: RegistrationSwitchState; eventId: string; superadmin: boolean }>) {
  const { problem, confirmOffOpen, busy } = reg;
  return (
    <>
      {problem && !confirmOffOpen && <ProblemMessage eventId={eventId} problem={problem} superadmin={superadmin} />}
      <ConfirmDialog
        open={confirmOffOpen}
        title="Turn off registration?"
        message="Guests can no longer open the form. This is what changes:"
        confirmLabel="Turn off registration"
        errorMessage={problem?.kind === "message" ? problem.text : null}
        loading={busy}
        onConfirm={reg.confirmOff}
        onCancel={reg.cancelOff}
      >
        <TurnOffConsequences />
      </ConfirmDialog>
    </>
  );
}
