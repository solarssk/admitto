// @vitest-environment jsdom
import type { Editor } from "@tiptap/core";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router";
import { ToastProvider } from "@admitto/ui";
import { ApiError } from "../../src/api/client.js";
import type { EventDto, LegalDocumentLimitsDto, LegalDocumentWithContentDto } from "../../src/api/types.js";
import { LegalTextEditor, type LegalTextEditorProps } from "../../src/registration/LegalTextEditor.js";
import { EVENT_TERMS_TARGET, PRIVACY_NOTICE_TARGET, consentTarget } from "../../src/registration/legalTexts.js";
import { LOAD_TIMEOUT_MESSAGE, SLOW_NOTICE_TEXT } from "../../src/utils/loading-timing.js";
import { advanceTimers, hangUntilAborted, isOff } from "../test-utils.js";
import { stubProseMirrorLayout } from "./proseMirrorJsdom.js";

const goToLogin = vi.fn();
const fetchLegalDocument = vi.fn();
const saveLegalDocument = vi.fn();
const publishLegalDocument = vi.fn();
const unpublishLegalDocument = vi.fn();
const deleteLegalDocument = vi.fn();

vi.mock("../../src/api/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/api/client.js")>()),
  fetchLegalDocument: (...args: unknown[]) => fetchLegalDocument(...args),
  saveLegalDocument: (...args: unknown[]) => saveLegalDocument(...args),
  publishLegalDocument: (...args: unknown[]) => publishLegalDocument(...args),
  unpublishLegalDocument: (...args: unknown[]) => unpublishLegalDocument(...args),
  deleteLegalDocument: (...args: unknown[]) => deleteLegalDocument(...args),
}));

vi.mock("../../src/auth/login-navigation.js", () => ({ goToLogin: (...args: unknown[]) => goToLogin(...args) }));

vi.mock("../../src/connection/ConnectionStateProvider.js");

const addToast = vi.fn();
vi.mock("@admitto/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@admitto/ui")>();
  return { ...actual, useToast: () => ({ addToast }) };
});

const event = { id: "evt-1", title: "Demo", slug: "demo", archived_at: null } as EventDto;
const archivedEvent = { ...event, archived_at: "2026-10-01T10:00:00.000Z" } as EventDto;
const limits: LegalDocumentLimitsDto = { title_chars: 200, content_chars: 100_000, consents: 10 };

function stored(extra: Partial<LegalDocumentWithContentDto> = {}): LegalDocumentWithContentDto {
  return {
    id: "doc-1",
    ref: "privacy-notice",
    kind: "privacy_notice",
    key: null,
    title: "Privacy notice",
    published: false,
    published_at: null,
    updated_at: "2026-10-20T09:00:00.000Z",
    public_path: "/legal/demo/privacy-notice",
    required: true,
    content_html: "<h2>Notice</h2><p>We keep your data.</p>",
    ...extra,
  };
}

const onBack = vi.fn();
const onChanged = vi.fn();
const onDeleted = vi.fn();

function renderEditor(props: Partial<LegalTextEditorProps> = {}) {
  const defaults: LegalTextEditorProps = {
    eventId: "evt-1",
    event,
    target: PRIVACY_NOTICE_TARGET,
    exists: true,
    newConsent: false,
    usedKeys: new Set(),
    limits,
    onBack,
    onChanged,
    onDeleted,
  };
  const router = createMemoryRouter(
    [
      { path: "/admin/events/evt-1/registration", element: <LegalTextEditor {...defaults} {...props} /> },
      { path: "/elsewhere", element: <p>Another page</p> },
    ],
    { initialEntries: ["/admin/events/evt-1/registration?tab=legal"] },
  );
  render(
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>,
  );
  return { router };
}

const textbox = () => screen.findByRole("textbox", { name: "Text" });
const tiptap = async () => ((await textbox()) as HTMLElement & { editor: Editor }).editor;
const button = (name: string) => screen.getByRole("button", { name });
const placeholder = () => screen.queryByRole("status", { name: "Loading legal text" });

/** Types into the editor: a paragraph at the end (the only paragraph, when the editor is empty). */
async function write(text: string) {
  const editor = await tiptap();
  act(() => {
    if (editor.isEmpty) editor.commands.setContent(`<p>${text}</p>`, { emitUpdate: true });
    else editor.commands.insertContentAt(editor.state.doc.content.size, `<p>${text}</p>`);
  });
}

beforeAll(() => {
  stubProseMirrorLayout();
});

beforeEach(() => {
  fetchLegalDocument.mockResolvedValue(stored());
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("LegalTextEditor: a stored text is read first", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetchLegalDocument.mockImplementation(hangUntilAborted as never);
  });

  it("holds its room for 200ms, draws a placeholder with the real title, and says it is taking longer after 8 seconds", async () => {
    renderEditor();
    await advanceTimers(0);

    const held = placeholder() as HTMLElement;
    expect(held.classList.contains("at-loading-hold")).toBe(true);
    expect(within(held).getByText("Privacy notice")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();

    await advanceTimers(200);
    expect(placeholder()?.classList.contains("at-loading-hold")).toBe(false);
    expect(screen.queryByText(SLOW_NOTICE_TEXT)).toBeNull();

    await advanceTimers(8000);
    expect(within(placeholder() as HTMLElement).getByText(SLOW_NOTICE_TEXT)).toBeTruthy();
  });

  it("is an error with a Retry after 30 seconds, never an empty editor", async () => {
    renderEditor();
    await advanceTimers(0);
    await advanceTimers(30_000);
    await advanceTimers(0);

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Could not load this text");
    expect(alert.textContent).toContain(LOAD_TIMEOUT_MESSAGE);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});

describe("LegalTextEditor: a text that cannot be read", () => {
  it("is an error with a Retry that reads it again, and then the editor", async () => {
    fetchLegalDocument.mockRejectedValueOnce(new ApiError(500, "internal_error", "internal_error"));
    renderEditor();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Could not load this text");
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));

    expect(await textbox()).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(fetchLegalDocument).toHaveBeenCalledTimes(2);
    expect(fetchLegalDocument).toHaveBeenLastCalledWith("evt-1", "privacy-notice", expect.any(AbortSignal));
  });
});

describe("LegalTextEditor: a text that is loaded", () => {
  it("shows its title, its words, its state and what saving does", async () => {
    renderEditor();

    expect(await textbox()).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement).value).toBe("Privacy notice");
    expect(screen.getByText("Draft")).toBeTruthy();
    expect(screen.getByText("Draft. Guests cannot read it until you publish it.")).toBeTruthy();
    expect(screen.queryByText("Unsaved changes")).toBeNull();
    expect(isOff(button("Save"))).toBe(true);
    expect(isOff(button("Publish"))).toBe(false);
    expect(screen.queryByRole("link", { name: /public page/i })).toBeNull();
  });

  it("links to the public page of a published text, in a new tab, and says what saving does to it", async () => {
    fetchLegalDocument.mockResolvedValue(stored({ published: true, published_at: "2026-10-20T10:00:00.000Z" }));
    renderEditor();
    await textbox();

    const link = screen.getByRole("link", { name: /View the public page/ });
    expect(link.getAttribute("href")).toBe("/legal/demo/privacy-notice");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getByText("Published")).toBeTruthy();
    expect(screen.getByText("Published. Saving changes what guests read at once.")).toBeTruthy();
    expect(button("Unpublish")).toBeTruthy();
  });

  it("calls the key of a consent, which cannot be changed", async () => {
    const photo = stored({ ref: "consent-photo", kind: "consent", key: "photo", title: "Photos", required: false });
    fetchLegalDocument.mockResolvedValue(photo);
    renderEditor({ target: consentTarget("photo") });
    await textbox();

    expect(screen.getByText("Key: photo")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Checkbox label" })).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Key" })).toBeNull();
    expect(screen.getByText("Extra consent")).toBeTruthy();
  });

  it("is not changed by being loaded, and Back leaves at once", async () => {
    renderEditor();
    await textbox();

    fireEvent.click(button("Back to legal texts"));

    expect(onBack).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("warns about formatting the editor cannot show, shows the text without it, and is still unchanged", async () => {
    fetchLegalDocument.mockResolvedValue(stored({ content_html: "<p>An <em>italic</em> word<br>and a break</p>" }));
    renderEditor();
    await textbox();

    const warning = await screen.findByText(/has formatting the editor cannot show/);
    expect(warning.closest(".at-notice")?.getAttribute("role")).toBe("status");
    expect(screen.queryByText("Unsaved changes")).toBeNull();
    expect(isOff(button("Save"))).toBe(true);
  });

  it("stops warning once the text is saved without that formatting", async () => {
    fetchLegalDocument.mockResolvedValue(stored({ content_html: "<p>An <em>italic</em> word<br>and a break</p>" }));
    saveLegalDocument.mockImplementation(async (_event, _ref, body) => stored({ title: body.title, content_html: body.content_html }));
    renderEditor();
    await textbox();
    await screen.findByText(/has formatting the editor cannot show/);
    await write("More words.");

    fireEvent.click(button("Save"));

    await waitFor(() => expect(addToast).toHaveBeenCalledWith("Text saved.", "success"));
    expect(screen.queryByText(/has formatting the editor cannot show/)).toBeNull();
  });

  it("does not warn about a text it shows exactly as it was stored", async () => {
    renderEditor();
    await textbox();

    await waitFor(() => expect(screen.queryByText(/has formatting the editor cannot show/)).toBeNull());
  });
});

describe("LegalTextEditor: saving", () => {
  it("turns Save on and says there are unsaved changes once the title or the words change", async () => {
    renderEditor();
    await textbox();

    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), { target: { value: "How we use your data" } });
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    expect(isOff(button("Save"))).toBe(false);
    // What is saved is what is published, so Publish waits for a saved text.
    expect(isOff(button("Publish"))).toBe(true);

    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), { target: { value: "Privacy notice" } });
    expect(screen.queryByText("Unsaved changes")).toBeNull();

    await write("One more paragraph.");
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
  });

  it("sends the title and the HTML the editor writes, and is saved when the answer is the same", async () => {
    saveLegalDocument.mockImplementation(async (_event, _ref, body) => stored({ title: body.title, content_html: body.content_html }));
    renderEditor();
    await textbox();
    await write("One more paragraph.");

    fireEvent.click(button("Save"));

    await waitFor(() => expect(addToast).toHaveBeenCalledWith("Text saved.", "success"));
    expect(saveLegalDocument).toHaveBeenCalledWith("evt-1", "privacy-notice", {
      title: "Privacy notice",
      content_html: "<h2>Notice</h2><p>We keep your data.</p><p>One more paragraph.</p>",
    });
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Unsaved changes")).toBeNull();
    expect(isOff(button("Save"))).toBe(true);
    // Nothing differed, so nothing is said about it, and the text the person is writing in was not replaced.
    expect(screen.queryByText(/could not be kept/)).toBeNull();
  });

  it("says what was changed when the server kept something other than what was sent, and shows what it kept", async () => {
    saveLegalDocument.mockResolvedValue(stored({ content_html: "<p>What the server kept.</p>" }));
    renderEditor();
    await textbox();
    await write("Words that were cleaned away.");

    fireEvent.click(button("Save"));

    const notice = await screen.findByText("Some formatting could not be kept when the text was saved. The editor now shows the text as it was saved.");
    expect(notice.closest(".at-notice")?.getAttribute("role")).toBe("alert");
    const box = await textbox();
    expect(within(box).getByText("What the server kept.")).toBeTruthy();
    expect(within(box).queryByText("Words that were cleaned away.")).toBeNull();
    expect(screen.queryByText("Unsaved changes")).toBeNull();
    expect(isOff(button("Save"))).toBe(true);
  });

  it("takes the notice away at the next save, and shows the title as the server cleaned it", async () => {
    saveLegalDocument.mockResolvedValueOnce(stored({ content_html: "<p>Kept.</p>" }));
    renderEditor();
    await textbox();
    await write("First.");
    fireEvent.click(button("Save"));
    await screen.findByText(/could not be kept/);

    saveLegalDocument.mockImplementationOnce(async (_e, _r, body) => stored({ title: "Cleaned title", content_html: body.content_html }));
    await write("Second.");
    fireEvent.click(button("Save"));

    await waitFor(() => expect(screen.queryByText(/could not be kept/)).toBeNull());
    await waitFor(() => expect((screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement).value).toBe("Cleaned title"));
  });

  it("shows the Save button busy with its label unchanged, and takes no typing, while it runs", async () => {
    let finish!: (doc: LegalDocumentWithContentDto) => void;
    saveLegalDocument.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderEditor();
    await textbox();
    await write("Words.");

    fireEvent.click(button("Save"));

    await waitFor(() => expect(button("Save").getAttribute("aria-busy")).toBe("true"));
    expect(button("Save").textContent).toBe("Save");
    expect((screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement).readOnly).toBe(true);
    expect((await textbox()).getAttribute("contenteditable")).toBe("false");
    fireEvent.click(button("Save"));
    expect(saveLegalDocument).toHaveBeenCalledTimes(1);

    await act(async () => {
      finish(stored({ content_html: "<h2>Notice</h2><p>We keep your data.</p><p>Words.</p>" }));
    });
    await waitFor(() => expect(button("Save").getAttribute("aria-busy")).toBeNull());
    expect((await textbox()).getAttribute("contenteditable")).toBe("true");
  });

  it("says why it failed, in the words of the app, and leaves the text as it is", async () => {
    saveLegalDocument.mockRejectedValue(new ApiError(422, "legal_document_empty", "legal_document_empty"));
    renderEditor();
    await textbox();
    await write("Words.");

    fireEvent.click(button("Save"));

    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith("There is no text left to save once unsupported formatting is removed. Write some text before saving.", "error"),
    );
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("does not show a machine code that the app has no words for, only its own message", async () => {
    saveLegalDocument.mockRejectedValue(new ApiError(500, "db_exploded", "db_exploded"));
    renderEditor();
    await textbox();
    await write("Words.");

    fireEvent.click(button("Save"));

    await waitFor(() => expect(addToast).toHaveBeenCalledWith("Could not save this text.", "error"));
  });

  it("sends the browser to sign-in when saving meets a session that ended, with no error toast", async () => {
    saveLegalDocument.mockRejectedValue(new ApiError(401, "unauthorized", "unauthorized"));
    renderEditor();
    await textbox();
    await write("Words.");

    fireEvent.click(button("Save"));

    await waitFor(() => expect(goToLogin).toHaveBeenCalledTimes(1));
    expect(goToLogin).toHaveBeenCalledWith(expect.stringMatching(/^\/login\?next=/));
    expect(addToast).not.toHaveBeenCalledWith("Could not save this text.", "error");
    expect(isOff(button("Save"))).toBe(false);
  });

  it("will not save a title that is only spaces", async () => {
    renderEditor();
    await textbox();

    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), { target: { value: "   " } });

    expect(isOff(button("Save"))).toBe(true);
  });

  it("will not save a text that is too long, and says by how much it is allowed", async () => {
    renderEditor({ limits: { ...limits, content_chars: 60 } });
    await textbox();

    await write("x".repeat(80));

    expect(screen.getByRole("alert").textContent).toBe("This text is too long to save: the limit is 60 characters, formatting included.");
    expect(isOff(button("Save"))).toBe(true);
  });
});

describe("LegalTextEditor: a text that has not been written", () => {
  it("starts with the name of its kind and no words, says it is not saved, and does not read anything", async () => {
    renderEditor({ target: EVENT_TERMS_TARGET, exists: false });

    await textbox();
    expect(fetchLegalDocument).not.toHaveBeenCalled();
    expect((screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement).value).toBe("Event terms");
    expect(screen.getByText("Not saved")).toBeTruthy();
    expect(screen.getByText("Not saved yet. Save it first, then publish it for guests to read.")).toBeTruthy();
    expect(screen.getByText("Write some text before saving.")).toBeTruthy();
    expect(isOff(button("Save"))).toBe(true);
    expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });

  it("is saved with its ref, and then has a state, a public page to publish and a way to delete it", async () => {
    saveLegalDocument.mockImplementation(async (_e, ref, body) =>
      stored({ ref, kind: "event_terms", title: body.title, content_html: body.content_html, public_path: "/legal/demo/event-terms" }),
    );
    renderEditor({ target: EVENT_TERMS_TARGET, exists: false });
    await textbox();
    await write("Bring your ticket.");
    expect(screen.queryByText("Write some text before saving.")).toBeNull();

    fireEvent.click(button("Save"));

    await waitFor(() => expect(screen.getByText("Draft")).toBeTruthy());
    expect(saveLegalDocument).toHaveBeenCalledWith("evt-1", "event-terms", { title: "Event terms", content_html: "<p>Bring your ticket.</p>" });
    expect(button("Publish")).toBeTruthy();
    expect(button("Delete")).toBeTruthy();
  });
});

describe("LegalTextEditor: a new extra consent", () => {
  const props = { target: { ref: "", kind: "consent" as const, key: null }, exists: false, newConsent: true, usedKeys: new Set(["photo"]) };

  it("asks for a key and a checkbox label, which start empty", async () => {
    renderEditor(props);

    await textbox();
    expect((screen.getByRole("textbox", { name: "Key" }) as HTMLInputElement).value).toBe("");
    expect((screen.getByRole("textbox", { name: "Checkbox label" }) as HTMLInputElement).value).toBe("");
    expect(screen.getByText(/cannot be changed later/)).toBeTruthy();
    expect(isOff(button("Save"))).toBe(true);
  });

  it.each([
    ["Photo Consent", /Use lowercase letters, digits, hyphens and underscores, up to 40 characters/],
    ["-photo", /Use lowercase letters/],
    ["photo", /already has a consent with this key/],
  ])("refuses the key %j with a message", async (key, message) => {
    renderEditor(props);
    await textbox();
    fireEvent.change(screen.getByRole("textbox", { name: "Checkbox label" }), { target: { value: "Photos" } });
    await write("I agree.");

    fireEvent.change(screen.getByRole("textbox", { name: "Key" }), { target: { value: key } });

    expect(screen.getByText(message)).toBeTruthy();
    expect(isOff(button("Save"))).toBe(true);
  });

  it("is saved under the ref of its key, with its label as the title", async () => {
    saveLegalDocument.mockImplementation(async (_e, ref, body) =>
      stored({ ref, kind: "consent", key: "video", title: body.title, content_html: body.content_html, required: false }),
    );
    renderEditor(props);
    await textbox();
    fireEvent.change(screen.getByRole("textbox", { name: "Key" }), { target: { value: "video" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Checkbox label" }), { target: { value: "  Video  " } });
    await write("I agree to be filmed.");

    fireEvent.click(button("Save"));

    await waitFor(() => expect(saveLegalDocument).toHaveBeenCalledWith("evt-1", "consent-video", { title: "Video", content_html: "<p>I agree to be filmed.</p>" }));
    // Once written it is a consent with a key that cannot be changed, and the key shown is the one that was saved.
    await waitFor(() => expect(screen.getByText("Draft")).toBeTruthy());
    expect(screen.queryByRole("textbox", { name: "Key" })).toBeNull();
    expect(screen.getByText("Key: video")).toBeTruthy();
  });
});

describe("LegalTextEditor: publishing", () => {
  it("publishes a saved text and offers to unpublish it", async () => {
    publishLegalDocument.mockResolvedValue({ ...stored(), content_html: undefined, published: true, published_at: "2026-10-21T10:00:00.000Z" });
    renderEditor();
    await textbox();

    fireEvent.click(button("Publish"));

    await waitFor(() => expect(screen.getByText("Published")).toBeTruthy());
    expect(publishLegalDocument).toHaveBeenCalledWith("evt-1", "privacy-notice");
    expect(addToast).toHaveBeenCalledWith("Text published.", "success");
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(button("Unpublish")).toBeTruthy();
    expect(screen.getByRole("link", { name: /View the public page/ })).toBeTruthy();
    // What was written is still there after the answer that carries no HTML.
    expect(within(await textbox()).getByText("We keep your data.")).toBeTruthy();
  });

  it("unpublishes a published text", async () => {
    fetchLegalDocument.mockResolvedValue(stored({ published: true, published_at: "2026-10-20T10:00:00.000Z" }));
    unpublishLegalDocument.mockResolvedValue({ ...stored(), published: false, published_at: null });
    renderEditor();
    await textbox();

    fireEvent.click(button("Unpublish"));

    await waitFor(() => expect(screen.getByText("Draft")).toBeTruthy());
    expect(unpublishLegalDocument).toHaveBeenCalledWith("evt-1", "privacy-notice");
    expect(addToast).toHaveBeenCalledWith("Text unpublished. Guests can no longer read it.", "success");
    expect(button("Publish")).toBeTruthy();
  });

  it("says that registration needs a text it cannot unpublish, and leaves it published", async () => {
    fetchLegalDocument.mockResolvedValue(stored({ published: true, published_at: "2026-10-20T10:00:00.000Z" }));
    unpublishLegalDocument.mockRejectedValue(new ApiError(409, "legal_document_in_use", "legal_document_in_use"));
    renderEditor();
    await textbox();

    fireEvent.click(button("Unpublish"));

    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith(
        "Registration is on for this event and needs this text. Turn registration off first, then withdraw or delete it.",
        "error",
      ),
    );
    expect(screen.getByText("Published")).toBeTruthy();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("shows its button busy with its label unchanged while it runs", async () => {
    let finish!: (doc: unknown) => void;
    publishLegalDocument.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderEditor();
    await textbox();

    fireEvent.click(button("Publish"));

    await waitFor(() => expect(button("Publish").getAttribute("aria-busy")).toBe("true"));
    expect(button("Publish").textContent).toBe("Publish");
    expect(isOff(button("Save"))).toBe(true);
    await act(async () => {
      finish({ ...stored(), published: true, published_at: "2026-10-21T10:00:00.000Z" });
    });
  });
});

describe("LegalTextEditor: deleting", () => {
  it("asks first, names the text, and says there is no earlier version", async () => {
    renderEditor();
    await textbox();

    fireEvent.click(button("Delete"));

    const dialog = screen.getByRole("dialog", { name: 'Delete "Privacy notice"?' });
    expect(within(dialog).getByText(/removed for good/)).toBeTruthy();
    expect(deleteLegalDocument).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("deletes the text and goes back to the list", async () => {
    deleteLegalDocument.mockResolvedValue(undefined);
    renderEditor();
    await textbox();
    fireEvent.click(button("Delete"));

    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    expect(deleteLegalDocument).toHaveBeenCalledWith("evt-1", "privacy-notice");
    expect(addToast).toHaveBeenCalledWith("Text deleted.", "success");
  });

  it("says inside the dialog that registration needs the text, and keeps it", async () => {
    deleteLegalDocument.mockRejectedValue(new ApiError(409, "legal_document_in_use", "legal_document_in_use"));
    renderEditor();
    await textbox();
    fireEvent.click(button("Delete"));

    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));

    const dialog = screen.getByRole("dialog");
    await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toContain("Registration is on for this event and needs this text"));
    expect(onDeleted).not.toHaveBeenCalled();
  });
});

describe("LegalTextEditor: a session that ended", () => {
  it("sends the browser to sign-in from publishing and from deleting, with no error shown", async () => {
    publishLegalDocument.mockRejectedValue(new ApiError(401, "unauthorized", "unauthorized"));
    deleteLegalDocument.mockRejectedValue(new ApiError(401, "unauthorized", "unauthorized"));
    renderEditor();
    await textbox();

    fireEvent.click(button("Publish"));
    await waitFor(() => expect(goToLogin).toHaveBeenCalledTimes(1));
    expect(addToast).not.toHaveBeenCalledWith("Could not publish this text.", "error");

    fireEvent.click(button("Delete"));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(goToLogin).toHaveBeenCalledTimes(2));
    expect(within(screen.getByRole("dialog")).queryByRole("alert")).toBeNull();
  });
});

describe("LegalTextEditor: leaving with unsaved changes", () => {
  it("asks before Back, and keeps the text when the person keeps editing", async () => {
    renderEditor();
    await textbox();
    await write("Words.");

    fireEvent.click(button("Back to legal texts"));

    expect(screen.getByRole("dialog", { name: "Discard unsaved changes?" })).toBeTruthy();
    expect(onBack).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
  });

  it("goes back when the person discards", async () => {
    renderEditor();
    await textbox();
    await write("Words.");
    fireEvent.click(button("Back to legal texts"));

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));

    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("asks before the page is left by the address (another tab, the menu), and goes on when the person discards", async () => {
    const { router } = renderEditor();
    await textbox();
    await write("Words.");

    await act(async () => {
      await router.navigate("/elsewhere");
    });
    expect(screen.getByRole("dialog", { name: "Discard unsaved changes?" })).toBeTruthy();
    expect(router.state.location.pathname).toBe("/admin/events/evt-1/registration");

    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(router.state.location.pathname).toBe("/admin/events/evt-1/registration");

    await act(async () => {
      await router.navigate("/elsewhere");
    });
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/elsewhere"));
  });

  it("asks before another tab of the page is opened, which changes only the query of the address", async () => {
    const { router } = renderEditor();
    await textbox();
    await write("Words.");

    await act(async () => {
      await router.navigate("/admin/events/evt-1/registration?tab=access");
    });

    expect(screen.getByRole("dialog", { name: "Discard unsaved changes?" })).toBeTruthy();
    expect(router.state.location.search).toBe("?tab=legal");
  });

  it("lets the address change when nothing is unsaved", async () => {
    const { router } = renderEditor();
    await textbox();

    await act(async () => {
      await router.navigate("/elsewhere");
    });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(router.state.location.pathname).toBe("/elsewhere");
  });

  it("asks the browser to confirm closing the tab while something is unsaved, and not otherwise", async () => {
    renderEditor();
    await textbox();
    const closing = () => {
      const closingEvent = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(closingEvent);
      return closingEvent.defaultPrevented;
    };
    expect(closing()).toBe(false);

    await write("Words.");

    expect(closing()).toBe(true);
  });
});

describe("LegalTextEditor: an archived event", () => {
  it("shows the text to read, with nothing to change and nothing to press", async () => {
    fetchLegalDocument.mockResolvedValue(stored({ published: true, published_at: "2026-10-20T10:00:00.000Z" }));
    renderEditor({ event: archivedEvent });

    const box = await textbox();

    expect(box.getAttribute("contenteditable")).toBe("false");
    expect(screen.queryByRole("group", { name: "Text formatting" })).toBeNull();
    expect((screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement).disabled).toBe(true);
    for (const name of ["Save", "Publish", "Unpublish", "Delete"]) expect(screen.queryByRole("button", { name })).toBeNull();
    // Reading goes on: the way back, and the public page.
    expect(button("Back to legal texts")).toBeTruthy();
    expect(screen.getByRole("link", { name: /View the public page/ })).toBeTruthy();
  });
});
