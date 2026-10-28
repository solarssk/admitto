// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/api/client.js";
import type { RegistrationSettingsDto } from "../../src/api/types.js";
import { deferred, isOff } from "../test-utils.js";
import { addToast, api, refreshEvent } from "./accessApiMocks.js";
import { checks, legalAnswer, settings, texts } from "./accessData.js";
import { radio, renderLoaded, resetApi, saveButton, toggle } from "./accessFixtures.js";

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

/** A refusal of the server, as the client makes it from the answer: the status, the message, the code and, for a 409, the keys. */
function refusal(status: number, code: string, blockers?: string[]) {
  return new ApiError(status, code, code, undefined, undefined, undefined, undefined, blockers);
}

const reasonText = () => screen.getByRole("alert").textContent ?? "";
const savedAs = (overrides: Partial<RegistrationSettingsDto>) => api.saveRegistrationSettings.mockResolvedValue(settings(overrides));
const unsavedNote = () => screen.queryByText("Unsaved changes");

async function save() {
  fireEvent.click(saveButton());
  await waitFor(() => expect(api.saveRegistrationSettings).toHaveBeenCalled());
}

beforeEach(() => {
  resetApi();
  goToLogin.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("RegistrationAccessTab: what a save sends", () => {
  it("has nothing to save, and a Save and a Reset that are off, until something changes", async () => {
    await renderLoaded();

    expect(isOff(saveButton())).toBe(true);
    expect(isOff(screen.getByRole("button", { name: "Reset" }))).toBe(true);
    fireEvent.click(saveButton());
    expect(api.saveRegistrationSettings).not.toHaveBeenCalled();

    fireEvent.click(toggle("Waiting list"));
    expect(unsavedNote()).toBeTruthy();
    expect(isOff(saveButton())).toBe(false);
    expect(isOff(screen.getByRole("button", { name: "Reset" }))).toBe(false);
  });

  it("sends the one setting that was changed and no other", async () => {
    await renderLoaded();
    savedAs({ waitlist_enabled: false });

    fireEvent.click(toggle("Waiting list"));
    await save();

    expect(api.saveRegistrationSettings).toHaveBeenCalledTimes(1);
    expect(api.saveRegistrationSettings).toHaveBeenCalledWith("evt-1", { waitlist_enabled: false });
  });

  it("sends two settings when two were changed, and says nothing of the rest", async () => {
    await renderLoaded();
    savedAs({ ask_company: true, ask_department: true });

    fireEvent.click(toggle("Ask for the company"));
    fireEvent.click(toggle("Ask for the department"));
    await save();

    expect(api.saveRegistrationSettings).toHaveBeenCalledWith("evt-1", { ask_company: true, ask_department: true });
  });

  it("leaves nothing to save when a change is undone", async () => {
    await renderLoaded();

    fireEvent.click(toggle("Confirm email addresses"));
    fireEvent.click(toggle("Confirm email addresses"));

    expect(unsavedNote()).toBeNull();
    expect(isOff(saveButton())).toBe(true);
    fireEvent.click(saveButton());
    expect(api.saveRegistrationSettings).not.toHaveBeenCalled();
  });

  it.each<[string, string, object]>([
    ["the check of the address", "Confirm email addresses", { verify_email: false }],
    ["the company", "Ask for the company", { ask_company: true }],
    ["the department", "Ask for the department", { ask_department: true }],
    ["a person to bring", "Guests can bring one person", { max_companions: 1 }],
  ])("sends %s as its own setting", async (_label, name, patch) => {
    await renderLoaded();
    api.saveRegistrationSettings.mockResolvedValue(settings());

    fireEvent.click(toggle(name));
    await save();

    expect(api.saveRegistrationSettings).toHaveBeenCalledWith("evt-1", patch);
  });

  it("sends a person to bring as none when it is taken away", async () => {
    await renderLoaded(settings({ max_companions: 1 }));
    api.saveRegistrationSettings.mockResolvedValue(settings());

    fireEvent.click(toggle("Guests can bring one person"));
    await save();

    expect(api.saveRegistrationSettings).toHaveBeenCalledWith("evt-1", { max_companions: 0 });
  });

  it("sends the way in as a list of one", async () => {
    await renderLoaded();
    api.saveRegistrationSettings.mockResolvedValue(settings({ access_methods: ["password"] }));

    fireEvent.click(screen.getByRole("radio", { name: "Password" }));
    await save();

    expect(api.saveRegistrationSettings).toHaveBeenCalledWith("evt-1", { access_methods: ["password"] });
  });

  it("sends the consents that were chosen", async () => {
    await renderLoaded();
    api.saveRegistrationSettings.mockResolvedValue(settings({ consent_keys: ["photo"] }));

    fireEvent.click(screen.getByRole("button", { name: "Extra consents, none selected" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Photos and video" }));
    await save();

    expect(api.saveRegistrationSettings).toHaveBeenCalledWith("evt-1", { consent_keys: ["photo"] });
  });

  it("does not send a setting it did not change, even when the server holds a way in the screen does not offer", async () => {
    await renderLoaded(settings({ access_methods: ["sso"], readiness: checks("access_method") }));
    api.saveRegistrationSettings.mockResolvedValue(settings({ access_methods: ["sso"], ask_company: true }));

    fireEvent.click(toggle("Ask for the company"));
    await save();

    expect(api.saveRegistrationSettings).toHaveBeenCalledWith("evt-1", { ask_company: true });
  });

  it("sends only what changed since the last save, and the answer of the server is the form", async () => {
    await renderLoaded();
    savedAs({ ask_company: true });
    fireEvent.click(toggle("Ask for the company"));
    await save();
    await waitFor(() => expect(isOff(saveButton())).toBe(true));
    expect(toggle("Ask for the company").checked).toBe(true);
    expect(unsavedNote()).toBeNull();

    api.saveRegistrationSettings.mockResolvedValue(settings({ ask_company: true, ask_department: true }));
    fireEvent.click(toggle("Ask for the department"));
    await waitFor(() => expect(isOff(saveButton())).toBe(false));
    fireEvent.click(saveButton());
    await waitFor(() => expect(api.saveRegistrationSettings).toHaveBeenCalledTimes(2));

    expect(api.saveRegistrationSettings).toHaveBeenLastCalledWith("evt-1", { ask_department: true });
  });

  it("shows what the server says it saved, which is not always what was sent", async () => {
    await renderLoaded();
    // The server turned a consent away: the form shows what it kept.
    api.saveRegistrationSettings.mockResolvedValue(settings({ ask_company: false, waitlist_enabled: false }));

    fireEvent.click(toggle("Ask for the company"));
    await save();

    await waitFor(() => expect(toggle("Waiting list").checked).toBe(false));
    expect(toggle("Ask for the company").checked).toBe(false);
    expect(isOff(saveButton())).toBe(true);
  });

  it("says that the settings were saved, in a toast", async () => {
    await renderLoaded();
    savedAs({ waitlist_enabled: false });

    fireEvent.click(toggle("Waiting list"));
    await save();

    await waitFor(() => expect(addToast).toHaveBeenCalledWith("Registration settings saved.", "success"));
  });

  it("takes the form back to what is saved, with Reset, and sends nothing", async () => {
    await renderLoaded();

    fireEvent.click(toggle("Waiting list"));
    fireEvent.click(radio("Password"));
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    expect(toggle("Waiting list").checked).toBe(true);
    expect(radio("Link").getAttribute("aria-checked")).toBe("true");
    expect(unsavedNote()).toBeNull();
    expect(api.saveRegistrationSettings).not.toHaveBeenCalled();
  });

  it("works while the save runs: the button is busy and keeps its focus, the controls are off, and a second click sends nothing", async () => {
    await renderLoaded();
    const answer = deferred<RegistrationSettingsDto>();
    api.saveRegistrationSettings.mockReturnValue(answer.promise);
    fireEvent.click(toggle("Waiting list"));
    const button = saveButton();
    button.focus();

    fireEvent.click(button);

    await waitFor(() => expect(button.getAttribute("aria-busy")).toBe("true"));
    expect(button.hasAttribute("disabled")).toBe(false);
    expect(document.activeElement).toBe(button);
    expect(toggle("Waiting list").disabled).toBe(true);
    expect(radio("Automatic").hasAttribute("disabled")).toBe(true);
    expect(isOff(screen.getByRole("button", { name: "Reset" }))).toBe(true);
    fireEvent.click(button);
    expect(api.saveRegistrationSettings).toHaveBeenCalledTimes(1);

    await act(async () => answer.resolve(settings({ waitlist_enabled: false })));
    await waitFor(() => expect(button.getAttribute("aria-busy")).not.toBe("true"));
    expect(toggle("Waiting list").disabled).toBe(false);
  });
});

describe("RegistrationAccessTab: turning registration on", () => {
  it.each([
    ["Automatic", "automatic"],
    ["With approval", "approval"],
  ])("sends %s as the mode and nothing else, and says that registration is on", async (name, mode) => {
    await renderLoaded();
    savedAs({ mode: mode as "automatic" | "approval" });

    fireEvent.click(radio(name));
    await save();

    expect(api.saveRegistrationSettings).toHaveBeenCalledWith("evt-1", { mode });
    await waitFor(() => expect(addToast).toHaveBeenCalledWith("Registration is on.", "success"));
    expect(radio(name).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("Guests open the form at this link.")).toBeTruthy();
  });

  it("does not ask for a confirmation: turning on is not a loss", async () => {
    await renderLoaded();
    savedAs({ mode: "automatic" });

    fireEvent.click(radio("Automatic"));
    await save();

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("says only that the settings were saved when it moves between the two modes that are on", async () => {
    await renderLoaded(settings({ mode: "approval" }));
    savedAs({ mode: "automatic" });

    fireEvent.click(radio("Automatic"));
    await save();

    expect(api.saveRegistrationSettings).toHaveBeenCalledWith("evt-1", { mode: "automatic" });
    await waitFor(() => expect(addToast).toHaveBeenCalledWith("Registration settings saved.", "success"));
  });
});

describe("RegistrationAccessTab: turning registration off", () => {
  async function chooseOff(saved: RegistrationSettingsDto = settings({ mode: "automatic" })) {
    await renderLoaded(saved);
    fireEvent.click(radio("Off"));
    fireEvent.click(saveButton());
    return screen.findByRole("dialog", { name: "Turn off registration?" });
  }

  it("asks first, says what it does, and sends nothing until it is confirmed", async () => {
    const dialog = await chooseOff();

    expect(within(dialog).getByText("Guests can no longer open the form. This is what changes:")).toBeTruthy();
    const consequences = within(dialog).getAllByRole("listitem").map((item) => item.textContent);
    expect(consequences).toEqual([
      "The requests you already have stay. You can still accept, reject and delete them on the Requests tab.",
      "Confirmation links stop working. They work again if you turn registration on before they expire.",
      "Emails that are already queued are still sent.",
    ]);
    expect(api.saveRegistrationSettings).not.toHaveBeenCalled();
  });

  it("sends the mode as none, and only that, when it is confirmed, and says that registration is off", async () => {
    const dialog = await chooseOff();
    api.saveRegistrationSettings.mockResolvedValue(settings({ mode: null }));

    fireEvent.click(within(dialog).getByRole("button", { name: "Turn off registration" }));

    await waitFor(() => expect(api.saveRegistrationSettings).toHaveBeenCalledWith("evt-1", { mode: null }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(addToast).toHaveBeenCalledWith("Registration is off.", "success");
    expect(radio("Off").getAttribute("aria-checked")).toBe("true");
  });

  it("sends nothing when it is cancelled, and keeps the choice of Off on the form to be saved or reset", async () => {
    const dialog = await chooseOff();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.saveRegistrationSettings).not.toHaveBeenCalled();
    expect(radio("Off").getAttribute("aria-checked")).toBe("true");
    expect(unsavedNote()).toBeTruthy();
  });

  it("is never refused for want of anything: it is possible when every check is missing", async () => {
    const dialog = await chooseOff(settings({ mode: "approval", readiness: checks("bot_protection", "legal_documents", "mail_provider", "instance_url") }));
    api.saveRegistrationSettings.mockResolvedValue(settings({ mode: null, readiness: checks("bot_protection") }));

    fireEvent.click(within(dialog).getByRole("button", { name: "Turn off registration" }));

    await waitFor(() => expect(api.saveRegistrationSettings).toHaveBeenCalledWith("evt-1", { mode: null }));
  });

  it("sends the other changes with it, and asks first all the same", async () => {
    await renderLoaded(settings({ mode: "approval" }));
    fireEvent.click(toggle("Ask for the company"));
    fireEvent.click(radio("Off"));
    fireEvent.click(saveButton());
    const dialog = await screen.findByRole("dialog", { name: "Turn off registration?" });
    api.saveRegistrationSettings.mockResolvedValue(settings({ mode: null, ask_company: true }));

    fireEvent.click(within(dialog).getByRole("button", { name: "Turn off registration" }));

    await waitFor(() => expect(api.saveRegistrationSettings).toHaveBeenCalledWith("evt-1", { mode: null, ask_company: true }));
  });

  it("shows a failure in the dialog, not in a toast, and keeps the dialog so that it can be tried again", async () => {
    const dialog = await chooseOff();
    api.saveRegistrationSettings.mockRejectedValue(refusal(500, "unexpected_failure"));

    fireEvent.click(within(dialog).getByRole("button", { name: "Turn off registration" }));

    await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toBe("Could not save the registration settings."));
    expect(screen.getByRole("dialog", { name: "Turn off registration?" })).toBeTruthy();
    expect(addToast).not.toHaveBeenCalled();
    // Only the dialog says it: the form behind it does not say it twice.
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("does not ask when the form was off already and something else changed", async () => {
    await renderLoaded(settings({ mode: null }));
    savedAs({ ask_company: true });

    fireEvent.click(toggle("Ask for the company"));
    await save();

    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("RegistrationAccessTab: a save that the server refuses because registration is not ready", () => {
  const refuse = (...keys: string[]) => api.saveRegistrationSettings.mockRejectedValue(refusal(409, "registration_not_ready", keys));

  it("names what is missing, from the keys and in its own words, with what to do about each, at the buttons, and not in a toast", async () => {
    await renderLoaded();
    refuse("legal_documents", "mail_provider");

    fireEvent.click(radio("Automatic"));
    await save();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("This change needs something that is not set up yet.");
    const items = within(alert).getAllByRole("listitem").map((item) => item.textContent);
    expect(items).toEqual([
      "Publish the privacy notice, the terms and every consent you chose. Open the Legal tab.",
      "Email sending is not set up for this event, so guests would get no email. Ask a superadmin to set it up.",
    ]);
    expect(within(alert).getByRole("link", { name: "Open the Legal tab." }).getAttribute("href")).toBe("/admin/events/evt-1/registration?tab=legal");
    expect(addToast).not.toHaveBeenCalled();
  });

  it("takes the mode that was asked for off the form, since registration stays as it was, and keeps the other changes", async () => {
    await renderLoaded();
    refuse("bot_protection");

    fireEvent.click(toggle("Ask for the company"));
    fireEvent.click(radio("Automatic"));
    await save();
    await screen.findByRole("alert");

    expect(radio("Off").getAttribute("aria-checked")).toBe("true");
    expect(radio("Automatic").getAttribute("aria-checked")).toBe("false");
    expect(toggle("Ask for the company").checked).toBe(true);
    expect(unsavedNote()).toBeTruthy();
  });

  it("reads the settings and the texts again, so the checklist is the truth, and the modes that are on go off the table", async () => {
    await renderLoaded();
    refuse("legal_documents");
    api.fetchRegistrationSettings.mockResolvedValue(settings({ readiness: checks("legal_documents") }));

    fireEvent.click(radio("Automatic"));
    await save();

    await waitFor(() => expect(api.fetchRegistrationSettings).toHaveBeenCalledTimes(2));
    expect(api.fetchLegalDocuments).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(radio("Automatic").hasAttribute("disabled")).toBe(true));
    expect(screen.getByText("Registration can be turned on when the checklist below is done.")).toBeTruthy();
  });

  it("keeps what it showed when the second read fails, and still says what is missing", async () => {
    await renderLoaded();
    refuse("legal_documents");
    api.fetchRegistrationSettings.mockRejectedValue(refusal(500, "unexpected_failure"));

    fireEvent.click(radio("Automatic"));
    await save();

    await waitFor(() => expect(api.fetchRegistrationSettings).toHaveBeenCalledTimes(2));
    expect((await screen.findByRole("alert")).textContent).toContain("This change needs something that is not set up yet.");
    expect(radio("Off").getAttribute("aria-checked")).toBe("true");
  });

  it("is told too for a change of the way in of an event that has registration on, and leaves the mode alone", async () => {
    await renderLoaded(settings({ mode: "approval" }));
    refuse("password");

    fireEvent.click(radio("Password"));
    await save();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Set the password that guests will enter.");
    expect(radio("With approval").getAttribute("aria-checked")).toBe("true");
    expect(radio("Password").getAttribute("aria-checked")).toBe("true");
  });

  it("falls back to a sentence of the app when the answer names no key", async () => {
    await renderLoaded();
    api.saveRegistrationSettings.mockRejectedValue(refusal(409, "registration_not_ready"));

    fireEvent.click(radio("Automatic"));
    await save();

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(reasonText()).toBe("Registration needs something that is not set up yet. Set up what the list marks as missing, then try again.");
  });

  it("can be tried again after what was missing is put right: Save is still on", async () => {
    await renderLoaded();
    refuse("legal_documents");
    fireEvent.click(toggle("Ask for the company"));
    await save();
    await screen.findByRole("alert");

    expect(isOff(saveButton())).toBe(false);
  });
});

describe("RegistrationAccessTab: other refusals", () => {
  it("says that a consent is not published, in the words of the app, at the buttons, and reads the texts again so that it is marked", async () => {
    await renderLoaded(settings({ consent_keys: [] }));
    api.saveRegistrationSettings.mockRejectedValue(refusal(422, "consent_not_published"));
    api.fetchLegalDocuments.mockResolvedValue(legalAnswer(texts(["photo", "Photos and video", false])));

    fireEvent.click(screen.getByRole("button", { name: "Extra consents, none selected" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Photos and video" }));
    await save();

    expect((await screen.findByRole("alert")).textContent).toBe("One of the extra consents you chose is not published for this event. Publish its text first, or leave it out.");
    await waitFor(() => expect(api.fetchLegalDocuments).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("button", { name: "Extra consents, Photos and video (not published)" })).toBeTruthy();
    expect(addToast).not.toHaveBeenCalled();
  });

  it("says that the event is archived, and has the page read the event again so that it locks", async () => {
    await renderLoaded();
    api.saveRegistrationSettings.mockRejectedValue(refusal(403, "event_archived"));

    fireEvent.click(toggle("Waiting list"));
    await save();

    expect((await screen.findByRole("alert")).textContent).toBe("This event is archived.");
    expect(refreshEvent).toHaveBeenCalledTimes(1);
  });

  it("says that it could not save when the server failed, never with the server's own words, and keeps the form to try again", async () => {
    await renderLoaded();
    api.saveRegistrationSettings.mockRejectedValue(new ApiError(500, "SELECT * FROM EventRegistrationSettings failed at db.ts:12", "unexpected_failure"));

    fireEvent.click(toggle("Waiting list"));
    await save();

    expect((await screen.findByRole("alert")).textContent).toBe("Could not save the registration settings.");
    expect(document.body.textContent).not.toContain("SELECT");
    expect(toggle("Waiting list").checked).toBe(false);
    expect(isOff(saveButton())).toBe(false);
    expect(addToast).not.toHaveBeenCalled();
  });

  it("tells someone who may no longer manage the event that they have no access", async () => {
    await renderLoaded();
    api.saveRegistrationSettings.mockRejectedValue(refusal(403, "forbidden"));

    fireEvent.click(toggle("Waiting list"));
    await save();

    expect((await screen.findByRole("alert")).textContent).toBe("You do not have access.");
  });

  it("hands the browser to the login page when the session ended, and says nothing", async () => {
    await renderLoaded();
    api.saveRegistrationSettings.mockRejectedValue(new ApiError(401, "authentication_required"));

    fireEvent.click(toggle("Waiting list"));
    await save();

    await waitFor(() => expect(goToLogin).toHaveBeenCalledWith(expect.stringMatching(/^\/login\?next=/)));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("takes a message away when the person changes something, since it was about the change before", async () => {
    await renderLoaded();
    api.saveRegistrationSettings.mockRejectedValue(refusal(500, "unexpected_failure"));
    fireEvent.click(toggle("Waiting list"));
    await save();
    await screen.findByRole("alert");

    fireEvent.click(toggle("Ask for the company"));

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("takes a message away with Reset", async () => {
    await renderLoaded();
    api.saveRegistrationSettings.mockRejectedValue(refusal(500, "unexpected_failure"));
    fireEvent.click(toggle("Waiting list"));
    await save();
    await screen.findByRole("alert");

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    expect(screen.queryByRole("alert")).toBeNull();
    expect(toggle("Waiting list").checked).toBe(true);
  });

  it("clears the message when a later save works", async () => {
    await renderLoaded();
    api.saveRegistrationSettings.mockRejectedValueOnce(refusal(500, "unexpected_failure"));
    fireEvent.click(toggle("Waiting list"));
    await save();
    await screen.findByRole("alert");

    savedAs({ waitlist_enabled: false });
    fireEvent.click(saveButton());

    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(api.saveRegistrationSettings).toHaveBeenCalledTimes(2);
  });
});

describe("RegistrationAccessTab: leaving with changes", () => {
  const legalTab = () => screen.getByRole("tab", { name: "Legal" });
  const openTab = () => screen.getByRole("tab", { selected: true }).textContent;

  it("does not ask when nothing changed", async () => {
    await renderLoaded();

    fireEvent.click(legalTab());

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(openTab()).toBe("Legal");
  });

  it("asks when a tab is opened with changes in the form, and stays on the form when the person keeps editing", async () => {
    await renderLoaded();
    fireEvent.click(toggle("Waiting list"));

    fireEvent.click(legalTab());

    const dialog = await screen.findByRole("dialog", { name: "Discard unsaved changes?" });
    expect(within(dialog).getByText("You have unsaved changes to the registration settings.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep editing" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(openTab()).toBe("Access");
    expect(toggle("Waiting list").checked).toBe(false);
  });

  it("leaves, and loses the changes, when the person discards them", async () => {
    await renderLoaded();
    fireEvent.click(toggle("Waiting list"));
    fireEvent.click(legalTab());

    fireEvent.click(await screen.findByRole("button", { name: "Discard" }));

    await waitFor(() => expect(openTab()).toBe("Legal"));
  });

  it("asks for a link to another tab too, such as the one of a check that is not met", async () => {
    await renderLoaded(settings({ readiness: checks("legal_documents") }));
    fireEvent.click(toggle("Waiting list"));

    fireEvent.click(screen.getByRole("link", { name: "Open the Legal tab." }));

    expect(await screen.findByRole("dialog", { name: "Discard unsaved changes?" })).toBeTruthy();
    expect(openTab()).toBe("Access");
  });

  it("stays when the person discards while a save is out: the save finishes", async () => {
    await renderLoaded();
    const answer = deferred<RegistrationSettingsDto>();
    api.saveRegistrationSettings.mockReturnValue(answer.promise);
    fireEvent.click(toggle("Waiting list"));
    fireEvent.click(saveButton());
    await waitFor(() => expect(api.saveRegistrationSettings).toHaveBeenCalled());
    fireEvent.click(legalTab());

    fireEvent.click(await screen.findByRole("button", { name: "Discard" }));

    expect(openTab()).toBe("Access");
    await act(async () => answer.resolve(settings({ waitlist_enabled: false })));
    expect(await screen.findByRole("radiogroup", { name: "Registration mode" })).toBeTruthy();
  });

  it("does not ask once the changes are saved", async () => {
    await renderLoaded();
    savedAs({ waitlist_enabled: false });
    fireEvent.click(toggle("Waiting list"));
    await save();
    await waitFor(() => expect(isOff(saveButton())).toBe(true));

    fireEvent.click(legalTab());

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(openTab()).toBe("Legal");
  });

  it("has the browser ask before the page is closed, only while the form holds changes", async () => {
    await renderLoaded();
    const closing = () => {
      const unload = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(unload);
      return unload.defaultPrevented;
    };
    expect(closing()).toBe(false);

    fireEvent.click(toggle("Waiting list"));
    expect(closing()).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(closing()).toBe(false);
  });
});
