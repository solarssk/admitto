// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { ToastProvider } from "@admitto/ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditLogEntryDto, SecurityAuditLogEntryDto, SystemLogResponse } from "../../src/api/types.js";
import { mockMatchMedia } from "../test-utils.js";

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    fetchAdminEvents: vi.fn(),
    fetchAuditLog: vi.fn(),
    fetchSecurityAuditLog: vi.fn(),
    exportAuditLog: vi.fn(),
    exportSecurityAuditLog: vi.fn(),
    fetchSystemLogs: vi.fn(),
  };
});

vi.mock("../../src/connection/ConnectionStateProvider.js", () => ({
  useConnectionState: () => ({ reportApiError: vi.fn() }),
}));

import { fetchAdminEvents, fetchAuditLog, fetchSecurityAuditLog, fetchSystemLogs } from "../../src/api/client.js";
import { AuditLogPanel } from "../../src/settings/AuditLogPanel.js";
import { resetPollIntervalMsForTests, setPollIntervalMsForTests } from "../../src/settings/SystemLogsPanel.js";

const auditEntry: AuditLogEntryDto = {
  id: "a1",
  action_type: "event_created",
  actor_user_id: "user-1",
  actor_email: "alice@example.com",
  actor_display_name: "Alice Admin",
  actor_timezone: "Europe/Warsaw",
  ip: "192.0.2.10",
  country: { kind: "internal" },
  metadata: null,
  created_at: "2026-06-15T12:00:00.000Z",
};

const securityEntry: SecurityAuditLogEntryDto = {
  id: "s1",
  event_type: "auth.login.success",
  user_id: "user-1",
  user_email: "alice@example.com",
  user_display_name: "Alice Admin",
  ip: "198.51.100.7",
  country: { kind: "internal" },
  actor_timezone: null,
  metadata: null,
  created_at: "2026-06-15T12:00:00.000Z",
};

function LocationProbe() {
  return <output data-testid="url">{useLocation().search}</output>;
}

function renderPanel(search = "?tab=logs") {
  return render(
    <MemoryRouter initialEntries={[`/admin/settings${search}`]}>
      <ToastProvider>
        <AuditLogPanel />
        <LocationProbe />
      </ToastProvider>
    </MemoryRouter>,
  );
}

const isChecked = (name: string) => screen.getByRole("radio", { name }).getAttribute("aria-checked") === "true";

beforeEach(() => {
  mockMatchMedia(true);
  setPollIntervalMsForTests(600_000);
  Element.prototype.scrollIntoView = vi.fn();
  vi.mocked(fetchAdminEvents).mockResolvedValue([]);
  vi.mocked(fetchAuditLog).mockResolvedValue({ entries: [auditEntry], total: 1, page: 1, pageSize: 25 });
  vi.mocked(fetchSecurityAuditLog).mockResolvedValue({ entries: [securityEntry], total: 1, page: 1, pageSize: 25 });
  vi.mocked(fetchSystemLogs).mockResolvedValue({ entries: [], cursor: 0 } as SystemLogResponse);
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
  resetPollIntervalMsForTests();
});

describe("the tables of the Logs tab", () => {
  it("draws Audit and Security in the shared box of a padded card, and asks for 1024px for the tables and 768px for the toolbar", async () => {
    const queries: string[] = [];
    vi.stubGlobal("matchMedia", (query: string) => {
      queries.push(query);
      return { matches: true, media: query, addEventListener: () => undefined, removeEventListener: () => undefined };
    });
    const { container } = renderPanel("?tab=logs&log=audit");

    await waitFor(() => expect(container.querySelectorAll(".audit-log-box")).toHaveLength(2));
    for (const variant of ["audit", "security"]) {
      const table = container.querySelector(`.item-table.audit-log-box--${variant} > .attendees-table-wrap > table.table`);
      expect(table, variant).toBeTruthy();
      // A box inside the padded body of the card, not a table bled to its edges.
      expect(table!.closest(".at-card")?.querySelector(".at-card__body")?.contains(table)).toBe(true);
    }
    expect(container.querySelector(".audit-log-table-wrap")).toBeNull();
    expect(queries).toContain("(min-width: 1024px)");
    expect(queries).toContain("(min-width: 768px)");
  });

  it("draws cards, not tables, below 1024px", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(min-width: 768px)",
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    const { container } = renderPanel("?tab=logs&log=audit");

    await waitFor(() => expect(container.querySelectorAll(".audit-log-card").length).toBeGreaterThan(0));
    expect(container.querySelector("table")).toBeNull();
  });

  it("keeps the columns of Audit in the order their widths are written for, with Scope and the IP address the ones a narrower screen folds", async () => {
    const { container } = renderPanel("?tab=logs&log=audit");
    await waitFor(() => expect(container.querySelector(".audit-log-box--audit tbody tr")).toBeTruthy());

    // audit-log-table.css writes the widths by position, so a column moved here would take another column's width.
    const head = [...container.querySelectorAll(".audit-log-box--audit thead th")];
    expect(head.map((th) => th.textContent?.trim())).toEqual(["Time", "Action", "Scope", "User", "IP address", "Details"]);
    expect(head.filter((th) => th.classList.contains("audit-log-table__from-1280")).map((th) => th.textContent?.trim())).toEqual(["Scope"]);
    expect(head.filter((th) => th.classList.contains("audit-log-table__from-1180")).map((th) => th.textContent?.trim())).toEqual(["IP address"]);

    const row = container.querySelector(".audit-log-box--audit tbody tr")!;
    expect(row.children).toHaveLength(6);
    expect(row.children[2]!.classList.contains("audit-log-table__from-1280")).toBe(true);
    expect(row.children[4]!.classList.contains("audit-log-table__from-1180")).toBe(true);
    // What a folded column leaves: the scope under the action, the IP address under the user.
    expect(row.children[1]!.querySelector(".audit-log-table__below-1280")?.textContent).toBe("Instance");
    expect(row.children[3]!.querySelector(".audit-log-table__below-1180")?.textContent).toContain("192.0.2.10");
  });

  it("keeps the columns of Security in the order their widths are written for, and calls the first one Action, not Event", async () => {
    const { container } = renderPanel("?tab=logs&log=security");
    await waitFor(() => expect(container.querySelector(".audit-log-box--security tbody tr")).toBeTruthy());

    const head = [...container.querySelectorAll(".audit-log-box--security thead th")];
    // An event is a gathering of people; what a row of this log records is an action.
    expect(head.map((th) => th.textContent?.trim())).toEqual(["Time", "Action", "User", "IP address", "Details"]);
    expect(head.filter((th) => th.classList.contains("audit-log-table__from-1180")).map((th) => th.textContent?.trim())).toEqual(["IP address"]);
    expect(head.some((th) => th.classList.contains("audit-log-table__from-1280"))).toBe(false);

    const row = container.querySelector(".audit-log-box--security tbody tr")!;
    expect(row.children).toHaveLength(5);
    expect(row.children[2]!.querySelector(".audit-log-table__below-1180")?.textContent).toContain("198.51.100.7");
  });
});

describe("the view of the Logs tab in the URL", () => {
  it.each([
    ["?tab=logs", "System"],
    ["?tab=logs&log=system", "System"],
    ["?tab=logs&log=audit", "Audit"],
    ["?tab=logs&log=security", "Security"],
    ["?tab=logs&log=nonsense", "System"],
  ])("opens %s on %s", (search, view) => {
    renderPanel(search);
    for (const name of ["System", "Audit", "Security"]) expect(isChecked(name), name).toBe(name === view);
  });

  it("writes the view to the URL when it is changed, keeps the tab, and does not add a step to go back to", () => {
    renderPanel("?tab=logs");
    expect(screen.getByTestId("url").textContent).toBe("?tab=logs");

    fireEvent.click(screen.getByRole("radio", { name: "Audit" }));
    expect(screen.getByTestId("url").textContent).toBe("?tab=logs&log=audit");
    expect(isChecked("Audit")).toBe(true);

    fireEvent.click(screen.getByRole("radio", { name: "Security" }));
    expect(screen.getByTestId("url").textContent).toBe("?tab=logs&log=security");
    expect(isChecked("Security")).toBe(true);
    expect(isChecked("Audit")).toBe(false);
  });

  it("opens the same view again from the URL it wrote, as a refresh does", () => {
    const first = renderPanel("?tab=logs");
    fireEvent.click(screen.getByRole("radio", { name: "Security" }));
    const search = screen.getByTestId("url").textContent ?? "";
    first.unmount();

    renderPanel(search);
    expect(isChecked("Security")).toBe(true);
  });
});
