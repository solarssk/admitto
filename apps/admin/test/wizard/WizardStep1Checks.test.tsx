// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WizardStep1Checks } from "../../src/pages/wizard/WizardStep1Checks.js";
import { renderWithToast } from "../test-utils.js";

const fetchSetupChecks = vi.fn();
const onChecksOk = vi.fn();

vi.mock("../../src/api/client.js", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  fetchSetupChecks: (...args: unknown[]) => fetchSetupChecks(...args),
}));

const okChecks = {
  database: { ok: true, detail: "Connected" },
  migrations: { ok: true, detail: "Up to date" },
  redis: { ok: true, detail: "Optional — not configured" },
  encryption: { ok: true, detail: "Key present" },
  base_url: { ok: true, detail: "https://tickets.example.com" },
};

function renderStep() {
  return renderWithToast(<WizardStep1Checks onChecksOk={onChecksOk} />);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("WizardStep1Checks", () => {
  it("shows Retry when fetch fails and re-runs checks on click", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    fetchSetupChecks
      .mockRejectedValueOnce(new ApiError(500, "Server error"))
      .mockResolvedValueOnce({ checks: okChecks });

    renderStep();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(fetchSetupChecks).toHaveBeenCalledTimes(2);
      expect(screen.getByText("Connected")).toBeTruthy();
    });
  });

  it("shows error banner Retry when a check fails", async () => {
    fetchSetupChecks.mockResolvedValueOnce({
      checks: {
        ...okChecks,
        encryption: { ok: false, detail: "ENCRYPTION_KEY is not set" },
      },
    });

    renderStep();

    await waitFor(() => {
      expect(screen.getByText("Failed")).toBeTruthy();
      expect(screen.getByText(/Fix the issues above/i)).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(fetchSetupChecks).toHaveBeenCalledTimes(2);
    });
  });

  it("shows inline fix text for a failed check", async () => {
    fetchSetupChecks.mockResolvedValueOnce({
      checks: {
        ...okChecks,
        encryption: { ok: false, detail: "ENCRYPTION_KEY is not set" },
      },
    });

    renderStep();

    await waitFor(() => {
      expect(screen.getByText(/Set ENCRYPTION_KEY in your .env file/i)).toBeTruthy();
    });
  });

  it("renders status detail on the right for passing checks", async () => {
    fetchSetupChecks.mockResolvedValueOnce({ checks: okChecks });

    renderStep();

    await waitFor(() => {
      expect(screen.getByText("Connected")).toBeTruthy();
      expect(screen.getByText("Up to date")).toBeTruthy();
    });
  });
});
