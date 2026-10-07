// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/api/client.js";
import { WizardStep1Checks } from "../../src/pages/wizard/WizardStep1Checks.js";
import { LOAD_TIMEOUT_MESSAGE, SLOW_NOTICE_TEXT } from "../../src/utils/loading-timing.js";
import { advanceTimers, deferred, hangUntilAborted, isOff, renderWithToast } from "../test-utils.js";

const fetchSetupChecks = vi.fn();
const onChecksOk = vi.fn();

vi.mock("../../src/api/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/api/client.js")>()),
  fetchSetupChecks: (...args: unknown[]) => fetchSetupChecks(...args),
}));

const okChecks = {
  database: { ok: true, detail: "PostgreSQL connected · migrations current" },
  redis: { ok: true, detail: "Optional — not configured" },
  encryption: { ok: true, detail: "Key present" },
  base_url: { ok: true, detail: "https://tickets.example.com" },
};
const failingChecks = { ...okChecks, encryption: { ok: false, detail: "ENCRYPTION_KEY is not set" } };

/** Inside the body of a step, as it is in the wizard: the focus of a Retry that worked goes there. */
function renderStep() {
  return renderWithToast(
    <div className="setup-wizard__body">
      <WizardStep1Checks onChecksOk={onChecksOk} />
    </div>,
  );
}

const placeholder = () => screen.queryByRole("status", { name: "Running the system checks" });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("WizardStep1Checks: the first run", () => {
  it("holds the rows' room invisibly for 200ms, with the real labels, then draws a placeholder for each result", async () => {
    fetchSetupChecks.mockImplementation(hangUntilAborted as never);
    renderStep();
    await advanceTimers(0);

    const held = placeholder() as HTMLElement;
    expect(held.classList.contains("at-loading-hold")).toBe(true);
    expect(["Database", "Redis", "Encryption key", "Base URL"].every((label) => held.textContent?.includes(label))).toBe(true);
    // The shapes are decoration: the region is named by its label, and the rows are not read out.
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.queryByText("Checking…")).toBeNull();
    await advanceTimers(200);
    expect((placeholder() as HTMLElement).classList.contains("at-loading-hold")).toBe(false);
  });

  it("never draws the placeholder for an answer that comes within 200ms", async () => {
    fetchSetupChecks.mockResolvedValueOnce({ checks: okChecks });
    renderStep();
    await advanceTimers(0);
    expect(placeholder()).toBeNull();
    expect(screen.getByText("PostgreSQL connected · migrations current")).toBeTruthy();
  });

  it("says it is taking longer than usual after 8 seconds", async () => {
    fetchSetupChecks.mockImplementation(hangUntilAborted as never);
    renderStep();
    await advanceTimers(0);
    await advanceTimers(7_999);
    expect(screen.queryByText(SLOW_NOTICE_TEXT)).toBeNull();
    await advanceTimers(1);
    expect(screen.getByText(SLOW_NOTICE_TEXT)).toBeTruthy();
  });

  it("is not ready while the checks run, and when they all pass, is", async () => {
    const answer = deferred<{ checks: typeof okChecks }>();
    fetchSetupChecks.mockReturnValueOnce(answer.promise);
    renderStep();
    await advanceTimers(0);
    expect(onChecksOk).toHaveBeenLastCalledWith(false);

    await act(async () => answer.resolve({ checks: okChecks }));
    expect(onChecksOk).toHaveBeenLastCalledWith(true);
    expect(screen.getByText("https://tickets.example.com")).toBeTruthy();
  });

  it("ends in an error after 30 seconds, and the Retry keeps the error on screen, busy, with its focus, until the checks are in", async () => {
    fetchSetupChecks.mockImplementationOnce(hangUntilAborted as never);
    renderStep();
    await advanceTimers(0);
    await advanceTimers(30_000);
    await advanceTimers(0);
    expect(screen.getByRole("alert").textContent).toContain(LOAD_TIMEOUT_MESSAGE);
    expect(onChecksOk).toHaveBeenLastCalledWith(false);

    const answer = deferred<{ checks: typeof okChecks }>();
    fetchSetupChecks.mockReturnValueOnce(answer.promise);
    const retry = screen.getByRole("button", { name: "Retry" });
    retry.focus();
    fireEvent.click(retry);
    await advanceTimers(500);
    expect(retry.getAttribute("aria-busy")).toBe("true");
    expect(document.activeElement).toBe(retry);
    expect(screen.getByRole("alert").textContent).toContain(LOAD_TIMEOUT_MESSAGE);
    expect(placeholder()).toBeNull();

    await act(async () => answer.resolve({ checks: okChecks }));
    await advanceTimers(500);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("PostgreSQL connected · migrations current")).toBeTruthy();
    expect(onChecksOk).toHaveBeenLastCalledWith(true);
    // The Retry that held the focus is gone: the focus goes to the step's body, not to the page.
    expect(document.activeElement).toBe(document.querySelector(".setup-wizard__body"));
  });

  it("says what the server said when the read fails, shows nothing as passed, and is not ready", async () => {
    fetchSetupChecks.mockRejectedValueOnce(new ApiError(500, "Server error"));
    renderStep();
    await advanceTimers(0);

    expect(screen.getByText("Server error")).toBeTruthy();
    expect(screen.queryByText("PostgreSQL connected · migrations current")).toBeNull();
    expect(onChecksOk).toHaveBeenLastCalledWith(false);
  });

  it("says it could not load the checks when the read fails with nothing to say for itself", async () => {
    fetchSetupChecks.mockRejectedValueOnce(new Error("socket hang up"));
    renderStep();
    await advanceTimers(0);

    expect(screen.getByRole("alert").textContent).toContain("Could not load system checks.");
    expect(screen.queryByText(/socket hang up/)).toBeNull();
  });
});

describe("WizardStep1Checks: the results", () => {
  it("shows the failed check with its fix, and a Retry that is not busy", async () => {
    fetchSetupChecks.mockResolvedValueOnce({ checks: failingChecks });
    renderStep();
    await advanceTimers(0);

    expect(screen.getByText("Failed")).toBeTruthy();
    expect(screen.getByText(/Set ENCRYPTION_KEY in your .env file/i)).toBeTruthy();
    const banner = screen.getByText(/Fix the issues above/i);
    expect(banner.closest(".at-notice--error")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" }).getAttribute("aria-busy")).toBeNull();
    expect(onChecksOk).toHaveBeenLastCalledWith(false);
  });

  it("renders the status detail on the right for passing checks", async () => {
    fetchSetupChecks.mockResolvedValueOnce({ checks: okChecks });
    renderStep();
    await advanceTimers(0);

    expect(screen.getByText("PostgreSQL connected · migrations current")).toBeTruthy();
    expect(screen.getByText("https://tickets.example.com")).toBeTruthy();
  });

  it("marks a passing check that warns, and still lets the step through", async () => {
    fetchSetupChecks.mockResolvedValueOnce({ checks: { ...okChecks, redis: { ok: true, warn: true, detail: "Optional, not configured" } } });
    renderStep();
    await advanceTimers(0);

    expect(document.querySelector(".setup-wizard__check-item--warn")).not.toBeNull();
    expect(onChecksOk).toHaveBeenLastCalledWith(true);
  });

  it("runs the checks again from the Retry with the results on screen, blocked, and the Retry busy with its focus, until the new ones are in", async () => {
    fetchSetupChecks.mockResolvedValueOnce({ checks: failingChecks });
    renderStep();
    await advanceTimers(0);

    const answer = deferred<{ checks: typeof okChecks }>();
    fetchSetupChecks.mockReturnValueOnce(answer.promise);
    const retry = screen.getByRole("button", { name: "Retry" });
    retry.focus();
    fireEvent.click(retry);
    await advanceTimers(0);

    expect(retry.getAttribute("aria-busy")).toBe("true");
    expect(isOff(retry)).toBe(true);
    expect(document.activeElement).toBe(retry);
    expect(screen.getByText("ENCRYPTION_KEY is not set")).toBeTruthy();
    expect(placeholder()).toBeNull();
    expect(document.querySelector(".refetch-card--busy")).not.toBeNull();
    expect(onChecksOk).toHaveBeenLastCalledWith(false);
    // Once the wait is noticeable a screen reader is told what is paused.
    await advanceTimers(200);
    expect(screen.getByText("Running the checks again. Actions are paused until it finishes.")).toBeTruthy();

    await act(async () => answer.resolve({ checks: okChecks }));
    await advanceTimers(500);
    expect(screen.queryByText("ENCRYPTION_KEY is not set")).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(onChecksOk).toHaveBeenLastCalledWith(true);
    expect(document.activeElement).toBe(document.querySelector(".setup-wizard__body"));
  });

  it("keeps the Retry busy for at least 400ms when the new answer is instant, so that a quick run is not a flicker", async () => {
    fetchSetupChecks.mockResolvedValueOnce({ checks: failingChecks });
    renderStep();
    await advanceTimers(0);

    fetchSetupChecks.mockResolvedValueOnce({ checks: failingChecks });
    const retry = screen.getByRole("button", { name: "Retry" });
    fireEvent.click(retry);
    await advanceTimers(0);
    expect(retry.getAttribute("aria-busy")).toBe("true");
    await advanceTimers(399);
    expect(retry.getAttribute("aria-busy")).toBe("true");
    await advanceTimers(1);
    expect(retry.getAttribute("aria-busy")).toBeNull();
  });

  it("keeps the results and says they may be older when the run that checks again fails", async () => {
    fetchSetupChecks.mockResolvedValueOnce({ checks: failingChecks });
    renderStep();
    await advanceTimers(0);

    fetchSetupChecks.mockRejectedValueOnce(new Error("blip"));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await advanceTimers(500);

    expect(screen.getByText("ENCRYPTION_KEY is not set")).toBeTruthy();
    // One notice says both (the run failed, and what the operator is to do), with one Retry: two Retry buttons that run the
    // same checks would be busy independently of each other.
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("may show older details");
    expect(alert.textContent).toContain("Fix the issues above");
    expect(screen.getAllByRole("button", { name: "Retry" })).toHaveLength(1);
    expect(onChecksOk).toHaveBeenLastCalledWith(false);

    // That Retry runs the checks again (once the 400ms of the busy one that failed are over), and the new answer replaces the
    // warning.
    await advanceTimers(400);
    fetchSetupChecks.mockResolvedValueOnce({ checks: failingChecks });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await advanceTimers(500);
    await advanceTimers(400);
    expect(screen.getByRole("alert").textContent).not.toContain("may show older details");
    expect(screen.getByRole("alert").textContent).toContain("Fix the issues above");
  });
});
