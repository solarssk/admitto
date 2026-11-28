// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { CommunicationPage } from "../../src/pages/CommunicationPage.js";
import { mockMatchMedia, renderWithToast } from "../test-utils.js";
import { communicationApiMocks } from "./communicationApiMock.js";
import { acceptedRow, failedRow } from "./deliveryFixtures.js";

const { fetchEventOverview, fetchEventTemplate, fetchEventTemplates, fetchEventDeliveries } = communicationApiMocks;
const outletContext = vi.hoisted(() => ({
  event: { id: "evt-1", title: "Demo", archived_at: null as string | null, timezone: "Europe/Warsaw" },
}));

vi.mock("../../src/connection/ConnectionStateProvider.js");

// Loaded inside the factory, as in CommunicationPage.deliveryLog.test.tsx: vi.mock() hoists above the imports.
vi.mock("../../src/api/client.js", async (importOriginal) => {
  const { buildCommunicationApiMock } = await import("./communicationApiMock.js");
  return buildCommunicationApiMock(await importOriginal<typeof import("../../src/api/client.js")>());
});

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    useBlocker: () => ({ state: "unblocked", proceed: vi.fn(), reset: vi.fn() }),
    useOutletContext: () => outletContext,
  };
});

beforeEach(() => {
  fetchEventTemplates.mockResolvedValue([]);
  fetchEventTemplate.mockResolvedValue({
    source: "event" as const,
    allowed_placeholders: ["first_name"],
    required_url_placeholders: [],
    image_placeholders: [],
    subject_template: "Hello",
    body_template: "<p>Hi</p>",
    template_format: "html" as const,
  });
  fetchEventOverview.mockResolvedValue({ email_bounced: 0, email_failed: 0, email_sent: 0, email_queued: 0 });
  fetchEventDeliveries.mockResolvedValue({ items: [acceptedRow, failedRow], total: 2 });
  mockMatchMedia(true);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function renderPage() {
  return renderWithToast(
    <MemoryRouter initialEntries={["/admin/events/evt-1/communication"]}>
      <Routes>
        <Route path="/admin/events/:eventId/communication" element={<CommunicationPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function openDeliveryLog() {
  fireEvent.click(await screen.findByRole("tab", { name: /Delivery log/i }));
}

describe("the Delivery log table", () => {
  it("draws the log in the shared box of a padded card, and asks for 1024px for the table", async () => {
    const queries: string[] = [];
    vi.stubGlobal("matchMedia", (query: string) => {
      queries.push(query);
      return { matches: true, media: query, addEventListener: () => undefined, removeEventListener: () => undefined };
    });
    const { container } = renderPage();
    await openDeliveryLog();

    await waitFor(() => expect(container.querySelectorAll(".delivery-log-box tbody tr")).toHaveLength(2));
    const table = container.querySelector(".item-table.delivery-log-box > .attendees-table-wrap > table.table");
    expect(table).toBeTruthy();
    // A box inside the padded body of the card, not a table bled to its edges.
    expect(table!.closest(".at-card")?.querySelector(".at-card__body")?.contains(table)).toBe(true);
    expect(container.querySelector(".communication-table-wrap")).toBeNull();
    expect(queries).toContain("(min-width: 1024px)");
  });

  it("draws cards, not a table, below 1024px", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(min-width: 768px)",
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    const { container } = renderPage();
    await openDeliveryLog();

    await waitFor(() => expect(container.querySelectorAll(".communication-card")).toHaveLength(2));
    expect(container.querySelector(".delivery-log-box")).toBeNull();
  });

  it("keeps the columns in the order their widths are written for, with Template and Purpose the two that a narrower screen folds", async () => {
    const { container } = renderPage();
    await openDeliveryLog();
    await waitFor(() => expect(container.querySelectorAll(".delivery-log-box tbody tr")).toHaveLength(2));

    // delivery-log-table.css writes the widths by position, so a column moved here would take another column's width.
    const head = [...container.querySelectorAll(".delivery-log-box thead th")];
    expect(head.map((th) => th.textContent?.trim())).toEqual(["Recipient", "Template", "Purpose", "Status", "Sent / Queued", "Actions"]);
    expect(head.filter((th) => th.classList.contains("delivery-log-table__from-1280")).map((th) => th.textContent?.trim())).toEqual(["Template", "Purpose"]);

    const row = container.querySelector(".delivery-log-box tbody tr")!;
    expect(row.children).toHaveLength(6);
    expect([...row.children].map((cell) => cell.classList.contains("delivery-log-table__from-1280"))).toEqual([false, true, true, false, false, false]);
  });

  it("folds Template and Purpose into one line under the recipient, which is the only place that line is, so that no text is in the page twice", async () => {
    const { container } = renderPage();
    await openDeliveryLog();
    await waitFor(() => expect(container.querySelectorAll(".delivery-log-box tbody tr")).toHaveLength(2));

    // acceptedRow is a resend with no template name, failedRow an initial send: both use the built-in template.
    const lines = [...container.querySelectorAll(".delivery-log-box .delivery-log-table__below-1280")];
    expect(lines.map((line) => line.textContent)).toEqual(["Default ticket · Resend", "Default ticket · Initial"]);
    expect(lines.map((line) => line.getAttribute("title"))).toEqual(["Default ticket · Resend", "Default ticket · Initial"]);
    expect(lines.every((line) => line.parentElement === line.closest("tr")!.children[0])).toBe(true);
    // The template of a row is found once, in its column: the folded line is a text of its own.
    expect(screen.getAllByText("Default ticket")).toHaveLength(2);
    expect(screen.getAllByText("Resend")).toHaveLength(1);
  });

  it("has a placeholder in the same box, with the same two headings folded", async () => {
    fetchEventDeliveries.mockReturnValue(new Promise(() => undefined));
    const { container } = renderPage();
    await openDeliveryLog();

    const placeholder = await screen.findByRole("status", { name: "Loading delivery log" });
    const folded = [...placeholder.querySelectorAll(".item-table.delivery-log-box > .attendees-table-wrap th.delivery-log-table__from-1280")];
    expect(folded.map((th) => th.textContent)).toEqual(["Template", "Purpose"]);
    expect(container.querySelector(".communication-table-wrap")).toBeNull();
  });
});
