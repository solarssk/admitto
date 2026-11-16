// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/api/client.js";
import type { RegistrationSettingsDto } from "../../src/api/types.js";
import { deferred, getTooltipText, isOff } from "../test-utils.js";
import { addToast, api, refreshEvent } from "./accessApiMocks.js";
import { settings } from "./accessData.js";
import { radio, resetApi, saveButton } from "./accessFixtures.js";
import { renderPanel, resetPanelApi } from "./panelFixtures.js";

const goToLogin = vi.fn();

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const { api: mocks } = await import("./accessApiMocks.js");
  return {
    ...(await importOriginal<typeof import("../../src/api/client.js")>()),
    fetchRegistrationSettings: (...args: unknown[]) => mocks.fetchRegistrationSettings(...args),
    saveRegistrationSettings: (...args: unknown[]) => mocks.saveRegistrationSettings(...args),
    setRegistrationPassword: (...args: unknown[]) => mocks.setRegistrationPassword(...args),
    clearRegistrationPassword: (...args: unknown[]) => mocks.clearRegistrationPassword(...args),
    fetchRegistrationSsoProvider: (...args: unknown[]) => mocks.fetchRegistrationSsoProvider(...args),
    saveCustomDomain: (...args: unknown[]) => mocks.saveCustomDomain(...args),
    checkCustomDomain: (...args: unknown[]) => mocks.checkCustomDomain(...args),
  };
});
vi.mock("../../src/connection/ConnectionStateProvider.js");
vi.mock("../../src/auth/login-navigation.js", () => ({ goToLogin: (...args: unknown[]) => goToLogin(...args) }));
vi.mock("@admitto/ui", async (importOriginal) => {
  const { addToast: toast } = await import("./accessApiMocks.js");
  return { ...(await importOriginal<typeof import("@admitto/ui")>()), useToast: () => ({ addToast: toast }) };
});

const PASSWORD = "correct horse battery";
const WITH_PASSWORD_WAY = { access_methods: ["password"], readiness: [{ key: "access_method", ok: true }, { key: "password", ok: false }] } as const;

const withoutPassword = () => settings({ ...WITH_PASSWORD_WAY, password_set: false });
const withPassword = () => settings({ ...WITH_PASSWORD_WAY, password_set: true, readiness: [{ key: "access_method", ok: true }, { key: "password", ok: true }] });

const setDialog = () => screen.findByRole("dialog", { name: /the event password$/ });
const passwordField = (dialog: HTMLElement) => within(dialog).getByLabelText("Password") as HTMLInputElement;
const rowTitle = () => screen.queryByText("Event password", { selector: ".settings-row__text strong" });
const rowText = () => rowTitle()?.closest(".settings-row")?.textContent ?? "";

async function openSetDialog(buttonName = "Set") {
  fireEvent.click(screen.getByRole("button", { name: buttonName }));
  return setDialog();
}

function type(dialog: HTMLElement, value: string) {
  fireEvent.change(passwordField(dialog), { target: { value } });
}

beforeEach(() => {
  resetApi();
  resetPanelApi();
  goToLogin.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("Event settings, Registration: the event password", () => {
  it("is asked for only when the way in is the password, with whether one is set and nothing else about it", async () => {
    await renderPanel(settings({ access_methods: ["link"] }));
    expect(rowTitle()).toBeNull();

    cleanup();
    await renderPanel(withoutPassword());
    expect(rowText()).toContain("No password is set. Guests cannot open the form without one.");
    expect(screen.getByRole("button", { name: "Set" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();

    cleanup();
    await renderPanel(withPassword());
    expect(rowText()).toContain("A password is set. Guests need it to open the form. You cannot read it again, so keep a copy to share with them.");
    expect(screen.getByRole("button", { name: "Change" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Set" })).toBeNull();
  });

  it("appears as soon as the password is chosen as the way in, before it is saved, so that it can be set first", async () => {
    await renderPanel(settings());

    fireEvent.click(radio("Password"));

    expect(rowText()).toContain("No password is set.");
    expect(screen.queryByText(/Choosing another way in later removes the password/)).toBeNull();
  });

  it("has the button that shows the password at the right end of the box, inside it, with the hint under it and a panel wide enough for the hint", async () => {
    await renderPanel(withoutPassword());

    const dialog = await openSetDialog();

    const control = passwordField(dialog).closest(".event-password__control");
    expect(control?.lastElementChild).toBe(within(dialog).getByRole("button", { name: "Show the password" }));
    expect(control?.firstElementChild).toBe(passwordField(dialog));
    expect(dialog.querySelector(".add-attendee-modal__panel--w560")).not.toBeNull();
    expect(within(dialog).getByText("8 to 128 characters. Guests type it exactly as you do, spaces included.").previousElementSibling).toBe(control);
    // Like the other dialogs of the app: no close icon in the corner, Cancel and Save at the foot.
    expect(within(dialog).getAllByRole("button").map((button) => button.textContent || button.getAttribute("aria-label"))).toEqual(["Show the password", "Cancel", "Save"]);
  });

  it("is free of axe violations", async () => {
    await renderPanel(withoutPassword());
    const dialog = await openSetDialog();

    const result = await axe.run(dialog, { rules: { "color-contrast": { enabled: false } } });

    expect(result.violations).toEqual([]);
  });

  it("is set in a dialog that asks for the password and says what the rule is", async () => {
    await renderPanel(withoutPassword());

    const dialog = await openSetDialog();

    expect(within(dialog).getByRole("heading", { name: "Set the event password" })).toBeTruthy();
    expect(within(dialog).getByText("8 to 128 characters. Guests type it exactly as you do, spaces included.")).toBeTruthy();
    expect(within(dialog).getByText(/You cannot read it again after you save it, so keep a copy to share with them\./)).toBeTruthy();
    expect(passwordField(dialog).type).toBe("password");
    expect(document.activeElement).toBe(passwordField(dialog));
  });

  it("is hidden as it is typed, with a button to show it and to hide it again", async () => {
    await renderPanel(withoutPassword());
    const dialog = await openSetDialog();
    type(dialog, PASSWORD);

    fireEvent.click(within(dialog).getByRole("button", { name: "Show the password" }));
    expect(passwordField(dialog).type).toBe("text");
    expect(passwordField(dialog).value).toBe(PASSWORD);

    fireEvent.click(within(dialog).getByRole("button", { name: "Hide the password" }));
    expect(passwordField(dialog).type).toBe("password");
  });

  it("is sent in the body of one request, closes the dialog, says so in a toast, and the row says a password is set", async () => {
    await renderPanel(withoutPassword());
    api.setRegistrationPassword.mockResolvedValue(undefined);
    api.fetchRegistrationSettings.mockResolvedValue(withPassword());
    const dialog = await openSetDialog();
    type(dialog, PASSWORD);

    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(api.setRegistrationPassword).toHaveBeenCalledWith("evt-1", PASSWORD));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(addToast).toHaveBeenCalledWith("Password saved.", "success");
    expect(rowText()).toContain("A password is set.");
    expect(screen.getByRole("button", { name: "Change" })).toBeTruthy();
  });

  it("is never shown again: not on the page, not in a toast, and not in the settings that are read after it", async () => {
    await renderPanel(withoutPassword());
    api.setRegistrationPassword.mockResolvedValue(undefined);
    api.fetchRegistrationSettings.mockResolvedValue(withPassword());
    const dialog = await openSetDialog();
    type(dialog, PASSWORD);
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    expect(document.body.innerHTML).not.toContain(PASSWORD);
    expect(JSON.stringify(addToast.mock.calls)).not.toContain(PASSWORD);
    expect(JSON.stringify(api.fetchRegistrationSettings.mock.calls)).not.toContain(PASSWORD);
    expect(JSON.stringify(api.saveRegistrationSettings.mock.calls)).not.toContain(PASSWORD);
  });

  it("reads the settings again after it, and the row says that a password is set", async () => {
    await renderPanel(withoutPassword());
    api.setRegistrationPassword.mockResolvedValue(undefined);
    api.fetchRegistrationSettings.mockResolvedValue(withPassword());
    const dialog = await openSetDialog();
    type(dialog, PASSWORD);

    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(api.fetchRegistrationSettings).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(rowText()).toContain("A password is set."));
  });

  it("still says that a password is set when the read after it fails", async () => {
    await renderPanel(withoutPassword());
    api.setRegistrationPassword.mockResolvedValue(undefined);
    api.fetchRegistrationSettings.mockRejectedValue(new ApiError(500, "unexpected_failure", "unexpected_failure"));
    const dialog = await openSetDialog();
    type(dialog, PASSWORD);

    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(api.fetchRegistrationSettings).toHaveBeenCalledTimes(2));
    expect(rowText()).toContain("A password is set.");
  });

  it("is changed in the same dialog, with its own title, and replaces the one that is set", async () => {
    await renderPanel(withPassword());
    api.setRegistrationPassword.mockResolvedValue(undefined);
    const dialog = await openSetDialog("Change");

    expect(within(dialog).getByRole("heading", { name: "Change the event password" })).toBeTruthy();
    type(dialog, "another long password");
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(api.setRegistrationPassword).toHaveBeenCalledWith("evt-1", "another long password"));
  });

  it.each([
    ["too short", "1234567"],
    ["too long", "a".repeat(129)],
    ["empty", ""],
  ])("is refused before it is sent when it is %s", async (_label, value) => {
    await renderPanel(withoutPassword());
    const dialog = await openSetDialog();
    type(dialog, value);

    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(within(dialog).getByRole("alert").textContent).toBe("The password needs 8 to 128 characters.");
    expect(api.setRegistrationPassword).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("is sent at either end of its length, and counts a character, not a code unit", async () => {
    await renderPanel(withoutPassword());
    api.setRegistrationPassword.mockResolvedValue(undefined);
    const emoji = String.fromCodePoint(0x1f600);

    for (const value of ["12345678", "a".repeat(128), emoji.repeat(8)]) {
      const dialog = await openSetDialog(screen.queryByRole("button", { name: "Change" }) ? "Change" : "Set");
      type(dialog, value);
      fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
      await waitFor(() => expect(api.setRegistrationPassword).toHaveBeenLastCalledWith("evt-1", value));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    }
  });

  it("is sent once when Enter is pressed again while it is being saved", async () => {
    await renderPanel(withoutPassword());
    const answer = deferred<void>();
    api.setRegistrationPassword.mockReturnValue(answer.promise);
    const dialog = await openSetDialog();
    type(dialog, "a long enough password");
    const form = dialog.querySelector("form") as HTMLFormElement;

    fireEvent.submit(form);
    await waitFor(() => expect(api.setRegistrationPassword).toHaveBeenCalledTimes(1));
    fireEvent.submit(form);

    expect(api.setRegistrationPassword).toHaveBeenCalledTimes(1);
    await act(async () => answer.resolve());
  });

  it("takes the message away when the person types again", async () => {
    await renderPanel(withoutPassword());
    const dialog = await openSetDialog();
    type(dialog, "short");
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(within(dialog).getByRole("alert")).toBeTruthy();

    type(dialog, "short one");

    expect(within(dialog).queryByRole("alert")).toBeNull();
  });

  it("shows the refusal of the server in the dialog, keeps what was typed, and keeps the dialog", async () => {
    await renderPanel(withoutPassword());
    api.setRegistrationPassword.mockRejectedValue(new ApiError(400, "registration_password_length", "registration_password_length"));
    const dialog = await openSetDialog();
    type(dialog, PASSWORD);

    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toBe("The event password needs 8 to 128 characters."));
    expect(passwordField(dialog).value).toBe(PASSWORD);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(addToast).not.toHaveBeenCalled();
  });

  it("says in the words of the app that the event is archived when the server refuses for that, closes the dialog, and reads the event and the settings again", async () => {
    await renderPanel(withoutPassword());
    api.setRegistrationPassword.mockRejectedValue(new ApiError(403, "event_archived", "event_archived"));
    const dialog = await openSetDialog();
    type(dialog, PASSWORD);

    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(addToast).toHaveBeenCalledWith("This event is archived.", "error"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(refreshEvent).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(api.fetchRegistrationSettings).toHaveBeenCalledTimes(2));
  });

  it("hands the browser to the login page when the session ended", async () => {
    await renderPanel(withoutPassword());
    api.setRegistrationPassword.mockRejectedValue(new ApiError(401, "authentication_required"));
    const dialog = await openSetDialog();
    type(dialog, PASSWORD);

    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(goToLogin).toHaveBeenCalledWith(expect.stringMatching(/^\/login\?next=/)));
  });

  it("does not close for a click outside, since what was typed would be lost, and closes for Cancel and for Escape", async () => {
    await renderPanel(withoutPassword());
    let dialog = await openSetDialog();
    type(dialog, PASSWORD);

    fireEvent.click(dialog.querySelector(".at-modal-backdrop") as HTMLElement);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(passwordField(dialog).value).toBe(PASSWORD);

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    dialog = await openSetDialog();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("forgets what was typed when the dialog closes, so the next time it opens empty and hidden", async () => {
    await renderPanel(withoutPassword());
    let dialog = await openSetDialog();
    type(dialog, PASSWORD);
    fireEvent.click(within(dialog).getByRole("button", { name: "Show the password" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(document.body.innerHTML).not.toContain(PASSWORD);

    dialog = await openSetDialog();

    expect(passwordField(dialog).value).toBe("");
    expect(passwordField(dialog).type).toBe("password");
  });

  it("holds the dialog while the request runs: Cancel is off, Escape does nothing, a second click sends nothing, and Save keeps its focus", async () => {
    await renderPanel(withoutPassword());
    const sent = deferred<void>();
    api.setRegistrationPassword.mockReturnValue(sent.promise);
    const dialog = await openSetDialog();
    type(dialog, PASSWORD);
    const button = within(dialog).getByRole("button", { name: "Save" });
    button.focus();

    fireEvent.click(button);

    await waitFor(() => expect(button.getAttribute("aria-busy")).toBe("true"));
    expect(button.hasAttribute("disabled")).toBe(false);
    expect(document.activeElement).toBe(button);
    expect(within(dialog).getByRole("button", { name: "Cancel" }).hasAttribute("disabled")).toBe(true);
    expect(passwordField(dialog).readOnly).toBe(true);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(button);
    expect(api.setRegistrationPassword).toHaveBeenCalledTimes(1);

    api.fetchRegistrationSettings.mockResolvedValue(withPassword());
    await act(async () => sent.resolve());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("is turned off with the save of the page while that runs, and back on after", async () => {
    await renderPanel(settings({ access_methods: ["link"], password_set: true }));
    const answer = deferred<RegistrationSettingsDto>();
    api.saveRegistrationSettings.mockReturnValue(answer.promise);
    fireEvent.click(radio("Password"));
    fireEvent.click(saveButton());
    await waitFor(() => expect(api.saveRegistrationSettings).toHaveBeenCalled());

    expect(isOff(screen.getByRole("button", { name: "Change" }))).toBe(true);
    expect(isOff(screen.getByRole("button", { name: "Remove" }))).toBe(true);

    await act(async () => answer.resolve(withPassword()));
    await waitFor(() => expect(isOff(screen.getByRole("button", { name: "Change" }))).toBe(false));
  });
});

describe("Event settings, Registration: a read that brings what somebody else changed", () => {
  it("does not make it the person's: a method that somebody else chose meanwhile is no edit, and the next save sends nothing", async () => {
    await renderPanel(withoutPassword());
    api.setRegistrationPassword.mockResolvedValue(undefined);
    // The read after the password finds that somebody made the link the way in, meanwhile.
    api.fetchRegistrationSettings.mockResolvedValue({ ...withPassword(), access_methods: ["link"] });
    const dialog = await openSetDialog();
    type(dialog, PASSWORD);
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.fetchRegistrationSettings).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    expect(radio("Password").getAttribute("aria-checked")).toBe("true");
    expect(isOff(saveButton())).toBe(true);
    expect(api.saveRegistrationSettings).not.toHaveBeenCalled();
  });
});

describe("Event settings, Registration: removing the event password", () => {
  const removeDialog = () => screen.findByRole("dialog", { name: "Remove the event password?" });

  async function askToRemove() {
    await renderPanel(withPassword());
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    return removeDialog();
  }

  it("asks first, and says what follows", async () => {
    const dialog = await askToRemove();

    expect(within(dialog).getByText("Guests cannot open the form until you set a new password. You cannot read the old one again.")).toBeTruthy();
    expect(api.clearRegistrationPassword).not.toHaveBeenCalled();
  });

  it("removes it when it is confirmed, says so in a toast, and the row says that none is set", async () => {
    const dialog = await askToRemove();
    api.clearRegistrationPassword.mockResolvedValue(undefined);
    api.fetchRegistrationSettings.mockResolvedValue(withoutPassword());

    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(api.clearRegistrationPassword).toHaveBeenCalledWith("evt-1"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(addToast).toHaveBeenCalledWith("Password removed.", "success");
    expect(rowText()).toContain("No password is set.");
    expect(screen.getByRole("button", { name: "Set" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
    await waitFor(() => expect(api.fetchRegistrationSettings).toHaveBeenCalledTimes(2));
  });

  it("says that the event is archived when the removal is refused for that, closes the dialog, and reads the event and the settings again", async () => {
    const dialog = await askToRemove();
    api.clearRegistrationPassword.mockRejectedValue(new ApiError(403, "event_archived", "event_archived"));

    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(addToast).toHaveBeenCalledWith("This event is archived.", "error"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(refreshEvent).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(api.fetchRegistrationSettings).toHaveBeenCalledTimes(2));
  });

  it("shows what the newest read says when an older one comes last: a password set and then removed is not put back", async () => {
    await renderPanel(withoutPassword());
    const afterSet = deferred<RegistrationSettingsDto>();
    const afterRemoval = deferred<RegistrationSettingsDto>();
    api.fetchRegistrationSettings.mockReturnValueOnce(afterSet.promise).mockReturnValueOnce(afterRemoval.promise);
    api.setRegistrationPassword.mockResolvedValue(undefined);
    api.clearRegistrationPassword.mockResolvedValue(undefined);

    const dialog = await openSetDialog();
    type(dialog, PASSWORD);
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(within(await removeDialog()).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(api.fetchRegistrationSettings).toHaveBeenCalledTimes(3));

    await act(async () => afterRemoval.resolve(withoutPassword()));
    await act(async () => afterSet.resolve(withPassword()));

    expect(rowText()).toContain("No password is set.");
  });

  it("keeps the answer of a save when a read that started before it comes last", async () => {
    await renderPanel(settings({ access_methods: ["link"] }));
    const afterSet = deferred<RegistrationSettingsDto>();
    api.fetchRegistrationSettings.mockReturnValueOnce(afterSet.promise);
    api.setRegistrationPassword.mockResolvedValue(undefined);
    fireEvent.click(radio("Password"));
    const dialog = await openSetDialog();
    type(dialog, PASSWORD);
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(rowText()).toContain("A password is set.");

    api.saveRegistrationSettings.mockResolvedValue(withPassword());
    fireEvent.click(saveButton());
    await waitFor(() => expect(api.saveRegistrationSettings).toHaveBeenCalled());
    await waitFor(() => expect(addToast).toHaveBeenCalledWith("Registration settings saved.", "success"));
    await act(async () => afterSet.resolve({ ...withoutPassword(), access_methods: ["link"] }));

    expect(rowText()).toContain("A password is set.");
  });

  it("removes nothing when it is cancelled", async () => {
    const dialog = await askToRemove();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.clearRegistrationPassword).not.toHaveBeenCalled();
    expect(rowText()).toContain("A password is set.");
  });

  it("shows a failure in the dialog, and keeps it, and the password stays", async () => {
    const dialog = await askToRemove();
    api.clearRegistrationPassword.mockRejectedValue(new ApiError(500, "unexpected_failure", "unexpected_failure"));

    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toBe("Could not remove the password."));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(rowText()).toContain("A password is set.");
    expect(addToast).not.toHaveBeenCalled();
  });

  it("forgets a failure when it is cancelled, so the next time the dialog opens clean", async () => {
    let dialog = await askToRemove();
    api.clearRegistrationPassword.mockRejectedValue(new ApiError(500, "unexpected_failure", "unexpected_failure"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(within(dialog).getByRole("alert")).toBeTruthy());
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    dialog = await removeDialog();

    expect(within(dialog).queryByRole("alert")).toBeNull();
  });

  it("hands the browser to the login page when the session ended", async () => {
    const dialog = await askToRemove();
    api.clearRegistrationPassword.mockRejectedValue(new ApiError(401, "authentication_required"));

    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(goToLogin).toHaveBeenCalledWith(expect.stringMatching(/^\/login\?next=/)));
  });
});

describe("Event settings, Registration: leaving the password as the way in", () => {
  const asked = () => screen.findByRole("dialog", { name: "Remove the event password?" });

  it("asks before the choice changes, while the saved way is the password and a password is set, and says nothing else on the card", async () => {
    await renderPanel(withPassword());
    expect(screen.queryByRole("dialog", { name: "Remove the event password?" })).toBeNull();

    fireEvent.click(radio("Link"));

    const dialog = await asked();
    expect(within(dialog).getByText("If you choose another way and save, the event password is deleted. To use a password again, you must set a new one.")).toBeTruthy();
    expect(radio("Password").getAttribute("aria-checked")).toBe("true");
    expect(isOff(saveButton())).toBe(true);
    expect(screen.queryByText(/Saving removes the event password/)).toBeNull();
    expect(screen.queryByText(/later removes the password/)).toBeNull();
  });

  it("keeps the password chosen when it is cancelled, and changes nothing", async () => {
    await renderPanel(withPassword());
    fireEvent.click(radio("Link"));

    fireEvent.click(within(await asked()).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Remove the event password?" })).toBeNull());
    expect(radio("Password").getAttribute("aria-checked")).toBe("true");
    expect(isOff(saveButton())).toBe(true);
  });

  it("changes the choice in the draft when it is confirmed, and the password goes with the save of the page", async () => {
    await renderPanel(withPassword());
    api.saveRegistrationSettings.mockResolvedValue(settings({ access_methods: ["link"], password_set: false }));
    fireEvent.click(radio("Link"));

    fireEvent.click(within(await asked()).getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(radio("Link").getAttribute("aria-checked")).toBe("true"));
    expect(api.clearRegistrationPassword).not.toHaveBeenCalled();
    expect(api.saveRegistrationSettings).not.toHaveBeenCalled();
    fireEvent.click(saveButton());
    await waitFor(() => expect(api.saveRegistrationSettings).toHaveBeenCalledWith("evt-1", { access_methods: ["link"], expected_sso_provider_id: null }));
    await waitFor(() => expect(rowTitle()).toBeNull());
  });

  it.each([
    ["the password that is chosen is pressed", withPassword, ["Password"], "Password"],
    ["no password is set", withoutPassword, ["Link"], "Link"],
    ["the saved way was not the password", () => settings({ access_methods: ["link"], password_set: true }), ["Password", "Link"], "Link"],
  ])("does not ask when %s", async (_what, make, presses, chosen) => {
    await renderPanel(make());

    for (const name of presses) fireEvent.click(radio(name));

    expect(screen.queryByRole("dialog", { name: "Remove the event password?" })).toBeNull();
    expect(radio(chosen).getAttribute("aria-checked")).toBe("true");
  });
});

describe("Event settings, Registration: an archived event", () => {
  it("locks the access method and turns the password buttons off with the one reason an archived event gives, and has no Save or Reset", async () => {
    await renderPanel(withPassword(), { archived: true });

    for (const name of ["Link", "Password", "Company SSO"]) expect(radio(name).hasAttribute("disabled"), name).toBe(true);
    for (const name of ["Change", "Remove"]) {
      const button = screen.getByRole("button", { name });
      expect(isOff(button), name).toBe(true);
      expect(getTooltipText(button)).toBe("This event is archived. Editing is disabled.");
    }
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();
  });
});
