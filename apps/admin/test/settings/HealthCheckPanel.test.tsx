// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { ToastProvider } from "@admitto/ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatRunningBuildLabel,
  HealthCheckPanel,
  LIVE_CHECKS_HINT,
} from "../../src/settings/HealthCheckPanel.js";
import { advanceTimers, hangUntilAborted, renderWithToast, renderWithToastAndRouter } from "../test-utils.js";
import { describePanelLoading } from "./panel-loading.js";
import { formatEventDateTime, getBrowserTimeZone } from "../../src/utils/event-dates.js";
import type { HealthReportDto, HealthRowStatus } from "../../src/api/types.js";

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    fetchAdminHealth: vi.fn(),
    runAdminHealthLive: vi.fn(),
  };
});

import { ApiError, fetchAdminHealth, runAdminHealthLive } from "../../src/api/client.js";

const mockFetch = vi.mocked(fetchAdminHealth);
const mockLive = vi.mocked(runAdminHealthLive);

function sampleReport(overrides?: Partial<HealthReportDto>): HealthReportDto {
  return {
    generated_at: "2026-08-03T12:54:24.000Z",
    version: "0.4.13",
    commit: "a955ac9",
    overall: "ok",
    groups: [
      {
        id: "core",
        label: "Core infrastructure",
        subtitle: "Owned and run by this instance",
        status: "ok",
        checks: [
          {
            id: "database",
            label: "Database",
            status: "ok",
            summary: "Connected",
            details: [
              { key: "status", value: "ok" },
              { key: "latency_ms", value: "4" },
              { key: "engine", value: "PostgreSQL 16.0" },
            ],
          },
          {
            id: "rate_limit_storage",
            label: "Rate-limit storage",
            status: "degraded",
            summary: "Responding slowly · 200 ms",
            details: [
              { key: "status", value: "degraded" },
              { key: "mode", value: "redis" },
              { key: "latency_ms", value: "200" },
            ],
          },
          {
            id: "file_storage",
            label: "File storage",
            status: "ok",
            summary: "Connected",
            details: [
              { key: "status", value: "ok" },
              { key: "provider", value: "local" },
              { key: "writable", value: "yes" },
            ],
          },
        ],
      },
      {
        id: "external",
        label: "External integrations",
        subtitle: "Third-party APIs this instance depends on",
        status: "ok",
        checks: [
          {
            id: "identity_provider_idp-1",
            label: "Identity provider, OIDC - Authentik",
            status: "ok",
            summary: "Configured · enabled",
            details: [
              { key: "protocol", value: "OIDC" },
              { key: "display_name", value: "Authentik" },
            ],
          },
          {
            id: "weather",
            label: "Weather, Open-Meteo",
            status: "ok",
            summary: "Provider available",
            details: [],
          },
          {
            id: "email_sending",
            label: "Email sending, SMTP",
            status: "down",
            summary: "Unreachable",
            details: [{ key: "status", value: "down" }],
          },
          {
            id: "custom_probe",
            label: "Custom probe",
            status: "ok",
            summary: "Connected",
            details: [],
          },
        ],
      },
    ],
    ...overrides,
  };
}

/** A single-group report with one check per given status, for verdict tests that need an exact
 * down/degraded tally instead of `sampleReport()`'s fixed mix. */
function reportWithStatuses(statuses: HealthRowStatus[]): HealthReportDto {
  return sampleReport({
    overall: "ok",
    groups: [
      {
        id: "core",
        label: "Core infrastructure",
        subtitle: "Owned and run by this instance",
        status: "ok",
        checks: statuses.map((status, i) => ({
          id: `check_${i}`,
          label: `Check ${i}`,
          status,
          summary: "Summary",
          details: [],
        })),
      },
    ],
  });
}

beforeEach(() => {
  mockFetch.mockResolvedValue(sampleReport());
  mockLive.mockResolvedValue(sampleReport());
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describePanelLoading({
  label: "Loading health checks",
  errorTitle: "Could not load health checks",
  render: () => renderWithToast(<HealthCheckPanel />),
  hang: () => mockFetch.mockImplementationOnce(hangUntilAborted),
});

describe("formatRunningBuildLabel", () => {
  it("includes commit when known", () => {
    expect(formatRunningBuildLabel("0.4.12", "a529cd5")).toBe(" · v0.4.12 · a529cd5");
  });

  it("omits commit when unknown", () => {
    expect(formatRunningBuildLabel("0.4.12", "unknown")).toBe(" · v0.4.12");
  });
});

// renderWithToastAndRouter wraps the first render only; a rerender has to bring the providers itself.
function rerenderPanel(rerender: (ui: ReactNode) => void, isActive: boolean) {
  rerender(
    <MemoryRouter>
      <ToastProvider>
        <HealthCheckPanel isActive={isActive} />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe("HealthCheckPanel", () => {
  it("reads the report again, without a loading state, when its tab is shown again", async () => {
    mockFetch.mockResolvedValueOnce(sampleReport({ overall: "down" }));
    const { rerender } = renderWithToastAndRouter(<HealthCheckPanel isActive />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    await screen.findByText("Core infrastructure");

    rerenderPanel(rerender, false);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const fresh = sampleReport({ generated_at: "2026-08-03T13:10:00.000Z" });
    mockFetch.mockResolvedValueOnce(fresh);
    rerenderPanel(rerender, true);

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    // The previous report stays on screen while the new one is read.
    expect(screen.getByText("Core infrastructure")).toBeTruthy();
    expect(screen.queryByText(/Loading/i)).toBeNull();
  });

  it("keeps the report it already shows when the read on returning to the tab fails", async () => {
    mockFetch.mockResolvedValueOnce(sampleReport());
    const { rerender } = renderWithToastAndRouter(<HealthCheckPanel isActive />);
    await screen.findByText("Core infrastructure");

    rerenderPanel(rerender, false);
    mockFetch.mockRejectedValueOnce(new Error("network down"));
    rerenderPanel(rerender, true);

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    expect(screen.getByText("Core infrastructure")).toBeTruthy();
  });

  it("does not let a read started when the tab was shown replace live results that finished first", async () => {
    const oneGroup = (label: string) =>
      sampleReport({ groups: [{ id: "core", label, subtitle: "Test group", status: "ok", checks: [] }] });
    mockFetch.mockResolvedValueOnce(sampleReport());
    const { rerender } = renderWithToastAndRouter(<HealthCheckPanel isActive />);
    await screen.findByText("Core infrastructure");

    rerenderPanel(rerender, false);
    let resolveStale!: (report: HealthReportDto) => void;
    mockFetch.mockImplementationOnce(
      () =>
        new Promise<HealthReportDto>((resolve) => {
          resolveStale = resolve;
        }),
    );
    rerenderPanel(rerender, true);
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));

    mockLive.mockResolvedValueOnce(oneGroup("Live results"));
    fireEvent.click(screen.getByRole("button", { name: /Run live checks/ }));
    await screen.findByText("Live results");

    // The read that was already in flight answers after the live checks: it must not win.
    resolveStale(oneGroup("Older results"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByText("Live results")).toBeTruthy();
    expect(screen.queryByText("Older results")).toBeNull();
  });

  it("still shows the first load when the tab is left and shown again while it is running", async () => {
    let resolveFirst!: (report: HealthReportDto) => void;
    mockFetch.mockImplementationOnce(
      () =>
        new Promise<HealthReportDto>((resolve) => {
          resolveFirst = resolve;
        }),
    );
    const { rerender } = renderWithToastAndRouter(<HealthCheckPanel isActive />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

    rerenderPanel(rerender, false);
    // The quiet read started on returning fails, so the first load is the only source of a report.
    mockFetch.mockRejectedValueOnce(new Error("network down"));
    rerenderPanel(rerender, true);
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));

    resolveFirst(sampleReport({ groups: [{ id: "core", label: "First load results", subtitle: "Test group", status: "ok", checks: [] }] }));
    expect(await screen.findByText("First load results")).toBeTruthy();
    expect(screen.queryByText("Could not load health checks")).toBeNull();
  });

  it("ignores a read that finishes after the tab was left again", async () => {
    mockFetch.mockResolvedValueOnce(sampleReport());
    const { rerender } = renderWithToastAndRouter(<HealthCheckPanel isActive />);
    await screen.findByText("Core infrastructure");

    rerenderPanel(rerender, false);
    let resolveLate!: (report: HealthReportDto) => void;
    mockFetch.mockImplementationOnce(
      () =>
        new Promise<HealthReportDto>((resolve) => {
          resolveLate = resolve;
        }),
    );
    rerenderPanel(rerender, true);
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    rerenderPanel(rerender, false);

    resolveLate(sampleReport({ groups: [{ id: "core", label: "Late results", subtitle: "Test group", status: "ok", checks: [] }] }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByText("Core infrastructure")).toBeTruthy();
    expect(screen.queryByText("Late results")).toBeNull();
  });

  it("renders fallback icons for unknown check and group ids", async () => {
    mockFetch.mockResolvedValueOnce(
      sampleReport({
        groups: [
          {
            id: "other",
            label: "Other",
            subtitle: "Extra",
            status: "ok",
            checks: [
              {
                id: "mystery",
                label: "Mystery",
                status: "ok",
                summary: "Fine",
                details: [],
              },
            ],
          },
        ],
      }),
    );
    renderWithToast(<HealthCheckPanel />);
    await screen.findByText("Mystery");
    expect(document.querySelector(".ti-circle-dot")).toBeTruthy();
  });

  it("ignores aborted errors from the passive fetch", async () => {
    let rejectFetch!: (reason?: unknown) => void;
    mockFetch.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectFetch = reject;
        }),
    );

    const { unmount } = renderWithToast(<HealthCheckPanel />);
    expect(screen.getByLabelText("Loading health checks")).toBeTruthy();
    unmount();

    await act(async () => {
      rejectFetch(new DOMException("Aborted", "AbortError"));
    });
  });

  it("shows fallback empty copy when the API returns an empty payload", async () => {
    mockFetch.mockResolvedValueOnce(undefined as unknown as HealthReportDto);
    renderWithToast(<HealthCheckPanel />);
    await waitFor(() => {
      expect(screen.getByText("Could not load health checks.")).toBeTruthy();
    });
  });

  it("shows the placeholder, named after what loads, while the passive fetch is in flight", () => {
    mockFetch.mockImplementationOnce(() => new Promise(() => {}));
    renderWithToast(<HealthCheckPanel />);
    expect(screen.getByLabelText("Loading health checks")).toBeTruthy();
  });

  it("renders groups and meta after a successful load", async () => {
    renderWithToast(<HealthCheckPanel />);
    await screen.findByText("Core infrastructure");
    expect(screen.getByText("External integrations")).toBeTruthy();
    expect(screen.getByText("Database")).toBeTruthy();
    expect(screen.getByText(/Generated/)).toBeTruthy();
    expect(
      screen.getByText(new RegExp(`v${__APP_VERSION__} · ${__APP_COMMIT__}`)),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /Run live checks/ })).toBeTruthy();
  });

  it("puts the Generated line directly under the description", async () => {
    renderWithToast(<HealthCheckPanel />);
    await screen.findByText("Core infrastructure");
    const description = screen.getByText(/Review whether this instance/);
    const meta = description.nextElementSibling;
    expect(meta?.textContent).toMatch(/^Generated /);
    const time = meta?.querySelector("time");
    expect(time?.getAttribute("datetime")).toBe("2026-08-03T12:54:24.000Z");
    expect(meta?.textContent).toContain(`v${__APP_VERSION__} · ${__APP_COMMIT__}`);
  });

  it("gives Background worker and Bounce detection their own icons", async () => {
    mockFetch.mockResolvedValueOnce(
      sampleReport({
        groups: [
          {
            id: "core",
            label: "Core infrastructure",
            subtitle: "Owned and run by this instance",
            status: "ok",
            checks: [
              { id: "background_worker", label: "Background worker", status: "ok", summary: "Running", details: [] },
              { id: "bounce_ingest", label: "Bounce detection", status: "ok", summary: "Idle", details: [] },
            ],
          },
        ],
      }),
    );
    const { container } = renderWithToast(<HealthCheckPanel />);
    await screen.findByText("Background worker");
    expect(container.querySelector(".ti-activity-heartbeat")).not.toBeNull();
    expect(container.querySelector(".ti-mail-exclamation")).not.toBeNull();
    expect(container.querySelector(".ti-circle-dot")).toBeNull();
  });

  it("uses the SPA build identity even when the API reports a different commit", async () => {
    mockFetch.mockResolvedValueOnce(sampleReport({ commit: "unknown", version: "9.9.9" }));
    renderWithToast(<HealthCheckPanel />);
    await screen.findByText("Core infrastructure");
    expect(
      screen.getByText(new RegExp(`v${__APP_VERSION__} · ${__APP_COMMIT__}`)),
    ).toBeTruthy();
    expect(screen.queryByText(/v9\.9\.9/)).toBeNull();
  });

  it("shows an error card with Retry when the passive load fails", async () => {
    mockFetch.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderWithToast(<HealthCheckPanel />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    });
    expect(screen.getByText("Could not load health checks")).toBeTruthy();
    expect(screen.queryByText("secret_internal")).toBeNull();

    mockFetch.mockResolvedValueOnce(sampleReport());
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("Core infrastructure");
  });

  it("keeps the placeholder up for its minimum time when the first read fails soon after it has appeared", async () => {
    let rejectRead: (error: unknown) => void = () => {};
    mockFetch.mockReturnValueOnce(new Promise((_resolve, reject) => (rejectRead = reject)));
    vi.useFakeTimers();
    try {
      renderWithToast(<HealthCheckPanel />);
      await advanceTimers(250);
      expect(screen.getByLabelText("Loading health checks").className).not.toContain("at-loading-hold");
      await act(async () => rejectRead(new ApiError(500, "secret_internal")));
      expect(screen.getByLabelText("Loading health checks")).toBeTruthy();
      expect(screen.queryByText("Could not load health checks")).toBeNull();
      await advanceTimers(500);
      expect(screen.getByText("Could not load health checks")).toBeTruthy();
      expect(screen.queryByLabelText("Loading health checks")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the error and a busy Retry on screen while it loads again, then shows the report", async () => {
    mockFetch.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderWithToast(<HealthCheckPanel />);
    const retry = await screen.findByRole("button", { name: "Retry" });
    let resolveRetry: (value: HealthReportDto) => void = () => {};
    mockFetch.mockReturnValueOnce(new Promise((resolve) => (resolveRetry = resolve)));
    fireEvent.click(retry);
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry" }).getAttribute("aria-busy")).toBe("true"));
    expect(screen.getByText("Could not load health checks")).toBeTruthy();
    expect(screen.queryByLabelText("Loading health checks")).toBeNull();
    await act(async () => resolveRetry(sampleReport()));
    await screen.findByText("Core infrastructure");
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("keeps Run live checks focusable and busy as Running… while it works, and ignores a second click", async () => {
    renderWithToast(<HealthCheckPanel />);
    const button = await screen.findByRole("button", { name: /Run live checks/ });
    let resolveLive: (value: HealthReportDto) => void = () => {};
    mockLive.mockReturnValueOnce(new Promise((resolve) => (resolveLive = resolve)));
    fireEvent.click(button);
    const busy = await screen.findByRole("button", { name: "Running…" });
    expect(busy).toBe(button);
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect((busy as HTMLButtonElement).disabled).toBe(false);
    expect(button.querySelector(".at-spinner, .at-btn__spinner")).toBeTruthy();
    fireEvent.click(busy);
    expect(mockLive).toHaveBeenCalledTimes(1);
    await act(async () => resolveLive(sampleReport({ overall: "ok" })));
    await waitFor(() => expect(button.getAttribute("aria-busy")).toBeNull());
  });

  it("shows the More actions item busy as Running… while live checks run", async () => {
    renderWithToast(<HealthCheckPanel />);
    await screen.findByRole("button", { name: /More actions/ });
    let resolveLive: (value: HealthReportDto) => void = () => {};
    mockLive.mockReturnValueOnce(new Promise((resolve) => (resolveLive = resolve)));
    fireEvent.click(screen.getByRole("button", { name: /More actions/ }));
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: /Run live checks/ }));
    await waitFor(() => expect(mockLive).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: /More actions/ }));
    const item = within(screen.getByRole("menu")).getByRole("menuitem", { name: /Running…/ });
    expect(item.getAttribute("aria-busy")).toBe("true");
    await act(async () => resolveLive(sampleReport()));
  });

  it("does not let a first read that answers late replace the results of live checks with an older report", async () => {
    let resolveFirst: (value: HealthReportDto) => void = () => {};
    mockFetch.mockReturnValueOnce(new Promise((resolve) => (resolveFirst = resolve)));
    let resolveQuiet: (value: HealthReportDto) => void = () => {};
    mockFetch.mockReturnValueOnce(new Promise((resolve) => (resolveQuiet = resolve)));
    // render() with a wrapper, not renderWithToast: a rerender of the latter would drop the ToastProvider.
    const { rerender } = render(<HealthCheckPanel isActive />, {
      wrapper: ({ children }) => <ToastProvider>{children}</ToastProvider>,
    });
    // Leaving the tab and coming back reads the report again, quietly: it answers before the first read does.
    rerender(<HealthCheckPanel isActive={false} />);
    rerender(<HealthCheckPanel isActive />);
    await act(async () => resolveQuiet(sampleReport()));
    await screen.findByText("Core infrastructure");
    mockLive.mockResolvedValueOnce(sampleReport({ groups: [{ id: "live", label: "Live results", status: "ok", checks: [] }] }));
    fireEvent.click(screen.getByRole("button", { name: /Run live checks/ }));
    await screen.findByText("Live results");
    await act(async () =>
      resolveFirst(sampleReport({ groups: [{ id: "old", label: "Old report", status: "ok", checks: [] }] })),
    );
    expect(screen.getByText("Live results")).toBeTruthy();
    expect(screen.queryByText("Old report")).toBeNull();
  });

  it("expands and collapses a row to show detail values", async () => {
    renderWithToast(<HealthCheckPanel />);
    await screen.findByText("Database");

    const rowBtn = screen.getByRole("button", { name: /Database/ });
    // The details list is a sibling of the button, not a descendant, and `rate_limit_storage`
    // (degraded) auto-opens its own "Latency" detail by default - scope to the row wrapper so
    // Database's own detail values are asserted, not the first match anywhere on the page.
    const row = rowBtn.closest(".health-check__row") as HTMLElement;
    expect(within(rowBtn).getByText("Status: Healthy")).toBeTruthy();
    expect(screen.getByText("Status: Down")).toBeTruthy();
    expect(rowBtn.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(rowBtn);
    expect(rowBtn.getAttribute("aria-expanded")).toBe("true");
    expect(within(row).getByText("Latency")).toBeTruthy();
    expect(within(row).getByText("4 ms")).toBeTruthy();
    expect(within(row).getByText("PostgreSQL 16.0")).toBeTruthy();

    fireEvent.click(rowBtn);
    expect(rowBtn.getAttribute("aria-expanded")).toBe("false");
    expect(within(row).queryByText("4 ms")).toBeNull();
  });

  it("toasts success after live checks when overall is ok", async () => {
    renderWithToast(<HealthCheckPanel />);
    await screen.findByRole("button", { name: /Run live checks/ });

    mockLive.mockResolvedValueOnce(sampleReport({ overall: "ok" }));
    fireEvent.click(screen.getByRole("button", { name: /Run live checks/ }));

    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Live checks finished/);
    });
    expect(screen.getByTestId("at-toast").getAttribute("data-variant")).toBe("success");
  });

  it("toasts warning when live overall is degraded", async () => {
    renderWithToast(<HealthCheckPanel />);
    await screen.findByRole("button", { name: /Run live checks/ });

    mockLive.mockResolvedValueOnce(sampleReport({ overall: "degraded" }));
    fireEvent.click(screen.getByRole("button", { name: /Run live checks/ }));

    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(
        /Live checks finished with warnings/,
      );
    });
    expect(screen.getByTestId("at-toast").getAttribute("data-variant")).toBe("warning");
  });

  it("toasts error when live overall is down", async () => {
    renderWithToast(<HealthCheckPanel />);
    await screen.findByRole("button", { name: /Run live checks/ });

    mockLive.mockResolvedValueOnce(sampleReport({ overall: "down" }));
    fireEvent.click(screen.getByRole("button", { name: /Run live checks/ }));

    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(
        /Live checks finished with outages/,
      );
    });
    expect(screen.getByTestId("at-toast").getAttribute("data-variant")).toBe("error");
  });

  it("toasts a wait message when live checks are rate limited", async () => {
    renderWithToast(<HealthCheckPanel />);
    await screen.findByRole("button", { name: /Run live checks/ });

    mockLive.mockRejectedValueOnce(new ApiError(429, "health_live_rate_limited"));
    fireEvent.click(screen.getByRole("button", { name: /Run live checks/ }));

    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(
        /Too many live checks right now/,
      );
    });
  });

  it("toasts operator-safe error when live checks reject", async () => {
    renderWithToast(<HealthCheckPanel />);
    await screen.findByRole("button", { name: /Run live checks/ });

    mockLive.mockRejectedValueOnce(new ApiError(500, "secret_live_fail"));
    fireEvent.click(screen.getByRole("button", { name: /Run live checks/ }));

    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Live checks failed/);
    });
    expect(screen.queryByText("secret_live_fail")).toBeNull();
  });

  it("runs live checks from the More actions menu (mobile mirror of the header button)", async () => {
    renderWithToast(<HealthCheckPanel />);
    await screen.findByRole("button", { name: /More actions/ });

    mockLive.mockResolvedValueOnce(sampleReport({ overall: "ok" }));
    fireEvent.click(screen.getByRole("button", { name: /More actions/ }));
    fireEvent.click(
      within(screen.getByRole("menu")).getByRole("menuitem", { name: /Run live checks/ }),
    );

    await waitFor(() => {
      expect(mockLive).toHaveBeenCalled();
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Live checks finished/);
    });
    // Menu closes on selection, same as the other More actions items.
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("describes every live probe, and the More actions item uses the same text", async () => {
    expect(LIVE_CHECKS_HINT).toMatch(/address lookup/);
    expect(LIVE_CHECKS_HINT).toMatch(/weather/);
    expect(LIVE_CHECKS_HINT).toMatch(/mail connection/);
    expect(LIVE_CHECKS_HINT).toMatch(/identity providers/);
    expect(LIVE_CHECKS_HINT).toMatch(/Cloudflare Access/);
    expect(LIVE_CHECKS_HINT).toMatch(/upload folder/);

    renderWithToast(<HealthCheckPanel />);
    await screen.findByRole("button", { name: /More actions/ });
    fireEvent.click(screen.getByRole("button", { name: /More actions/ }));
    expect(within(screen.getByRole("menu")).getByText(LIVE_CHECKS_HINT)).toBeTruthy();
  });

  it("copies a Markdown snapshot via More actions", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    renderWithToast(<HealthCheckPanel />);
    await screen.findByRole("button", { name: /More actions/ });

    fireEvent.click(screen.getByRole("button", { name: /More actions/ }));
    const menu = screen.getByRole("menu");
    fireEvent.click(within(menu).getByRole("menuitem", { name: /Copy for GitHub Issue/ }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalled();
      expect(screen.getByTestId("at-toast").textContent).toMatch(
        /Health snapshot copied to clipboard/,
      );
    });
    expect(String(writeText.mock.calls[0]![0])).toContain("### Admitto health snapshot");
    expect(String(writeText.mock.calls[0]![0])).toContain(
      `Version: v${__APP_VERSION__} (${__APP_COMMIT__})`,
    );
  });

  it("toasts when clipboard copy is blocked", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });

    renderWithToast(<HealthCheckPanel />);
    await screen.findByRole("button", { name: /More actions/ });

    fireEvent.click(screen.getByRole("button", { name: /More actions/ }));
    fireEvent.click(
      within(screen.getByRole("menu")).getByRole("menuitem", { name: /Copy for GitHub Issue/ }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(
        /Could not copy\. Clipboard access was blocked/,
      );
    });
  });

  it("exports a Markdown download via More actions", async () => {
    const click = vi.fn();
    const createObjectURL = vi.fn(() => "blob:health-md");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL,
      revokeObjectURL,
    });
    const realCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = realCreateElement(tag);
      if (tag === "a") {
        Object.defineProperty(el, "click", { value: click });
      }
      return el;
    });

    renderWithToast(<HealthCheckPanel />);
    await screen.findByRole("button", { name: /More actions/ });

    fireEvent.click(screen.getByRole("button", { name: /More actions/ }));
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: /^Export/ }));

    await waitFor(() => {
      expect(createObjectURL).toHaveBeenCalled();
      expect(click).toHaveBeenCalled();
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Health snapshot downloaded/);
    });
  });

  it("ignores aborted passive loads on unmount", async () => {
    let resolveFetch!: (value: HealthReportDto) => void;
    mockFetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const { unmount } = renderWithToast(<HealthCheckPanel />);
    expect(screen.getByLabelText("Loading health checks")).toBeTruthy();
    unmount();

    await act(async () => {
      resolveFetch(sampleReport());
    });
    // No throw / no leftover loading UI after abort.
    expect(screen.queryByLabelText("Loading health checks")).toBeNull();
  });

  it("gives group titles their own h2 heading", async () => {
    renderWithToast(<HealthCheckPanel />);
    expect(
      await screen.findByRole("heading", { level: 2, name: "Core infrastructure" }),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "External integrations" })).toBeTruthy();
  });

  it.each<[HealthRowStatus[], string]>([
    [["ok", "not_configured", "planned"], "No problems found."],
    [["degraded"], "1 check is degraded."],
    [["degraded", "degraded", "degraded"], "3 checks are degraded."],
    [["down"], "1 check is down."],
    [["down", "down"], "2 checks are down."],
    [["down", "degraded", "degraded"], "1 check is down and 2 are degraded."],
    [["down", "down", "degraded"], "2 checks are down and 1 is degraded."],
  ])("shows the verdict sentence for %j", async (statuses, expectedText) => {
    mockFetch.mockResolvedValueOnce(reportWithStatuses(statuses));
    renderWithToast(<HealthCheckPanel />);
    expect(await screen.findByText(expectedText)).toBeTruthy();
  });

  it.each<[HealthRowStatus[], string]>([
    [["ok"], "at-notice--success"],
    [["degraded"], "at-notice--warning"],
    [["down"], "at-notice--error"],
    [["down", "degraded"], "at-notice--error"],
  ])("colours the verdict notice for %j", async (statuses, expectedClass) => {
    mockFetch.mockResolvedValueOnce(reportWithStatuses(statuses));
    const { container } = renderWithToast(<HealthCheckPanel />);
    await screen.findByText("Core infrastructure");
    expect(container.querySelector(".health-check__verdict")?.className).toContain(expectedClass);
  });

  function reportWithOneCheck(status: HealthRowStatus): HealthReportDto {
    return sampleReport({
      overall: "ok",
      groups: [
        {
          id: "core",
          label: "Core infrastructure",
          subtitle: "Owned and run by this instance",
          status: "ok",
          checks: [{ id: "test_check", label: "Test check", status, summary: "Summary text", details: [] }],
        },
      ],
    });
  }

  it.each<[HealthRowStatus, string, string, string]>([
    ["ok", "ok", "check", "Healthy"],
    ["degraded", "warn", "alert-triangle", "Degraded"],
    ["down", "error", "x", "Down"],
    ["not_configured", "neutral", "minus", "Not configured"],
  ])(
    "renders a %s row with a %s status circle and %s glyph, and no separate status badge",
    async (status, circleVariant, glyph, srWord) => {
      mockFetch.mockResolvedValueOnce(reportWithOneCheck(status));
      renderWithToast(<HealthCheckPanel />);
      const rowBtn = await screen.findByRole("button", { name: /Test check/ });

      expect(rowBtn.querySelector(`.status-circle--${circleVariant} .ti-${glyph}`)).toBeTruthy();
      // The circle's colour and glyph carry the state; a badge would only repeat it (and, for
      // not_configured, the summary word for word). Screen readers still get the status.
      expect(rowBtn.querySelector(".at-badge")).toBeNull();
      expect(within(rowBtn).getByText(`Status: ${srWord}`).className).toBe("sr-only");
    },
  );

  it("gives a not_configured row a quiet label instead of a coloured border", async () => {
    mockFetch.mockResolvedValueOnce(reportWithOneCheck("not_configured"));
    const { container } = renderWithToast(<HealthCheckPanel />);
    await screen.findByText("Test check");
    expect(container.querySelector(".health-check__row--quiet")).toBeTruthy();
    expect(container.querySelector(".health-check__row--warn")).toBeNull();
    expect(container.querySelector(".health-check__row--err")).toBeNull();
  });

  it("never colours the summary text by row severity", async () => {
    mockFetch.mockResolvedValueOnce(reportWithOneCheck("down"));
    renderWithToast(<HealthCheckPanel />);
    const rowBtn = await screen.findByRole("button", { name: /Test check/ });
    const summary = within(rowBtn).getByText("Summary text");
    expect(summary.className).toBe("health-check__summary");
  });

  function reportWithMixedOrder(): HealthReportDto {
    return sampleReport({
      overall: "ok",
      groups: [
        {
          id: "core",
          label: "Core infrastructure",
          subtitle: "Owned and run by this instance",
          status: "ok",
          checks: [
            { id: "a", label: "Alpha", status: "ok", summary: "s", details: [] },
            { id: "b", label: "Bravo", status: "not_configured", summary: "s", details: [] },
            { id: "c", label: "Charlie", status: "degraded", summary: "s", details: [] },
            { id: "d", label: "Delta", status: "down", summary: "s", details: [] },
            { id: "e", label: "Echo", status: "ok", summary: "s", details: [] },
          ],
        },
      ],
    });
  }

  it("sorts rows within a group as down, degraded, ok, not configured, stably", async () => {
    mockFetch.mockResolvedValueOnce(reportWithMixedOrder());
    renderWithToast(<HealthCheckPanel />);
    await screen.findByText("Alpha");

    const labels = screen
      .getAllByText(/^(Alpha|Bravo|Charlie|Delta|Echo)$/)
      .map((el) => el.textContent);
    // Alpha before Echo: both "ok", so the stable sort keeps their original relative order.
    expect(labels).toEqual(["Delta", "Charlie", "Alpha", "Echo", "Bravo"]);
  });

  it("auto-opens down and degraded rows, leaves healthy and not_configured collapsed", async () => {
    mockFetch.mockResolvedValueOnce(reportWithMixedOrder());
    renderWithToast(<HealthCheckPanel />);
    await screen.findByText("Alpha");

    expect(screen.getByRole("button", { name: /Delta/ }).getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: /Charlie/ }).getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: /Alpha/ }).getAttribute("aria-expanded")).toBe(
      "false",
    );
    expect(screen.getByRole("button", { name: /Bravo/ }).getAttribute("aria-expanded")).toBe(
      "false",
    );
  });

  it("remembers a manual collapse across a live re-run that keeps the same status", async () => {
    mockFetch.mockResolvedValueOnce(reportWithMixedOrder());
    renderWithToast(<HealthCheckPanel />);
    const deltaBtn = await screen.findByRole("button", { name: /Delta/ });
    expect(deltaBtn.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(deltaBtn);
    expect(deltaBtn.getAttribute("aria-expanded")).toBe("false");

    mockLive.mockResolvedValueOnce(reportWithMixedOrder());
    fireEvent.click(screen.getByRole("button", { name: /Run live checks/ }));
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Live checks finished/);
    });
    expect(screen.getByRole("button", { name: /Delta/ }).getAttribute("aria-expanded")).toBe(
      "false",
    );
  });

  it("discards a manual collapse once a live run changes that row's status", async () => {
    mockFetch.mockResolvedValueOnce(reportWithMixedOrder());
    renderWithToast(<HealthCheckPanel />);
    const charlieBtn = await screen.findByRole("button", { name: /Charlie/ });
    expect(charlieBtn.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(charlieBtn);
    expect(charlieBtn.getAttribute("aria-expanded")).toBe("false");

    // Charlie goes from degraded to down - the override was pinned to "degraded", so it no
    // longer applies and the row falls back to its new default (open), per the spec's own
    // example: "a row collapsed while degraded re-opens when a later live run makes it down".
    const nextReport = reportWithMixedOrder();
    nextReport.groups[0]!.checks[2]!.status = "down";
    mockLive.mockResolvedValueOnce(nextReport);
    fireEvent.click(screen.getByRole("button", { name: /Run live checks/ }));
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Live checks finished/);
    });
    expect(screen.getByRole("button", { name: /Charlie/ }).getAttribute("aria-expanded")).toBe(
      "true",
    );
  });

  it("does not resurrect a stale override once a row's status returns to its earlier value", async () => {
    mockFetch.mockResolvedValueOnce(reportWithMixedOrder());
    renderWithToast(<HealthCheckPanel />);
    const charlieBtn = await screen.findByRole("button", { name: /Charlie/ });
    expect(charlieBtn.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(charlieBtn); // manually collapse while degraded
    expect(charlieBtn.getAttribute("aria-expanded")).toBe("false");

    // First live run: degraded -> down. The stale override must be dropped here, not just
    // bypassed for this one report (see "discards a manual collapse..." above).
    const downReport = reportWithMixedOrder();
    downReport.groups[0]!.checks[2]!.status = "down";
    mockLive.mockResolvedValueOnce(downReport);
    fireEvent.click(screen.getByRole("button", { name: /Run live checks/ }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Charlie/ }).getAttribute("aria-expanded")).toBe(
        "true",
      );
    });

    // Second live run: back to degraded. If the override had merely been bypassed instead of
    // dropped, its stored status ("degraded") would once again match and resurrect the
    // original collapse - the row must stay open instead.
    mockLive.mockResolvedValueOnce(reportWithMixedOrder());
    fireEvent.click(screen.getByRole("button", { name: /Run live checks/ }));
    await waitFor(() => {
      expect(mockLive).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByRole("button", { name: /Charlie/ }).getAttribute("aria-expanded")).toBe(
      "true",
    );
  });

  function reportWithWorker(lastBeatAt: string): HealthReportDto {
    return sampleReport({
      generated_at: "2026-08-03T12:54:24.000Z",
      overall: "ok",
      groups: [
        {
          id: "core",
          label: "Core infrastructure",
          subtitle: "Owned and run by this instance",
          status: "ok",
          checks: [
            {
              id: "background_worker",
              label: "Background worker",
              status: "ok",
              summary: "Worker heartbeat is fresh",
              details: [
                { key: "status", value: "ok" },
                { key: "last_beat_at", value: lastBeatAt },
                { key: "hostname", value: "worker-1" },
                { key: "last_checked", value: "2026-08-03T12:54:00.000Z" },
              ],
            },
          ],
        },
      ],
    });
  }

  it("shows the worker's Last seen in the expanded details, not in the row header", async () => {
    mockFetch.mockResolvedValueOnce(reportWithWorker("2026-08-03T12:42:24.000Z"));
    renderWithToast(<HealthCheckPanel />);
    const rowBtn = await screen.findByRole("button", { name: /Background worker/ });
    const row = rowBtn.closest(".health-check__row") as HTMLElement;
    expect(within(rowBtn).queryByText(/Last seen/)).toBeNull();

    fireEvent.click(rowBtn);
    const label = within(row).getByText("Last seen");
    expect(label.tagName).toBe("DT");
    expect(label.nextElementSibling?.textContent).toBe("12 min before this report");
  });

  it("shows the raw heartbeat time for a heartbeat under a minute old, and hides status/last_checked", async () => {
    mockFetch.mockResolvedValueOnce(reportWithWorker("2026-08-03T12:54:00.000Z"));
    renderWithToast(<HealthCheckPanel />);
    const rowBtn = await screen.findByRole("button", { name: /Background worker/ });
    const row = rowBtn.closest(".health-check__row") as HTMLElement;
    fireEvent.click(rowBtn);
    expect(within(row).queryByText("Last seen")).toBeNull();
    expect(within(row).getByText("Hostname")).toBeTruthy();
    expect(within(row).queryByText("Status")).toBeNull();
    expect(within(row).queryByText("Last checked")).toBeNull();
    // The age was omitted (too fresh), so the raw timestamp still shows up in the details
    // instead of being lost entirely.
    expect(within(row).getByText(formatEventDateTime("2026-08-03T12:54:00.000Z", getBrowserTimeZone()))).toBeTruthy();
  });

  function reportWithGuidanceRows(): HealthReportDto {
    return sampleReport({
      overall: "down",
      groups: [
        {
          id: "core",
          label: "Core infrastructure",
          subtitle: "Owned and run by this instance",
          status: "down",
          checks: [
            { id: "database", label: "Database", status: "down", summary: "Not reachable", details: [] },
          ],
        },
        {
          id: "external",
          label: "External integrations",
          subtitle: "Third-party APIs this instance depends on",
          status: "down",
          checks: [
            {
              id: "email_sending",
              label: "Email sending",
              status: "down",
              summary: "Unreachable",
              details: [{ key: "live_check", value: "failed" }],
            },
          ],
        },
      ],
    });
  }

  it("shows guidance above the detail list for a problem row, with no link when none applies", async () => {
    mockFetch.mockResolvedValueOnce(reportWithGuidanceRows());
    renderWithToastAndRouter(<HealthCheckPanel />);
    const rowBtn = await screen.findByRole("button", { name: /Database/ });
    const row = rowBtn.closest(".health-check__row") as HTMLElement;

    expect(
      within(row).getByText("Admitto cannot read or save attendees, events or settings."),
    ).toBeTruthy();
    expect(
      within(row).getByText("Check that the database service is running and that DATABASE_URL is correct."),
    ).toBeTruthy();
    expect(within(row).queryByRole("link")).toBeNull();

    // Both lines are labelled rows in the same grid as the detail list.
    expect(within(row).getByText("Why").tagName).toBe("DT");
    expect(within(row).getByText("Admitto could not connect to the database.")).toBeTruthy();
    expect(within(row).getByText("What it affects").tagName).toBe("DT");
    expect(within(row).getByText("What to do").tagName).toBe("DT");

    // Guidance renders before the detail list in DOM order.
    const body = row.querySelector(".health-check__body") as HTMLElement;
    const guidanceEl = body.querySelector(".health-check__guidance");
    const detailsEl = body.querySelector(".health-check__details");
    expect(guidanceEl).toBeTruthy();
    if (detailsEl) {
      expect(guidanceEl?.compareDocumentPosition(detailsEl)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    }
  });

  it("shows a guidance link to the relevant settings tab when one applies", async () => {
    mockFetch.mockResolvedValueOnce(reportWithGuidanceRows());
    renderWithToastAndRouter(<HealthCheckPanel />);
    const rowBtn = await screen.findByRole("button", { name: /Email sending/ });
    const row = rowBtn.closest(".health-check__row") as HTMLElement;

    const link = within(row).getByRole("link", { name: /Open Mail settings/ });
    expect(link.getAttribute("href")).toBe("/admin/settings?tab=mail");
    // A plain text link: the arrow icon made the hover underline stop short of the link's end.
    expect(link.querySelector(".ti")).toBeNull();
  });

  it("shows no guidance block for a healthy row", async () => {
    renderWithToast(<HealthCheckPanel />);
    const rowBtn = await screen.findByRole("button", { name: /Database/ });
    const row = rowBtn.closest(".health-check__row") as HTMLElement;
    fireEvent.click(rowBtn);
    expect(row.querySelector(".health-check__guidance")).toBeNull();
  });

  it("shows a quiet note with a Mail settings link when email_sending is not configured", async () => {
    mockFetch.mockResolvedValueOnce(
      sampleReport({
        overall: "ok",
        groups: [
          {
            id: "external",
            label: "External integrations",
            subtitle: "Third-party APIs this instance depends on",
            status: "ok",
            checks: [
              {
                id: "email_sending",
                label: "Email sending",
                status: "not_configured",
                summary: "Not configured",
                details: [{ key: "configured", value: "no" }],
              },
            ],
          },
        ],
      }),
    );
    renderWithToastAndRouter(<HealthCheckPanel />);
    const rowBtn = await screen.findByRole("button", { name: /Email sending/ });
    const row = rowBtn.closest(".health-check__row") as HTMLElement;
    fireEvent.click(rowBtn);

    expect(within(row).getByText("No organisation mail provider is set.")).toBeTruthy();
    const link = within(row).getByRole("link", { name: /Open Mail settings/ });
    expect(link.getAttribute("href")).toBe("/admin/settings?tab=mail");
    expect(row.querySelector(".health-check__guidance--quiet")).toBeTruthy();
  });
});
