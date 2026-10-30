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
import { accessPanel, card, loaded, radio, renderAccess, renderLoaded, resetApi, saveButton, toggle } from "./accessFixtures.js";

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
const checklistRows = () => Array.from(card("Setup checklist").querySelectorAll("li.access-check"));

beforeEach(() => {
  resetApi();
  goToLogin.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("RegistrationAccessTab: a route without an event", () => {
  it("says there is no event, without reading anything", () => {
    renderAccess({ path: "/admin/registration?tab=access" });

    expect(screen.getByText("Missing event.")).toBeTruthy();
    expect(api.fetchRegistrationSettings).not.toHaveBeenCalled();
    expect(api.fetchLegalDocuments).not.toHaveBeenCalled();
  });
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
    for (const title of ["Guest registration", "Setup checklist", "Way in", "Form", "Your questions on the form"]) expect(within(held).getByText(title)).toBeTruthy();
    // The shapes are decoration; nothing claims that there is nothing yet.
    expect(held.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.queryByRole("radiogroup")).toBeNull();

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

    expect(screen.queryByRole("radiogroup")).toBeNull();

    await act(async () => legal.resolve(legalAnswer(texts())));
    await advanceTimers(500);
    expect(screen.getByRole("radiogroup", { name: "Registration mode" })).toBeTruthy();
  });

  it("ends in an error after 30 seconds, with a Retry that stays on screen, busy, with its focus, and hands the focus to the tab when it works", async () => {
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
    expect(screen.getByRole("radiogroup", { name: "Registration mode" })).toBeTruthy();
    expect(document.activeElement).toBe(accessPanel());
  });
});

describe("RegistrationAccessTab: a read that fails", () => {
  it("is an error in the words of the app, never the form, and the connection state hears of it", async () => {
    api.fetchRegistrationSettings.mockRejectedValue(new ApiError(500, "internal_error", "internal_error"));
    renderAccess();

    const alert = await screen.findByRole("alert");

    expect(alert.textContent).toContain("Could not load the registration settings");
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(reportApiError).toHaveBeenCalledWith(500);
  });

  it("tells someone who may not manage the event that they have no access, and shows nothing of the settings", async () => {
    api.fetchRegistrationSettings.mockRejectedValue(new ApiError(403, "forbidden", "forbidden"));
    renderAccess();

    const alert = await screen.findByRole("alert");

    expect(alert.textContent).toContain("Could not load the registration settings");
    expect(alert.textContent).toContain("You do not have access.");
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.queryByText("Setup checklist", { selector: ".at-card__title" })).toBeNull();
    expect(reportApiError).toHaveBeenCalledWith(403);
  });

  it("is an error when the legal texts cannot be read, although the settings could", async () => {
    api.fetchLegalDocuments.mockRejectedValue(new ApiError(500, "internal_error", "internal_error"));
    renderAccess();

    expect((await screen.findByRole("alert")).textContent).toContain("Could not load the registration settings");
    expect(screen.queryByRole("radiogroup")).toBeNull();
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

  it("has the switch for the styled boxes in the Form card: a switch named by its title, off by default, with its words in the same row", async () => {
    await renderLoaded();

    const styled = within(card("Form")).getByRole("switch", { name: "Styled form boxes" }) as HTMLInputElement;
    expect(styled.type).toBe("checkbox");
    expect(styled.checked).toBe(false);
    expect(styled.disabled).toBe(false);
    const row = styled.closest(".settings-row") as HTMLElement;
    expect(within(row).getByText("Styled form boxes").tagName).toBe("STRONG");
    expect(row.textContent).toContain("Turned off, guests get their browser's boxes.");
    expect(screen.queryByText("Unsaved changes")).toBeNull();
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
        styled_form_controls: true,
      }),
    );

    expect(radio("With approval").getAttribute("aria-checked")).toBe("true");
    expect(radio("Off").getAttribute("aria-checked")).toBe("false");
    expect(radio("Password").getAttribute("aria-checked")).toBe("true");
    expect(radio("Link").getAttribute("aria-checked")).toBe("false");
    expect(toggle("Waiting list").checked).toBe(false);
    expect(toggle("Confirm email addresses").checked).toBe(true);
    expect(toggle("Ask for the company").checked).toBe(true);
    expect(toggle("Ask for the department").checked).toBe(false);
    expect(toggle("Guests can bring one person").checked).toBe(true);
    expect(toggle("Styled form boxes").checked).toBe(true);
    expect(screen.getByRole("button", { name: "Extra consents, Photos and video" })).toBeTruthy();
    expect(isOff(saveButton())).toBe(true);
    expect(screen.queryByText("Unsaved changes")).toBeNull();
  });

  it("shows the mode that is on in its own words, and the mode that is off in its own", async () => {
    await renderLoaded(settings({ mode: "automatic" }));
    expect(screen.getByText("Guests are accepted without waiting for you, until the event is full.")).toBeTruthy();

    cleanup();
    await renderLoaded(settings({ mode: "approval" }));
    expect(screen.getByText("Every request waits on the Requests tab until you accept or reject it.")).toBeTruthy();

    cleanup();
    await renderLoaded(settings({ mode: null }));
    expect(screen.getByText("Guests cannot open the form. The requests you already have stay on the Requests tab.")).toBeTruthy();
  });

  it.each<[string[]]>([[[]], [["sso"]], [["link", "password"]]])("shows no way in as chosen for %j, as the server counts none, and has nothing to save", async (methods) => {
    await renderLoaded(settings({ access_methods: methods as RegistrationSettingsDto["access_methods"], readiness: checks("access_method") }));

    expect(radio("Link").getAttribute("aria-checked")).toBe("false");
    expect(radio("Password").getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText("Choose how guests open the form. You can use one way in at a time.")).toBeTruthy();
    expect(isOff(saveButton())).toBe(true);
  });

  it("says what each way in does, and shows the password row only for the password", async () => {
    await renderLoaded(settings({ access_methods: ["link"] }));
    expect(screen.getByText("Anyone who has the link can ask to join. A bot check protects the form.")).toBeTruthy();
    expect(screen.queryByText("Event password")).toBeNull();

    fireEvent.click(radio("Password"));
    expect(screen.getByText("Guests must type the event password to open the form. A bot check protects it too.")).toBeTruthy();
    expect(screen.getByText("Event password")).toBeTruthy();
  });

  it("reads again nothing under the form that is loaded: one read, whatever the person does", async () => {
    await renderLoaded();

    fireEvent.click(toggle("Waiting list"));
    fireEvent.click(radio("Password"));

    expect(api.fetchRegistrationSettings).toHaveBeenCalledTimes(1);
    expect(api.fetchLegalDocuments).toHaveBeenCalledTimes(1);
  });
});

describe("RegistrationAccessTab: turning registration on", () => {
  it("is possible when every check is met", async () => {
    await renderLoaded(settings({ readiness: checks() }));

    expect(isOff(radio("Automatic"))).toBe(false);
    expect(isOff(radio("With approval"))).toBe(false);
    expect(radio("Automatic").hasAttribute("disabled")).toBe(false);
    expect(screen.queryByText(/Registration can be turned on when/)).toBeNull();
    expect(screen.getByRole("radiogroup", { name: "Registration mode" }).hasAttribute("aria-describedby")).toBe(false);
  });

  it("is off the table while any check is not met, with the reason under the control and tied to it, and Off stays", async () => {
    await renderLoaded(settings({ readiness: checks("legal_documents") }));

    expect(radio("Automatic").hasAttribute("disabled")).toBe(true);
    expect(radio("With approval").hasAttribute("disabled")).toBe(true);
    expect(radio("Off").hasAttribute("disabled")).toBe(false);
    expect(radio("Off").getAttribute("aria-checked")).toBe("true");
    const group = screen.getByRole("radiogroup", { name: "Registration mode" });
    const reason = document.getElementById(group.getAttribute("aria-describedby") ?? "");
    expect(reason?.textContent).toBe("Registration can be turned on when the checklist below is done.");
  });

  it("says to save first when the form holds changes, since the checklist is of what is saved", async () => {
    await renderLoaded(settings({ readiness: checks("legal_documents") }));
    expect(screen.queryByText(/Save your changes first/)).toBeNull();
    expect(screen.queryByText("The checklist shows what is saved. Save your changes to update it.")).toBeNull();

    fireEvent.click(toggle("Ask for the company"));

    expect(screen.getByText(/Save your changes first: the checklist shows what is saved\./)).toBeTruthy();
    expect(screen.getByText("The checklist shows what is saved. Save your changes to update it.")).toBeTruthy();
  });

  it("is not blocked for an event that has it on: a move between the modes is never refused", async () => {
    await renderLoaded(settings({ mode: "approval", readiness: checks("mail_provider") }));

    expect(radio("Automatic").hasAttribute("disabled")).toBe(false);
    expect(radio("Off").hasAttribute("disabled")).toBe(false);
    expect(screen.queryByText(/Registration can be turned on when/)).toBeNull();
  });

  it("warns, for an event that has it on, that something it needs is missing", async () => {
    await renderLoaded(settings({ mode: "automatic", readiness: checks("bot_protection") }));

    expect(screen.getByText(/Registration is on, but something it needs is missing/)).toBeTruthy();

    cleanup();
    await renderLoaded(settings({ mode: "automatic", readiness: checks() }));
    expect(screen.queryByText(/Registration is on, but something it needs is missing/)).toBeNull();

    cleanup();
    await renderLoaded(settings({ mode: null, readiness: checks("bot_protection") }));
    expect(screen.queryByText(/Registration is on, but something it needs is missing/)).toBeNull();
  });
});

describe("RegistrationAccessTab: the checklist", () => {
  it("has a row for each check, the ones that are not met first, and how many are done", async () => {
    await renderLoaded(settings({ readiness: checks("mail_provider", "legal_documents") }));

    const rows = checklistRows();
    expect(rows).toHaveLength(10);
    expect(rows[0]?.textContent).toContain("Legal texts");
    expect(rows[0]?.textContent).toContain("Publish the privacy notice, the terms and every consent you chose.");
    expect(rows[1]?.textContent).toContain("Email sending");
    expect(rows[1]?.textContent).toContain("Email sending is not set up for this event, so guests would get no email.");
    expect(rows[2]?.textContent).toContain("A way in is chosen.");
    expect(within(card("Setup checklist")).getByText("8 of 10 done")).toBeTruthy();
  });

  it("says in words, not by colour alone, which check is done and which is to do", async () => {
    await renderLoaded(settings({ readiness: checks("legal_documents") }));

    const [first, second] = checklistRows();
    expect(first?.querySelector(".sr-only")?.textContent).toBe("To do: ");
    expect(second?.querySelector(".sr-only")?.textContent).toBe("Done: ");
  });

  it("sends a missing check to the tab that puts it right, and a superadmin's to the superadmin", async () => {
    api.fetchRegistrationSettings.mockResolvedValue(
      settings({ readiness: checks("legal_documents", "form_questions", "required_fields", "bot_protection", "mail_provider", "instance_url", "access_method_enabled", "event_not_ended") }),
    );
    const { router } = renderAccess();
    await loaded();
    const checklist = within(card("Setup checklist"));

    const legal = checklist.getByRole("link", { name: "Open the Legal tab." });
    expect(legal.getAttribute("href")).toBe("/admin/events/evt-1/registration?tab=legal");
    expect(checklist.getAllByRole("link", { name: "Open the Fields tab." })).toHaveLength(2);
    expect(checklist.getByRole("link", { name: "Check the date and hours in Event settings." }).getAttribute("href")).toBe("/admin/events/evt-1/settings");
    expect(checklist.getAllByText("Ask a superadmin to set it up.")).toHaveLength(3);
    expect(checklist.getByText("Ask a superadmin to turn it on in Organisation settings, External services, Ways in.")).toBeTruthy();

    fireEvent.click(legal);
    expect(router.state.location.search).toBe("?tab=legal");
    // A tab of the page replaces the entry of the history, as the tab strip does: Back leaves the page, not the tab.
    expect(router.state.historyAction).toBe("REPLACE");
  });

  it("does not send a check that is put right on this tab anywhere", async () => {
    await renderLoaded(settings({ access_methods: [], readiness: checks("access_method") }));

    const row = checklistRows()[0] as HTMLElement;
    expect(row.textContent).toContain("Choose how guests get in: with a link or with a password.");
    expect(within(row).queryByRole("link")).toBeNull();
  });

  it("does not say again that the event is archived, which the page above says, and says it for an event that is not archived as far as the page knows", async () => {
    await renderLoaded(settings({ readiness: checks("event_not_archived") }), { withEvent: archivedEvent });
    expect(checklistRows()).toHaveLength(9);
    expect(screen.queryByText("Event status")).toBeNull();
    expect(within(card("Setup checklist")).getByText("9 of 9 done")).toBeTruthy();

    cleanup();
    await renderLoaded(settings({ readiness: checks("event_not_archived") }));
    expect(screen.getByText("The event is archived, so it cannot take registrations.")).toBeTruthy();
    expect(screen.getByText("Ask a superadmin to restore it.")).toBeTruthy();
  });

  it("reads a check it has no words for as another thing that is missing, so a newer server never leaves a blank row", async () => {
    await renderLoaded(settings({ readiness: [...checks(), { key: "something_new" as never, ok: false }] }));

    expect(checklistRows()[0]?.textContent).toContain("Something else that registration needs is missing.");
  });

  it("asks for the password only when the way in is the password, as the server lists it", async () => {
    await renderLoaded(settings({ access_methods: ["password"], readiness: [{ key: "access_method", ok: true }, { key: "password", ok: false }] }));

    expect(checklistRows()[0]?.textContent).toContain("Set the password that guests will enter.");
  });
});

describe("RegistrationAccessTab: the link for guests", () => {
  const writeText = vi.fn();

  beforeEach(() => {
    writeText.mockReset();
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator, "clipboard");
  });

  it("shows the address of the form, and says it works once registration is on while it is off", async () => {
    await renderLoaded(settings({ mode: null }));

    expect((screen.getByRole("textbox", { name: "Link for guests" }) as HTMLInputElement).value).toBe("https://admitto.example.com/r/demo");
    expect(screen.getByRole("textbox", { name: "Link for guests" }).hasAttribute("readonly")).toBe(true);
    expect(screen.getByText("This link works once registration is on.")).toBeTruthy();
  });

  it("says guests open the form at the link when registration is on", async () => {
    await renderLoaded(settings({ mode: "automatic" }));

    expect(screen.getByText("Guests open the form at this link.")).toBeTruthy();
    expect(screen.queryByText("This link works once registration is on.")).toBeNull();
  });

  it("copies the address and says so", async () => {
    writeText.mockResolvedValue(undefined);
    await renderLoaded();

    fireEvent.click(screen.getByRole("button", { name: "Copy the link for guests" }));

    await waitFor(() => expect(addToast).toHaveBeenCalledWith("Link copied.", "success"));
    expect(writeText).toHaveBeenCalledWith("https://admitto.example.com/r/demo");
  });

  it("says when the address could not be copied", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    await renderLoaded();

    fireEvent.click(screen.getByRole("button", { name: "Copy the link for guests" }));

    await waitFor(() => expect(addToast).toHaveBeenCalledWith("Could not copy the link.", "error"));
  });

  it("gives no link while the instance has no address, and says who sets it", async () => {
    await renderLoaded(settings({ guest_url: null, readiness: checks("instance_url") }));

    expect(screen.queryByRole("textbox", { name: "Link for guests" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy the link for guests" })).toBeNull();
    expect(screen.getByText("There is no link yet, because the address of this instance is not set. Ask a superadmin to set it up.")).toBeTruthy();
  });

  it("can still be copied on an archived event: reading is not editing", async () => {
    writeText.mockResolvedValue(undefined);
    await renderLoaded(settings(), { withEvent: archivedEvent });

    expect(isOff(screen.getByRole("button", { name: "Copy the link for guests" }))).toBe(false);
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

  it("sends the person to the Legal tab when no extra consent is published, and turns the choice off", async () => {
    api.fetchLegalDocuments.mockResolvedValue(legalAnswer(texts()));
    await renderLoaded();

    expect(isOff(screen.getByRole("button", { name: "Extra consents, none selected" }))).toBe(true);
    expect(screen.getByText("No extra consent is published for this event.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Write and publish one on the Legal tab." }).getAttribute("href")).toBe("/admin/events/evt-1/registration?tab=legal");
  });

  it("explains what a consent does, and that the notice and the terms are always on the form", async () => {
    await renderLoaded();

    expect(screen.getByText("Each consent you choose gets its own checkbox on the form. The privacy notice and the terms are always on it.")).toBeTruthy();
  });
});

describe("RegistrationAccessTab: the questions on the form", () => {
  it("lists the questions the form asks, whether each is required, and where to change them", async () => {
    await renderLoaded(
      settings({
        public_fields: [
          { key: "plate", label: "Registration number of your car", type: "text", required: true },
          { key: "diet", label: "Dietary requirements", type: "text", required: false },
        ],
      }),
    );

    const questions = within(card("Your questions on the form"));
    const rows = questions.getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual(["Registration number of your carRequired", "Dietary requirementsOptional"]);
    expect(questions.getByRole("link", { name: "Add or change questions on the Fields tab." }).getAttribute("href")).toBe("/admin/events/evt-1/registration?tab=fields");
  });

  it("says what a guest is asked when none of the organiser's questions is on the form", async () => {
    await renderLoaded(settings({ public_fields: [] }));

    const questions = within(card("Your questions on the form"));
    expect(questions.queryByRole("listitem")).toBeNull();
    expect(questions.getByText("No question of yours is on the form. Guests give their name and email address, and what the switches above add.")).toBeTruthy();
  });
});

describe("RegistrationAccessTab: an archived event", () => {
  beforeEach(async () => {
    await renderLoaded(settings({ mode: "approval", access_methods: ["password"], password_set: true, readiness: [{ key: "access_method", ok: true }, { key: "password", ok: true }] }), {
      withEvent: archivedEvent,
    });
  });

  it("locks every control that would change a setting, and has no Save or Reset", () => {
    for (const name of ["Off", "Automatic", "With approval", "Link", "Password"]) expect(radio(name).hasAttribute("disabled"), name).toBe(true);
    for (const name of ["Waiting list", "Confirm email addresses", "Ask for the company", "Ask for the department", "Guests can bring one person", "Styled form boxes"]) {
      expect(toggle(name).disabled, name).toBe(true);
    }
    expect(screen.getByRole("button", { name: /^Extra consents/ }).hasAttribute("disabled")).toBe(true);
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();
  });

  it("turns the password buttons off with the reason, which is the one reason an archived event gives", () => {
    for (const name of ["Change password", "Remove"]) {
      const button = screen.getByRole("button", { name });
      expect(isOff(button), name).toBe(true);
      expect(getTooltipText(button)).toBe("This event is archived. Editing is disabled.");
    }
  });

  it("does not say again, in the panel, that the event is archived: only the reason of a button that is off says it, to assistive tech", () => {
    const sayings = Array.from(accessPanel().querySelectorAll("*")).filter((node) => node.children.length === 0 && /archived/i.test(node.textContent ?? ""));

    expect(sayings.every((node) => node.classList.contains("sr-only"))).toBe(true);
    expect(sayings).toHaveLength(2);
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
      await router.navigate("/admin/events/evt-2/registration?tab=access");
    });
    // The form that is open has changes in it, so the leaving is asked first.
    fireEvent.click(await screen.findByRole("button", { name: "Discard" }));
    await waitFor(() => expect(api.fetchRegistrationSettings).toHaveBeenLastCalledWith("evt-2", expect.any(AbortSignal)));
    await loaded();

    expect(toggle("Ask for the company").checked).toBe(false);
  });
});
