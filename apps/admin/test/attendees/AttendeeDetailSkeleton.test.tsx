// @vitest-environment jsdom
import type { ComponentProps } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EnabledWalletPlatforms } from "@admitto/shared";
import { AttendeeDetailSkeleton } from "../../src/attendees/AttendeeDetailSkeleton.js";
import { SLOW_NOTICE_TEXT } from "../../src/utils/loading-timing.js";

const WALLETS_ON: EnabledWalletPlatforms = { apple: true, google: true, samsung: false, any: true };
const WALLETS_OFF: EnabledWalletPlatforms = { apple: false, google: false, samsung: false, any: false };

afterEach(cleanup);

function renderSkeleton(props: Partial<ComponentProps<typeof AttendeeDetailSkeleton>> = {}) {
  return render(
    <div className="screen">
      <AttendeeDetailSkeleton slow={false} isDesktop onBack={() => {}} walletPlatforms={WALLETS_ON} tab="overview" {...props} />
    </div>,
  );
}

describe("AttendeeDetailSkeleton: the page's own frame while its record is on its way", () => {
  it("says what it can with the page's real words: the heading, the subtitle, the five chips, the three tabs and the cards", () => {
    const { container } = renderSkeleton();
    expect(screen.getByRole("heading", { level: 1, name: "Attendee" })).toBeTruthy();
    expect(screen.getByText("Manage this attendee's profile, ticket, and check-in status.")).toBeTruthy();

    const chips = [...container.querySelectorAll(".attendee-status-chip strong")].map((el) => el.textContent);
    expect(chips).toEqual(["Pass", "Attendance", "Ticket delivery", "Check-in", "Wallet"]);
    const tabs = [...container.querySelectorAll(".attendee-detail-skeleton__tabs .at-tab")].map((el) => el.textContent);
    expect(tabs).toEqual(["Overview", "Activity log", "Notes"]);
    const titles = [...container.querySelectorAll(".at-card__title")].map((el) => el.textContent);
    expect(titles).toEqual(["Profile", "Additional information", "Event items", "Delivery history"]);
    const rows = [...container.querySelectorAll(".attendee-detail-profile .attendee-detail-row > span:first-child")].map((el) => el.textContent);
    expect(rows).toEqual(["Email", "Ticket type", "Company", "Department", "Added via", "Registered on"]);
  });

  it("draws the Wallet chip only when the event offers a wallet platform, as the page does, so the strip has the rows it will have", () => {
    const chips = (container: HTMLElement) => [...container.querySelectorAll(".attendee-status-chip strong")].map((el) => el.textContent);
    expect(chips(renderSkeleton({ walletPlatforms: WALLETS_OFF }).container)).toEqual(["Pass", "Attendance", "Ticket delivery", "Check-in"]);
    cleanup();
    // A Samsung-only event has the chip too: the page reads its registration data like Apple's and Google's.
    expect(chips(renderSkeleton({ walletPlatforms: { apple: false, google: false, samsung: true, any: false } }).container)).toContain("Wallet");
    cleanup();
    expect(chips(renderSkeleton({ walletPlatforms: { apple: true, google: false, samsung: false, any: true } }).container)).toContain("Wallet");
  });

  it("uses the page's own classes, so the stylesheet lays it out as it lays out the page, and keeps the marker the page's tests look for", () => {
    const { container } = renderSkeleton();
    expect(container.querySelector(".at-pageheader.attendee-detail-pageheader")).not.toBeNull();
    expect(container.querySelector(".attendee-status-strip")).not.toBeNull();
    expect(container.querySelector(".at-tabs")).not.toBeNull();
    expect(container.querySelector(".attendee-detail-grid.attendee-detail-skeleton > .attendee-detail-main")).not.toBeNull();
    expect(container.querySelector(".attendee-detail-grid.attendee-detail-skeleton > .attendee-detail-side")).not.toBeNull();
  });

  it("hides what is only drawn from assistive tech: the chips, the tabs and the cards are not controls of a page that is not there yet", () => {
    const { container } = renderSkeleton();
    for (const selector of [".attendee-status-strip", ".at-tabs", ".attendee-detail-grid"]) {
      expect(container.querySelector(selector)?.getAttribute("aria-hidden"), selector).toBe("true");
    }
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    // The one control is the Back button.
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Back"]);
  });

  it("has a real Back, so a slow read can be left", () => {
    const onBack = vi.fn();
    renderSkeleton({ onBack });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("draws a bar for Edit and one for More actions on a desktop, and only More actions on a phone, in the sizes of the buttons", () => {
    const widths = (container: HTMLElement) =>
      [...container.querySelectorAll(".at-pageheader__actions .at-skeleton")].map((el) => (el as HTMLElement).style.width);
    expect(widths(renderSkeleton({ isDesktop: true }).container)).toEqual(["74px", "158px"]);
    cleanup();
    expect(widths(renderSkeleton({ isDesktop: false }).container)).toEqual(["142px"]);
  });
});

describe("AttendeeDetailSkeleton: its status region", () => {
  it("is the one region that names what is loading, with nothing in view until 8 seconds", () => {
    const { container } = renderSkeleton();
    const regions = screen.getAllByRole("status");
    expect(regions).toHaveLength(1);
    expect(regions[0]?.textContent).toBe("Loading attendee");
    expect(regions[0]?.className).toBe("attendee-detail-skeleton__status");
    expect(screen.queryByText(SLOW_NOTICE_TEXT)).toBeNull();
    // It sits among the page's rows, between the header and the chips.
    const status = container.querySelector("output")!;
    expect(status.previousElementSibling?.classList.contains("at-pageheader")).toBe(true);
    expect(status.nextElementSibling?.classList.contains("attendee-status-strip")).toBe(true);
  });

  it("adds the note to the same region once it is slow, and gives the region its room", () => {
    const { rerender } = renderSkeleton();
    rerender(
      <div className="screen">
        <AttendeeDetailSkeleton slow isDesktop onBack={() => {}} walletPlatforms={WALLETS_ON} tab="overview" />
      </div>,
    );
    const region = screen.getByRole("status");
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(within(region).getByText(SLOW_NOTICE_TEXT)).toBeTruthy();
    expect(region.textContent).toContain("Loading attendee");
    expect(region.classList.contains("attendee-detail-skeleton__status--note")).toBe(true);
  });
});

describe("AttendeeDetailSkeleton: the tab that the address asks for", () => {
  const openTabs = (container: HTMLElement) => [...container.querySelectorAll(".attendee-detail-skeleton__tabs .at-tab--active")].map((el) => el.textContent);

  it.each([
    ["overview", "Overview"],
    ["activity", "Activity log"],
    ["notes", "Notes"],
  ] as const)("marks %s as the open tab, and only that one, so the strip does not claim Overview for a page that opens elsewhere", (tab, label) => {
    const { container } = renderSkeleton({ tab });
    expect(openTabs(container)).toEqual([label]);
    expect(container.querySelectorAll(".attendee-detail-skeleton__tabs .at-tab")).toHaveLength(3);
  });

  it.each(["overview", "activity", "notes"] as const)("draws exactly one body for %s, with the marker that the page's tests look for", (tab) => {
    const { container } = renderSkeleton({ tab });
    expect(container.querySelectorAll(".attendee-detail-skeleton")).toHaveLength(1);
  });

  it("draws the Overview cards, and nothing of the other two tabs, for Overview", () => {
    const { container } = renderSkeleton({ tab: "overview" });
    expect(container.querySelector(".attendee-detail-grid.attendee-detail-skeleton")).not.toBeNull();
    expect(container.querySelector(".at-timeline, .audit-log-footer, .at-notes-hint, .at-notes-form, .at-notes-list")).toBeNull();
  });

  it("draws the rows of the Activity log, each with a dot, a headline and a detail line, the time and who did it, and the pager under them", () => {
    const { container } = renderSkeleton({ tab: "activity" });
    const rows = [...container.querySelectorAll(".at-timeline > .at-tl-item")];
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.querySelectorAll(".at-tl-dot > .at-skeleton--circle")).toHaveLength(1);
      expect(row.querySelectorAll(".at-tl-body .at-skeleton")).toHaveLength(2);
      expect(row.querySelectorAll(".at-tl-meta .at-skeleton")).toHaveLength(2);
    }
    // The rows are bars: no text that a reader would take for an entry, and the three differ in width.
    expect(container.querySelector(".at-timeline")?.textContent).toBe("");
    const headlines = rows.map((row) => (row.querySelector(".at-tl-body .at-skeleton") as HTMLElement).style.width);
    expect(new Set(headlines).size).toBe(3);
    // The pager of the page's footer, in the page's own classes, with the Previous and Next of the real one as bars.
    expect(container.querySelector(".audit-log-footer > .audit-log-footer__summary")).not.toBeNull();
    expect(container.querySelectorAll(".audit-log-footer__pager .at-skeleton")).toHaveLength(3);
    expect(container.querySelector(".attendee-detail-grid, .at-notes-hint, .at-notes-form")).toBeNull();
  });

  it("gives every line of text the height of the text, with the bar in it, so that a row is as tall as a real one", () => {
    const { container } = renderSkeleton({ tab: "activity" });
    const row = container.querySelector(".at-tl-item")!;
    const lines = [...row.querySelectorAll<HTMLElement>(".attendee-detail-skeleton__line")];
    expect(lines.map((el) => el.style.height)).toEqual(["21px", "22px", "18px", "18px"]);
    expect(lines.map((el) => (el.querySelector(".at-skeleton") as HTMLElement).style.height)).toEqual(["14px", "12px", "12px", "12px"]);
  });

  it("draws the Notes tab's hint in the page's words, the composer as bars and one note", () => {
    const { container } = renderSkeleton({ tab: "notes" });
    expect(container.querySelector(".at-notes-hint.at-notice--info")?.textContent).toBe("Internal notes are visible to staff only and are never shown to the attendee.");
    // The field and the Add button are bars, not controls: a placeholder is not a form to type into.
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Back"]);
    expect(container.querySelectorAll(".at-notes-form > .attendee-detail-skeleton__textarea.at-skeleton")).toHaveLength(1);
    const add = container.querySelector<HTMLElement>(".at-notes-form__actions .at-skeleton")!;
    expect([add.style.width, add.style.height]).toEqual(["43px", "28px"]);
    const notes = container.querySelectorAll(".at-notes-list > .at-notes-list__item");
    expect(notes).toHaveLength(1);
    const note = notes[0]!;
    expect(note.querySelectorAll(".at-notes-list__head .at-avatar .at-skeleton--circle")).toHaveLength(1);
    expect(note.querySelectorAll(".at-notes-list__author-group .at-skeleton")).toHaveLength(3);
    expect(note.querySelectorAll(":scope > .attendee-detail-skeleton__line")).toHaveLength(2);
    expect(container.querySelector(".attendee-detail-grid, .at-timeline, .audit-log-footer")).toBeNull();
  });

  it("hides the body of Activity and of Notes from assistive tech, as it does the cards of Overview", () => {
    for (const tab of ["activity", "notes"] as const) {
      const { container } = renderSkeleton({ tab });
      expect(container.querySelector(".attendee-detail-skeleton")?.getAttribute("aria-hidden"), tab).toBe("true");
      // Still the one region that names what is loading.
      expect(screen.getAllByRole("status")).toHaveLength(1);
      cleanup();
    }
  });
});
