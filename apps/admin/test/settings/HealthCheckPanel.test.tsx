// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HealthCheckPanel } from "../../src/settings/HealthCheckPanel.js";
import { renderWithToast } from "../test-utils.js";
import type { HealthReportDto } from "../../src/api/types.js";

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
            status: "planned",
            summary: "Coming later",
            details: [{ key: "availability", value: "later_release" }],
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
            status: "not_configured",
            summary: "Coming in a later release",
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

describe("HealthCheckPanel", () => {
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
    expect(screen.getByText("Loading health checks…")).toBeTruthy();
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

  it("shows loading copy while the passive fetch is in flight", () => {
    mockFetch.mockImplementationOnce(() => new Promise(() => {}));
    renderWithToast(<HealthCheckPanel />);
    expect(screen.getByText("Loading health checks…")).toBeTruthy();
  });

  it("renders groups and meta after a successful load", async () => {
    renderWithToast(<HealthCheckPanel />);
    await screen.findByText("Core infrastructure");
    expect(screen.getByText("External integrations")).toBeTruthy();
    expect(screen.getByText("Database")).toBeTruthy();
    expect(screen.getByText(/Generated/)).toBeTruthy();
    expect(screen.getByText(/v0\.4\.13 · a955ac9/)).toBeTruthy();
    expect(screen.getByTitle("Your local time")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Run live checks/ })).toBeTruthy();
  });

  it("omits commit from meta when commit is unknown", async () => {
    mockFetch.mockResolvedValueOnce(sampleReport({ commit: "unknown" }));
    renderWithToast(<HealthCheckPanel />);
    await screen.findByText("Core infrastructure");
    expect(screen.getByText(/v0\.4\.13$/)).toBeTruthy();
    expect(screen.queryByText(/a955ac9/)).toBeNull();
  });

  it("shows EmptyState with Retry when the passive load fails", async () => {
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

  it("expands and collapses a row to show detail values", async () => {
    renderWithToast(<HealthCheckPanel />);
    await screen.findByText("Database");

    const rowBtn = screen.getByRole("button", { name: /Database/ });
    expect(within(rowBtn).getByText("Status: Healthy")).toBeTruthy();
    expect(screen.getByText("Status: Down")).toBeTruthy();
    expect(rowBtn.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(rowBtn);
    expect(rowBtn.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Latency")).toBeTruthy();
    expect(screen.getByText("4 ms")).toBeTruthy();
    expect(screen.getByText("PostgreSQL 16.0")).toBeTruthy();

    fireEvent.click(rowBtn);
    expect(rowBtn.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("4 ms")).toBeNull();
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
    expect(screen.getByText("Loading health checks…")).toBeTruthy();
    unmount();

    await act(async () => {
      resolveFetch(sampleReport());
    });
    // No throw / no leftover loading UI after abort.
    expect(screen.queryByText("Loading health checks…")).toBeNull();
  });
});
