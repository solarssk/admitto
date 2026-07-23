import { Fragment, useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Button } from "@admitto/ui";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { BrandMark } from "../layouts/BrandMark.js";
import {
  WizardProvider,
  useWizard,
  WIZARD_CONTEXT_STORAGE_KEY,
  type WizardSummary,
} from "./wizard/WizardContext.js";
import { WizardStep1Checks } from "./wizard/WizardStep1Checks.js";
import { WizardStep2Mail, type WizardStep2MailHandle } from "./wizard/WizardStep2Mail.js";
import { WizardStep3Branding, type WizardStep3BrandingHandle } from "./wizard/WizardStep3Branding.js";
import { WizardStep4Event, type WizardStep4EventHandle } from "./wizard/WizardStep4Event.js";
import { WizardStep5Ready, type WizardStep5ReadyHandle } from "./wizard/WizardStep5Ready.js";
import "./setup-wizard.css";

const WIZARD_STEP_KEY = "admitto_wizard_step";
const WIZARD_UNSAVED_KEY = "admitto_wizard_unsaved_refresh";
const TOTAL_STEPS = 5;

function readSavedWizardStep(): number {
  try {
    const raw = sessionStorage.getItem(WIZARD_STEP_KEY);
    const n = raw ? Number.parseInt(raw, 10) : 1;
    return Number.isFinite(n) && n >= 1 && n <= TOTAL_STEPS ? n : 1;
  } catch {
    return 1;
  }
}

function clearWizardSession(): void {
  try {
    sessionStorage.removeItem(WIZARD_STEP_KEY);
    sessionStorage.removeItem(WIZARD_UNSAVED_KEY);
    sessionStorage.removeItem(WIZARD_CONTEXT_STORAGE_KEY);
  } catch {
    /* storage blocked */
  }
}

function readUnsavedRefreshFlag(): boolean {
  try {
    return sessionStorage.getItem(WIZARD_UNSAVED_KEY) === "1";
  } catch {
    return false;
  }
}

function clearUnsavedRefreshFlag(): void {
  try {
    sessionStorage.removeItem(WIZARD_UNSAVED_KEY);
  } catch {
    /* storage blocked */
  }
}

function persistWizardStep(step: number): void {
  try {
    sessionStorage.setItem(WIZARD_STEP_KEY, String(step));
  } catch {
    /* storage blocked */
  }
}

function markUnsavedRefreshFlag(): void {
  try {
    sessionStorage.setItem(WIZARD_UNSAVED_KEY, "1");
  } catch {
    /* storage blocked */
  }
}

const STEP_NAMES = ["System", "Mail", "Brand", "Event", "Ready"] as const;

const STEP_LABELS: Record<(typeof STEP_NAMES)[number], string> = {
  System: "System check",
  Mail: "Mail transport",
  Brand: "Branding",
  Event: "First event",
  Ready: "Ready",
};

/**
 * Applies the saved wizard step (marking prior steps complete) and consumes the
 * unsaved-refresh flag from a previous session. Returns whether the notice should show.
 */
function initializeWizardFromSession(markStepComplete: (step: number) => void): boolean {
  const saved = readSavedWizardStep();
  for (let i = 1; i < saved; i++) markStepComplete(i);
  const hadUnsavedRefresh = readUnsavedRefreshFlag();
  if (hadUnsavedRefresh) clearUnsavedRefreshFlag();
  return hadUnsavedRefresh;
}

function createMarkUnsavedRefreshHandler(dirty: boolean): () => void {
  return () => {
    if (dirty) markUnsavedRefreshFlag();
  };
}

function createBeforeUnloadHandler(dirty: boolean): (e: BeforeUnloadEvent) => void {
  return (e) => {
    if (dirty) {
      e.preventDefault();
    }
  };
}

function backNeedsConfirm(step: number, dirty: boolean): boolean {
  return dirty && step >= 2 && step <= 4;
}

type SkipHandlers = {
  setMailSkipped: (skipped: boolean) => void;
  setBrandingSkipped: (skipped: boolean) => void;
  setSummary: (patch: Partial<WizardSummary>) => void;
  goNext: (fromStep: number) => void;
};

function runStepSkip(step: number, hasExistingEvents: boolean, handlers: SkipHandlers): void {
  switch (step) {
    case 2:
      handlers.setMailSkipped(true);
      handlers.setSummary({ mailLabel: "Skipped" });
      handlers.goNext(2);
      break;
    case 3:
      handlers.setBrandingSkipped(true);
      handlers.setSummary({ brandingLabel: "Skipped" });
      handlers.goNext(3);
      break;
    case 4:
      if (hasExistingEvents) handlers.goNext(4);
      break;
    default:
      break;
  }
}

/** Runs the save/create action for the current step and reports whether it succeeded. */
async function runContinueStep(
  step: number,
  checksOk: boolean,
  mailRef: RefObject<WizardStep2MailHandle | null>,
  brandingRef: RefObject<WizardStep3BrandingHandle | null>,
  eventRef: RefObject<WizardStep4EventHandle | null>,
): Promise<boolean> {
  switch (step) {
    case 1:
      return checksOk;
    case 2:
      return Boolean(await mailRef.current?.saveAndContinue());
    case 3:
      return Boolean(await brandingRef.current?.saveAndContinue());
    case 4:
      return Boolean(await eventRef.current?.createAndContinue());
    default:
      return false;
  }
}

function getContinueLabel(step: number, continuing: boolean): string {
  if (step === 2 || step === 3) return continuing ? "Saving…" : "Save & Continue";
  if (step === 4) return continuing ? "Creating…" : "Continue";
  return "Continue";
}

type StepDotState = { isActive: boolean; isComplete: boolean; state: "active" | "done" | "pending" };

/** Computes the active/complete/pending state for one step dot in the progress nav. */
function getStepDotState(
  step: number,
  stepNum: number,
  completedSteps: Set<number>,
): StepDotState {
  const isOnReady = step === TOTAL_STEPS;
  const isActive = step === stepNum && !isOnReady;
  const isComplete =
    step > stepNum ||
    (completedSteps.has(stepNum) && !isActive) ||
    (isOnReady && stepNum === TOTAL_STEPS);
  const completionState: StepDotState["state"] = isComplete ? "done" : "pending";
  const state: StepDotState["state"] = isActive ? "active" : completionState;
  return { isActive, isComplete, state };
}

type SetupWizardPageProps = {
  onComplete: () => Promise<void>;
};

export function SetupWizardPage({ onComplete }: Readonly<SetupWizardPageProps>) {
  return (
    <WizardProvider>
      <SetupWizardContent onComplete={onComplete} />
    </WizardProvider>
  );
}

function SetupWizardContent({ onComplete }: Readonly<SetupWizardPageProps>) {
  const {
    completedSteps,
    markStepComplete,
    setMailSkipped,
    setBrandingSkipped,
    setSummary,
  } = useWizard();
  const [step, setStep] = useState(() => readSavedWizardStep());
  const [checksOk, setChecksOk] = useState(false);
  const [eventCanContinue, setEventCanContinue] = useState(false);
  const [hasExistingEvents, setHasExistingEvents] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [unsavedRefreshNotice, setUnsavedRefreshNotice] = useState(false);
  const [backConfirmOpen, setBackConfirmOpen] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const [finishing, setFinishing] = useState(false);

  const mailRef = useRef<WizardStep2MailHandle>(null);
  const brandingRef = useRef<WizardStep3BrandingHandle>(null);
  const eventRef = useRef<WizardStep4EventHandle>(null);
  const readyRef = useRef<WizardStep5ReadyHandle>(null);

  useEffect(() => {
    if (initializeWizardFromSession(markStepComplete)) {
      setUnsavedRefreshNotice(true);
    }
  }, [markStepComplete]);

  useEffect(() => {
    persistWizardStep(step);
  }, [step]);

  useEffect(() => {
    const markUnsavedRefresh = createMarkUnsavedRefreshHandler(dirty);
    const handleBeforeUnload = createBeforeUnloadHandler(dirty);
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pagehide", markUnsavedRefresh);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("pagehide", markUnsavedRefresh);
    };
  }, [dirty]);

  const goNext = useCallback(
    (fromStep: number) => {
      markStepComplete(fromStep);
      setDirty(false);
      setStep((s) => Math.min(TOTAL_STEPS, s + 1));
    },
    [markStepComplete],
  );

  const goToChecks = useCallback(() => {
    setStep(1);
  }, []);

  const navigateBack = useCallback(() => {
    setDirty(false);
    setStep((s) => s - 1);
  }, []);

  const handleBack = () => {
    if (step <= 1) return;
    if (backNeedsConfirm(step, dirty)) {
      setBackConfirmOpen(true);
      return;
    }
    navigateBack();
  };

  const handleSkip = () => {
    runStepSkip(step, hasExistingEvents, { setMailSkipped, setBrandingSkipped, setSummary, goNext });
  };

  const handleContinue = async () => {
    if (continuing) return;
    setContinuing(true);
    try {
      const ok = await runContinueStep(step, checksOk, mailRef, brandingRef, eventRef);
      if (ok) goNext(step);
    } finally {
      setContinuing(false);
    }
  };

  const showSkip = step === 2 || step === 3 || (step === 4 && hasExistingEvents);
  const showBack = step > 1 && step < TOTAL_STEPS;
  const continueDisabled =
    continuing ||
    (step === 1 && !checksOk) ||
    (step === 4 && !eventCanContinue && !hasExistingEvents);

  const continueLabel = getContinueLabel(step, continuing);

  const showContinueArrow = !continuing && step < TOTAL_STEPS;

  return (
    <div className="setup-wizard">
      <main className="setup-wizard__shell">
        <header className="setup-wizard__header">
          <span className="setup-wizard__brand" aria-label="Admitto">
            <BrandMark className="setup-wizard__brand-mark" />
            Admitto
          </span>
          <h1 className="setup-wizard__title">Set up your instance</h1>
          <p className="setup-wizard__subtitle">
            Complete a few steps to get Admitto ready for your first event.
          </p>
        </header>

        <nav className="setup-wizard__steps" aria-label="Setup progress">
          {STEP_NAMES.map((name, index) => {
            const stepNum = index + 1;
            const { isActive, isComplete, state } = getStepDotState(step, stepNum, completedSteps);
            return (
              <Fragment key={name}>
                <div
                  className={`setup-wizard__step setup-wizard__step--${state}`}
                  aria-current={isActive ? "step" : undefined}
                >
                  <span className="setup-wizard__step-dot" aria-hidden="true">
                    {!isActive && isComplete ? (
                      <i className="ti ti-check" />
                    ) : (
                      <span>{stepNum}</span>
                    )}
                  </span>
                  <span className="setup-wizard__step-label">
                    {STEP_LABELS[name]}
                    {isComplete && !isActive ? (
                      <span className="setup-wizard__sr-only"> — completed</span>
                    ) : null}
                  </span>
                </div>
                {index < STEP_NAMES.length - 1 ? (
                  <div
                    className={`setup-wizard__step-line${step > stepNum ? " setup-wizard__step-line--done" : ""}`}
                    aria-hidden="true"
                  />
                ) : null}
              </Fragment>
            );
          })}
        </nav>

        <div className={`setup-wizard__body${step === TOTAL_STEPS ? " setup-wizard__body--done" : ""}`}>
          {unsavedRefreshNotice && (
            <p className="setup-wizard__refresh-notice" role="status">
              Unsaved form changes were lost after refresh. Settings you already saved (mail, branding)
              are still kept — continue from here.
            </p>
          )}

          {step === 1 && <WizardStep1Checks onChecksOk={setChecksOk} />}
          {step === 2 && <WizardStep2Mail ref={mailRef} onDirtyChange={setDirty} />}
          {step === 3 && <WizardStep3Branding ref={brandingRef} onDirtyChange={setDirty} />}
          {step === 4 && (
            <WizardStep4Event
              ref={eventRef}
              onCanContinueChange={setEventCanContinue}
              onHasExistingEventsChange={setHasExistingEvents}
              onDirtyChange={setDirty}
            />
          )}
          {step === 5 && (
            <WizardStep5Ready
              ref={readyRef}
              onGoToChecks={goToChecks}
              onSubmittingChange={setFinishing}
              onComplete={async () => {
                clearWizardSession();
                await onComplete();
              }}
            />
          )}
        </div>

        {step === TOTAL_STEPS ? (
          <footer className="setup-wizard__footer setup-wizard__footer--done">
            <Button type="button" variant="secondary" onClick={handleBack}>
              Back
            </Button>
            <div className="setup-wizard__footer-spacer" />
            <Button
              type="button"
              variant="primary"
              disabled={finishing}
              icon={<i className="ti ti-layout-dashboard" aria-hidden="true" />}
              onClick={() => void readyRef.current?.goToDashboard()}
            >
              {finishing ? "Finishing…" : "Open dashboard"}
            </Button>
          </footer>
        ) : (
          <footer className="setup-wizard__footer">
            {showBack ? (
              <Button type="button" variant="secondary" onClick={handleBack}>
                Back
              </Button>
            ) : (
              <span />
            )}
            <div className="setup-wizard__footer-spacer" />
            {showSkip && (
              <Button type="button" variant="ghost" disabled={continuing} onClick={handleSkip}>
                Skip for now
              </Button>
            )}
            <Button
              type="button"
              variant="primary"
              disabled={continueDisabled}
              iconRight={
                showContinueArrow ? <i className="ti ti-arrow-right" aria-hidden="true" /> : undefined
              }
              onClick={() => void handleContinue()}
            >
              {continueLabel}
            </Button>
          </footer>
        )}
      </main>

      <ConfirmDialog
        open={backConfirmOpen}
        title="Discard unsaved changes?"
        message="Going back will discard unsaved form changes on this step."
        confirmLabel="Go back"
        cancelLabel="Stay"
        onConfirm={() => {
          setBackConfirmOpen(false);
          navigateBack();
        }}
        onCancel={() => setBackConfirmOpen(false)}
      />
    </div>
  );
}
