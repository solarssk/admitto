// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/api/client.js";
import type { RegistrationOwnAddressDto, RegistrationSettingsDto, RoleAssignment } from "../../src/api/types.js";
import { reportApiError } from "../../src/connection/ConnectionStateProvider.js";
import { LOAD_TIMEOUT_MESSAGE, SLOW_NOTICE_TEXT } from "../../src/utils/loading-timing.js";
import { advanceTimers, deferred, hangUntilAborted } from "../test-utils.js";
import { api } from "./accessApiMocks.js";
import { archivedEvent, checks, notUsedChecks, settings, ssoChecks, ssoEventSettings } from "./accessData.js";
import { card, checklistPanel, checklistRows, doneSummary, openDone, renderChecklist, renderChecklistLoaded, resetApi } from "./accessFixtures.js";

let assignments: RoleAssignment[] = [];
const goToLogin = vi.fn();

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const { api: mocks } = await import("./accessApiMocks.js");
  return {
    ...(await importOriginal<typeof import("../../src/api/client.js")>()),
    fetchRegistrationSettings: (...args: unknown[]) => mocks.fetchRegistrationSettings(...args),
    fetchLegalDocuments: (...args: unknown[]) => mocks.fetchLegalDocuments(...args),
    fetchRegistrationCounts: (...args: unknown[]) => mocks.fetchRegistrationCounts(...args),
  };
});
vi.mock("../../src/connection/ConnectionStateProvider.js");
vi.mock("../../src/auth/login-navigation.js", () => ({ goToLogin: (...args: unknown[]) => goToLogin(...args) }));
vi.mock("../../src/auth/AuthProvider.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/auth/AuthProvider.js")>()),
  useOptionalAuth: () => ({ assignments }),
}));

const SUPERADMIN: RoleAssignment = { role: "superadmin", scope_type: "instance", scope_id: null };
const ORG_ADMIN: RoleAssignment = { role: "admin", scope_type: "organization", scope_id: "org-1" };
const placeholder = () => screen.queryByRole("status", { name: "Loading the checklist" });
const checklistTitles = () => Array.from(checklistPanel().querySelectorAll(".at-card__title")).map((title) => (title.textContent ?? "").replace(/\s*\d+$/, ""));
const rowOf = (text: string) => checklistRows().find((row) => row.textContent?.includes(text)) as HTMLElement;

beforeEach(() => {
  resetApi();
  goToLogin.mockReset();
  assignments = [ORG_ADMIN];
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("RegistrationChecklistTab: a route without an event", () => {
  it("says there is no event, without reading anything", () => {
    renderChecklist({ path: "/admin/registration?tab=checklist" });

    expect(screen.getByText("Missing event.")).toBeTruthy();
    expect(api.fetchRegistrationSettings).not.toHaveBeenCalled();
  });
});

describe("RegistrationChecklistTab: the first read", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    api.fetchRegistrationSettings.mockImplementation(hangUntilAborted as never);
  });

  it("holds the room of the cards invisibly for 200ms, then draws them grey with their real titles, and says it is taking longer after 8 seconds", async () => {
    renderChecklist();
    await advanceTimers(0);

    const held = placeholder() as HTMLElement;
    expect(held.classList.contains("at-loading-hold")).toBe(true);
    for (const title of ["Registration checklist", "For you", "Done"]) expect(within(held).getByText(title)).toBeTruthy();
    // The closed Done is a header alone, as the card is when it is loaded: no body under it.
    const done = within(held).getByText("Done").closest(".at-card") as HTMLElement;
    expect(done.classList.contains("settings-skeleton__closed")).toBe(true);
    expect(done.querySelector(".at-card__body")).toBeNull();
    // Every header has the grey pill of its status at the right.
    for (const title of ["Registration checklist", "For you", "Done"]) expect((within(held).getByText(title).closest(".at-card__header") as HTMLElement).querySelector(".at-skeleton")).not.toBeNull();
    expect(held.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.queryByRole("list")).toBeNull();
    // The placeholder is the tab's own and has no Save and Reset footer: there is nothing to save here.
    expect(held.querySelector(".settings-footer")).toBeNull();

    await advanceTimers(200);
    expect(placeholder()?.classList.contains("at-loading-hold")).toBe(false);
    expect(screen.queryByText(SLOW_NOTICE_TEXT)).toBeNull();

    await advanceTimers(8000);
    expect(within(placeholder() as HTMLElement).getByText(SLOW_NOTICE_TEXT)).toBeTruthy();
  });

  it("ends in an error after 30 seconds, with a Retry that stays on screen, busy, with its focus, and hands the focus to the tab when it works", async () => {
    renderChecklist();
    await advanceTimers(0);
    await advanceTimers(30_000);
    await advanceTimers(0);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain(LOAD_TIMEOUT_MESSAGE);
    expect(alert.textContent).toContain("Could not load the checklist");

    const read = deferred<RegistrationSettingsDto>();
    api.fetchRegistrationSettings.mockReturnValueOnce(read.promise);
    const retry = screen.getByRole("button", { name: "Retry" });
    retry.focus();
    fireEvent.click(retry);
    await advanceTimers(500);
    expect(retry.getAttribute("aria-busy")).toBe("true");
    expect(retry.hasAttribute("disabled")).toBe(false);
    expect(document.activeElement).toBe(retry);
    expect(placeholder()).toBeNull();

    await act(async () => read.resolve(settings()));
    await advanceTimers(500);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(checklistTitles()).toContain("Registration checklist");
    expect(document.activeElement).toBe(checklistPanel());
  });
});

describe("RegistrationChecklistTab: a read that fails", () => {
  it("is an error in the words of the app, never the checklist, and the connection state hears of it", async () => {
    api.fetchRegistrationSettings.mockRejectedValue(new ApiError(500, "internal_error", "internal_error"));
    renderChecklist();

    const alert = await screen.findByRole("alert");

    expect(alert.textContent).toContain("Could not load the checklist");
    expect(screen.queryByRole("list")).toBeNull();
    expect(reportApiError).toHaveBeenCalledWith(500);
  });

  it("tells someone who may not manage the event that they have no access", async () => {
    api.fetchRegistrationSettings.mockRejectedValue(new ApiError(403, "forbidden", "forbidden"));
    renderChecklist();

    expect((await screen.findByRole("alert")).textContent).toContain("You do not have access.");
    expect(reportApiError).toHaveBeenCalledWith(403);
  });

  it("hands the browser to the login page when the session has ended, and shows nothing first", async () => {
    api.fetchRegistrationSettings.mockRejectedValue(new ApiError(401, "authentication_required"));
    renderChecklist();

    await waitFor(() => expect(goToLogin).toHaveBeenCalledWith(expect.stringMatching(/^\/login\?next=/)));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

const STOPPED: RegistrationOwnAddressDto = { domain: "events.example.com", status: "failing", check_result: "unreachable", verified: true, checked_at: "2026-11-17T10:00:00.000Z" };
const WORKING: RegistrationOwnAddressDto = { ...STOPPED, status: "ok", check_result: "ok" };
const banner = () => checklistPanel().querySelector(".at-notice") as HTMLElement;
const progress = () => screen.getByRole("progressbar", { name: "Checklist progress" }) as HTMLProgressElement;

describe("RegistrationChecklistTab: the summary", () => {
  it("has a progress bar that says how many steps are done, and the same in words", async () => {
    await renderChecklistLoaded(settings({ readiness: checks("mail_provider", "legal_documents", "bot_protection") }));

    expect(progress().max).toBe(8);
    expect(progress().value).toBe(5);
    expect(within(card("Registration checklist")).getByText("5 of 8 done")).toBeTruthy();
    expect(progress().className).toContain("overview-setup__bar--warn");
  });

  it("counts the stopped address as a step, and the bar is red while registration is on and a step is open", async () => {
    await renderChecklistLoaded(settings({ mode: "automatic", own_address: STOPPED, readiness: checks() }));

    expect(progress().max).toBe(9);
    expect(progress().value).toBe(8);
    expect(progress().className).toContain("overview-setup__bar--error");
  });

  it("has a green bar when nothing is open", async () => {
    await renderChecklistLoaded(settings({ readiness: checks() }));

    expect(progress().value).toBe(progress().max);
    expect(progress().className).toContain("overview-setup__bar--ok");
  });
});

describe("RegistrationChecklistTab: the headers and the buttons", () => {
  const pill = (title: string) => card(title).querySelector(".at-card__header .at-badge") as HTMLElement;

  it("shows the status of every card as one pill at the right of its header, in the same place", async () => {
    await renderChecklistLoaded(settings({ readiness: checks("mail_provider", "legal_documents") }));

    expect(pill("Registration checklist").textContent).toBe("6 of 8 done");
    expect(pill("Registration checklist").className).toContain("at-badge--warn");
    expect(pill("For you").textContent).toBe("1 to do");
    expect(pill("For you").className).toContain("at-badge--warn");
    expect(pill("Waiting for a superadmin").textContent).toBe("1 waiting");
    expect(pill("Waiting for a superadmin").className).toContain("at-badge--neutral");
    expect(pill("Registration checklist").closest(".at-card__actions")).not.toBeNull();
    expect(pill("For you").closest(".at-card__actions")).not.toBeNull();
  });

  it("puts the count of Done at the right too, before the chevron, and leaves its title plain", async () => {
    await renderChecklistLoaded(settings({ readiness: checks("legal_documents") }));
    const toggle = doneSummary();

    expect(toggle.querySelector(".at-card__title")?.textContent).toBe("Done");
    expect(toggle.querySelector(".at-card__meta .at-badge")?.textContent).toBe("7");
    expect(toggle.querySelector(".at-card__meta")?.nextElementSibling?.className).toContain("at-card__chevron");
  });

  it("has an ok pill when nothing is left for the person, and an ok pill for a finished checklist", async () => {
    await renderChecklistLoaded(settings({ readiness: checks() }));

    expect(pill("For you").textContent).toBe("All done");
    expect(pill("For you").className).toContain("at-badge--ok");
    expect(pill("Registration checklist").className).toContain("at-badge--ok");
  });

  it("has a red pill on the summary while registration is on and a step is open", async () => {
    await renderChecklistLoaded(settings({ mode: "automatic", readiness: checks("mail_provider") }));

    expect(pill("Registration checklist").className).toContain("at-badge--error");
  });

  it("has no arrow in a button, and no link under any text, on any row", async () => {
    assignments = [SUPERADMIN];
    await renderChecklistLoaded(settings({ own_address: STOPPED, readiness: checks("legal_documents", "mail_provider") }));
    openDone();

    expect(checklistPanel().querySelector(".ti-arrow-right")).toBeNull();
    for (const link of Array.from(checklistPanel().querySelectorAll("li.access-check a"))) {
      expect(link.className).toContain("at-btn--secondary");
      expect(link.className).toContain("at-btn--sm");
      expect(link.closest(".access-check__aside")).not.toBeNull();
    }
    expect(checklistPanel().querySelectorAll(".overview-check__body a")).toHaveLength(0);
  });
});

describe("RegistrationChecklistTab: the banner", () => {
  it.each([
    ["steps are for the person and for a superadmin", settings({ readiness: checks("legal_documents", "mail_provider", "bot_protection") }), "1 for you, 2 waiting for a superadmin. Registration can be turned on when all are done.", "warning"],
    ["one step is open", settings({ readiness: checks("legal_documents") }), "1 step is open. Registration can be turned on when it is done.", "warning"],
    ["two steps are open", settings({ readiness: checks("legal_documents", "form_questions") }), "2 steps are open. Registration can be turned on when they are done.", "warning"],
    ["only a superadmin's steps are open", settings({ readiness: checks("mail_provider") }), "1 step waits for a superadmin. Your steps are done.", "info"],
    ["two of a superadmin's steps are open", settings({ readiness: checks("mail_provider", "instance_url") }), "2 steps wait for a superadmin. Your steps are done.", "info"],
    ["everything is done and registration is off", settings({ readiness: checks() }), "Ready. Registration can be turned on.", "success"],
    ["everything is done and registration is on", settings({ mode: "approval", readiness: checks() }), "Registration is on and every step is done.", "success"],
    ["a step is open while registration is on", settings({ mode: "automatic", readiness: checks("mail_provider") }), "Registration is on, but something it needs is missing. Guests may not be able to register.", "error"],
    ["the address stopped while registration is on", settings({ mode: "automatic", own_address: STOPPED, readiness: checks() }), "Registration is on, but the address of this event stopped working. Guests may not be able to register.", "error"],
  ])("says, when %s, the sentence for it", async (_case, saved, text, variant) => {
    await renderChecklistLoaded(saved);

    expect(banner().textContent).toContain(text);
    expect(banner().className).toContain(`at-notice--${variant}`);
  });

  it("is an alert only when something broke while registration is on", async () => {
    await renderChecklistLoaded(settings({ mode: "automatic", readiness: checks("mail_provider") }));
    expect(banner().getAttribute("role")).toBe("alert");
    cleanup();

    await renderChecklistLoaded(settings({ readiness: checks("mail_provider") }));
    expect(banner().getAttribute("role")).toBeNull();
  });

  it("has the button Go to Access, which opens the Access tab, when everything is ready and registration is off, and only then", async () => {
    const { router } = await renderChecklistLoaded(settings({ readiness: checks() }));

    fireEvent.click(within(banner()).getByRole("link", { name: "Go to Access" }));
    expect(router.state.location.search).toBe("?tab=access");
    cleanup();

    await renderChecklistLoaded(settings({ mode: "automatic", readiness: checks() }));
    expect(within(banner()).queryByRole("link")).toBeNull();
    cleanup();

    await renderChecklistLoaded(settings({ readiness: checks("legal_documents") }));
    expect(within(banner()).queryByRole("link")).toBeNull();
  });
});

describe("RegistrationChecklistTab: what an event administrator sees", () => {
  it("has the steps this person can do under For you, the ones for a superadmin under Waiting for a superadmin, and what is met behind Done", async () => {
    await renderChecklistLoaded(settings({ readiness: checks("mail_provider", "legal_documents", "bot_protection") }));

    expect(checklistTitles()).toEqual(["Registration checklist", "For you", "Waiting for a superadmin", "Done"]);
    const forYou = within(card("For you"));
    expect(forYou.getAllByRole("listitem")).toHaveLength(1);
    expect(forYou.getByText("Legal texts")).toBeTruthy();
    expect(forYou.getByText("1 to do")).toBeTruthy();
    const waiting = within(card("Waiting for a superadmin"));
    expect(waiting.getAllByRole("listitem").map((row) => row.querySelector("strong")?.textContent)).toEqual(["To do: Bot protection", "To do: Email sending"]);
    expect(waiting.getByText("Only a superadmin can put these right. Ask one to do it.")).toBeTruthy();
    expect(waiting.getByText("2 waiting")).toBeTruthy();
    expect(waiting.getAllByText("Superadmin")).toHaveLength(2);
  });

  it("says who to ask, with a badge and no button, for a step of a superadmin", async () => {
    await renderChecklistLoaded(settings({ readiness: checks("bot_protection", "mail_provider", "instance_url") }));

    const waiting = within(card("Waiting for a superadmin"));
    expect(waiting.getAllByText("Ask a superadmin to set it up.")).toHaveLength(3);
    expect(waiting.queryByRole("link")).toBeNull();
  });

  it("has a button, named by its step, to the tab or the settings that put one of its own steps right", async () => {
    api.fetchRegistrationSettings.mockResolvedValue(settings({ readiness: checks("legal_documents", "form_questions", "required_fields", "event_not_ended") }));
    const { router } = renderChecklist();
    const legal = await screen.findByRole("link", { name: "Open Legal: Legal texts" });
    const forYou = within(card("For you"));

    expect(legal.getAttribute("href")).toBe("/admin/events/evt-1/registration?tab=legal");
    expect(legal.className).toContain("at-btn--secondary");
    expect(forYou.getByRole("link", { name: "Open Fields: Form questions" })).toBeTruthy();
    expect(forYou.getByRole("link", { name: "Open Fields: Required questions" })).toBeTruthy();
    expect(forYou.getByRole("link", { name: "Open Event settings: Event dates" }).getAttribute("href")).toBe("/admin/events/evt-1/settings");

    fireEvent.click(legal);
    expect(router.state.location.search).toBe("?tab=legal");
    // A tab of the page replaces the entry of the history, as the tab strip does: Back leaves the page, not the tab.
    expect(router.state.historyAction).toBe("REPLACE");
  });

  it("has nothing for the person, and says what is left is a superadmin's, when only those are open", async () => {
    await renderChecklistLoaded(settings({ readiness: checks("mail_provider") }));

    expect(within(card("For you")).getByText("Your steps are done")).toBeTruthy();
    expect(within(card("For you")).getByText("What is left needs a superadmin. It is listed below.")).toBeTruthy();
    expect(within(card("For you")).queryByText("1 to do")).toBeNull();
    expect(checklistTitles()).toContain("Waiting for a superadmin");
  });

  it("has a different state for everything done, for registration on and off, and no card of waiting", async () => {
    await renderChecklistLoaded(settings({ readiness: checks() }));
    expect(checklistTitles()).toEqual(["Registration checklist", "For you", "Done"]);
    expect(within(card("For you")).getByText("Everything is ready")).toBeTruthy();
    expect(within(card("For you")).getByText(/Turn registration on from the Access tab/)).toBeTruthy();
    cleanup();

    await renderChecklistLoaded(settings({ mode: "automatic", readiness: checks() }));
    expect(within(card("For you")).getByText("Everything is in place")).toBeTruthy();
    expect(within(card("For you")).getByText(/Check this tab again when something changes/)).toBeTruthy();
  });
});

describe("RegistrationChecklistTab: what a superadmin sees", () => {
  beforeEach(() => {
    assignments = [SUPERADMIN];
  });

  it("has every open step under For you, with a button to where it is put right, and no card of waiting", async () => {
    await renderChecklistLoaded(settings({ own_address: STOPPED, readiness: checks("bot_protection", "mail_provider", "instance_url", "legal_documents") }));

    expect(checklistTitles()).toEqual(["Registration checklist", "For you", "Done"]);
    const forYou = within(card("For you"));
    expect(forYou.getAllByRole("listitem")).toHaveLength(5);
    expect(forYou.queryByText("Superadmin")).toBeNull();
    expect(forYou.queryByText("Ask a superadmin to set it up.")).toBeNull();
    expect(forYou.getByRole("link", { name: "Open Organisation settings: Bot protection" }).getAttribute("href")).toBe("/admin/settings?tab=external");
    expect(forYou.getByRole("link", { name: "Open Organisation settings: Email sending" }).getAttribute("href")).toBe("/admin/settings?tab=mail");
    expect(forYou.getByRole("link", { name: "Open Organisation settings: Instance address" }).getAttribute("href")).toBe("/admin/settings?tab=general");
    expect(forYou.getByRole("link", { name: "Open Event settings: Address for guests" }).getAttribute("href")).toBe("/admin/events/evt-1/settings?tab=registration");
    expect(forYou.getByRole("link", { name: "Open Legal: Legal texts" })).toBeTruthy();
  });

  it("sends the access method, the password and the identity provider to Event settings, Registration", async () => {
    await renderChecklistLoaded(settings({ access_methods: ["password"], readiness: [{ key: "access_method", ok: false }, { key: "password", ok: false }] }));
    const links = within(card("For you")).getAllByRole("link");

    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/admin/events/evt-1/settings?tab=registration", "/admin/events/evt-1/settings?tab=registration"]);
    expect(links.map((link) => link.getAttribute("aria-label"))).toEqual(["Open Event settings: Access method", "Open Event settings: Event password"]);
    cleanup();

    await renderChecklistLoaded(ssoEventSettings({ readiness: ssoChecks("identity_provider") }));
    expect(within(card("For you")).getByRole("link", { name: "Open Event settings: Identity provider" })).toBeTruthy();
  });
});

describe("RegistrationChecklistTab: the address for guests", () => {
  it("is not a step while the event has no address of its own, or the address was never found working", async () => {
    await renderChecklistLoaded(settings({ own_address: null, readiness: checks() }));
    expect(progress().max).toBe(8);
    cleanup();

    await renderChecklistLoaded(settings({ own_address: { ...STOPPED, verified: false, status: "failing" }, readiness: checks() }));
    expect(progress().max).toBe(8);
  });

  it("is a step that is done while the address works, and open while its last check fails: an administrator waits for a superadmin", async () => {
    await renderChecklistLoaded(settings({ own_address: WORKING, readiness: checks() }));
    expect(progress().max).toBe(9);
    openDone();
    expect(rowOf("Address for guests").textContent).toContain("The address of this event for guests works.");
    cleanup();

    await renderChecklistLoaded(settings({ mode: "automatic", own_address: STOPPED, readiness: checks() }));
    const row = within(card("Waiting for a superadmin")).getByText("Address for guests").closest("li") as HTMLElement;
    expect(row.textContent).toContain("The address of this event for guests stopped working, so guests may not be able to open their links.");
    expect(row.textContent).toContain("Ask a superadmin to check the address.");
    expect(row.querySelector(".ti-world-off")).not.toBeNull();
    expect(within(row).getByText("Superadmin")).toBeTruthy();
  });
});

describe("RegistrationChecklistTab: an archived event", () => {
  it("has the banner and what is done, and no card of steps to do, whatever is open", async () => {
    await renderChecklistLoaded(settings({ readiness: checks("legal_documents", "mail_provider") }), { withEvent: archivedEvent });

    expect(banner().textContent).toContain("This event is archived. Registration is closed and nothing here can be changed.");
    expect(banner().className).toContain("at-notice--info");
    expect(checklistTitles()).toEqual(["Registration checklist", "Done"]);
    expect(doneSummary()).toBeTruthy();
    expect(screen.queryByText("Event status")).toBeNull();
  });
});

describe("RegistrationChecklistTab: the card Done", () => {
  it("is a collapsible card: closed, with how many steps are done in its title, until its header is pressed, and closes again", async () => {
    await renderChecklistLoaded(settings({ readiness: checks("legal_documents") }));
    const toggle = doneSummary();

    expect(toggle.classList.contains("at-card__header")).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.textContent).toContain("7");
    expect(toggle.textContent).not.toMatch(/Show|Hide/);
    expect(toggle.querySelector(".at-card__chevron")).not.toBeNull();
    expect(checklistRows()).toHaveLength(1);

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(toggle.getAttribute("aria-controls") as string)).not.toBeNull();
    expect(checklistRows()).toHaveLength(8);

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(checklistRows()).toHaveLength(1);
  });

  it("is a native button in the tab order, in a card like the others", async () => {
    await renderChecklistLoaded(settings({ readiness: checks() }));

    expect(doneSummary().tagName).toBe("BUTTON");
    expect(doneSummary().tabIndex).toBe(0);
    expect(doneSummary().closest(".at-card")).not.toBeNull();
  });

  it("is not drawn when nothing is done", async () => {
    await renderChecklistLoaded(settings({ readiness: [{ key: "legal_documents", ok: false }] }));

    expect(within(checklistPanel()).queryByRole("button", { name: /^Done/ })).toBeNull();
  });
});

describe("RegistrationChecklistTab: the rows", () => {
  it("says in words, not by colour alone, which row is done and which is to do", async () => {
    await renderChecklistLoaded(settings({ readiness: checks("legal_documents") }));
    openDone();

    expect(rowOf("Legal texts").querySelector(".sr-only")?.textContent).toBe("To do: ");
    expect(rowOf("Legal texts").textContent).toContain("Publish the privacy notice, the terms and every consent you chose.");
    expect(rowOf("Email sending").querySelector(".sr-only")?.textContent).toBe("Done: ");
    expect(checklistRows()).toHaveLength(8);
  });

  it("never says that the event is archived as a step", async () => {
    await renderChecklistLoaded(settings({ readiness: checks("event_not_archived") }));
    openDone();

    expect(checklistRows()).toHaveLength(8);
    expect(screen.queryByText("Event status")).toBeNull();
    expect(within(card("Registration checklist")).getByText("8 of 8 done")).toBeTruthy();
  });

  it("states the access method as text, with who sets it, and no control", async () => {
    await renderChecklistLoaded(settings());
    openDone();
    const row = rowOf("Access method");

    expect(row.textContent).toContain("Link. Anyone who has the link can ask to join.");
    expect(row.textContent).toContain("Set by a superadmin in Event settings, Registration.");
    expect(within(row).queryByRole("link")).toBeNull();
    expect(within(row).queryByRole("button")).toBeNull();
  });

  it("shows bot protection that is not used as grey information, last, with a dash, and does not count it", async () => {
    await renderChecklistLoaded(settings({ bot_protection: "not_used", readiness: notUsedChecks("mail_provider") }));
    openDone();

    const info = checklistRows().at(-1) as HTMLElement;
    expect(info.textContent).toContain("Off for this organisation. The link and password forms have no bot check.");
    expect(info.querySelector(".sr-only")?.textContent).toBe("Off: ");
    expect(info.querySelector(".overview-check__icon--neutral")).not.toBeNull();
    expect(info.querySelector(".ti-minus")).not.toBeNull();
    expect(within(info).queryByRole("link")).toBeNull();
    expect(within(card("Registration checklist")).getByText("6 of 7 done")).toBeTruthy();
  });

  it("tells the event's own switch from the organisation's", async () => {
    await renderChecklistLoaded(settings({ bot_protection: "required", bot_protection_enabled: false, readiness: notUsedChecks() }));
    openDone();

    const info = checklistRows().at(-1) as HTMLElement;
    expect(info.textContent).toContain("Off for this event. The link and password forms of this event have no bot check.");
    expect(info.textContent).not.toContain("organisation");
  });

  it("asks for the identity provider, and has no bot protection, for an event with the company SSO", async () => {
    await renderChecklistLoaded(ssoEventSettings({ readiness: ssoChecks("identity_provider") }));

    expect(screen.queryByText("Bot protection")).toBeNull();
    expect(rowOf("Identity provider").textContent).toContain("Choose an identity provider for Company SSO. If the list is empty, ask a superadmin to set one up under Identity.");
    expect(within(card("Waiting for a superadmin")).getByText("Identity provider")).toBeTruthy();
  });

  it("says which identity provider guests sign in with, and marks one that is turned off", async () => {
    await renderChecklistLoaded(ssoEventSettings());
    openDone();
    expect(rowOf("Access method").textContent).toContain("Company SSO. Guests sign in with Contoso Entra.");
    cleanup();

    await renderChecklistLoaded(ssoEventSettings({ sso_provider: { id: "idp-entra", state: "disabled", display_name: "Contoso Entra", kind: "entra" } }));
    openDone();
    expect(rowOf("Access method").textContent).toContain("Company SSO. Guests sign in with Contoso Entra (turned off).");
    cleanup();

    await renderChecklistLoaded(ssoEventSettings({ sso_provider_id: null, sso_provider: null }));
    openDone();
    expect(rowOf("Access method").textContent).toContain("Company SSO. No identity provider is chosen yet.");
  });

  it("is the warning row, with who to ask and without the sentence about who sets it, when no access method is chosen", async () => {
    await renderChecklistLoaded(settings({ access_methods: [], readiness: checks("access_method") }));
    const row = rowOf("Access method");

    expect(row.textContent).toContain("No access method is chosen yet. Guests cannot open the form.");
    expect(row.textContent).toContain("Ask a superadmin to choose it in Event settings, Registration.");
    expect(row.textContent).not.toContain("Set by a superadmin");
    expect(row.querySelector(".ti-alert-triangle")).not.toBeNull();
    expect(within(card("Waiting for a superadmin")).getByText("Access method")).toBeTruthy();
  });

  it.each<[string[]]>([[[]], [["link", "password"]], [["sso", "link"]]])("shows no access method as chosen for %j, as the server counts none", async (methods) => {
    await renderChecklistLoaded(settings({ access_methods: methods as RegistrationSettingsDto["access_methods"], readiness: checks("access_method") }));

    expect(rowOf("Access method").textContent).toContain("No access method is chosen yet. Guests cannot open the form.");
    expect(rowOf("Access method").textContent).not.toContain("Set by a superadmin");
  });

  it.each([
    [[], "No question of yours is on the form. Guests give their name and email address, and what the switches on the Access tab add."],
    [[{ key: "a", label: "A", type: "text", required: true }], "1 question of yours is on the form."],
    [[{ key: "a", label: "A", type: "text", required: true }, { key: "b", label: "B", type: "text", required: false }], "2 questions of yours are on the form."],
  ] as const)("says how many questions of the organiser are on the form, with a button to the Fields tab", async (fields, text) => {
    await renderChecklistLoaded(settings({ public_fields: [...fields] }));
    openDone();
    const row = rowOf("Form questions");

    expect(row.textContent).toContain(text);
    // A done row has the same button, in the same place and look, as an open one: no link under the text.
    const button = within(row).getByRole("link", { name: "Open Fields: Form questions" });
    expect(button.getAttribute("href")).toBe("/admin/events/evt-1/registration?tab=fields");
    expect(button.className).toContain("at-btn--secondary");
    expect(button.closest(".access-check__aside")).not.toBeNull();
    expect(within(row).queryByText("Add or change questions on the Fields tab.")).toBeNull();
  });

  it("does not say how many questions there are for a form that cannot show a required one: the row says what is wrong", async () => {
    await renderChecklistLoaded(settings({ readiness: checks("form_questions") }));

    expect(rowOf("Form questions").textContent).toContain("A required question cannot be shown on the form.");
    expect(rowOf("Form questions").textContent).not.toContain("of yours");
  });

  it("reads a check it has no words for as another thing that is missing, so a newer server never leaves a blank row", async () => {
    await renderChecklistLoaded(settings({ readiness: [...checks(), { key: "something_new" as never, ok: false }] }));

    expect(within(card("For you")).getByText("Something else that registration needs is missing.")).toBeTruthy();
  });

  it("asks for the password only when the way in is the password, as the server lists it", async () => {
    await renderChecklistLoaded(settings({ access_methods: ["password"], readiness: [{ key: "access_method", ok: true }, { key: "password", ok: false }] }));

    expect(rowOf("Event password").textContent).toContain("Set the password that guests will enter.");
    expect(rowOf("Event password").textContent).toContain("Ask a superadmin to set it in Event settings, Registration.");
  });
});

describe("RegistrationChecklistTab: accessibility", () => {
  const scan = async () => (await axe.run(checklistPanel(), { rules: { "color-contrast": { enabled: false } } })).violations;

  it("is free of axe violations for an organiser and for a superadmin, with the card Done closed and open", async () => {
    await renderChecklistLoaded(settings({ own_address: STOPPED, mode: "automatic", readiness: ssoChecks("identity_provider", "legal_documents") }));
    expect(await scan()).toEqual([]);
    openDone();
    expect(await scan()).toEqual([]);
    cleanup();

    assignments = [SUPERADMIN];
    await renderChecklistLoaded(settings({ own_address: STOPPED, readiness: ssoChecks("identity_provider", "legal_documents") }));
    expect(await scan()).toEqual([]);
    cleanup();

    await renderChecklistLoaded(settings({ readiness: checks() }));
    expect(await scan()).toEqual([]);
  });
});

describe("RegistrationChecklistTab: the number on the tab", () => {
  it("is the number of open steps of the list, for an organiser and for a superadmin alike, and is read once", async () => {
    await renderChecklistLoaded(settings({ readiness: checks("mail_provider", "legal_documents", "bot_protection") }));

    // The page hears of the checks in an effect after the list is drawn.
    expect((await screen.findByRole("tab", { name: "Checklist, 3 steps open" })).textContent).toBe("Checklist3");
    expect(api.fetchRegistrationSettings).toHaveBeenCalledTimes(1);
    cleanup();

    assignments = [SUPERADMIN];
    await renderChecklistLoaded(settings({ readiness: checks("mail_provider", "legal_documents", "bot_protection") }));
    expect(await screen.findByRole("tab", { name: "Checklist, 3 steps open" })).toBeTruthy();
  });

  it("counts the stopped address, as the list does", async () => {
    await renderChecklistLoaded(settings({ own_address: STOPPED, readiness: checks("legal_documents") }));

    expect(await screen.findByRole("tab", { name: "Checklist, 2 steps open" })).toBeTruthy();
  });

  it("is gone when nothing is open, and the list says so", async () => {
    await renderChecklistLoaded(settings({ readiness: checks() }));

    expect(screen.getByRole("tab", { name: "Checklist" }).textContent).toBe("Checklist");
  });
});
