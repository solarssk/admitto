// @vitest-environment jsdom
import { Children, isValidElement, type ReactNode } from "react";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CustomFieldsReportsTab } from "../../src/pages/CustomFieldsReportsTab.js";
import { ApiError } from "../../src/api/client.js";
import type { EventCustomFieldReportsResponse } from "../../src/api/types.js";
import { connectionStateValue, mockMatchMedia, renderWithToast } from "../test-utils.js";

const fetchEventCustomFieldReports = vi.fn();
const reportApiError = vi.fn();

vi.mock("../../src/connection/ConnectionStateProvider.js", () => ({
  useConnectionState: () => connectionStateValue("connected", reportApiError),
}));

vi.mock("../../src/api/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/api/client.js")>()),
  fetchEventCustomFieldReports: (...args: unknown[]) => fetchEventCustomFieldReports(...args),
}));

// Same reasoning as WalletsReportsTab.test.tsx's own "recharts" mock: no ResizeObserver polyfill
// under jsdom, so ResponsiveContainer would always measure a 0x0 box. Each mocked chart root
// renders a marker div carrying its own data as a `data-*` JSON attribute, so a test can assert on
// the data this component computes and passes into the chart instead of a real SVG render.
vi.mock("recharts", () => {
  function childProps(children: ReactNode, type: unknown): any {
    let found: any;
    Children.forEach(children, (child) => {
      if (isValidElement(child) && child.type === type) found = child.props;
    });
    return found;
  }

  const RadialBar = () => null;
  const PolarAngleAxis = () => null;
  const Cell = () => null;
  const Tooltip = () => null;
  const Pie = () => null;
  const ResponsiveContainer = ({ children }: { children: ReactNode }) => <>{children}</>;

  const RadialBarChart = ({ data }: { data: Array<{ value: number }> }) => (
    <div data-testid="rc-radialbar" data-values={JSON.stringify(data.map((d) => d.value))} />
  );

  const PieChart = ({ children }: { children: ReactNode }) => {
    const pie = childProps(children, Pie);
    const tooltip = childProps(children, Tooltip);
    const slices = (pie?.data ?? []) as Array<{ key: string; count: number; color: string }>;
    return (
      <div
        data-testid="rc-pie"
        data-slices={JSON.stringify(slices.map((s) => ({ key: s.key, count: s.count, color: s.color })))}
        data-tooltip-one={tooltip?.formatter?.(1)}
        data-tooltip-many={tooltip?.formatter?.(3)}
      />
    );
  };

  return { ResponsiveContainer, RadialBarChart, RadialBar, PolarAngleAxis, PieChart, Pie, Cell, Tooltip };
});

function fixture(overrides: Partial<EventCustomFieldReportsResponse> = {}): EventCustomFieldReportsResponse {
  return {
    total_attendees: 5,
    fields: [
      {
        id: "cf-dietary",
        source_field: "dietary",
        label: "Dietary requirements",
        description: "Let us know about any allergies.",
        type: "text",
        distribution: null,
        response_rate: { answered: 3, pct: 60 },
      },
      {
        id: "cf-shirt",
        source_field: "shirt_size",
        label: "Shirt size",
        description: null,
        type: "select",
        distribution: [
          { key: "M", label: "M", count: 2, pct: 40 },
          { key: "L", label: "L", count: 1, pct: 20 },
          { key: "__not_answered__", label: "Not answered", count: 2, pct: 40 },
        ],
        response_rate: null,
      },
      {
        id: "cf-vegetarian",
        source_field: "vegetarian",
        label: "Vegetarian",
        description: "Dietary preference for the catering headcount.",
        type: "boolean",
        distribution: [
          { key: "true", label: "Yes", count: 2, pct: 40 },
          { key: "false", label: "No", count: 1, pct: 20 },
          { key: "__not_answered__", label: "Not answered", count: 2, pct: 40 },
        ],
        response_rate: null,
      },
    ],
    ...overrides,
  };
}

function cardByTitle(title: string): HTMLElement {
  const titleEl = Array.from(document.querySelectorAll(".at-card__title")).find((el) =>
    el.textContent?.includes(title),
  );
  const card = titleEl?.closest(".at-card");
  if (!card) throw new Error(`Card titled "${title}" not found`);
  return card as HTMLElement;
}

function breakdownRows(container: HTMLElement): Array<{ name: string; meta: string }> {
  return Array.from(container.querySelectorAll(".reports-breakdown-row")).map((row) => ({
    name: row.querySelector(".reports-breakdown-row__name")?.textContent ?? "",
    meta: row.querySelector(".reports-breakdown-row__meta")?.textContent ?? "",
  }));
}

function pieSlices(container: HTMLElement): Array<{ key: string; count: number; color: string }> {
  const el = container.querySelector('[data-testid="rc-pie"]');
  return JSON.parse(el?.getAttribute("data-slices") ?? "null");
}

function radialValues(container: HTMLElement): number[] {
  const el = container.querySelector('[data-testid="rc-radialbar"]');
  return JSON.parse(el?.getAttribute("data-values") ?? "null");
}

beforeEach(() => {
  mockMatchMedia(true);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("CustomFieldsReportsTab", () => {
  it("shows the loading state once the delayed-loading threshold elapses", async () => {
    vi.useFakeTimers();
    let resolveFetch: (value: EventCustomFieldReportsResponse) => void = () => {};
    fetchEventCustomFieldReports.mockReturnValue(
      new Promise<EventCustomFieldReportsResponse>((resolve) => {
        resolveFetch = resolve;
      }),
    );
    try {
      renderWithToast(<CustomFieldsReportsTab eventId="evt-1" isActive />);

      expect(screen.queryByText("Loading custom field report…")).toBeNull();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(screen.getByText("Loading custom field report…")).toBeTruthy();

      await act(async () => {
        resolveFetch(fixture());
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows an EmptyState with a Retry action on a generic fetch error, and re-fetches on click", async () => {
    fetchEventCustomFieldReports.mockRejectedValueOnce(new ApiError(500, "Internal server problem"));
    fetchEventCustomFieldReports.mockResolvedValueOnce(fixture());

    renderWithToast(<CustomFieldsReportsTab eventId="evt-1" isActive />);

    await screen.findByText("Could not load custom field report");
    expect(screen.getByText("Internal server problem")).toBeTruthy();
    expect(reportApiError).toHaveBeenCalledWith(500);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(fetchEventCustomFieldReports).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText("Dietary requirements")).toBeTruthy();
    expect(screen.queryByText("Could not load custom field report")).toBeNull();
  });

  it("shows a generic message for a non-ApiError failure (e.g. a network error)", async () => {
    fetchEventCustomFieldReports.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    renderWithToast(<CustomFieldsReportsTab eventId="evt-1" isActive />);

    await screen.findByText("Could not load custom field report");
    expect(screen.getByText("Could not load custom field report.")).toBeTruthy();
    expect(reportApiError).not.toHaveBeenCalled();
  });

  it("shows the 403-specific access message instead of the server's own error text", async () => {
    fetchEventCustomFieldReports.mockRejectedValueOnce(new ApiError(403, "forbidden", "forbidden"));

    renderWithToast(<CustomFieldsReportsTab eventId="evt-1" isActive />);

    await screen.findByText("Could not load custom field report");
    expect(screen.getByText("You do not have access to this event.")).toBeTruthy();
    expect(reportApiError).toHaveBeenCalledWith(403);
  });

  it("shows an EmptyState when the event has no custom fields configured", async () => {
    fetchEventCustomFieldReports.mockResolvedValue(fixture({ fields: [] }));

    renderWithToast(<CustomFieldsReportsTab eventId="evt-1" isActive />);

    expect(await screen.findByText("No custom fields yet")).toBeTruthy();
  });

  it("renders a fill-rate gauge for a text field, and a category donut + breakdown list (with a trailing not-answered bucket) for select/boolean fields", async () => {
    fetchEventCustomFieldReports.mockResolvedValue(fixture());

    renderWithToast(<CustomFieldsReportsTab eventId="evt-1" isActive />);
    await screen.findByText("Dietary requirements");

    // text field: single ring at response_rate.pct, no category donut. Description shows the
    // field's own admin-entered text, above the chart.
    const dietaryCard = cardByTitle("Dietary requirements");
    expect(dietaryCard.textContent).toContain("Let us know about any allergies.");
    expect(radialValues(dietaryCard)).toEqual([60]);
    expect(dietaryCard.textContent).toContain("60%");
    expect(dietaryCard.textContent).toContain("3 of 5 attendees have filled this in.");

    // select field: no description set - falls back to a literal "No description" rather than
    // rendering nothing, so every card keeps the same shape.
    const shirtCard = cardByTitle("Shirt size");
    expect(shirtCard.textContent).toContain("No description");
    // donut slices match the distribution, in the same order (not-answered last), with a
    // distinct color per real value and gray reserved for not-answered.
    const shirtSlices = pieSlices(shirtCard);
    expect(shirtSlices.map((s) => s.key)).toEqual(["M", "L", "__not_answered__"]);
    expect(shirtSlices.map((s) => s.count)).toEqual([2, 1, 2]);
    expect(shirtSlices[2]!.color).toBe("#94a3b8"); // not-answered is always gray
    expect(new Set(shirtSlices.map((s) => s.color)).size).toBe(3); // every slice visually distinct
    expect(breakdownRows(shirtCard)).toEqual([
      { name: "M", meta: "2 · 40%" },
      { name: "L", meta: "1 · 20%" },
      { name: "Not answered", meta: "2 · 40%" },
    ]);
    // Tooltip pluralizes "attendee(s)" off the hovered slice's own count.
    const shirtPie = shirtCard.querySelector('[data-testid="rc-pie"]')!;
    expect(shirtPie.getAttribute("data-tooltip-one")).toBe("1 attendee");
    expect(shirtPie.getAttribute("data-tooltip-many")).toBe("3 attendees");

    // boolean field: same donut/list rendering as select, generically - no "Yes is green" special
    // casing, same not-answered-is-gray rule.
    const vegCard = cardByTitle("Vegetarian");
    expect(vegCard.textContent).toContain("Dietary preference for the catering headcount.");
    const vegSlices = pieSlices(vegCard);
    expect(vegSlices.map((s) => s.key)).toEqual(["true", "false", "__not_answered__"]);
    expect(vegSlices[2]!.color).toBe("#94a3b8");
    expect(breakdownRows(vegCard)).toEqual([
      { name: "Yes", meta: "2 · 40%" },
      { name: "No", meta: "1 · 20%" },
      { name: "Not answered", meta: "2 · 40%" },
    ]);
  });

  it("skips mounting ResponsiveContainer's charts while the tab is hidden (isActive=false), keeping titles and breakdown lists rendered", async () => {
    fetchEventCustomFieldReports.mockResolvedValue(fixture());

    renderWithToast(<CustomFieldsReportsTab eventId="evt-1" isActive={false} />);
    await screen.findByText("Dietary requirements");

    // ReportsPage keeps this tab mounted with display:none instead of unmounting it on tab
    // switch (to avoid refetching) - isActive gates only the actual chart mount, since a
    // ResponsiveContainer left alive underneath a display:none ancestor is what produces
    // Recharts' own "width(0) and height(0)" console warning the moment the wrapper collapses.
    const dietaryCard = cardByTitle("Dietary requirements");
    expect(dietaryCard.querySelector('[data-testid="rc-radialbar"]')).toBeNull();
    expect(dietaryCard.textContent).toContain("3 of 5 attendees have filled this in.");

    const shirtCard = cardByTitle("Shirt size");
    expect(shirtCard.querySelector('[data-testid="rc-pie"]')).toBeNull();
    expect(breakdownRows(shirtCard)).toEqual([
      { name: "M", meta: "2 · 40%" },
      { name: "L", meta: "1 · 20%" },
      { name: "Not answered", meta: "2 · 40%" },
    ]);
  });
});
