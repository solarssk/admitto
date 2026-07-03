// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forwardRef, useEffect } from "react";
import { SetupWizardPage } from "../../src/pages/SetupWizardPage.js";
import { renderWithToast } from "../test-utils.js";

const WIZARD_STEP_KEY = "admitto_wizard_step";
const WIZARD_UNSAVED_KEY = "admitto_wizard_unsaved_refresh";

vi.mock("../../src/pages/wizard/WizardStep1Checks.js", () => ({
  WizardStep1Checks: () => <div>System checks step</div>,
}));

vi.mock("../../src/pages/wizard/WizardStep2Mail.js", () => ({
  WizardStep2Mail: forwardRef(function MockMail(
    { onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void },
    _ref: unknown,
  ) {
    useEffect(() => {
      onDirtyChange?.(true);
    }, [onDirtyChange]);
    return <div>Mail step</div>;
  }),
}));

vi.mock("../../src/pages/wizard/WizardStep3Branding.js", () => ({
  WizardStep3Branding: forwardRef(function MockBranding(_props: unknown, _ref: unknown) {
    return <div>Branding step</div>;
  }),
}));

vi.mock("../../src/pages/wizard/WizardStep4Event.js", () => ({
  WizardStep4Event: forwardRef(function MockEvent(_props: unknown, _ref: unknown) {
    return <div>Event step</div>;
  }),
}));

vi.mock("../../src/pages/wizard/WizardStep5Ready.js", () => ({
  WizardStep5Ready: forwardRef(function MockReady(_props: unknown, _ref: unknown) {
    return <div>Ready step</div>;
  }),
}));

const onComplete = vi.fn().mockResolvedValue(undefined);

function renderWizard() {
  return renderWithToast(<SetupWizardPage onComplete={onComplete} />);
}

beforeEach(() => {
  sessionStorage.clear();
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
