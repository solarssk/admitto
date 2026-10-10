// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forwardRef, useEffect, useImperativeHandle } from "react";
import { SetupWizardPage } from "../../src/pages/SetupWizardPage.js";
import { deferred, isOff, renderWithToast } from "../test-utils.js";

const WIZARD_STEP_KEY = "admitto_wizard_step";
const WIZARD_UNSAVED_KEY = "admitto_wizard_unsaved_refresh";
const {
  brandingSaveAndContinue,
  eventCreateAndContinue,
  mailSaveAndContinue,
  readyGoToDashboard,
  wizardMockState,
} = vi.hoisted(() => ({
  brandingSaveAndContinue: vi.fn(),
  eventCreateAndContinue: vi.fn(),
  mailSaveAndContinue: vi.fn(),
  readyGoToDashboard: vi.fn(),
  wizardMockState: { checksOk: true, eventCanContinue: true, hasExistingEvents: false },
}));

vi.mock("../../src/pages/wizard/WizardStep1Checks.js", () => ({
  WizardStep1Checks: ({ onChecksOk }: { onChecksOk: (checksOk: boolean) => void }) => {
    useEffect(() => {
      onChecksOk(wizardMockState.checksOk);
    }, [onChecksOk]);
    return <div>System checks step</div>;
  },
}));

vi.mock("../../src/pages/wizard/WizardStep2Mail.js", () => ({
  WizardStep2Mail: forwardRef(function MockMail(
    { onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void },
    ref,
  ) {
    useImperativeHandle(ref, () => ({ saveAndContinue: () => mailSaveAndContinue() }));
    useEffect(() => {
      onDirtyChange?.(true);
    }, [onDirtyChange]);
    return <div>Mail step</div>;
  }),
}));

vi.mock("../../src/pages/wizard/WizardStep3Branding.js", () => ({
  WizardStep3Branding: forwardRef(function MockBranding(
    { onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void },
    ref,
  ) {
    useImperativeHandle(ref, () => ({ saveAndContinue: () => brandingSaveAndContinue() }));
    useEffect(() => {
      onDirtyChange?.(true);
    }, [onDirtyChange]);
    return <div>Branding step</div>;
  }),
}));

vi.mock("../../src/pages/wizard/WizardStep4Event.js", () => ({
  WizardStep4Event: forwardRef(function MockEvent(
    {
      onCanContinueChange,
      onDirtyChange,
      onHasExistingEventsChange,
    }: {
      onCanContinueChange?: (canContinue: boolean) => void;
      onDirtyChange?: (dirty: boolean) => void;
      onHasExistingEventsChange?: (hasExistingEvents: boolean) => void;
    },
    ref,
  ) {
    useImperativeHandle(ref, () => ({ createAndContinue: () => eventCreateAndContinue() }));
    useEffect(() => {
      onCanContinueChange?.(wizardMockState.eventCanContinue);
      onDirtyChange?.(true);
      onHasExistingEventsChange?.(wizardMockState.hasExistingEvents);
    }, [onCanContinueChange, onDirtyChange, onHasExistingEventsChange]);
    return <div>Event step</div>;
  }),
}));

vi.mock("../../src/pages/wizard/WizardStep5Ready.js", () => ({
  WizardStep5Ready: forwardRef(function MockReady(
    {
      onComplete,
      onGoToChecks,
      onSubmittingChange,
    }: {
      onComplete: () => Promise<void>;
      onGoToChecks: () => void;
      onSubmittingChange?: (submitting: boolean) => void;
    },
    ref,
  ) {
    useImperativeHandle(ref, () => ({
      goToDashboard: async () => {
        onSubmittingChange?.(true);
        try {
          await readyGoToDashboard();
        } finally {
          onSubmittingChange?.(false);
        }
      },
    }));
    return (
      <>
        <div>Ready step</div>
        <button type="button" onClick={onGoToChecks}>
          Review checks
        </button>
        <button type="button" onClick={() => void onComplete()}>
          Complete setup
        </button>
      </>
    );
  }),
}));

const onComplete = vi.fn().mockResolvedValue(undefined);

function renderWizard() {
  return renderWithToast(<SetupWizardPage onComplete={onComplete} />);
}

beforeEach(() => {
  sessionStorage.clear();
  brandingSaveAndContinue.mockResolvedValue(true);
  eventCreateAndContinue.mockResolvedValue(true);
  mailSaveAndContinue.mockResolvedValue(true);
  wizardMockState.checksOk = true;
  wizardMockState.eventCanContinue = true;
  wizardMockState.hasExistingEvents = false;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SetupWizardPage session restore", () => {
  it("restores the saved wizard step from sessionStorage", () => {
    sessionStorage.setItem(WIZARD_STEP_KEY, "3");
    renderWizard();
    expect(screen.getByText("Branding step")).toBeTruthy();
  });

  it("shows unsaved refresh notice when the pagehide flag was set", () => {
    sessionStorage.setItem(WIZARD_STEP_KEY, "2");
    sessionStorage.setItem(WIZARD_UNSAVED_KEY, "1");
    renderWizard();
    expect(screen.getByText(/Unsaved form changes were lost after refresh/)).toBeTruthy();
    expect(sessionStorage.getItem(WIZARD_UNSAVED_KEY)).toBeNull();
  });
});

describe("SetupWizardPage step region", () => {
  it.each([
    [1, "System check"],
    [2, "Mail transport"],
    [3, "Branding"],
    [4, "First event"],
    [5, "Ready"],
  ])("names the body of step %i %s, so that the focus a Retry hands over is announced", (step, name) => {
    sessionStorage.setItem(WIZARD_STEP_KEY, String(step));
    renderWizard();
    expect(screen.getByRole("region", { name })).toBeTruthy();
  });
});

describe("SetupWizardPage back navigation", () => {
  it("confirms before going back with unsaved changes on form steps", async () => {
    sessionStorage.setItem(WIZARD_STEP_KEY, "2");
    renderWizard();

    expect(screen.getByText("Mail step")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(screen.getByText("Discard unsaved changes?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));

    await waitFor(() => {
      expect(screen.getByText("System checks step")).toBeTruthy();
    });
  });

  it("goes back from the ready step without a discard dialog", async () => {
    sessionStorage.setItem(WIZARD_STEP_KEY, "5");
    renderWizard();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(screen.queryByText("Discard unsaved changes?")).toBeNull();
    await waitFor(() => {
      expect(screen.getByText("Event step")).toBeTruthy();
    });
  });
});

describe("SetupWizardPage step actions", () => {
  it("persists an unsaved form warning on pagehide and blocks browser unload", () => {
    sessionStorage.setItem(WIZARD_STEP_KEY, "2");
    renderWizard();

    fireEvent(window, new Event("pagehide"));
    expect(sessionStorage.getItem(WIZARD_UNSAVED_KEY)).toBe("1");

    const beforeUnload = new Event("beforeunload", { cancelable: true });
    expect(window.dispatchEvent(beforeUnload)).toBe(false);
  });

  it("advances from checks, then skips the optional mail and branding steps", async () => {
    renderWizard();

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("Mail step")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    expect(await screen.findByText("Branding step")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    expect(await screen.findByText("Event step")).toBeTruthy();

    await waitFor(() => {
      expect(JSON.parse(sessionStorage.getItem("admitto_wizard_context") ?? "{}")).toMatchObject({
        mailSkipped: true,
        brandingSkipped: true,
        summary: { mailLabel: "Skipped", brandingLabel: "Skipped" },
      });
    });
  });

  it("offers the event skip only when an existing event makes it safe", async () => {
    wizardMockState.hasExistingEvents = true;
    sessionStorage.setItem(WIZARD_STEP_KEY, "4");
    renderWizard();

    await screen.findByText("Event step");
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));

    expect(await screen.findByText("Ready step")).toBeTruthy();
  });

  it("does not offer the event skip when no existing event is available", async () => {
    sessionStorage.setItem(WIZARD_STEP_KEY, "4");
    renderWizard();

    await screen.findByText("Event step");
    expect(screen.queryByRole("button", { name: "Skip for now" })).toBeNull();
  });

  it("does not advance when the mail save reports failure", async () => {
    sessionStorage.setItem(WIZARD_STEP_KEY, "2");
    mailSaveAndContinue.mockResolvedValueOnce(false);
    renderWizard();

    fireEvent.click(screen.getByRole("button", { name: "Save & Continue" }));

    await waitFor(() => {
      expect(mailSaveAndContinue).toHaveBeenCalledOnce();
      expect(screen.getByText("Mail step")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Save & Continue" })).toBeTruthy();
    });
  });

  it("saves the branding step before advancing to the first-event step", async () => {
    sessionStorage.setItem(WIZARD_STEP_KEY, "3");
    renderWizard();

    fireEvent.click(screen.getByRole("button", { name: "Save & Continue" }));

    expect(await screen.findByText("Event step")).toBeTruthy();
    expect(brandingSaveAndContinue).toHaveBeenCalledOnce();
  });

  it("clears wizard session state when the ready step completes setup", async () => {
    sessionStorage.setItem(WIZARD_STEP_KEY, "5");
    sessionStorage.setItem(WIZARD_UNSAVED_KEY, "1");
    sessionStorage.setItem("admitto_wizard_context", "{}");
    renderWizard();

    fireEvent.click(await screen.findByRole("button", { name: "Complete setup" }));

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledOnce();
      expect(sessionStorage.getItem(WIZARD_STEP_KEY)).toBeNull();
      expect(sessionStorage.getItem(WIZARD_UNSAVED_KEY)).toBeNull();
      expect(sessionStorage.getItem("admitto_wizard_context")).toBeNull();
    });
  });

  it("delegates the ready-step dashboard action through its imperative handle", async () => {
    sessionStorage.setItem(WIZARD_STEP_KEY, "5");
    renderWizard();

    fireEvent.click(await screen.findByRole("button", { name: "Open dashboard" }));

    expect(readyGoToDashboard).toHaveBeenCalledOnce();
  });
});

describe("SetupWizardPage busy buttons", () => {
  it("shows Save & Continue busy on its own button, with its focus, keeps Back and Skip off meanwhile, and ignores a second press", async () => {
    sessionStorage.setItem(WIZARD_STEP_KEY, "2");
    const save = deferred<boolean>();
    mailSaveAndContinue.mockReturnValueOnce(save.promise);
    renderWizard();
    const continueButton = screen.getByRole("button", { name: "Save & Continue" });
    continueButton.focus();
    fireEvent.click(continueButton);

    expect(continueButton.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("button", { name: "Saving…" })).toBe(continueButton);
    expect(isOff(continueButton)).toBe(true);
    expect(document.activeElement).toBe(continueButton);
    expect((screen.getByRole("button", { name: "Back" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Skip for now" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Saving. Actions are paused until it finishes.")).toBeTruthy();
    fireEvent.click(continueButton);
    expect(mailSaveAndContinue).toHaveBeenCalledTimes(1);

    await act(async () => save.resolve(true));
    expect(screen.getByText("Branding step")).toBeTruthy();
    expect(continueButton.getAttribute("aria-busy")).toBeNull();
    expect(document.activeElement).toBe(continueButton);
    expect(screen.queryByText(/Actions are paused/)).toBeNull();
  });

  it("keeps Continue busy, with its name and its focus, while the first event is being created, and hands the same button on as Open dashboard", async () => {
    sessionStorage.setItem(WIZARD_STEP_KEY, "4");
    const create = deferred<boolean>();
    eventCreateAndContinue.mockReturnValueOnce(create.promise);
    renderWizard();
    await screen.findByText("Event step");
    const continueButton = screen.getByRole("button", { name: "Continue" });
    continueButton.focus();
    fireEvent.click(continueButton);

    expect(continueButton.getAttribute("aria-busy")).toBe("true");
    // No busy label: "Creating…" would be longer than "Continue" and make the button wider all the time.
    expect(screen.getByRole("button", { name: "Continue" })).toBe(continueButton);
    expect(document.activeElement).toBe(continueButton);
    expect(screen.getByText("Creating the event. Actions are paused until it finishes.")).toBeTruthy();

    await act(async () => create.resolve(true));
    expect(screen.getByText("Ready step")).toBeTruthy();
    // The footer is one for every step, so the button that held the focus is Open dashboard now and still holds it.
    expect(screen.getByRole("button", { name: "Open dashboard" })).toBe(continueButton);
    expect(document.activeElement).toBe(continueButton);
  });

  it("brings Continue back with its focus when the save does not go through, and stays on the step", async () => {
    sessionStorage.setItem(WIZARD_STEP_KEY, "3");
    const save = deferred<boolean>();
    brandingSaveAndContinue.mockReturnValueOnce(save.promise);
    renderWizard();
    const continueButton = screen.getByRole("button", { name: "Save & Continue" });
    continueButton.focus();
    fireEvent.click(continueButton);

    await act(async () => save.resolve(false));
    expect(screen.getByText("Branding step")).toBeTruthy();
    expect(continueButton.getAttribute("aria-busy")).toBeNull();
    expect(document.activeElement).toBe(continueButton);
  });

  it("keeps Continue focusable, off with aria-disabled and not disabled, while the checks have not passed", async () => {
    wizardMockState.checksOk = false;
    renderWizard();
    const continueButton = screen.getByRole("button", { name: "Continue" });

    expect(continueButton.getAttribute("aria-disabled")).toBe("true");
    expect((continueButton as HTMLButtonElement).disabled).toBe(false);
    continueButton.focus();
    expect(document.activeElement).toBe(continueButton);
    fireEvent.click(continueButton);
    expect(screen.getByText("System checks step")).toBeTruthy();
  });

  it("keeps the focus on Continue when it turns itself off because the next step is not ready", async () => {
    sessionStorage.setItem(WIZARD_STEP_KEY, "3");
    wizardMockState.eventCanContinue = false;
    renderWizard();
    const continueButton = screen.getByRole("button", { name: "Save & Continue" });
    continueButton.focus();
    fireEvent.click(continueButton);

    expect(await screen.findByText("Event step")).toBeTruthy();
    expect(continueButton.getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement).toBe(continueButton);
  });

  it("shows Open dashboard busy on its own button, with its focus, and keeps Back off while the setup is finished", async () => {
    sessionStorage.setItem(WIZARD_STEP_KEY, "5");
    const finishing = deferred<void>();
    readyGoToDashboard.mockReturnValueOnce(finishing.promise);
    renderWizard();
    const openDashboard = screen.getByRole("button", { name: "Open dashboard" });
    openDashboard.focus();
    fireEvent.click(openDashboard);

    expect(openDashboard.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("button", { name: "Finishing…" })).toBe(openDashboard);
    expect(document.activeElement).toBe(openDashboard);
    expect((screen.getByRole("button", { name: "Back" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Finishing setup. Actions are paused until it finishes.")).toBeTruthy();
    fireEvent.click(openDashboard);
    expect(readyGoToDashboard).toHaveBeenCalledTimes(1);

    await act(async () => finishing.resolve());
    expect(openDashboard.getAttribute("aria-busy")).toBeNull();
    expect(document.activeElement).toBe(openDashboard);
  });

  it("keeps the focus on Back when it moves the wizard from the last step to the one before", async () => {
    sessionStorage.setItem(WIZARD_STEP_KEY, "5");
    renderWizard();
    const back = screen.getByRole("button", { name: "Back" });
    back.focus();
    fireEvent.click(back);

    expect(screen.getByText("Event step")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Back" })).toBe(back);
    expect(document.activeElement).toBe(back);
  });
});
