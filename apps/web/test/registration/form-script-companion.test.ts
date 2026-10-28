import { describe, expect, it, vi } from "vitest";
import { REGISTRATION_FORM_SCRIPT } from "../../src/registration/form-script.js";
import { question, type Dom } from "../helpers/registration-form-fixtures.js";
import {
  PAGE_URL,
  bootPage,
  chooseOption,
  fillFixedFields,
  sendForm,
  sentBody,
  tickBox,
  typeInto,
  until,
  type ScriptPage,
} from "../helpers/registration-script-page.js";

// The part of the form for the guest's companion (D-E5): a row that opens a panel, the companion's name and the event's
// questions about a companion. The real script runs in a browser model, against the markup the server writes.

/** The companion's questions: a required text (f-c0), a choice (f-c1), a Yes/No (f-c2) and a text that waits for the Yes/No (f-c3). */
const COMPANION_QUESTIONS = [
  question({ key: "badge", label: "Badge name", type: "text", required: true }),
  question({ key: "diet", label: "Diet", type: "select", options: ["Vegan", "None"] }),
  question({ key: "car", label: "Needs parking", type: "boolean" }),
  question({ key: "plate", label: "Plate", type: "text", showWhen: { field: "car", value: true }, required: true }),
];

function boot(guestQuestions = [question({ key: "size", label: "Your size", type: "select", options: ["S", "M"] })], companionQuestions = COMPANION_QUESTIONS) {
  return bootPage(guestQuestions, { model: { companion: { max: 1, questions: companionQuestions } } });
}

const panel = (page: ScriptPage): Dom => page.doc.getElementById("f-companion-panel");
const box = (page: ScriptPage, field: string): Dom => page.doc.querySelector(`[data-field="${field}"]`);
const control = (page: ScriptPage, field: string): Dom => box(page, field).querySelector("[data-control]");
const summary = (page: ScriptPage): Dom => page.doc.getElementById("reg-error");
const bring = (page: ScriptPage, on = true) => tickBox(page, "f-companion", on);
const answerServer = (page: ScriptPage, status: number, body: unknown) =>
  page.fetchMock.mockImplementationOnce(async () => ({ status, json: async () => body }));

describe("the panel of the guest's companion", () => {
  it("starts closed, with its fields hidden, disabled and not required", () => {
    const page = boot();
    expect(panel(page).hidden).toBe(true);
    for (const field of ["companion_name", "companion_badge", "companion_diet", "companion_car", "companion_plate"]) {
      expect(box(page, field).hidden, field).toBe(true);
      expect(control(page, field).disabled, field).toBe(true);
      expect(control(page, field).required, field).toBe(false);
    }
    expect(page.doc.getElementById("f-companion").checked).toBe(false);
  });

  it("opens when the row is ticked: the name and the questions are asked, and a question that waits for an answer stays shut", () => {
    const page = boot();
    bring(page);
    expect(panel(page).hidden).toBe(false);
    for (const field of ["companion_name", "companion_badge", "companion_diet", "companion_car"]) {
      expect(box(page, field).hidden, field).toBe(false);
      expect(control(page, field).disabled, field).toBe(false);
    }
    expect(control(page, "companion_name").required).toBe(true);
    expect(control(page, "companion_badge").required).toBe(true);
    expect(control(page, "companion_diet").required).toBe(false);
    expect(box(page, "companion_plate").hidden).toBe(true);
    expect(control(page, "companion_plate").disabled).toBe(true);
  });

  it("closes again when the row is unticked, and puts every field back as it was", () => {
    const page = boot();
    bring(page);
    tickBox(page, "f-c2");
    expect(box(page, "companion_plate").hidden).toBe(false);
    bring(page, false);
    expect(panel(page).hidden).toBe(true);
    for (const field of ["companion_name", "companion_badge", "companion_diet", "companion_car", "companion_plate"]) {
      expect(box(page, field).hidden, field).toBe(true);
      expect(control(page, field).disabled, field).toBe(true);
      expect(control(page, field).required, field).toBe(false);
    }
  });

  it("is open from the start for a browser that restores a ticked row", () => {
    const page = bootPage([], {
      model: { companion: { max: 1, questions: COMPANION_QUESTIONS } },
      before: (doc) => {
        doc.getElementById("f-companion").checked = true;
      },
    });
    expect(panel(page).hidden).toBe(false);
    expect(control(page, "companion_name").disabled).toBe(false);
  });

  it("asks the questions that wait for an answer about the companion by that answer, and not by the guest's answer under the same key (an event has each key once: the page does not rely on it)", () => {
    const page = boot([question({ key: "car", label: "Do you drive?", type: "boolean" })]);
    bring(page);
    tickBox(page, "f-q0");
    expect(box(page, "companion_plate").hidden).toBe(true);
    tickBox(page, "f-c2");
    expect(box(page, "companion_plate").hidden).toBe(false);
    expect(control(page, "companion_plate").required).toBe(true);
    tickBox(page, "f-c2", false);
    expect(box(page, "companion_plate").hidden).toBe(true);
  });
});

describe("sending a form with a companion", () => {
  it("does not look at the companion's fields when none is brought, and sends no companion", async () => {
    const page = boot();
    fillFixedFields(page);
    typeInto(page, "f-q0", "S");
    chooseOption(page, "f-q0", "S");
    sendForm(page);
    await until(() => expect(page.fetchMock).toHaveBeenCalledTimes(1));
    expect(sentBody(page)).not.toHaveProperty("companions");
  });

  it("sends the companion with the answers to the questions about a companion, apart from the guest's own", async () => {
    const page = boot();
    fillFixedFields(page);
    chooseOption(page, "f-q0", "M");
    bring(page);
    typeInto(page, "f-companion_name", "  Piotr Kowalski  ");
    typeInto(page, "f-c0", "Piotr");
    chooseOption(page, "f-c1", "Vegan");
    tickBox(page, "f-c2");
    typeInto(page, "f-c3", "WA 12345");
    sendForm(page);
    await until(() => expect(page.fetchMock).toHaveBeenCalledTimes(1));
    const body = sentBody(page);
    expect(body.companions).toEqual([{ name: "Piotr Kowalski", answers: { badge: "Piotr", diet: "Vegan", car: "true", plate: "WA 12345" } }]);
    expect(body.custom_data).toEqual({ size: "M" });
    expect(body).not.toHaveProperty("companion_name");
  });

  it("sends the name alone when no question is answered, and no answers", async () => {
    const page = boot([], [question({ key: "diet", label: "Diet", type: "select", options: ["Vegan"] })]);
    fillFixedFields(page);
    bring(page);
    typeInto(page, "f-companion_name", "Piotr");
    sendForm(page);
    await until(() => expect(page.fetchMock).toHaveBeenCalledTimes(1));
    expect(sentBody(page).companions).toEqual([{ name: "Piotr" }]);
  });

  it("keeps the answers apart by the panel they are in, even for a key that both would have (an event has each key once)", async () => {
    const page = boot([question({ key: "size", label: "Your size", type: "select", options: ["S", "M"] })], [
      question({ key: "size", label: "Their size", type: "select", options: ["XL", "XXL"] }),
    ]);
    fillFixedFields(page);
    chooseOption(page, "f-q0", "S");
    bring(page);
    typeInto(page, "f-companion_name", "Piotr");
    chooseOption(page, "f-c0", "XXL");
    sendForm(page);
    await until(() => expect(page.fetchMock).toHaveBeenCalledTimes(1));
    const body = sentBody(page);
    expect(body.custom_data).toEqual({ size: "S" });
    expect(body.companions).toEqual([{ name: "Piotr", answers: { size: "XXL" } }]);
  });

  it("sends nothing of a companion that is no longer brought, and finds what was typed when the row is ticked again", async () => {
    const page = boot();
    fillFixedFields(page);
    chooseOption(page, "f-q0", "S");
    bring(page);
    typeInto(page, "f-companion_name", "Piotr");
    typeInto(page, "f-c0", "Piotr");
    bring(page, false);
    sendForm(page);
    await until(() => expect(page.fetchMock).toHaveBeenCalledTimes(1));
    expect(sentBody(page)).not.toHaveProperty("companions");
    bring(page);
    expect(control(page, "companion_name").value).toBe("Piotr");
  });

  it("does not send the answer to a question about the companion that is not asked, whatever its box holds", async () => {
    const page = boot([], COMPANION_QUESTIONS);
    fillFixedFields(page);
    bring(page);
    typeInto(page, "f-companion_name", "Piotr");
    typeInto(page, "f-c0", "Piotr");
    tickBox(page, "f-c2");
    typeInto(page, "f-c3", "WA 12345");
    tickBox(page, "f-c2", false);
    sendForm(page);
    await until(() => expect(page.fetchMock).toHaveBeenCalledTimes(1));
    expect(sentBody(page).companions).toEqual([{ name: "Piotr", answers: { badge: "Piotr" } }]);
  });
});

describe("checking a form with a companion in the browser", () => {
  it("does not send a companion without a name, and puts the sentence under the name, the focus in it and the count in the notice", () => {
    const page = boot([], [question({ key: "diet", label: "Diet", type: "select", options: ["Vegan"] })]);
    fillFixedFields(page);
    bring(page);
    sendForm(page);
    expect(page.fetchMock).not.toHaveBeenCalled();
    expect(box(page, "companion_name").classList.contains("has-error")).toBe(true);
    expect(box(page, "companion_name").querySelector("[data-msg-text]").textContent).toBe("Enter your guest's full name.");
    expect(page.doc.activeElement).toBe(control(page, "companion_name"));
    expect(control(page, "companion_name").getAttribute("aria-invalid")).toBe("true");
    expect(summary(page).hidden).toBe(false);
    expect(page.doc.getElementById("reg-error-text").textContent).toBe("1 field needs your attention. It is marked in red.");
  });

  it("counts a name that is only spaces as missing, and a required question about the companion as one more", () => {
    const page = boot([], COMPANION_QUESTIONS);
    fillFixedFields(page);
    bring(page);
    typeInto(page, "f-companion_name", "   ");
    sendForm(page);
    expect(page.fetchMock).not.toHaveBeenCalled();
    expect(box(page, "companion_badge").querySelector("[data-msg-text]").textContent).toBe("Answer this question.");
    expect(page.doc.getElementById("reg-error-text").textContent).toBe("2 fields need your attention. They are marked in red.");
  });

  it("takes the mark off a field that the guest corrects, and sends once the whole form is right", async () => {
    const page = boot([], COMPANION_QUESTIONS);
    fillFixedFields(page);
    bring(page);
    sendForm(page);
    expect(box(page, "companion_name").classList.contains("has-error")).toBe(true);
    typeInto(page, "f-companion_name", "Piotr");
    expect(box(page, "companion_name").classList.contains("has-error")).toBe(false);
    typeInto(page, "f-c0", "Piotr");
    sendForm(page);
    await until(() => expect(page.fetchMock).toHaveBeenCalledTimes(1));
  });

  it("takes the marks of the companion's fields, and their count, away when the row is unticked", () => {
    const page = boot([], COMPANION_QUESTIONS);
    fillFixedFields(page);
    bring(page);
    sendForm(page);
    expect(summary(page).hidden).toBe(false);
    bring(page, false);
    for (const field of ["companion_name", "companion_badge"]) expect(box(page, field).classList.contains("has-error"), field).toBe(false);
    expect(summary(page).hidden).toBe(true);
  });

  it("leaves the guest's own fields to be checked as before, with the companion's open or shut", () => {
    for (const bringIt of [false, true]) {
      const page = boot();
      bring(page, bringIt);
      sendForm(page);
      expect(box(page, "custom_data.size")).not.toBeNull();
      expect(box(page, "first_name").classList.contains("has-error")).toBe(true);
      expect(page.fetchMock).not.toHaveBeenCalled();
    }
  });
});

describe("what the server says about a companion", () => {
  async function sendWithCompanion(page: ScriptPage) {
    fillFixedFields(page);
    chooseOption(page, "f-q0", "S");
    bring(page);
    typeInto(page, "f-companion_name", "Piotr");
    typeInto(page, "f-c0", "Piotr");
    sendForm(page);
    await until(() => expect(page.fetchMock).toHaveBeenCalledTimes(1));
  }

  it("is shown under the name and the question it is about, with the focus on the first, in the order of the page", async () => {
    const page = boot();
    answerServer(page, 422, { errors: { companion_badge: "Check this answer.", companion_name: "Enter your guest's full name, up to 100 characters and without links." } });
    await sendWithCompanion(page);
    await until(() => expect(box(page, "companion_name").classList.contains("has-error")).toBe(true));
    expect(box(page, "companion_name").querySelector("[data-msg-text]").textContent).toBe("Enter your guest's full name, up to 100 characters and without links.");
    expect(box(page, "companion_badge").querySelector("[data-msg-text]").textContent).toBe("Check this answer.");
    expect(page.doc.activeElement).toBe(control(page, "companion_name"));
    expect(page.doc.getElementById("reg-error-text").textContent).toBe("2 fields need your attention. They are marked in red.");
  });

  it("is shown under the row for the refusal of the number of guests", async () => {
    const page = boot();
    answerServer(page, 422, { errors: { companions: "This event does not take that many guests." } });
    await sendWithCompanion(page);
    await until(() => expect(box(page, "companions").classList.contains("has-error")).toBe(true));
    expect(box(page, "companions").querySelector("[data-msg-text]").textContent).toBe("This event does not take that many guests.");
    expect(page.doc.activeElement).toBe(page.doc.getElementById("f-companion"));
    expect(page.doc.getElementById("f-companion").getAttribute("aria-invalid")).toBe("true");
    // Ticking the row again is the correction: the mark goes.
    bring(page, false);
    expect(box(page, "companions").classList.contains("has-error")).toBe(false);
  });

  it("is not shown for a companion that is no longer brought: the page says what it says for an answer it cannot place", async () => {
    const page = boot();
    answerServer(page, 422, { errors: { companion_name: "Enter your guest's full name, up to 100 characters and without links." } });
    await sendWithCompanion(page);
    await until(() => expect(box(page, "companion_name").classList.contains("has-error")).toBe(true));
    bring(page, false);
    expect(box(page, "companion_name").classList.contains("has-error")).toBe(false);
    // The check is single use: the page asked for a new one after the answer.
    page.win.admittoTurnstileDone("token-2");
    answerServer(page, 422, { errors: { companion_name: "Enter your guest's full name, up to 100 characters and without links." } });
    sendForm(page);
    await until(() => expect(page.fetchMock).toHaveBeenCalledTimes(2));
    await until(() => expect(summary(page).hidden).toBe(false));
    expect(page.doc.getElementById("reg-error-text").textContent).toBe("Something went wrong. Check your details and try again.");
  });

  it("shows nothing of an error that it has no field for, whatever the key", async () => {
    const page = boot();
    answerServer(page, 422, { errors: { companion_unknown: "<b>x</b>", "__proto__": "y", companion_: "z" } });
    await sendWithCompanion(page);
    await until(() => expect(summary(page).hidden).toBe(false));
    expect(page.doc.getElementById("reg-error-text").textContent).toBe("Something went wrong. Check your details and try again.");
    expect(page.doc.querySelectorAll(".has-error").length).toBe(0);
  });
});

describe("what the page keeps of the companion", () => {
  const NAME = "Zygmunt Companionname";

  it("is nothing outside the fields of the form: not the address, a cookie, the storage of the browser, nor the markup", async () => {
    const page = boot();
    fillFixedFields(page);
    chooseOption(page, "f-q0", "S");
    bring(page);
    typeInto(page, "f-companion_name", NAME);
    typeInto(page, "f-c0", "Badge Secret");
    sendForm(page);
    await until(() => expect(page.fetchMock).toHaveBeenCalledTimes(1));
    await until(() => expect(page.doc.getElementById("reg-done").hidden).toBe(false));

    expect(page.win.location.href).toBe(PAGE_URL);
    expect(page.win.location.search).toBe("");
    expect(page.win.location.hash).toBe("");
    expect(page.win.document.cookie).toBe("");
    expect(page.win.localStorage).toHaveLength(0);
    expect(page.win.sessionStorage).toHaveLength(0);
    expect(page.win.history.length).toBe(1);
    const [address, init] = page.fetchMock.mock.calls[0]!;
    expect(String(address)).not.toContain("?");
    expect(JSON.stringify([init!.headers, init!.method, init!.credentials])).not.toContain("Companionname");
    expect(page.doc.documentElement.outerHTML).not.toContain("Companionname");
    const attributes = [...page.doc.querySelectorAll("*")].flatMap((el: Dom) => [...el.attributes].map((attribute: Dom) => attribute.value as string));
    expect(attributes.some((value) => value.includes("Companionname") || value.includes("Badge Secret"))).toBe(false);
  });

  it("is not stored, written to an address or kept by any line of the script: it names no storage, history or address of the page", () => {
    for (const word of ["localStorage", "sessionStorage", "indexedDB", "document.cookie", "history.", "location.hash", "location.search", "location.href", "URLSearchParams"]) {
      expect(REGISTRATION_FORM_SCRIPT.includes(word), word).toBe(false);
    }
  });

  it("is put in the text of the page only as the text the guest types in a box: the notice and the screen after the send hold no name of the companion", async () => {
    const page = boot();
    fillFixedFields(page);
    chooseOption(page, "f-q0", "S");
    bring(page);
    typeInto(page, "f-companion_name", NAME);
    typeInto(page, "f-c0", "Badge Secret");
    sendForm(page);
    await until(() => expect(page.doc.getElementById("reg-done").hidden).toBe(false));
    expect(page.doc.getElementById("reg-done").textContent).not.toContain("Companionname");
    expect(summary(page).textContent).not.toContain("Companionname");
    vi.restoreAllMocks();
  });
});
