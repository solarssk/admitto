// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/api/client.js";
import type { RegistrationSettingsDto, RoleAssignment } from "../../src/api/types.js";
import { reportApiError } from "../../src/connection/ConnectionStateProvider.js";
import { LOAD_TIMEOUT_MESSAGE, SLOW_NOTICE_TEXT } from "../../src/utils/loading-timing.js";
import { advanceTimers, deferred, hangUntilAborted } from "../test-utils.js";
import { api } from "./accessApiMocks.js";
import { archivedEvent, checks, notUsedChecks, settings, ssoChecks, ssoEventSettings } from "./accessData.js";
import { card, checklistPanel, checklistRows, renderChecklist, renderChecklistLoaded, resetApi } from "./accessFixtures.js";

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
const titles = () => Array.from(checklistPanel().querySelectorAll(".at-card__title")).map((title) => title.textContent);
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
    for (const title of ["For you", "Done"]) expect(within(held).getByText(title)).toBeTruthy();
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
    expect(titles()).toEqual(["For you", "Done"]);
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

describe("RegistrationChecklistTab: what an event administrator sees", () => {
  it("has the steps this person can do under For you, the ones for a superadmin under Waiting for a superadmin, and what is met under Done", async () => {
    await renderChecklistLoaded(settings({ readiness: checks("mail_provider", "legal_documents", "bot_protection") }));

    expect(titles()).toEqual(["For you", "Waiting for a superadmin", "Done"]);
    const forYou = within(card("For you"));
    expect(forYou.getAllByRole("listitem")).toHaveLength(1);
    expect(forYou.getByText("Legal texts")).toBeTruthy();
    const waiting = within(card("Waiting for a superadmin"));
    expect(waiting.getAllByRole("listitem").map((row) => row.querySelector("strong")?.textContent)).toEqual(["To do: Bot protection", "To do: Email sending"]);
    expect(waiting.getByText("Only a superadmin can put these right. Ask one to do it.")).toBeTruthy();
    expect(within(card("Done")).getAllByRole("listitem")).toHaveLength(5);
    expect(within(card("For you")).getByText("1 to do")).toBeTruthy();
    expect(within(card("Waiting for a superadmin")).getByText("2 to do")).toBeTruthy();
    expect(within(card("Done")).getByText("5 of 8 done")).toBeTruthy();
  });

  it("tells a superadmin's steps apart by who can fix them, and sends the others to ask a superadmin, with no link", async () => {
    await renderChecklistLoaded(settings({ readiness: checks("bot_protection", "mail_provider", "instance_url") }));

    const waiting = within(card("Waiting for a superadmin"));
    expect(waiting.getAllByText("Ask a superadmin to set it up.")).toHaveLength(3);
    expect(waiting.queryByRole("link")).toBeNull();
  });

  it("says there is nothing to do, and leaves out the card of waiting, when every open step is a superadmin's or none is open", async () => {
    await renderChecklistLoaded(settings({ readiness: checks("mail_provider") }));
    expect(within(card("For you")).getByText("There is nothing for you to do right now.")).toBeTruthy();
    expect(within(card("For you")).getByText("Nothing to do")).toBeTruthy();
    expect(titles()).toEqual(["For you", "Waiting for a superadmin", "Done"]);
    cleanup();

    await renderChecklistLoaded(settings({ readiness: checks() }));
    expect(titles()).toEqual(["For you", "Done"]);
    expect(within(card("For you")).getByText("There is nothing for you to do right now.")).toBeTruthy();
    expect(within(card("Done")).getByText("8 of 8 done")).toBeTruthy();
  });

  it("sends a check to the tab that puts it right, and the steps of the event to its settings", async () => {
    api.fetchRegistrationSettings.mockResolvedValue(settings({ readiness: checks("legal_documents", "form_questions", "required_fields", "event_not_ended") }));
    const { router } = renderChecklist();
    await waitFor(() => expect(screen.getByRole("link", { name: "Open the Legal tab." })).toBeTruthy());
    const forYou = within(card("For you"));

    const legal = forYou.getByRole("link", { name: "Open the Legal tab." });
    expect(legal.getAttribute("href")).toBe("/admin/events/evt-1/registration?tab=legal");
    expect(forYou.getAllByRole("link", { name: "Open the Fields tab." })).toHaveLength(2);
    expect(forYou.getByRole("link", { name: "Check the date and hours in Event settings." }).getAttribute("href")).toBe("/admin/events/evt-1/settings");

    fireEvent.click(legal);
    expect(router.state.location.search).toBe("?tab=legal");
    // A tab of the page replaces the entry of the history, as the tab strip does: Back leaves the page, not the tab.
    expect(router.state.historyAction).toBe("REPLACE");
  });
});

describe("RegistrationChecklistTab: what a superadmin sees", () => {
  beforeEach(() => {
    assignments = [SUPERADMIN];
  });

  it("has every open step under For you, with a link to where it is put right, and no card of waiting", async () => {
    await renderChecklistLoaded(settings({ readiness: checks("bot_protection", "mail_provider", "instance_url", "legal_documents") }));

    expect(titles()).toEqual(["For you", "Done"]);
    const forYou = within(card("For you"));
    expect(forYou.getAllByRole("listitem")).toHaveLength(4);
    expect(forYou.queryByText("Ask a superadmin to set it up.")).toBeNull();
    expect(forYou.getByRole("link", { name: "Set it up in Organisation settings, External services." }).getAttribute("href")).toBe("/admin/settings?tab=external");
    expect(forYou.getByRole("link", { name: "Set it up in Organisation settings, Mail." }).getAttribute("href")).toBe("/admin/settings?tab=mail");
    expect(forYou.getByRole("link", { name: "Set it in Organisation settings, General." }).getAttribute("href")).toBe("/admin/settings?tab=general");
    expect(forYou.getByRole("link", { name: "Open the Legal tab." })).toBeTruthy();
  });

  it("sends the way in, the password and the identity provider to Event settings, Registration", async () => {
    await renderChecklistLoaded(settings({ access_methods: ["password"], readiness: [{ key: "access_method", ok: false }, { key: "password", ok: false }] }));
    const links = within(card("For you")).getAllByRole("link");

    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/admin/events/evt-1/settings?tab=registration", "/admin/events/evt-1/settings?tab=registration"]);
    expect(links.map((link) => link.textContent)).toEqual(["Choose it in Event settings, Registration.", "Set it in Event settings, Registration."]);
    cleanup();

    await renderChecklistLoaded(ssoEventSettings({ readiness: ssoChecks("identity_provider") }));
    expect(within(card("For you")).getByRole("link", { name: "Choose it in Event settings, Registration." })).toBeTruthy();
  });
});

describe("RegistrationChecklistTab: the rows", () => {
  it("lists a row for each check but the archived one, and says in words, not by colour alone, which is done and which is to do", async () => {
    await renderChecklistLoaded(settings({ readiness: checks("legal_documents") }));

    expect(checklistRows()).toHaveLength(8);
    expect(rowOf("Legal texts").querySelector(".sr-only")?.textContent).toBe("To do: ");
    expect(rowOf("Legal texts").textContent).toContain("Publish the privacy notice, the terms and every consent you chose.");
    expect(rowOf("Email sending").querySelector(".sr-only")?.textContent).toBe("Done: ");
  });

  it("never says that the event is archived, which the page above says, even for a check that says so", async () => {
    await renderChecklistLoaded(settings({ readiness: checks("event_not_archived") }), { withEvent: archivedEvent });

    expect(checklistRows()).toHaveLength(8);
    expect(screen.queryByText("Event status")).toBeNull();
    expect(within(card("Done")).getByText("8 of 8 done")).toBeTruthy();
  });

  it("states the access method as text, with who sets it, and no control", async () => {
    await renderChecklistLoaded(settings());
    const row = rowOf("Access method");

    expect(within(card("Done")).getByText("Access method")).toBeTruthy();
    expect(row.textContent).toContain("Link. Anyone who has the link can ask to join.");
    expect(row.textContent).toContain("Set by a superadmin in Event settings, Registration.");
    expect(within(row).queryByRole("link")).toBeNull();
    expect(within(row).queryByRole("button")).toBeNull();
  });

  it("shows bot protection that is not used as grey information, last, with a dash, and does not count it", async () => {
    await renderChecklistLoaded(settings({ bot_protection: "not_used", readiness: notUsedChecks("mail_provider") }));

    const info = checklistRows().at(-1) as HTMLElement;
    expect(info.textContent).toContain("Off for this organisation. The link and password forms have no bot check.");
    expect(info.querySelector(".sr-only")?.textContent).toBe("Off: ");
    expect(info.querySelector(".overview-check__icon--neutral")).not.toBeNull();
    expect(info.querySelector(".ti-minus")).not.toBeNull();
    expect(within(info).queryByRole("link")).toBeNull();
    expect(within(card("Done")).getByText("6 of 7 done")).toBeTruthy();
  });

  it("tells the event's own switch from the organisation's", async () => {
    await renderChecklistLoaded(settings({ bot_protection: "required", bot_protection_enabled: false, readiness: notUsedChecks() }));

    const info = checklistRows().at(-1) as HTMLElement;
    expect(info.textContent).toContain("Off for this event. The link and password forms of this event have no bot check.");
    expect(info.textContent).not.toContain("organisation");
  });

  it("asks for the identity provider, and has no bot protection, for an event with the company SSO", async () => {
    await renderChecklistLoaded(ssoEventSettings({ readiness: ssoChecks("identity_provider") }));

    expect(screen.queryByText("Bot protection")).toBeNull();
    expect(rowOf("Identity provider").textContent).toContain("Choose an identity provider for Company SSO. If the list is empty, ask a superadmin to set one up under Identity.");
    expect(within(card("Waiting for a superadmin")).getByText("Identity provider")).toBeTruthy();
    expect(checklistRows()).toHaveLength(8);
  });

  it("says which identity provider guests sign in with, and marks one that is turned off", async () => {
    await renderChecklistLoaded(ssoEventSettings());
    expect(rowOf("Access method").textContent).toContain("Company SSO. Guests sign in with Contoso Entra.");
    cleanup();

    await renderChecklistLoaded(ssoEventSettings({ sso_provider: { id: "idp-entra", state: "disabled", display_name: "Contoso Entra", kind: "entra" } }));
    expect(rowOf("Access method").textContent).toContain("Company SSO. Guests sign in with Contoso Entra (turned off).");
    cleanup();

    await renderChecklistLoaded(ssoEventSettings({ sso_provider_id: null, sso_provider: null }));
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

  it("reads a check it has no words for as another thing that is missing, so a newer server never leaves a blank row", async () => {
    await renderChecklistLoaded(settings({ readiness: [...checks(), { key: "something_new" as never, ok: false }] }));

    expect(within(card("For you")).getByText("Something else that registration needs is missing.")).toBeTruthy();
  });

  it("asks for the password only when the way in is the password, as the server lists it", async () => {
    await renderChecklistLoaded(settings({ access_methods: ["password"], readiness: [{ key: "access_method", ok: true }, { key: "password", ok: false }] }));

    expect(rowOf("Event password").textContent).toContain("Set the password that guests will enter.");
    expect(rowOf("Event password").textContent).toContain("Ask a superadmin to set it in Event settings, Registration.");
  });

  it("is free of axe violations, for an organiser and for a superadmin", async () => {
    await renderChecklistLoaded(ssoEventSettings({ readiness: ssoChecks("identity_provider", "legal_documents") }));
    expect((await axe.run(checklistPanel(), { rules: { "color-contrast": { enabled: false } } })).violations).toEqual([]);
    cleanup();

    assignments = [SUPERADMIN];
    await renderChecklistLoaded(ssoEventSettings({ readiness: ssoChecks("identity_provider", "legal_documents") }));
    expect((await axe.run(checklistPanel(), { rules: { "color-contrast": { enabled: false } } })).violations).toEqual([]);
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

  it("is gone when nothing is open, and the list says so", async () => {
    await renderChecklistLoaded(settings({ readiness: checks() }));

    expect(screen.getByRole("tab", { name: "Checklist" }).textContent).toBe("Checklist");
  });
});

describe("RegistrationChecklistTab: it stays when registration is on", () => {
  it("shows the same cards for an event that has registration on, and a step that stopped working is open", async () => {
    await renderChecklistLoaded(settings({ mode: "automatic", readiness: checks("bot_protection") }));

    expect(titles()).toEqual(["For you", "Waiting for a superadmin", "Done"]);
    expect(within(card("Waiting for a superadmin")).getByText("Bot protection")).toBeTruthy();
  });
});
