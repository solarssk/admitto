// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/api/client.js";
import type { EventDto, LegalDocumentLimitsDto, LegalDocumentWithContentDto } from "../../src/api/types.js";
import { CopyLegalTextsDialog, type CopyLegalTextsDialogProps } from "../../src/registration/CopyLegalTextsDialog.js";
import { isOff } from "../test-utils.js";
import { LEGAL_LIMITS, legalDoc, legalDocWithContent } from "./legalFixtures.js";

const goToLogin = vi.fn();
const fetchAdminEvents = vi.fn();
const fetchLegalDocuments = vi.fn();
const fetchLegalDocument = vi.fn();
const saveLegalDocument = vi.fn();

vi.mock("../../src/auth/login-navigation.js", () => ({ goToLogin: (...args: unknown[]) => goToLogin(...args) }));

vi.mock("../../src/api/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/api/client.js")>()),
  fetchAdminEvents: (...args: unknown[]) => fetchAdminEvents(...args),
  fetchLegalDocuments: (...args: unknown[]) => fetchLegalDocuments(...args),
  fetchLegalDocument: (...args: unknown[]) => fetchLegalDocument(...args),
  saveLegalDocument: (...args: unknown[]) => saveLegalDocument(...args),
}));

const limits: LegalDocumentLimitsDto = { ...LEGAL_LIMITS, consents: 3 };

function event(id: string, title: string): EventDto {
  return { id, title, slug: id, archived_at: null } as EventDto;
}

const doc = legalDoc;
const content = (ref: string): LegalDocumentWithContentDto => legalDocWithContent(ref, { title: `Title of ${ref}`, content_html: `<p>Words of ${ref}</p>` });

const onClose = vi.fn();
const onCopied = vi.fn();
const onPartial = vi.fn();

function renderDialog(props: Partial<CopyLegalTextsDialogProps> = {}) {
  const defaults: CopyLegalTextsDialogProps = { open: true, eventId: "evt-1", current: [], limits, onClose, onCopied, onPartial };
  const view = render(<CopyLegalTextsDialog {...defaults} {...props} />);
  return { ...view, rerenderWith: (next: Partial<CopyLegalTextsDialogProps>) => view.rerender(<CopyLegalTextsDialog {...defaults} {...props} {...next} />) };
}

const dialog = () => screen.getByRole("dialog", { name: "Copy legal texts from another event" });
const copyButton = () => within(dialog()).getByRole("button", { name: "Copy texts" });

async function choose(title: string) {
  fireEvent.click(await screen.findByRole("button", { name: /^Copy from, / }));
  fireEvent.click(await screen.findByRole("button", { name: title }));
}

beforeEach(() => {
  fetchAdminEvents.mockResolvedValue([event("evt-1", "This event"), event("evt-2", "Autumn Gala"), event("evt-3", "Winter Meetup")]);
  fetchLegalDocuments.mockResolvedValue({ items: [doc("privacy-notice"), doc("event-terms"), doc("consent-photo")], missing: [], limits });
  fetchLegalDocument.mockImplementation(async (_event: string, ref: string) => content(ref));
  saveLegalDocument.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CopyLegalTextsDialog: choosing the event", () => {
  it("says what it does, offers the other events and not this one, and cannot copy before one is chosen", async () => {
    renderDialog();

    expect(dialog().textContent).toContain("Its privacy notice, event terms and extra consents are copied into this event.");
    fireEvent.click(await screen.findByRole("button", { name: "Copy from, none selected" }));
    const options = (await screen.findAllByRole("button", { name: /Autumn Gala|Winter Meetup|This event/ })).map((option) => option.getAttribute("aria-label"));
    expect(options).toEqual(["Autumn Gala", "Winter Meetup"]);
    expect(isOff(copyButton())).toBe(true);
    expect(fetchLegalDocuments).not.toHaveBeenCalled();
  });

  it("reads the texts of the event it is given and says what each does here: new, a draft it replaces, a published text it replaces", async () => {
    renderDialog({ current: [doc("privacy-notice", { published: true }), doc("event-terms"), doc("consent-other")] });

    await choose("Autumn Gala");

    const list = await screen.findByRole("list", { name: "What will be copied" });
    expect(within(list).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Privacy noticeReplaces the published text",
      "Event termsReplaces your draft",
      "consent-photoNew",
    ]);
    expect(fetchLegalDocuments).toHaveBeenCalledWith("evt-2", expect.any(AbortSignal));
    expect(dialog().textContent).toContain("A text that is published here stays published, so guests read the copy at once.");
    expect(dialog().textContent).toContain("Which consents the form asks for is not copied.");
    expect(isOff(copyButton())).toBe(false);
  });

  it("says when the other event has no texts, and cannot copy", async () => {
    fetchLegalDocuments.mockResolvedValue({ items: [], missing: [], limits });
    renderDialog();

    await choose("Winter Meetup");

    expect(await screen.findByText("That event has no legal texts to copy.")).toBeTruthy();
    expect(isOff(copyButton())).toBe(true);
  });

  it("says that copying would give the event more consents than it may have, and cannot copy", async () => {
    fetchLegalDocuments.mockResolvedValue({ items: [doc("consent-a"), doc("consent-b"), doc("consent-c")], missing: [], limits });
    renderDialog({ current: [doc("consent-x")] });

    await choose("Autumn Gala");

    expect((await screen.findByRole("alert")).textContent).toBe("This would give the event 4 extra consents. The limit is 3.");
    expect(isOff(copyButton())).toBe(true);
  });

  it("hands the browser to sign-in when the session ended before the texts were read, with no error and no Retry", async () => {
    fetchLegalDocuments.mockRejectedValueOnce(new ApiError(401, "unauthorized", "unauthorized"));
    renderDialog();
    await choose("Autumn Gala");

    await waitFor(() => expect(goToLogin).toHaveBeenCalledTimes(1));
    expect(goToLogin).toHaveBeenCalledWith(expect.stringMatching(/^\/login\?next=/));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: /Retry loading legal texts/ })).toBeNull();
  });

  it("hands the browser to sign-in when the session ended while the copy waited for its confirmation", async () => {
    fetchLegalDocument.mockRejectedValueOnce(new ApiError(401, "unauthorized", "unauthorized"));
    renderDialog();
    await choose("Autumn Gala");
    await screen.findByRole("list", { name: "What will be copied" });

    fireEvent.click(copyButton());

    await waitFor(() => expect(goToLogin).toHaveBeenCalledTimes(1));
    expect(goToLogin).toHaveBeenCalledWith(expect.stringMatching(/^\/login\?next=/));
    expect(onCopied).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("forgets the error of a copy when another event is chosen", async () => {
    saveLegalDocument.mockRejectedValueOnce(new ApiError(422, "legal_document_unsupported", "legal_document_unsupported"));
    renderDialog();
    await choose("Autumn Gala");
    await screen.findByRole("list", { name: "What will be copied" });
    fireEvent.click(copyButton());
    await waitFor(() => expect(within(dialog()).getAllByRole("alert").length).toBeGreaterThan(0));

    await choose("Winter Meetup");

    await waitFor(() => expect(fetchLegalDocuments).toHaveBeenCalledWith("evt-3", expect.anything()));
    await screen.findByRole("list", { name: "What will be copied" });
    expect(within(dialog()).queryByRole("alert")).toBeNull();
  });

  it("says that the texts of an event could not be read, with a Retry that reads them again", async () => {
    fetchLegalDocuments.mockRejectedValueOnce(new ApiError(403, "forbidden", "forbidden"));
    renderDialog();
    await choose("Autumn Gala");

    const hint = await screen.findByRole("alert");
    expect(hint.textContent).toContain("You do not have access.");
    // A read that failed is not an event with no texts.
    expect(screen.queryByText("That event has no legal texts to copy.")).toBeNull();
    expect(screen.queryByRole("list", { name: "What will be copied" })).toBeNull();
    expect(isOff(copyButton())).toBe(true);
    fireEvent.click(within(hint).getByRole("button", { name: /Retry loading legal texts/ }));

    expect(await screen.findByRole("list", { name: "What will be copied" })).toBeTruthy();
    expect(fetchLegalDocuments).toHaveBeenCalledTimes(2);
  });

  it("says that the events could not be read, with a Retry, and the picker is off until they can", async () => {
    fetchAdminEvents.mockRejectedValueOnce(new ApiError(500, "internal_error", "internal_error"));
    renderDialog();

    const hint = await screen.findByRole("alert");
    expect(hint.textContent).toContain("Something went wrong.");
    expect(within(dialog()).getByRole("button", { name: /^Copy from, / }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(within(hint).getByRole("button", { name: /Retry loading events/ }));

    await waitFor(() => expect(within(dialog()).getByRole("button", { name: /^Copy from, / }).hasAttribute("disabled")).toBe(false));
  });

  it("starts again from nothing each time it is opened", async () => {
    const { rerenderWith } = renderDialog();
    await choose("Autumn Gala");
    await screen.findByRole("list", { name: "What will be copied" });

    rerenderWith({ open: false });
    expect(screen.queryByRole("dialog")).toBeNull();
    rerenderWith({ open: true });

    expect(await screen.findByRole("button", { name: "Copy from, none selected" })).toBeTruthy();
    expect(screen.queryByRole("list", { name: "What will be copied" })).toBeNull();
  });

  it("closes without copying when it is cancelled", async () => {
    renderDialog();
    await choose("Autumn Gala");
    await screen.findByRole("list", { name: "What will be copied" });

    fireEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(saveLegalDocument).not.toHaveBeenCalled();
  });
});

describe("CopyLegalTextsDialog: copying", () => {
  it("reads each text of the other event and saves it here, one after another in the order of the other event, then tells how many", async () => {
    renderDialog();
    await choose("Autumn Gala");
    await screen.findByRole("list", { name: "What will be copied" });

    fireEvent.click(copyButton());

    await waitFor(() => expect(onCopied).toHaveBeenCalledWith(3, "Autumn Gala"));
    expect(fetchLegalDocument.mock.calls.map((call) => [call[0], call[1]])).toEqual([
      ["evt-2", "privacy-notice"],
      ["evt-2", "event-terms"],
      ["evt-2", "consent-photo"],
    ]);
    expect(saveLegalDocument.mock.calls).toEqual([
      ["evt-1", "privacy-notice", { title: "Title of privacy-notice", content_html: "<p>Words of privacy-notice</p>" }],
      ["evt-1", "event-terms", { title: "Title of event-terms", content_html: "<p>Words of event-terms</p>" }],
      ["evt-1", "consent-photo", { title: "Title of consent-photo", content_html: "<p>Words of consent-photo</p>" }],
    ]);
    expect(onPartial).not.toHaveBeenCalled();
  });

  it("does not start the next text before the one before it is saved", async () => {
    const order: string[] = [];
    let finishFirstSave!: () => void;
    saveLegalDocument.mockImplementation((_event: string, ref: string) => {
      order.push(`save ${ref}`);
      return ref === "privacy-notice" ? new Promise<void>((resolve) => (finishFirstSave = resolve)) : Promise.resolve();
    });
    fetchLegalDocument.mockImplementation(async (_event: string, ref: string) => {
      order.push(`read ${ref}`);
      return content(ref);
    });
    renderDialog();
    await choose("Autumn Gala");
    await screen.findByRole("list", { name: "What will be copied" });

    fireEvent.click(copyButton());
    await waitFor(() => expect(order).toEqual(["read privacy-notice", "save privacy-notice"]));
    await act(async () => {
      finishFirstSave();
    });

    await waitFor(() => expect(onCopied).toHaveBeenCalled());
    expect(order).toEqual([
      "read privacy-notice",
      "save privacy-notice",
      "read event-terms",
      "save event-terms",
      "read consent-photo",
      "save consent-photo",
    ]);
  });

  it("shows its button busy with its label unchanged, and the picker and Cancel off, while it works", async () => {
    saveLegalDocument.mockReturnValue(new Promise(() => undefined));
    renderDialog();
    await choose("Autumn Gala");
    await screen.findByRole("list", { name: "What will be copied" });

    fireEvent.click(copyButton());

    await waitFor(() => expect(copyButton().getAttribute("aria-busy")).toBe("true"));
    expect(copyButton().textContent).toBe("Copy texts");
    expect(within(dialog()).getByRole("button", { name: "Cancel" }).hasAttribute("disabled")).toBe(true);
    expect(within(dialog()).getByRole("button", { name: /^Copy from, / }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(copyButton());
    expect(fetchLegalDocument).toHaveBeenCalledTimes(1);
  });

  it("stops at the first text that fails, says how far it got, lets the list know, and can be run again", async () => {
    saveLegalDocument.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new ApiError(422, "legal_document_unsupported", "legal_document_unsupported"));
    renderDialog();
    await choose("Autumn Gala");
    await screen.findByRole("list", { name: "What will be copied" });

    fireEvent.click(copyButton());

    const alert = await within(dialog()).findByRole("alert");
    expect(alert.textContent).toBe(
      "Copied 1 of 3 texts, then it stopped. This text has a structure that cannot be saved safely. Simplify its formatting, or paste it as plain text.",
    );
    expect(onPartial).toHaveBeenCalledTimes(1);
    expect(onCopied).not.toHaveBeenCalled();
    expect(saveLegalDocument).toHaveBeenCalledTimes(2);
    expect(fetchLegalDocument).toHaveBeenCalledTimes(2);

    saveLegalDocument.mockResolvedValue(undefined);
    fireEvent.click(copyButton());
    await waitFor(() => expect(onCopied).toHaveBeenCalledWith(3, "Autumn Gala"));
  });

  it("says only why it failed when the first text fails, and does not tell the list anything changed", async () => {
    fetchLegalDocument.mockRejectedValueOnce(new ApiError(403, "forbidden", "forbidden"));
    renderDialog();
    await choose("Autumn Gala");
    await screen.findByRole("list", { name: "What will be copied" });

    fireEvent.click(copyButton());

    expect((await within(dialog()).findByRole("alert")).textContent).toBe("You do not have access.");
    expect(onPartial).not.toHaveBeenCalled();
    expect(saveLegalDocument).not.toHaveBeenCalled();
  });

  it("says only its own words for a failure it has no words for", async () => {
    saveLegalDocument.mockRejectedValueOnce(new ApiError(500, "db_exploded", "db_exploded"));
    renderDialog();
    await choose("Autumn Gala");
    await screen.findByRole("list", { name: "What will be copied" });

    fireEvent.click(copyButton());

    expect((await within(dialog()).findByRole("alert")).textContent).toBe("Could not copy the texts.");
  });
});
