// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventMailReportsResponse } from "../../src/api/types.js";
import { MailReportsTab } from "../../src/reports/ReportsTabs.js";
import { connectionStateValue, mockMatchMedia, renderWithToast } from "../test-utils.js";

const fetchEventMailReports = vi.fn();
const reportApiError = vi.fn();

// The chunk with the report's code cannot be loaded (the network dropped, or a new version replaced it).
vi.mock("../../src/pages/MailReportsTab.js", () => {
  throw new Error("Failed to fetch dynamically imported module");
});

vi.mock("../../src/connection/ConnectionStateProvider.js", () => ({
  useConnectionState: () => connectionStateValue("connected", reportApiError),
}));

vi.mock("../../src/api/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/api/client.js")>()),
  fetchEventMailReports: (...args: unknown[]) => fetchEventMailReports(...args),
}));

beforeEach(() => {
  mockMatchMedia(true);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("a Reports tab whose code cannot be loaded", () => {
  it("is a failed read like any other: an error that says what failed, with a Retry, and nothing for the connection state", async () => {
    fetchEventMailReports.mockResolvedValue({ total_attendees: 5 } as EventMailReportsResponse);
    renderWithToast(<MailReportsTab eventId="evt-1" isActive />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Could not load mail report");
    // The words of the browser's error are not for the operator.
    expect(alert.textContent).not.toContain("dynamically imported");
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.queryByRole("status", { name: "Loading the mail report" })).toBeNull();
    expect(reportApiError).not.toHaveBeenCalled();
  });
});
