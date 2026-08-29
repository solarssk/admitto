// @vitest-environment jsdom
// This import must come first, before every other import in the file - see
// attendeeDetailPageMocks.ts's own doc comment for why.
import { mockModule, mockOutletEvent } from "./attendeeDetailPageMocks.js";
import {
  baseAttendeeDetail,
  baseAttendeeDetailEvent,
  mockAttendeeDetailLoad,
  mockMatchMedia,
  renderAttendeeDetailRoute,
} from "../test-utils.js";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AttendeeDetailPage } from "../../src/pages/AttendeeDetailPage.js";
import { loadAttendeeDetailData } from "../../src/attendees/attendeeDetailForm.js";

vi.mock("../../src/attendees/attendeeDetailForm.js");
vi.mock("../../src/auth/AuthProvider.js");

vi.mock("react-router", (importOriginal) =>
  mockOutletEvent(importOriginal, () => baseAttendeeDetailEvent),
);

vi.mock("../../src/api/client.js", (importOriginal) =>
  mockModule(importOriginal, () => ({
    updateAttendee: vi.fn(),
    resendTicket: vi.fn(),
    fetchAttendeeDetail: vi.fn(),
  })),
);

function baseDetail(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ...baseAttendeeDetail,
    admitted_at: "2026-06-01T09:44:00.000Z",
    check_in_status: "admitted" as const,
    ...overrides,
  };
}

function mockLoad(detail: ReturnType<typeof baseDetail>) {
  mockAttendeeDetailLoad(loadAttendeeDetailData, detail);
}

function renderPage() {
  renderAttendeeDetailRoute(<AttendeeDetailPage />);
}

beforeEach(() => {
  mockMatchMedia(true);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("AttendeeDetailPage — Resend ticket modal", () => {
  it("opens the resend modal with the 'other address' option available", async () => {
    mockLoad(baseDetail());
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Resend ticket/ }));

    const dialog = screen.getByRole("dialog", { name: "Resend ticket" });
    expect(within(dialog).getByText("Other address")).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("radio", { name: /Other address/ }));
    expect(within(dialog).getByLabelText("Recipient email")).toBeTruthy();
  });

  it("closes when the backdrop is clicked", async () => {
    mockLoad(baseDetail());
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Resend ticket/ }));
    screen.getByRole("dialog", { name: "Resend ticket" });

    fireEvent.click(document.querySelector(".at-modal-backdrop")!);

    expect(screen.queryByRole("dialog", { name: "Resend ticket" })).toBeNull();
  });
});
