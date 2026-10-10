// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@admitto/ui";
import { ApiError } from "../../src/api/client.js";
import type { EventMailReportsResponse } from "../../src/api/types.js";
import { CustomFieldsReportsTab, MailReportsTab, WalletsReportsTab } from "../../src/reports/ReportsTabs.js";
import { LOAD_TIMEOUT_MESSAGE, SLOW_NOTICE_TEXT } from "../../src/utils/loading-timing.js";
import { advanceTimers, connectionStateValue, deferred, hangUntilAborted, mockMatchMedia, renderWithToast } from "../test-utils.js";

// What the three lazily loaded Reports tabs (Wallets, Mail, Custom fields) share: the first read, its placeholder, its error and
// its Retry live in `useReportFetch` and `ReportTab`, so they are exercised through one of them (Mail). Each tab's own wiring
// (its titles, its messages, its report) is in its own test file.

const fetchEventMailReports = vi.fn();
const fetchEventWalletReports = vi.fn();
const fetchEventCustomFieldReports = vi.fn();
const reportApiError = vi.fn();

vi.mock("../../src/connection/ConnectionStateProvider.js", () => ({
  useConnectionState: () => connectionStateValue("connected", reportApiError),
}));

vi.mock("../../src/api/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/api/client.js")>()),
  fetchEventMailReports: (...args: unknown[]) => fetchEventMailReports(...args),
  fetchEventWalletReports: (...args: unknown[]) => fetchEventWalletReports(...args),
  fetchEventCustomFieldReports: (...args: unknown[]) => fetchEventCustomFieldReports(...args),
}));

// The charts draw into their wrappers; under jsdom nothing has a size, so the charts themselves are left out.
vi.mock("recharts", () => {
  const Nothing = () => null;
  const Box = ({ children }: { children?: unknown }) => <>{children as never}</>;
  return {
    ResponsiveContainer: Box,
    PieChart: Nothing,
    Pie: Nothing,
    Cell: Nothing,
    AreaChart: Nothing,
    Area: Nothing,
    XAxis: Nothing,
    YAxis: Nothing,
    CartesianGrid: Nothing,
    Tooltip: Nothing,
    RadialBarChart: Nothing,
    RadialBar: Nothing,
    PolarAngleAxis: Nothing,
  };
});

const report = (): EventMailReportsResponse => ({
  total_attendees: 5,
  delivery: {
    total_attempts: 2,
    successful: 1,
    successful_pct: 50,
    by_status: [
      { status: "sent", count: 1 },
      { status: "failed", count: 1 },
    ],
  },
  attendee_reach: { reached: 1, not_reached: 4, reached_pct: 20, never_sent: 3, send_failed: 1 },
  by_purpose: { initial: 2, resend: 0 },
  by_template: [{ template: null, total: 2, successful: 1, successful_pct: 50 }],
  sent_by_day: [{ date: "2027-09-01", count: 1, cumulative: 1 }],
  ticket_viewed: { reached: 1, viewed: 1, viewed_pct: 100 },
  admission_by_email: {
    reached: { total: 1, admitted: 1, pct: 100 },
    not_reached: { total: 4, admitted: 0, pct: 0 },
  },
  funnel: { total_attendees: 5, reached_by_email: 1, wallet_installed: 1, attended: 1 },
});

const placeholder = () => screen.queryByRole("status", { name: "Loading the mail report" });
const tabRegion = () => screen.getByRole("region", { name: "Mail report" });
const renderTab = () => renderWithToast(<MailReportsTab eventId="evt-1" isActive />);

beforeEach(() => {
  mockMatchMedia(true);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("a Reports tab's first read: the wait", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // A read that a test has not set up hangs, instead of answering with nothing.
    fetchEventMailReports.mockImplementation(hangUntilAborted as never);
  });

  it("holds its room for 200ms, shows the placeholder, and says it is taking longer after 8 seconds", async () => {
    renderTab();
    await advanceTimers(0);

    const held = placeholder() as HTMLElement;
    expect(held.classList.contains("at-loading-hold")).toBe(true);
    // The tab's own section stays whatever the read is doing, and nothing claims that there is nothing to see.
    expect(tabRegion().contains(held)).toBe(true);
    expect(screen.queryByText("No emails sent yet")).toBeNull();

    await advanceTimers(200);
    expect((placeholder() as HTMLElement).classList.contains("at-loading-hold")).toBe(false);
    await advanceTimers(7_799);
    expect(screen.queryByText(SLOW_NOTICE_TEXT)).toBeNull();
    await advanceTimers(1);
    expect(screen.getByText(SLOW_NOTICE_TEXT)).toBeTruthy();
  });

  it("fades the report in where the placeholder was once the read has answered", async () => {
    const answer = deferred<EventMailReportsResponse>();
    fetchEventMailReports.mockReturnValueOnce(answer.promise);
    renderTab();
    await advanceTimers(0);
    expect((placeholder() as HTMLElement).closest(".at-fade-in")).toBeNull();

    await act(async () => answer.resolve(report()));
    // The report's code comes with its data, so it may still be a moment on its way, and the placeholder draws the same titles.
    await vi.waitFor(() => expect(placeholder()).toBeNull(), { interval: 5, timeout: 3000 });
    expect(screen.getByText("Event journey").closest(".reports-tab__report.at-fade-in")).not.toBeNull();
  });

  it("reads once, however often the page draws the tab again", async () => {
    const answer = deferred<EventMailReportsResponse>();
    fetchEventMailReports.mockReturnValue(answer.promise);
    const { rerender } = renderTab();
    await advanceTimers(0);

    rerender(
      <ToastProvider>
        <MailReportsTab eventId="evt-1" isActive={false} />
      </ToastProvider>,
    );
    await advanceTimers(0);

    expect(fetchEventMailReports).toHaveBeenCalledTimes(1);
  });

  it("ends in an error after 30 seconds, with a Retry that stays on screen, busy, with its focus, and hands the focus to the tab's section when it works", async () => {
    renderTab();
    await advanceTimers(0);
    await advanceTimers(30_000);
    await advanceTimers(0);
    expect(screen.getByRole("alert").textContent).toContain(LOAD_TIMEOUT_MESSAGE);
    expect(screen.getByRole("alert").textContent).toContain("Could not load mail report");

    const answer = deferred<EventMailReportsResponse>();
    fetchEventMailReports.mockReturnValueOnce(answer.promise);
    const retry = screen.getByRole("button", { name: "Retry" });
    retry.focus();
    fireEvent.click(retry);
    await advanceTimers(500);
    expect(retry.getAttribute("aria-busy")).toBe("true");
    expect(retry.hasAttribute("disabled")).toBe(false);
    expect(document.activeElement).toBe(retry);
    expect(screen.getByRole("alert").textContent).toContain(LOAD_TIMEOUT_MESSAGE);
    expect(placeholder()).toBeNull();

    await act(async () => answer.resolve(report()));
    // The report's code comes with its data, so it may still be a moment on its way.
    await vi.waitFor(() => expect(screen.queryByRole("alert")).toBeNull(), { interval: 5 });
    await advanceTimers(500);
    expect(screen.getByText("Event journey")).toBeTruthy();
    expect(document.activeElement).toBe(tabRegion());
  });

  it("announces a Retry that fails again with the same message: the message is mounted afresh in its live region", async () => {
    fetchEventMailReports.mockRejectedValueOnce(new Error("offline")).mockRejectedValueOnce(new Error("offline"));
    renderTab();
    await advanceTimers(0);

    const first = screen.getByText("Could not load mail report.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await advanceTimers(500);
    // The 400ms minimum of the busy Retry ends in a timer that is set when the answer is in.
    await advanceTimers(400);

    expect(screen.getByText("Could not load mail report.")).not.toBe(first);
  });

  it("says the viewer has no access on a 403, with a Retry, and tells the connection state", async () => {
    fetchEventMailReports.mockRejectedValueOnce(new ApiError(403, "forbidden", "forbidden"));
    renderTab();
    await advanceTimers(0);

    expect(screen.getByRole("alert").textContent).toContain("You do not have access to this event.");
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(reportApiError).toHaveBeenCalledWith(403);
  });

  it("keeps saying so while a Retry of a 403 runs, whatever the next answer will be", async () => {
    fetchEventMailReports.mockRejectedValueOnce(new ApiError(403, "forbidden", "forbidden"));
    renderTab();
    await advanceTimers(0);
    fetchEventMailReports.mockReturnValueOnce(deferred<EventMailReportsResponse>().promise);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await advanceTimers(500);

    expect(screen.getByRole("alert").textContent).toContain("You do not have access to this event.");
  });

  it("hands the browser to the login page on a 401, instead of flashing an error first", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign, pathname: "/admin/events/evt-1/reports" });
    fetchEventMailReports.mockRejectedValueOnce(new ApiError(401, "unauthenticated", "unauthenticated"));
    renderTab();
    await advanceTimers(0);

    expect(assign).toHaveBeenCalledWith("/login?next=%2Fadmin%2Fevents%2Fevt-1%2Freports");
    expect(reportApiError).toHaveBeenCalledWith(401);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("a Reports tab's first read: an answer that comes at once", () => {
  it("never shows the placeholder for it, and draws the report in the tab's section", async () => {
    // The report's code is a chunk of its own, so the answer is not synchronous: watch for a placeholder that is ever visible.
    const visible: string[] = [];
    const observer = new MutationObserver(() => {
      const region = placeholder();
      if (region && !region.classList.contains("at-loading-hold")) visible.push(region.getAttribute("aria-label") ?? "");
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true });
    fetchEventMailReports.mockResolvedValue(report());

    renderTab();
    await waitFor(() => expect(placeholder()).toBeNull(), { timeout: 3000 });
    observer.disconnect();

    expect(visible).toEqual([]);
    expect(tabRegion().contains(screen.getByText("Event journey"))).toBe(true);
  });
});

describe("a Reports tab's read", () => {
  it.each([
    ["Wallets", fetchEventWalletReports, <WalletsReportsTab eventId="evt-1" walletPlatforms={{ any: true, apple: true, google: true, samsung: false }} isActive />],
    ["Custom fields", fetchEventCustomFieldReports, <CustomFieldsReportsTab eventId="evt-1" isActive />],
    ["Mail", fetchEventMailReports, <MailReportsTab eventId="evt-1" isActive />],
  ])("%s: asks for its own event's report, with a signal that stops the request when the tab goes away", async (_name, read, tab) => {
    read.mockImplementation(hangUntilAborted as never);
    const { unmount } = renderWithToast(tab);
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));

    const [eventId, signal] = read.mock.calls[0] as [string, AbortSignal];
    expect(eventId).toBe("evt-1");
    expect(signal.aborted).toBe(false);
    unmount();
    expect(signal.aborted).toBe(true);
  });
});
