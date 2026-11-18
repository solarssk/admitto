import { useState } from "react";
import { useNavigate } from "react-router";
import { Badge, Button, Skeleton, Tooltip, useToast } from "@admitto/ui";
import type { RegistrationMode } from "@admitto/db/status";
import { ApiError, fetchRegistrationSettings, saveRegistrationSettings } from "../api/client.js";
import { hasApiErrorCode, operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { RegistrationSettingsDto } from "../api/types.js";
import { ARCHIVED_ACTION_TOOLTIP, ArchivedGuard } from "../components/ArchivedGuard.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { MoreActionsMenuItem } from "../components/MoreActionsMenuItem.js";
import { useDropdownMenu } from "../components/useDropdownMenu.js";
import { useIsDesktop } from "../hooks/useIsDesktop.js";
import { redirectToLogin } from "../identity/loginRedirect.js";
import { missingChecks } from "./accessSettings.js";
import { ProblemMessage, TURN_OFF_MESSAGE } from "./AccessFormParts.js";
import type { AccessProblem } from "./useAccessForm.js";
import "../attendees/attendees.css";
import "./registration-access.css";

/** The mode registration starts in when it is turned on with the switch: every request waits for a decision. The "Approve requests by hand" switch of Event settings changes it. */
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

/** What the header says about registration: the badge next to the title and the buttons follow it. */
export type RegistrationHeaderStatus = { kind: "loading" } | { kind: "open" } | { kind: "closed" } | { kind: "not_ready"; open: number };

/**
 * Open (registration is on), Closed (it is off and can be turned on), or Not ready (it is off and a check is not met). A move between the
 * two modes that are on is never refused, so only an event that has registration off needs to be ready. `openSteps` is the number the
 * Checklist tab shows; before it is known, the checks of the settings are counted.
 */
export function registrationHeaderStatus(reg: RegistrationSwitchState, openSteps: number | undefined): RegistrationHeaderStatus {
  const { settings, on } = reg;
  if (settings === null) return { kind: "loading" };
  if (on) return { kind: "open" };
  const missing = missingChecks(settings.readiness).length;
  if (missing === 0) return { kind: "closed" };
  return { kind: "not_ready", open: openSteps && openSteps > 0 ? openSteps : missing };
}

const stepsOpen = (open: number) => `${open} ${open === 1 ? "step is" : "steps are"} open. See the Checklist.`;

/** The state of registration, next to the title of the page. It says nothing while the first read is on its way. */
export function RegistrationStatusBadge({ status }: Readonly<{ status: RegistrationHeaderStatus }>) {
  if (status.kind === "loading") return null;
  let badge;
  if (status.kind === "open") badge = <Badge variant="ok" dot>Open</Badge>;
  else if (status.kind === "closed") badge = <Badge variant="neutral" dot>Closed</Badge>;
  else {
    badge = (
      <Badge variant="warn" dot>
        Not ready: {status.open} {status.open === 1 ? "step" : "steps"} open
      </Badge>
    );
  }
  return <span className="registration-status">{badge}</span>;
}

/** Why the link cannot be copied now, or undefined when it can. */
function copyLinkReason(url: string | null, on: boolean): string | undefined {
  if (url === null) return NO_LINK;
  return on ? undefined : LINK_WHEN_OFF;
}

/** The one button that matches the state: turn on (ready), copy the link (on), or go to the Checklist (not ready). */
function MainButton({
  status,
  reg,
  eventId,
  archived,
  onChecklist,
  isDesktop,
  onCopy,
  onGoToChecklist,
}: Readonly<{
  status: RegistrationHeaderStatus;
  reg: RegistrationSwitchState;
  eventId: string;
  archived: boolean;
  onChecklist: boolean;
  isDesktop: boolean;
  onCopy: () => void;
  onGoToChecklist: () => void;
}>) {
  const reason = copyLinkReason(reg.settings?.guest_url ?? null, reg.on);
  if (status.kind === "open") {
    return (
      <Tooltip content={reason}>
        <Button type="button" variant="primary" icon={<i className="ti ti-copy" />} disabled={reason !== undefined} onClick={onCopy}>
          Copy link
        </Button>
      </Tooltip>
    );
  }
  if (status.kind === "not_ready" && !onChecklist) {
    return (
      <Button type="button" variant="secondary" onClick={onGoToChecklist}>
        {isDesktop ? "See the Checklist" : "Checklist"}
      </Button>
    );
  }
  const notReady = status.kind === "not_ready";
  return (
    <ArchivedGuard event={{ archived_at: archived ? "archived" : null }} reasonId={`registration-on-${eventId}`} disabled={notReady} tooltip={notReady ? stepsOpen(status.open) : undefined}>
      {(guard) => (
        <Button type="button" variant={notReady ? "secondary" : "primary"} {...guard} loading={reg.busy} onClick={() => reg.request(MODE_ON_START)}>
          {isDesktop ? "Turn registration on" : "Turn on"}
        </Button>
      )}
    </ArchivedGuard>
  );
}

/** The items of "More actions" for each state. Opening the form and copying the link are for registration that is on; the others say why not. */
function MoreItems({
  status,
  reg,
  archived,
  onChecklist,
  close,
  onGoToChecklist,
}: Readonly<{
  status: RegistrationHeaderStatus;
  reg: RegistrationSwitchState;
  archived: boolean;
  onChecklist: boolean;
  close: () => void;
  onGoToChecklist: () => void;
}>) {
  const url = reg.settings?.guest_url ?? null;
  const reason = copyLinkReason(url, reg.on);
  const archivedTip = archived ? ARCHIVED_ACTION_TOOLTIP : undefined;
  const run = (action: () => void) => () => {
    close();
    action();
  };
  return (
    <>
      {status.kind === "open" && url !== null && (
        <MoreActionsMenuItem icon="external-link" label="Open the form" hint="In a new tab" onClick={run(() => window.open(url, "_blank", "noopener"))} />
      )}
      {status.kind === "open" && (
        <MoreActionsMenuItem icon="player-pause" label="Turn registration off" hint="Guests can no longer open the form" disabled={archived} tooltip={archivedTip} onClick={run(() => reg.request(null))} />
      )}
      {status.kind === "not_ready" && (
        <MoreActionsMenuItem icon="player-play" label="Turn registration on" hint="Finish the Checklist first" disabled tooltip={archivedTip ?? stepsOpen(status.open)} onClick={() => undefined} />
      )}
      {status.kind !== "open" && <MoreActionsMenuItem icon="copy" label="Copy link" hint="Works once registration is on" disabled tooltip={reason} onClick={() => undefined} />}
      {!onChecklist && (status.kind === "open" || status.kind === "closed") && (
        <MoreActionsMenuItem icon="list-check" label="See the Checklist" hint="What is set up and what is not" onClick={run(onGoToChecklist)} />
      )}
    </>
  );
}

/**
 * The buttons of the header of the Registration page, on every tab, in the shape of the Attendees header: one main button for the state
 * of registration (Turn registration on, Copy link, or See the Checklist) and a "More actions" menu with the rest. While the event is not
 * ready the way on is greyed in the menu, with the number of open steps; an archived event cannot be turned on or off. While the first
 * read is on its way a grey block holds the room, so the header does not jump. Below 768 px the labels are shorter, as on Attendees.
 */
export function RegistrationHeaderActions({
  reg,
  eventId,
  archived,
  status,
  onChecklist,
}: Readonly<{ reg: RegistrationSwitchState; eventId: string; archived: boolean; status: RegistrationHeaderStatus; onChecklist: boolean }>) {
  const isDesktop = useIsDesktop();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const { open, setOpen, panelStyle, rootRef, triggerRef, panelRef } = useDropdownMenu<HTMLButtonElement>({ align: "end" });
  if (status.kind === "loading") {
    return (
      <div className="registration-switch" role="status" aria-label="Loading the registration buttons">
        <Skeleton variant="rect" width={150} height={36} />
      </div>
    );
  }
  const url = reg.settings?.guest_url ?? null;
  const onCopy = () => url !== null && void copyLink(url, addToast);
  const onGoToChecklist = () => void navigate({ search: "?tab=checklist" }, { replace: true });
  return (
    <>
      <MainButton status={status} reg={reg} eventId={eventId} archived={archived} onChecklist={onChecklist} isDesktop={isDesktop} onCopy={onCopy} onGoToChecklist={onGoToChecklist} />
      <div className="more-actions-menu" ref={rootRef}>
        <Button ref={triggerRef} type="button" variant="secondary" hasMenu aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {isDesktop ? "More actions" : "More"}
        </Button>
        {open && (
          <div className="more-actions-menu__panel at-scroll" role="menu" ref={panelRef} style={panelStyle}>
            <MoreItems status={status} reg={reg} archived={archived} onChecklist={onChecklist} close={() => setOpen(false)} onGoToChecklist={onGoToChecklist} />
          </div>
        )}
      </div>
    </>
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
        message={TURN_OFF_MESSAGE}
        confirmLabel="Turn off registration"
        errorMessage={problem?.kind === "message" ? problem.text : null}
        loading={busy}
        onConfirm={reg.confirmOff}
        onCancel={reg.cancelOff}
      />
    </>
  );
}
