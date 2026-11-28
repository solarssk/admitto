// @vitest-environment jsdom
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RegistrationMailBriefDto } from "../../src/api/types.js";
import { mockMatchMedia } from "../test-utils.js";
import { answer, bodyRows, counts, renderTab, request, table } from "./requestsFixtures.js";

const fetchRegistrations = vi.fn();
const fetchRegistrationCounts = vi.fn();

vi.mock("../../src/api/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/api/client.js")>()),
  fetchRegistrations: (...args: unknown[]) => fetchRegistrations(...args),
  fetchRegistrationCounts: (...args: unknown[]) => fetchRegistrationCounts(...args),
}));

vi.mock("../../src/connection/ConnectionStateProvider.js");
vi.mock("../../src/auth/login-navigation.js", () => ({ goToLogin: vi.fn() }));

// The other tabs read and edit their own things: their tests have them. This page is tested around the Requests tab.
vi.mock("../../src/registration/RegistrationFieldsTab.js", () => ({
  RegistrationFieldsTab: () => <p>The attendee fields card</p>,
}));
vi.mock("../../src/registration/RegistrationLegalTab.js", () => ({
  RegistrationLegalTab: () => <p>The legal texts of the event</p>,
}));

const mail = (template_name: RegistrationMailBriefDto["template_name"], status: RegistrationMailBriefDto["status"], retryable: boolean | null = null): RegistrationMailBriefDto => ({
  template_name,
  status,
  retryable,
  can_retry: false,
});

/** Five requests: a company and a department, a company, none, a department only, and every kind of last email that has a different look. */
const ROWS = [
  request("r1", { first_name: "Ann", last_name: "Kowalska", company: "Northwind Ltd", department: "Marketing", last_mail: mail("registration-received", "sent") }),
  request("r2", { first_name: "Bo", last_name: "Lee", company: "Contoso", last_mail: mail("registration-confirm", "failed", false) }),
  request("r3", { first_name: "Cy", last_name: "Park", last_mail: null }),
  request("r4", { first_name: "Di", last_name: "Wu", department: "Finance", last_mail: mail("ticket", "failed", true) }),
  request("r5", { first_name: "Ed", last_name: "Ito", last_mail: mail("registration-waitlist", "queued") }),
];

beforeEach(() => {
  mockMatchMedia(true);
  fetchRegistrations.mockReset();
  fetchRegistrationCounts.mockReset();
  fetchRegistrations.mockResolvedValue(answer(ROWS));
  fetchRegistrationCounts.mockResolvedValue(counts({ pending: 1 }, "automatic"));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const BOX = ".item-table.registration-requests__box";
const text = (element: Element | null | undefined) => element?.textContent ?? null;

describe("the table of the Requests tab", () => {
  it("draws the requests in the shared box, with no wrapper of its own that scrolls", async () => {
    const { container } = render();
    await screen.findByRole("table", { name: "Requests" });

    const wrap = container.querySelector(`${BOX} > .attendees-table-wrap`);
    expect(wrap?.querySelector("table.table")).toBe(table());
    expect(container.querySelector(".registration-requests__table-wrap")).toBeNull();
  });

  it("keeps the columns in the order their widths are written for, with Company and Last email the two that a narrower screen folds", async () => {
    render();
    await screen.findByRole("table", { name: "Requests" });

    // registration-requests.css writes the widths by position, so a column moved here would take another column's width.
    const head = within(table()).getAllByRole("columnheader");
    expect(head.map((th) => th.textContent)).toEqual(["", "Guest", "Company", "Status", "Last email", "Registered"]);
    expect(head.filter((th) => th.classList.contains("registration-requests__from-1360")).map(text)).toEqual(["Company"]);
    expect(head.filter((th) => th.classList.contains("registration-requests__from-1180")).map(text)).toEqual(["Last email"]);

    for (const row of bodyRows()) {
      expect(row.children).toHaveLength(6);
      expect([...row.children].map((cell) => cell.classList.contains("registration-requests__from-1360"))).toEqual([false, false, true, false, false, false]);
      expect([...row.children].map((cell) => cell.classList.contains("registration-requests__from-1180"))).toEqual([false, false, false, false, true, false]);
    }
  });

  it("folds the company and the department into one line under the guest, only for a request that has one", async () => {
    render();
    await screen.findByRole("table", { name: "Requests" });

    const lines = bodyRows().map((row) => row.querySelector(".registration-requests__below-1360"));
    expect(lines.map(text)).toEqual(["Company: Northwind Ltd · Marketing", "Company: Contoso", null, "Company: Finance", null]);
    // The line is in the guest's cell, under the button that opens the request.
    for (const [index, line] of lines.entries()) {
      if (line) expect(line.parentElement).toBe(bodyRows()[index]!.children[1]);
    }
  });

  it("folds the last email into one line under the status: its state and what it was, and 'none' for a guest who was sent nothing", async () => {
    render();
    await screen.findByRole("table", { name: "Requests" });

    const lines = bodyRows().map((row) => row.querySelector(".registration-requests__below-1180"));
    expect(lines.map(text)).toEqual([
      "Last email: Sent · Request received",
      "Last email: Failed · Address confirmation",
      "Last email: none",
      "Last email: Retrying · Ticket",
      "Last email: Pending · Waiting list notice",
    ]);
    for (const [index, line] of lines.entries()) expect(line?.parentElement).toBe(bodyRows()[index]!.children[3]);
    // Only the email that failed for good has its red: a retried one and a pending one are as quiet as the others.
    expect(lines.map((line) => line?.classList.contains("registration-requests__fold-mail--error"))).toEqual([false, true, false, false, false]);
  });

  it("finds what a column says once: a folded line is a text of its own, never the text of the column a second time", async () => {
    render();
    await screen.findByRole("table", { name: "Requests" });

    const [first] = bodyRows();
    expect(within(first!).getAllByText("Northwind Ltd")).toHaveLength(1);
    expect(within(first!).getAllByText("Marketing")).toHaveLength(1);
    expect(within(first!).getAllByText("Sent")).toHaveLength(1);
    expect(within(first!).getAllByText("Request received")).toHaveLength(1);
    expect(within(bodyRows()[2]!).getAllByText("None")).toHaveLength(1);
  });

  it("has a placeholder in the same box, with the same two headings folded", async () => {
    fetchRegistrations.mockReturnValue(new Promise(() => undefined));
    const { container } = render();

    const placeholder = await screen.findByText("Loading requests");
    expect(placeholder).toBeTruthy();
    const heads = [...container.querySelectorAll(`${BOX} > .attendees-table-wrap thead th`)];
    expect(heads.map((th) => th.textContent)).toEqual(["", "Guest", "Company", "Status", "Last email", "Registered"]);
    expect(heads.filter((th) => th.classList.contains("registration-requests__from-1360")).map(text)).toEqual(["Company"]);
    expect(heads.filter((th) => th.classList.contains("registration-requests__from-1180")).map(text)).toEqual(["Last email"]);
    expect(container.querySelector(".registration-requests__table-wrap")).toBeNull();
  });
});

describe("the cards of the Requests tab", () => {
  beforeEach(() => {
    mockMatchMedia(false);
  });

  it("have no folded line: a card always has the company and the last email of its own", async () => {
    const { container } = render();
    await screen.findByRole("list", { name: "Requests" });

    expect(container.querySelectorAll(".registration-requests__card")).toHaveLength(5);
    expect(container.querySelector(".registration-requests__below-1360")).toBeNull();
    expect(container.querySelector(".registration-requests__below-1180")).toBeNull();
    expect(container.querySelector(BOX)).toBeNull();
  });
});

function render() {
  renderTab();
  return { container: document.body };
}
