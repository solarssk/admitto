import { describe, expect, it, vi } from "vitest";
import { ACCESS_DENIED_ERROR } from "../../src/registration/form-contract.js";
import { REGISTRATION_FORM_SCRIPT } from "../../src/registration/form-script.js";
import { PAGE_URL, bootPage, fillFixedFields, sendForm, sentBody, typeInto, until, type ScriptPage } from "../helpers/registration-script-page.js";
import type { Dom } from "../helpers/registration-form-fixtures.js";

/**
 * The script of the password screen (D-C3): "Continue" looks only that something is typed, the password is kept in the
 * script and sent with the form, the answer `403 access_denied` turns the guest back to the screen with their form
 * intact, and the password goes nowhere else.
 */
const PASSWORD = "test-password";
const SENTENCES = {
  empty: "Enter the event password.",
  wrong: "That password did not work. Check it and try again.",
};

const boot = () => bootPage([], { model: { needsPassword: true } });
const answer = (status: number, body: unknown) => async () => ({ status, json: async () => body });
const denied = answer(403, { error: "access_denied" });

const screen = (page: ScriptPage) => page.doc.getElementById("reg-password");
const box = (page: ScriptPage) => page.doc.getElementById("f-password");
const goOn = (page: ScriptPage) => page.doc.getElementById("reg-password-continue").click();
const errorUnderField = (page: ScriptPage) => page.doc.querySelector("[data-password-field] [data-msg-text]").textContent;
const behind = (page: ScriptPage): Dom[] => [...page.doc.querySelectorAll("[data-after-password]")];
/** The form is in front: the screen is gone and everything that waited behind it is there. */
const formIsShown = (page: ScriptPage) => screen(page).hidden && behind(page).every((part) => !part.hidden);

function enterPassword(page: ScriptPage, password = PASSWORD) {
  typeInto(page, "f-password", password);
  goOn(page);
}

describe("the contract with the route", () => {
  it("reads the answer to a wrong password by the code the contract names, and by no other", () => {
    expect(ACCESS_DENIED_ERROR).toBe("access_denied");
    expect(REGISTRATION_FORM_SCRIPT).toContain(`data.error === "${ACCESS_DENIED_ERROR}"`);
  });

  it("says what the mockup says on the screen, in the words of the mockup", () => {
    expect(REGISTRATION_FORM_SCRIPT).toContain(SENTENCES.wrong);
    expect(REGISTRATION_FORM_SCRIPT).toContain(SENTENCES.empty);
  });
});

describe("the screen at the start", () => {
  it("shows the screen and keeps what is behind it hidden, and turns on both buttons once the script has run", () => {
    const page = boot();

    expect(screen(page).hidden).toBe(false);
    expect(behind(page).every((part) => part.hidden)).toBe(true);
    expect(page.doc.getElementById("reg-password-continue").disabled).toBe(false);
    expect(page.doc.getElementById("reg-submit").disabled).toBe(false);
  });

  it("is not there for an event whose way in is the link, and the page works as it did", () => {
    const page = bootPage([]);

    expect(screen(page)).toBeNull();
    fillFixedFields(page);
    sendForm(page);
    expect(sentBody(page)).not.toHaveProperty("password");
  });
});

describe("Continue", () => {
  it("does not go on while the field is empty: the sentence under the field, the field marked, the focus in it, no request", () => {
    const page = boot();

    goOn(page);

    expect(errorUnderField(page)).toBe(SENTENCES.empty);
    expect(box(page).getAttribute("aria-invalid")).toBe("true");
    expect(box(page).classList.contains("at-input--invalid")).toBe(true);
    expect(page.doc.querySelector("[data-password-field]").classList.contains("has-error")).toBe(true);
    expect(page.doc.activeElement).toBe(box(page));
    expect(screen(page).hidden).toBe(false);
    expect(behind(page).every((part) => part.hidden)).toBe(true);
    expect(page.fetchMock).not.toHaveBeenCalled();
  });

  it("goes on with anything typed, without asking the server: the screen goes, the form comes, the focus is on its first box", () => {
    const page = boot();

    enterPassword(page);

    expect(page.fetchMock).not.toHaveBeenCalled();
    expect(formIsShown(page)).toBe(true);
    expect(page.doc.activeElement).toBe(page.doc.getElementById("f-first_name"));
    expect(errorUnderField(page)).toBe("");
  });

  it("takes a password that is only spaces, and clears the error as soon as the guest types", () => {
    const page = boot();
    goOn(page);
    expect(errorUnderField(page)).toBe(SENTENCES.empty);

    typeInto(page, "f-password", " ");

    expect(errorUnderField(page)).toBe("");
    expect(box(page).hasAttribute("aria-invalid")).toBe(false);
    goOn(page);
    expect(screen(page).hidden).toBe(true);
  });

  it("goes on with Enter in the field, and not with Enter while a composition is being made", () => {
    const page = boot();
    typeInto(page, "f-password", PASSWORD);

    box(page).dispatchEvent(new page.win.KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, cancelable: true }));
    expect(screen(page).hidden).toBe(false);
    box(page).dispatchEvent(new page.win.KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true }));
    expect(screen(page).hidden).toBe(false);

    const enter = new page.win.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    box(page).dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    expect(screen(page).hidden).toBe(true);
  });
});

describe("where the password goes", () => {
  it("is sent in the body of the form, as typed, spaces and all, and in no address and no header", async () => {
    const page = boot();
    const typed = "  two  spaced words  ";
    enterPassword(page, typed);
    fillFixedFields(page);

    sendForm(page);

    await until(() => expect(page.fetchMock).toHaveBeenCalledOnce());
    const [address, init] = page.fetchMock.mock.calls[0]!;
    expect(sentBody(page).password).toBe(typed);
    expect(address).toBe("/r/northwind-summit");
    expect(JSON.stringify([address, init!.headers, init!.method, init!.credentials])).not.toContain("spaced");
  });

  it("is kept nowhere else: not in the address of the page, a cookie, the storage of the browser, the markup of the page", () => {
    const page = boot();

    enterPassword(page);

    expect(page.win.location.href).toBe(PAGE_URL);
    expect(page.win.document.cookie).toBe("");
    expect(page.win.localStorage.length).toBe(0);
    expect(page.win.sessionStorage.length).toBe(0);
    expect(page.doc.documentElement.outerHTML).not.toContain(PASSWORD);
    const attributes = [...page.doc.querySelectorAll("*")].flatMap((el: Dom) => [...el.attributes].map((attribute: Dom) => attribute.value as string));
    expect(attributes.some((value) => value.includes(PASSWORD))).toBe(false);
  });

  it("is sent again with a form that came back with errors, without being asked for again", async () => {
    const page = boot();
    enterPassword(page);
    fillFixedFields(page);
    page.fetchMock.mockImplementationOnce(answer(422, { errors: { email: "Enter a valid email address." } }));

    sendForm(page);
    await until(() => expect(page.doc.querySelector("[data-field='email']").classList.contains("has-error")).toBe(true));
    expect(screen(page).hidden).toBe(true);
    page.win.admittoTurnstileDone("token-2");
    sendForm(page);

    await until(() => expect(page.fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(page.fetchMock.mock.calls[1]![1]!.body as string).password).toBe(PASSWORD);
  });

  it("is sent again after a 429 and after a failure of the network, the guest being on the form still", async () => {
    for (const failure of [answer(429, { error: "too many requests" }), () => Promise.reject(new TypeError("network"))]) {
      const page = boot();
      enterPassword(page);
      fillFixedFields(page);
      page.fetchMock.mockImplementationOnce(failure);

      sendForm(page);
      await until(() => expect(page.doc.getElementById("reg-error").hidden).toBe(false));
      expect(page.doc.getElementById("reg-error-text").textContent).toBe("Try again in a moment.");
      expect(screen(page).hidden).toBe(true);
      page.win.admittoTurnstileDone("token-2");
      sendForm(page);

      await until(() => expect(page.fetchMock).toHaveBeenCalledTimes(2));
      expect(JSON.parse(page.fetchMock.mock.calls[1]![1]!.body as string).password).toBe(PASSWORD);
    }
  });
});

describe("the answer that turns the password away (403 access_denied)", () => {
  async function turnedAway() {
    const page = boot();
    enterPassword(page, "wrong-password");
    fillFixedFields(page);
    page.fetchMock.mockImplementationOnce(denied);
    sendForm(page);
    await until(() => expect(screen(page).hidden).toBe(false));
    return page;
  }

  it("goes back to the screen, with the sentence under the field, the field marked and the focus in it, and the form out of sight", async () => {
    const page = await turnedAway();

    expect(errorUnderField(page)).toBe(SENTENCES.wrong);
    expect(box(page).getAttribute("aria-invalid")).toBe("true");
    expect(page.doc.activeElement).toBe(box(page));
    expect(behind(page).every((part) => part.hidden)).toBe(true);
    // No notice at the top of the form either: the sentence is the one under the field, in the slot that reserved its room.
    expect(page.doc.getElementById("reg-error").hidden).toBe(true);
    expect(page.doc.getElementById("m-f-password").getAttribute("aria-live")).toBe("polite");
  });

  it("keeps what the guest typed, in the form and in the box, and gives the send button back", async () => {
    const page = await turnedAway();

    expect(box(page).value).toBe("wrong-password");
    expect(page.doc.getElementById("f-first_name").value).toBe("Anna");
    expect(page.doc.getElementById("f-email").value).toBe("anna.kowalska@contoso.example");
    expect(page.doc.getElementById("f-terms").checked).toBe(true);
    const submit = page.doc.getElementById("reg-submit");
    expect(submit.disabled).toBe(false);
    expect(submit.hasAttribute("aria-busy")).toBe(false);
  });

  it("asks for the security check again, since its token was spent by the answer, and does not remember the wrong password", async () => {
    const page = await turnedAway();

    expect(page.win.turnstile.reset).toHaveBeenCalledTimes(1);
    // Back on the form with a new password and a new token, the body carries the new one.
    typeInto(page, "f-password", "other-password");
    expect(errorUnderField(page)).toBe("");
    goOn(page);
    expect(formIsShown(page)).toBe(true);
    page.win.admittoTurnstileDone("token-2");
    sendForm(page);

    await until(() => expect(page.fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(page.fetchMock.mock.calls[1]![1]!.body as string).password).toBe("other-password");
  });

  it("never sends the password that was turned away again: the form, sent without a new Continue, carries none", async () => {
    const page = await turnedAway();
    page.win.admittoTurnstileDone("token-2");

    // The form is out of sight, but a send is a send: what it holds is what the guest has typed, and no password.
    page.doc.getElementById("reg-form").dispatchEvent(new page.win.Event("submit", { bubbles: true, cancelable: true }));

    await until(() => expect(page.fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(page.fetchMock.mock.calls[1]![1]!.body as string)).not.toHaveProperty("password");
  });

  it("does not go on from the screen with an empty box, after a wrong password as before it", async () => {
    const page = await turnedAway();
    typeInto(page, "f-password", "");

    goOn(page);

    expect(errorUnderField(page)).toBe(SENTENCES.empty);
    expect(screen(page).hidden).toBe(false);
    expect(page.fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reads like any other failure on a page that has no password screen: the general sentence, and the form stays", async () => {
    const page = bootPage([]);
    fillFixedFields(page);
    page.fetchMock.mockImplementationOnce(denied);

    sendForm(page);

    await until(() => expect(page.doc.getElementById("reg-error").hidden).toBe(false));
    expect(page.doc.getElementById("reg-error-text").textContent).toBe("Something went wrong. Check your details and try again.");
    expect(page.doc.getElementById("reg-form").hidden).toBe(false);
  });

  it("reads a 403 of another kind as a failure on the form, and does not send the guest back to the screen", async () => {
    const page = boot();
    enterPassword(page);
    fillFixedFields(page);
    for (const body of [{ error: "forbidden" }, null, "access_denied"]) {
      page.fetchMock.mockImplementationOnce(answer(403, body));
      page.win.admittoTurnstileDone("token-again");

      sendForm(page);

      await until(() => expect(page.doc.getElementById("reg-error").hidden).toBe(false));
      expect(page.doc.getElementById("reg-error-text").textContent).toBe("Something went wrong. Check your details and try again.");
      expect(screen(page).hidden).toBe(true);
      page.doc.getElementById("reg-error").hidden = true;
    }
  });

  it("is a status of 403 only: the same words with another status are not a wrong password", async () => {
    const page = boot();
    enterPassword(page);
    fillFixedFields(page);
    page.fetchMock.mockImplementationOnce(answer(400, { error: "access_denied" }));

    sendForm(page);

    await until(() => expect(page.doc.getElementById("reg-error").hidden).toBe(false));
    expect(screen(page).hidden).toBe(true);
  });
});

describe("after the form is sent", () => {
  it("shows the form again, not the screen, to a guest who chooses to start again, and keeps the password for them", async () => {
    const page = boot();
    enterPassword(page);
    fillFixedFields(page);
    sendForm(page);
    await until(() => expect(page.doc.getElementById("reg-done").hidden).toBe(false));
    expect(behind(page).filter((part) => part.hasAttribute("data-hide-when-done")).every((part) => part.hidden)).toBe(true);

    page.doc.getElementById("reg-again").click();

    expect(screen(page).hidden).toBe(true);
    expect(page.doc.getElementById("reg-form").hidden).toBe(false);
    page.win.admittoTurnstileDone("token-3");
    vi.mocked(page.fetchMock).mockClear();
    sendForm(page);
    await until(() => expect(page.fetchMock).toHaveBeenCalledOnce());
    expect(sentBody(page).password).toBe(PASSWORD);
  });
});
