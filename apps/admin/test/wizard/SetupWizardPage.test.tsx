// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forwardRef, useEffect, useImperativeHandle } from "react";
import { SetupWizardPage } from "../../src/pages/SetupWizardPage.js";
import { renderWithToast } from "../test-utils.js";

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
  wizardMockState: { checksOk: true, hasExistingEvents: false },
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
      onCanContinueChange?.(true);
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
    }: {
      onComplete: () => Promise<void>;
      onGoToChecks: () => void;
    },
    ref,
  ) {
    useImperativeHandle(ref, () => ({ goToDashboard: () => readyGoToDashboard() }));
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

describe("SetupWizardPage continue labels", () => {
  it("shows Saving while the mail step is being persisted", async () => {
    sessionStorage.setItem(WIZARD_STEP_KEY, "2");
    let resolveSave: (value: boolean) => void = () => {};
    mailSaveAndContinue.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSave = resolve;
      }),
    );

    renderWizard();
    fireEvent.click(screen.getByRole("button", { name: "Save & Continue" }));

    expect(await screen.findByRole("button", { name: "Saving…" })).toBeTruthy();

    resolveSave(true);
    expect(await screen.findByText("Branding step")).toBeTruthy();
  });

  it("shows Creating while the first event is being created", async () => {
    sessionStorage.setItem(WIZARD_STEP_KEY, "4");
    let resolveCreate: (value: boolean) => void = () => {};
    eventCreateAndContinue.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    );

    renderWizard();
    await screen.findByText("Event step");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByRole("button", { name: "Creating…" })).toBeTruthy();

    resolveCreate(true);
    expect(await screen.findByText("Ready step")).toBeTruthy();
  });
});
