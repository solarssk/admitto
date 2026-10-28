// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/api/client.js";
import type { RegistrationSettingsDto } from "../../src/api/types.js";
import { deferred, isOff } from "../test-utils.js";
import { addToast, api } from "./accessApiMocks.js";
import { settings } from "./accessData.js";
import { radio, renderLoaded, resetApi, saveButton } from "./accessFixtures.js";

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

const PASSWORD = "correct horse battery";
const WITH_PASSWORD_WAY = { access_methods: ["password"], readiness: [{ key: "access_method", ok: true }, { key: "password", ok: false }] } as const;

const withoutPassword = () => settings({ ...WITH_PASSWORD_WAY, password_set: false });
const withPassword = () => settings({ ...WITH_PASSWORD_WAY, password_set: true, readiness: [{ key: "access_method", ok: true }, { key: "password", ok: true }] });

const setDialog = () => screen.findByRole("dialog", { name: /the event password$/ });
const passwordField = (dialog: HTMLElement) => within(dialog).getByLabelText("Password") as HTMLInputElement;
const rowTitle = () => screen.queryByText("Event password", { selector: ".settings-row__text strong" });
const rowText = () => rowTitle()?.closest(".settings-row")?.textContent ?? "";

async function openSetDialog(buttonName = "Set password") {
  fireEvent.click(screen.getByRole("button", { name: buttonName }));
  return setDialog();
}

function type(dialog: HTMLElement, value: string) {
  fireEvent.change(passwordField(dialog), { target: { value } });
}

beforeEach(() => {
  resetApi();
  goToLogin.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("RegistrationAccessTab: the event password", () => {
  it("is asked for only when the way in is the password, with whether one is set and nothing else about it", async () => {
    await renderLoaded(settings({ access_methods: ["link"] }));
    expect(rowTitle()).toBeNull();

    cleanup();
    await renderLoaded(withoutPassword());
    expect(rowText()).toContain("No password is set. Guests cannot open the form without one.");
    expect(screen.getByRole("button", { name: "Set password" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();

    cleanup();
    await renderLoaded(withPassword());
    expect(rowText()).toContain("A password is set. Guests need it to open the form. You cannot read it again, so keep a copy to share with them.");
    expect(screen.getByRole("button", { name: "Change password" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Set password" })).toBeNull();
  });

  it("appears as soon as the password is chosen as the way in, before it is saved, so that it can be set first", async () => {
    await renderLoaded();

    fireEvent.click(radio("Password"));

    expect(rowText()).toContain("No password is set.");
    expect(screen.getByText("Choosing another way in later removes the password.")).toBeTruthy();
  });

  it("is set in a dialog that asks for the password and says what the rule is", async () => {
    await renderLoaded(withoutPassword());

    const dialog = await openSetDialog();

    expect(within(dialog).getByRole("heading", { name: "Set the event password" })).toBeTruthy();
    expect(within(dialog).getByText("8 to 128 characters. Guests type it exactly as you do, spaces included.")).toBeTruthy();
    expect(within(dialog).getByText(/You cannot read it again after you save it, so keep a copy to share with them\./)).toBeTruthy();
    expect(passwordField(dialog).type).toBe("password");
    expect(document.activeElement).toBe(passwordField(dialog));
  });

  it("is hidden as it is typed, with a button to show it and to hide it again", async () => {
    await renderLoaded(withoutPassword());
    const dialog = await openSetDialog();
    type(dialog, PASSWORD);

    fireEvent.click(within(dialog).getByRole("button", { name: "Show the password" }));
    expect(passwordField(dialog).type).toBe("text");
    expect(passwordField(dialog).value).toBe(PASSWORD);

    fireEvent.click(within(dialog).getByRole("button", { name: "Hide the password" }));
    expect(passwordField(dialog).type).toBe("password");
  });

  it("is sent in the body of one request, closes the dialog, says so in a toast, and the row says a password is set", async () => {
    await renderLoaded(withoutPassword());
    api.setRegistrationPassword.mockResolvedValue(undefined);
    api.fetchRegistrationSettings.mockResolvedValue(withPassword());
    const dialog = await openSetDialog();
    type(dialog, PASSWORD);

    fireEvent.click(within(dialog).getByRole("button", { name: "Save password" }));

    await waitFor(() => expect(api.setRegistrationPassword).toHaveBeenCalledWith("evt-1", PASSWORD));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(addToast).toHaveBeenCalledWith("Password saved.", "success");
    expect(rowText()).toContain("A password is set.");
    expect(screen.getByRole("button", { name: "Change password" })).toBeTruthy();
  });

  it("is never shown again: not on the page, not in a toast, and not in the settings that are read after it", async () => {
    await renderLoaded(withoutPassword());
    api.setRegistrationPassword.mockResolvedValue(undefined);
    api.fetchRegistrationSettings.mockResolvedValue(withPassword());
    const dialog = await openSetDialog();
    type(dialog, PASSWORD);
    fireEvent.click(within(dialog).getByRole("button", { name: "Save password" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    expect(document.body.innerHTML).not.toContain(PASSWORD);
    expect(JSON.stringify(addToast.mock.calls)).not.toContain(PASSWORD);
    expect(JSON.stringify(api.fetchRegistrationSettings.mock.calls)).not.toContain(PASSWORD);
    expect(JSON.stringify(api.saveRegistrationSettings.mock.calls)).not.toContain(PASSWORD);
  });

  it("reads the settings again after it, so the checklist knows a password is set", async () => {
    await renderLoaded(withoutPassword());
    api.setRegistrationPassword.mockResolvedValue(undefined);
    api.fetchRegistrationSettings.mockResolvedValue(withPassword());
    const dialog = await openSetDialog();
    type(dialog, PASSWORD);

    fireEvent.click(within(dialog).getByRole("button", { name: "Save password" }));

    await waitFor(() => expect(api.fetchRegistrationSettings).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText("A password is set.", { selector: ".overview-check__detail" })).toBeTruthy());
  });

  it("still says that a password is set when the read after it fails", async () => {
    await renderLoaded(withoutPassword());
    api.setRegistrationPassword.mockResolvedValue(undefined);
    api.fetchRegistrationSettings.mockRejectedValue(new ApiError(500, "unexpected_failure", "unexpected_failure"));
    const dialog = await openSetDialog();
    type(dialog, PASSWORD);

    fireEvent.click(within(dialog).getByRole("button", { name: "Save password" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(api.fetchRegistrationSettings).toHaveBeenCalledTimes(2));
    expect(rowText()).toContain("A password is set.");
  });

  it("is changed in the same dialog, with its own title, and replaces the one that is set", async () => {
    await renderLoaded(withPassword());
    api.setRegistrationPassword.mockResolvedValue(undefined);
    const dialog = await openSetDialog("Change password");

    expect(within(dialog).getByRole("heading", { name: "Change the event password" })).toBeTruthy();
    type(dialog, "another long password");
    fireEvent.click(within(dialog).getByRole("button", { name: "Save password" }));

    await waitFor(() => expect(api.setRegistrationPassword).toHaveBeenCalledWith("evt-1", "another long password"));
  });

  it.each([
    ["too short", "1234567"],
    ["too long", "a".repeat(129)],
    ["empty", ""],
  ])("is refused before it is sent when it is %s", async (_label, value) => {
    await renderLoaded(withoutPassword());
    const dialog = await openSetDialog();
    type(dialog, value);

    fireEvent.click(within(dialog).getByRole("button", { name: "Save password" }));

    expect(within(dialog).getByRole("alert").textContent).toBe("The password needs 8 to 128 characters.");
    expect(api.setRegistrationPassword).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("is sent at either end of its length, and counts a character, not a code unit", async () => {
    await renderLoaded(withoutPassword());
    api.setRegistrationPassword.mockResolvedValue(undefined);
    const emoji = String.fromCodePoint(0x1f600);

    for (const value of ["12345678", "a".repeat(128), emoji.repeat(8)]) {
      const dialog = await openSetDialog(screen.queryByRole("button", { name: "Change password" }) ? "Change password" : "Set password");
      type(dialog, value);
      fireEvent.click(within(dialog).getByRole("button", { name: "Save password" }));
      await waitFor(() => expect(api.setRegistrationPassword).toHaveBeenLastCalledWith("evt-1", value));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    }
  });

  it("takes the message away when the person types again", async () => {
    await renderLoaded(withoutPassword());
    const dialog = await openSetDialog();
    type(dialog, "short");
    fireEvent.click(within(dialog).getByRole("button", { name: "Save password" }));
    expect(within(dialog).getByRole("alert")).toBeTruthy();

    type(dialog, "short one");

    expect(within(dialog).queryByRole("alert")).toBeNull();
  });

  it("shows the refusal of the server in the dialog, keeps what was typed, and keeps the dialog", async () => {
    await renderLoaded(withoutPassword());
    api.setRegistrationPassword.mockRejectedValue(new ApiError(400, "registration_password_length", "registration_password_length"));
    const dialog = await openSetDialog();
    type(dialog, PASSWORD);

    fireEvent.click(within(dialog).getByRole("button", { name: "Save password" }));

    await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toBe("The event password needs 8 to 128 characters."));
    expect(passwordField(dialog).value).toBe(PASSWORD);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(addToast).not.toHaveBeenCalled();
  });

  it("says in the words of the app that the event is archived when the server refuses for that", async () => {
    await renderLoaded(withoutPassword());
    api.setRegistrationPassword.mockRejectedValue(new ApiError(403, "event_archived", "event_archived"));
    const dialog = await openSetDialog();
    type(dialog, PASSWORD);

    fireEvent.click(within(dialog).getByRole("button", { name: "Save password" }));

    await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toBe("This event is archived."));
  });

  it("hands the browser to the login page when the session ended", async () => {
    await renderLoaded(withoutPassword());
    api.setRegistrationPassword.mockRejectedValue(new ApiError(401, "authentication_required"));
    const dialog = await openSetDialog();
    type(dialog, PASSWORD);

    fireEvent.click(within(dialog).getByRole("button", { name: "Save password" }));

    await waitFor(() => expect(goToLogin).toHaveBeenCalledWith(expect.stringMatching(/^\/login\?next=/)));
  });

  it("does not close for a click outside, since what was typed would be lost, and closes for Cancel and for Escape", async () => {
    await renderLoaded(withoutPassword());
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
    await renderLoaded(withoutPassword());
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
    await renderLoaded(withoutPassword());
    const sent = deferred<void>();
    api.setRegistrationPassword.mockReturnValue(sent.promise);
    const dialog = await openSetDialog();
    type(dialog, PASSWORD);
    const button = within(dialog).getByRole("button", { name: "Save password" });
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
    await renderLoaded(withPassword());
    const answer = deferred<RegistrationSettingsDto>();
    api.saveRegistrationSettings.mockReturnValue(answer.promise);
    fireEvent.click(screen.getByRole("switch", { name: "Waiting list" }));
    fireEvent.click(saveButton());
    await waitFor(() => expect(api.saveRegistrationSettings).toHaveBeenCalled());

    expect(isOff(screen.getByRole("button", { name: "Change password" }))).toBe(true);
    expect(isOff(screen.getByRole("button", { name: "Remove" }))).toBe(true);

    await act(async () => answer.resolve(withPassword()));
    await waitFor(() => expect(isOff(screen.getByRole("button", { name: "Change password" }))).toBe(false));
  });
});

describe("RegistrationAccessTab: removing the event password", () => {
  const removeDialog = () => screen.findByRole("dialog", { name: "Remove the event password?" });

  async function askToRemove() {
    await renderLoaded(withPassword());
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

    fireEvent.click(within(dialog).getByRole("button", { name: "Remove password" }));

    await waitFor(() => expect(api.clearRegistrationPassword).toHaveBeenCalledWith("evt-1"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(addToast).toHaveBeenCalledWith("Password removed.", "success");
    expect(rowText()).toContain("No password is set.");
    expect(screen.getByRole("button", { name: "Set password" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
    await waitFor(() => expect(api.fetchRegistrationSettings).toHaveBeenCalledTimes(2));
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

    fireEvent.click(within(dialog).getByRole("button", { name: "Remove password" }));

    await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toBe("Could not remove the password."));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(rowText()).toContain("A password is set.");
    expect(addToast).not.toHaveBeenCalled();
  });

  it("forgets a failure when it is cancelled, so the next time the dialog opens clean", async () => {
    let dialog = await askToRemove();
    api.clearRegistrationPassword.mockRejectedValue(new ApiError(500, "unexpected_failure", "unexpected_failure"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove password" }));
    await waitFor(() => expect(within(dialog).getByRole("alert")).toBeTruthy());
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    dialog = await removeDialog();

    expect(within(dialog).queryByRole("alert")).toBeNull();
  });

  it("hands the browser to the login page when the session ended", async () => {
    const dialog = await askToRemove();
    api.clearRegistrationPassword.mockRejectedValue(new ApiError(401, "authentication_required"));

    fireEvent.click(within(dialog).getByRole("button", { name: "Remove password" }));

    await waitFor(() => expect(goToLogin).toHaveBeenCalledWith(expect.stringMatching(/^\/login\?next=/)));
  });
});

describe("RegistrationAccessTab: leaving the password as the way in", () => {
  it("warns that saving removes the password, only while the saved way in is the password and a password is set", async () => {
    await renderLoaded(withPassword());
    const warning = "Saving removes the event password. A new one has to be set if you choose the password again.";
    expect(screen.queryByText(warning)).toBeNull();

    fireEvent.click(radio("Link"));
    expect(screen.getByText(warning)).toBeTruthy();

    fireEvent.click(radio("Password"));
    expect(screen.queryByText(warning)).toBeNull();
  });

  it("does not warn when no password is set, since there is nothing to remove", async () => {
    await renderLoaded(withoutPassword());

    fireEvent.click(radio("Link"));

    expect(screen.queryByText(/Saving removes the event password/)).toBeNull();
  });

  it("does not warn for a way in that was not the password to begin with", async () => {
    await renderLoaded(settings({ access_methods: ["link"], password_set: true }));

    fireEvent.click(radio("Password"));
    fireEvent.click(radio("Link"));

    expect(screen.queryByText(/Saving removes the event password/)).toBeNull();
  });

  it("sends the new way in, and the answer says that no password is set any more, and the warning goes", async () => {
    await renderLoaded(withPassword());
    api.saveRegistrationSettings.mockResolvedValue(settings({ access_methods: ["link"], password_set: false }));

    fireEvent.click(radio("Link"));
    fireEvent.click(saveButton());

    await waitFor(() => expect(api.saveRegistrationSettings).toHaveBeenCalledWith("evt-1", { access_methods: ["link"] }));
    await waitFor(() => expect(screen.queryByText(/Saving removes the event password/)).toBeNull());
    expect(rowTitle()).toBeNull();
  });
});
