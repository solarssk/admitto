// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/api/client.js";
import type { RegistrationSettingsDto } from "../../src/api/types.js";
import { reportApiError } from "../../src/connection/ConnectionStateProvider.js";
import { LOAD_TIMEOUT_MESSAGE, SLOW_NOTICE_TEXT } from "../../src/utils/loading-timing.js";
import { advanceTimers, deferred, getTooltipText, hangUntilAborted, isOff } from "../test-utils.js";
import { addToast, api } from "./accessApiMocks.js";
import { archivedEvent, checks, event, legalAnswer, settings, texts } from "./accessData.js";
import { card, loaded, renderAccess, renderLoaded, resetApi, saveButton, toggle } from "./accessFixtures.js";

const goToLogin = vi.fn();

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const { api: mocks } = await import("./accessApiMocks.js");
  return {
    ...(await importOriginal<typeof import("../../src/api/client.js")>()),
    fetchRegistrationSettings: (...args: unknown[]) => mocks.fetchRegistrationSettings(...args),
    saveRegistrationSettings: (...args: unknown[]) => mocks.saveRegistrationSettings(...args),
    setRegistrationPassword: (...args: unknown[]) => mocks.setRegistrationPassword(...args),
    clearRegistrationPassword: (...args: unknown[]) => mocks.clearRegistrationPassword(...args),
    fetchLegalDocuments: (...args: unknown[]) => mocks.fetchLegalDocuments(...args),
    fetchRegistrationCounts: (...args: unknown[]) => mocks.fetchRegistrationCounts(...args),
  };
});
vi.mock("../../src/connection/ConnectionStateProvider.js");
vi.mock("../../src/auth/login-navigation.js", () => ({ goToLogin: (...args: unknown[]) => goToLogin(...args) }));
vi.mock("@admitto/ui", async (importOriginal) => {
  const { addToast: toast } = await import("./accessApiMocks.js");
  return { ...(await importOriginal<typeof import("@admitto/ui")>()), useToast: () => ({ addToast: toast }) };
});

const placeholder = () => screen.queryByRole("status", { name: "Loading registration settings" });

beforeEach(() => {
  resetApi();
  goToLogin.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("RegistrationAccessTab: the first read", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // A read that a test has not set up hangs, instead of answering with nothing.
    api.fetchRegistrationSettings.mockImplementation(hangUntilAborted as never);
    api.fetchLegalDocuments.mockImplementation(hangUntilAborted as never);
  });

  it("holds the room of the cards invisibly for 200ms, then draws them grey with their real titles, and says it is taking longer after 8 seconds", async () => {
    renderAccess();
    await advanceTimers(0);

    const held = placeholder() as HTMLElement;
    expect(held.classList.contains("at-loading-hold")).toBe(true);
    for (const title of ["Access method", "Company SSO", "Form", "Handling requests"]) expect(within(held).getByText(title)).toBeTruthy();
    // The shapes are decoration; nothing claims that there is nothing yet.
    expect(held.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.queryByRole("switch")).toBeNull();

    await advanceTimers(200);
    expect(placeholder()?.classList.contains("at-loading-hold")).toBe(false);
    expect(screen.queryByText(SLOW_NOTICE_TEXT)).toBeNull();

    await advanceTimers(8000);
    expect(within(placeholder() as HTMLElement).getByText(SLOW_NOTICE_TEXT)).toBeTruthy();
  });

  it("waits for both reads: the settings alone are not the form", async () => {
    const legal = deferred<ReturnType<typeof legalAnswer>>();
    api.fetchRegistrationSettings.mockResolvedValue(settings());
    api.fetchLegalDocuments.mockReturnValue(legal.promise);
    renderAccess();
    await advanceTimers(500);

    expect(screen.queryByRole("switch")).toBeNull();

    await act(async () => legal.resolve(legalAnswer(texts())));
    await advanceTimers(500);
    expect(screen.getByRole("switch", { name: "Waiting list" })).toBeTruthy();
  });

  it("ends in an error after 30 seconds, with a Retry that stays on screen, busy, with its focus", async () => {
    renderAccess();
    await advanceTimers(0);
    await advanceTimers(30_000);
    await advanceTimers(0);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain(LOAD_TIMEOUT_MESSAGE);
    expect(alert.textContent).toContain("Could not load the registration settings");

    const read = deferred<RegistrationSettingsDto>();
    api.fetchRegistrationSettings.mockReturnValueOnce(read.promise);
    api.fetchLegalDocuments.mockResolvedValue(legalAnswer(texts()));
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
    expect(screen.getByRole("switch", { name: "Waiting list" })).toBeTruthy();
  });
});

describe("RegistrationAccessTab: a read that fails", () => {
  it("is an error in the words of the app, never the form, and the connection state hears of it", async () => {
    api.fetchRegistrationSettings.mockRejectedValue(new ApiError(500, "internal_error", "internal_error"));
    renderAccess();

    const alert = await screen.findByRole("alert");

    expect(alert.textContent).toContain("Could not load the registration settings");
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(reportApiError).toHaveBeenCalledWith(500);
  });

  it("tells someone who may not manage the event that they have no access, and shows nothing of the settings", async () => {
    api.fetchRegistrationSettings.mockRejectedValue(new ApiError(403, "forbidden", "forbidden"));
    renderAccess();

    const alert = await screen.findByRole("alert");

    expect(alert.textContent).toContain("Could not load the registration settings");
    expect(alert.textContent).toContain("You do not have access.");
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByText("Form", { selector: ".at-card__title" })).toBeNull();
    expect(reportApiError).toHaveBeenCalledWith(403);
  });

  it("is an error when the legal texts cannot be read, although the settings could", async () => {
    api.fetchLegalDocuments.mockRejectedValue(new ApiError(500, "internal_error", "internal_error"));
    renderAccess();

    expect((await screen.findByRole("alert")).textContent).toContain("Could not load the registration settings");
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("hands the browser to the login page when the session has ended, and shows nothing first", async () => {
    api.fetchRegistrationSettings.mockRejectedValue(new ApiError(401, "authentication_required"));
    renderAccess();

    await waitFor(() => expect(goToLogin).toHaveBeenCalledWith(expect.stringMatching(/^\/login\?next=/)));
    expect(reportApiError).toHaveBeenCalledWith(401);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("RegistrationAccessTab: the settings", () => {
  it("reads the settings and the legal texts of the event, with the signal that abandons them", async () => {
    await renderLoaded();

    expect(api.fetchRegistrationSettings).toHaveBeenCalledWith("evt-1", expect.any(AbortSignal));
    expect(api.fetchLegalDocuments).toHaveBeenCalledWith("evt-1", expect.any(AbortSignal));
  });

  it("has no switch for the look of the form's boxes: every form draws its own", async () => {
    await renderLoaded();

    expect(within(card("Form")).queryByRole("switch", { name: "Styled form boxes" })).toBeNull();
    expect(card("Form").textContent).not.toContain("Styled form boxes");
    expect(card("Form").textContent).not.toContain("Look");
  });

  it("shows each setting as it is saved, and nothing to save yet", async () => {
    await renderLoaded(
      settings({
        mode: "approval",
        access_methods: ["password"],
        password_set: true,
        waitlist_enabled: false,
        verify_email: true,
        ask_company: true,
        ask_department: false,
        max_companions: 1,
        consent_keys: ["photo"],
      }),
    );

    expect(toggle("Approve requests by hand").checked).toBe(true);
    expect(toggle("Waiting list").checked).toBe(false);
    expect(toggle("Confirm email addresses").checked).toBe(true);
    expect(toggle("Ask for the company").checked).toBe(true);
    expect(toggle("Ask for the department").checked).toBe(false);
    expect(toggle("Guests can bring one person").checked).toBe(true);
    expect(screen.getByRole("button", { name: "Extra consents, Photos and video" })).toBeTruthy();
    expect(isOff(saveButton())).toBe(true);
    expect(screen.queryByText("Unsaved changes")).toBeNull();
  });

  it("reads again nothing under the form that is loaded: one read, whatever the person does", async () => {
    await renderLoaded();

    fireEvent.click(toggle("Waiting list"));
    fireEvent.click(toggle("Ask for the company"));

    expect(api.fetchRegistrationSettings).toHaveBeenCalledTimes(1);
    expect(api.fetchLegalDocuments).toHaveBeenCalledTimes(1);
  });
});

describe("RegistrationAccessTab: the consents", () => {
  it("offers the extra consents that are published, and no draft", async () => {
    await renderLoaded();

    fireEvent.click(screen.getByRole("button", { name: "Extra consents, none selected" }));

    const list = screen.getByRole("list", { name: "Extra consents" });
    expect(within(list).getAllByRole("checkbox").map((box) => (box as HTMLInputElement).labels?.[0]?.textContent)).toEqual(["Photos and video"]);
  });

  it("keeps a consent that is chosen and not published in the list, marked, so that it can be taken off", async () => {
    await renderLoaded(settings({ consent_keys: ["news"] }));

    expect(screen.getByRole("button", { name: "Extra consents, News about our events (not published)" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Extra consents/ }));
    const box = screen.getByRole("checkbox", { name: "News about our events (not published)" }) as HTMLInputElement;
    expect(box.checked).toBe(true);
  });

  it("is the button Open Legal at the right of its row, with a line that says why, when no extra consent is published", async () => {
    api.fetchLegalDocuments.mockResolvedValue(legalAnswer(texts()));
    await renderLoaded();

    const row = within(card("Form")).getByText("Extra consents").closest(".settings-row") as HTMLElement;
    expect(within(row).getByText("You have no consent to choose from yet. Write one on the Legal tab.")).toBeTruthy();
    const link = within(row).getByRole("link", { name: "Open Legal: Extra consents" });
    expect(link.getAttribute("href")).toBe("/admin/events/evt-1/registration?tab=legal");
    // The same markup as the row "Your own questions": the button is the last thing in the row, in its controls.
    expect(link.closest(".settings-row__controls")).toBe(row.lastElementChild);
    expect(link.className).toBe("at-btn at-btn--secondary at-btn--sm");
    expect(link.textContent).toBe("Open Legal");
    // No field, no placeholder and no hint under a field.
    expect(screen.queryByRole("button", { name: /^Extra consents/ })).toBeNull();
    expect(screen.queryByText("Nothing to choose yet")).toBeNull();
    expect(row.querySelector(".at-hint")).toBeNull();
  });

  it("is the choice of consents at the right of its row, described by the line of the row, when there is something to choose", async () => {
    await renderLoaded();

    const row = within(card("Form")).getByText("Extra consents", { selector: "strong" }).closest(".settings-row") as HTMLElement;
    const description = within(row).getByText("Optional checkboxes on the form, for example a marketing consent. The privacy notice and the terms are always shown.");
    const select = within(row).getByRole("button", { name: /^Extra consents/ });
    expect(select.getAttribute("aria-describedby")).toBe(description.id);
    expect(select.closest(".settings-row__controls")).toBe(row.lastElementChild);
    expect(within(row).queryByRole("link", { name: /Open Legal/ })).toBeNull();
    expect(within(row).queryByText("Extra consents", { selector: "label" })).toBeNull();
  });
});

describe("RegistrationAccessTab: the two cards of the form", () => {
  const switchNames = (part: HTMLElement) => within(part).getAllByRole("switch").map((node) => node.getAttribute("aria-label"));
  const groupLabels = (part: HTMLElement) => Array.from(part.querySelectorAll(".attendees-section-label")).map((node) => node.textContent);

  it("has an intro line in each card, the questions and the consents first, in three labelled groups, and what happens after the form is sent second", async () => {
    await renderLoaded();

    const titles = Array.from(document.querySelectorAll(".at-card__title")).map((node) => node.textContent);
    expect(titles).toEqual(["Access method", "Company SSO", "Form", "Handling requests"]);
    for (const title of titles) expect(card(title as string).querySelector(".settings-card-intro")).not.toBeNull();
    expect(card("Form").querySelector(".settings-card-intro")?.textContent).toBe("The questions on the form and the consents guests agree to.");
    expect(switchNames(card("Form"))).toEqual(["Ask for the company", "Ask for the department", "Guests can bring one person"]);
    expect(groupLabels(card("Form"))).toEqual(["Questions", "Consents"]);
    expect(within(card("Form")).getByRole("button", { name: /^Extra consents/ })).toBeTruthy();
    expect(card("Handling requests").querySelector(".settings-card-intro")?.textContent).toBe("Decide how new requests are checked and accepted.");
    expect(switchNames(card("Handling requests"))).toEqual(["Confirm email addresses", "Approve requests by hand", "Waiting list"]);
  });

  it("says each setting in one short line", async () => {
    await renderLoaded();

    const line = (title: string) => (toggle(title).closest(".settings-row") as HTMLElement).querySelector("p")?.textContent;
    expect(line("Waiting list")).toBe("When the event is full, new requests wait for a free place.");
    expect(line("Confirm email addresses")).toBe("Guests confirm by a link. It works for 24 hours.");
    expect(line("Guests can bring one person")).toBe("That person takes a place too.");
    expect(line("Ask for the company")).toBe("Adds a company question to the form.");
    expect(line("Ask for the department")).toBe("Adds a department question to the form.");
  });

  it("is changed by every administrator of the event, not by a superadmin alone", async () => {
    await renderLoaded(settings({ mode: "approval" }), { superadmin: false });

    for (const name of ["Approve requests by hand", "Waiting list", "Confirm email addresses", "Guests can bring one person", "Ask for the company", "Ask for the department"]) {
      expect(isOff(toggle(name)), name).toBe(false);
    }
  });
});

describe("RegistrationAccessTab: the mode of registration", () => {
  it("is a switch of the Requests and limits card, on for requests that wait, and off for guests that are accepted by themselves, while registration is on", async () => {
    await renderLoaded(settings({ mode: "approval" }));
    expect(screen.getByText("You accept or reject each request on the Requests tab.")).toBeTruthy();
    expect(isOff(toggle("Approve requests by hand"))).toBe(false);
    api.saveRegistrationSettings.mockResolvedValue(settings({ mode: "automatic" }));

    fireEvent.click(toggle("Approve requests by hand"));
    fireEvent.click(saveButton());

    await waitFor(() => expect(api.saveRegistrationSettings).toHaveBeenCalledWith("evt-1", { mode: "automatic" }));
    expect(addToast).toHaveBeenCalledWith("Registration settings saved.", "success");
  });

  it("sends the mode that waits for approval when the switch is turned back on", async () => {
    await renderLoaded(settings({ mode: "automatic" }));
    expect(toggle("Approve requests by hand").checked).toBe(false);
    api.saveRegistrationSettings.mockResolvedValue(settings({ mode: "approval" }));

    fireEvent.click(toggle("Approve requests by hand"));
    fireEvent.click(saveButton());

    await waitFor(() => expect(api.saveRegistrationSettings).toHaveBeenCalledWith("evt-1", { mode: "approval" }));
  });

  it("is off, with the way to turn registration on, while registration is off, and never turns it on", async () => {
    await renderLoaded(settings({ mode: null }));

    expect(isOff(toggle("Approve requests by hand"))).toBe(true);
    expect(toggle("Approve requests by hand").checked).toBe(false);
    expect(screen.getByText("You can choose this once registration is on.")).toBeTruthy();
  });
});

describe("RegistrationAccessTab: the questions of the event", () => {
  it("has no card of the questions on the form (the Fields tab is where they are), and a row with a button to the Fields tab in the Form card", async () => {
    await renderLoaded(settings({ public_fields: [{ key: "plate", label: "Registration number of your car", type: "text", required: true }] }));

    expect(screen.queryByText("Your questions on the form", { selector: ".at-card__title" })).toBeNull();
    expect(screen.queryByText("Registration number of your car")).toBeNull();
    const row = within(card("Form")).getByText("Your own questions").closest(".settings-row") as HTMLElement;
    expect(within(row).getByText("Add or change them on the Fields tab.")).toBeTruthy();
    expect(within(row).getByRole("link", { name: "Open Fields: Your own questions" }).getAttribute("href")).toBe("/admin/events/evt-1/registration?tab=fields");
  });
});

describe("RegistrationAccessTab: an archived event", () => {
  beforeEach(async () => {
    await renderLoaded(settings({ mode: "approval", access_methods: ["password"], password_set: true, readiness: [{ key: "access_method", ok: true }, { key: "password", ok: true }] }), {
      withEvent: archivedEvent,
    });
  });

  it("locks every control that would change a setting, and has no Save or Reset", () => {
    for (const name of ["Approve requests by hand", "Waiting list", "Confirm email addresses", "Ask for the company", "Ask for the department", "Guests can bring one person"]) {
      expect(toggle(name).disabled, name).toBe(true);
    }
    expect(screen.getByRole("button", { name: /^Extra consents/ }).hasAttribute("disabled")).toBe(true);
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();
  });

  it("does not say again, in the panel, that the event is archived: the page above says it, and the access method is only read", () => {
    // The page says it. The buttons of the event password carry the reason in their tooltips, as in every guarded control.
    const sayings = [card("Form"), card("Handling requests")].flatMap((part) => Array.from(part.querySelectorAll("*"))).filter((node) => node.children.length === 0 && /archived/i.test(node.textContent ?? ""));

    expect(sayings).toHaveLength(0);
  });
});

describe("RegistrationAccessTab: one event, one tab", () => {
  it("reads the other event, and holds nothing of the first one's form, when the address changes under the tab", async () => {
    const { router } = renderAccess();
    await loaded();
    fireEvent.click(toggle("Ask for the company"));
    expect(toggle("Ask for the company").checked).toBe(true);

    api.fetchRegistrationSettings.mockResolvedValue(settings({ ask_company: false }));
    await act(async () => {
      await router.navigate("/admin/events/evt-2/settings?tab=registration");
    });
    await waitFor(() => expect(api.fetchRegistrationSettings).toHaveBeenLastCalledWith("evt-2", expect.any(AbortSignal)));
    await loaded();

    expect(toggle("Ask for the company").checked).toBe(false);
  });
});
