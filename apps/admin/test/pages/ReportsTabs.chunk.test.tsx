// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventMailReportsResponse } from "../../src/api/types.js";
import { MailReportsTab } from "../../src/reports/ReportsTabs.js";
import { advanceTimers, connectionStateValue, mockMatchMedia, renderWithToast } from "../test-utils.js";

// The report of a tab (its code, with the charts) is a chunk of its own that travels with the tab's data: one wait, however the
// two arrive. Here the chunk is held back until a test lets it through.

const fetchEventMailReports = vi.fn();

const chunk = vi.hoisted(() => {
  let release: () => void = () => {};
  const arrived = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { arrived, release: () => release() };
});

vi.mock("../../src/pages/MailReportsTab.js", async () => {
  await chunk.arrived;
  return { MailReport: ({ data }: { data: { total_attendees: number } }) => <p>Attendees in the report: {data.total_attendees}</p> };
});

vi.mock("../../src/connection/ConnectionStateProvider.js", () => ({
  useConnectionState: () => connectionStateValue("connected", vi.fn()),
}));

vi.mock("../../src/api/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/api/client.js")>()),
  fetchEventMailReports: (...args: unknown[]) => fetchEventMailReports(...args),
}));

const placeholder = () => screen.queryByRole("status", { name: "Loading the mail report" });

beforeEach(() => {
  mockMatchMedia(true);
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("a Reports tab whose data has answered before its code has arrived", () => {
  it("stays one wait: the placeholder is drawn and kept until the code is in, and the report replaces it", async () => {
    fetchEventMailReports.mockResolvedValue({ total_attendees: 5 } as EventMailReportsResponse);
    renderWithToast(<MailReportsTab eventId="evt-1" isActive />);
    await advanceTimers(0);

    // The data is in, but the report cannot be drawn without its code: nothing says "ready" yet.
    expect(fetchEventMailReports).toHaveBeenCalledTimes(1);
    expect(placeholder()).not.toBeNull();
    expect(screen.queryByText(/Attendees in the report/)).toBeNull();
    await advanceTimers(200);
    expect((placeholder() as HTMLElement).classList.contains("at-loading-hold")).toBe(false);
    await advanceTimers(5_000);
    expect(placeholder()).not.toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();

    chunk.release();
    await vi.waitFor(() => expect(screen.getByText("Attendees in the report: 5")).toBeTruthy(), { interval: 5 });
    await advanceTimers(500);
    expect(placeholder()).toBeNull();
    expect(screen.getByText("Attendees in the report: 5")).toBeTruthy();
  });
});
