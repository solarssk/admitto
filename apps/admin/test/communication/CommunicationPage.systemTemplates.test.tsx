// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Link, MemoryRouter, Route, Routes } from "react-router";
import { forceLinting, forEachDiagnostic } from "@codemirror/lint";
import type { EditorView } from "@codemirror/view";
import { CommunicationPage, resolveTestSendTemplateLabel } from "../../src/pages/CommunicationPage.js";
import { ApiError } from "../../src/api/client.js";
import { deferred, getTooltipText, isOff, renderWithToast } from "../test-utils.js";
import { communicationApiMocks } from "./communicationApiMock.js";
import { bodyValue, getBodyView, setBodyValue } from "./codeMirrorTestUtils.js";

const { fetchEventTemplates, fetchEventTemplate, fetchEventTemplateById, fetchEventSystemTemplate, fetchEventOverview } =
  communicationApiMocks;
const deleteEventTemplate = vi.fn();
const previewEventSystemTemplate = vi.fn();
const previewEventTemplateById = vi.fn();
const saveEventSystemTemplate = vi.fn();
const saveEventTemplateById = vi.fn();
const testSendEventSystemTemplate = vi.fn();
const testSendEventTemplateById = vi.fn();
const sendEventBulk = vi.fn();

const outlet = { event: { id: "evt-1", title: "Demo", archived_at: null as string | null, timezone: "UTC" } };

vi.mock("../../src/connection/ConnectionStateProvider.js");

// Same technique as CommunicationPage.templates.test.tsx: the shared builder is imported inside the factory, and the
// calls this file drives (revert, preview, save, test send of a registration mail) get handles of their own.
vi.mock("../../src/api/client.js", async (importOriginal) => {
  const { buildCommunicationApiMock } = await import("./communicationApiMock.js");
  return {
    ...buildCommunicationApiMock(await importOriginal<typeof import("../../src/api/client.js")>()),
    deleteEventTemplate: (...args: unknown[]) => deleteEventTemplate(...args),
    previewEventSystemTemplate: (...args: unknown[]) => previewEventSystemTemplate(...args),
    previewEventTemplateById: (...args: unknown[]) => previewEventTemplateById(...args),
    saveEventSystemTemplate: (...args: unknown[]) => saveEventSystemTemplate(...args),
    saveEventTemplateById: (...args: unknown[]) => saveEventTemplateById(...args),
    testSendEventSystemTemplate: (...args: unknown[]) => testSendEventSystemTemplate(...args),
    testSendEventTemplateById: (...args: unknown[]) => testSendEventTemplateById(...args),
    sendEventBulk: (...args: unknown[]) => sendEventBulk(...args),
  };
});

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    useBlocker: () => ({ state: "unblocked" as const, proceed: vi.fn(), reset: vi.fn() }),
    useOutletContext: () => outlet,
  };
});

/** What GET /template answers: the placeholder lists the editor starts from (the ticket's own, all of them). */
const ticketDto = {
  source: "builtin" as const,
  allowed_placeholders: [
    "first_name",
    "last_name",
    "full_name",
    "email",
    "event_name",
    "event_date",
    "ticket_url",
    "qr_image_url",
    "ticket_type",
    "apple_wallet_url",
    "confirm_url",
    "contact_name",
    "contact_email",
    "contact_line",
    "logo_url",
  ],
  required_url_placeholders: ["ticket_url", "qr_image_url"],
  image_placeholders: ["logo_url", "qr_image_url"],
  subject_template: "Your ticket for {{event_name}}",
  body_template: "<p>Ticket</p>",
  template_format: "html" as const,
  logo_url: "",
  header_image_url: "",
};

const BUILTIN_CONFIRM = {
  subject_template: "Confirm your email for {{event_name}}",
  body_template: '<mjml><mj-body><mj-section><mj-column><mj-button href="{{confirm_url}}">Confirm</mj-button></mj-column></mj-section></mj-body></mjml>',
  template_format: "mjml" as const,
  source: "builtin" as const,
};

const BUILTIN_WAITLIST = {
  subject_template: "You are on the waiting list for {{event_name}}",
  body_template: "<mjml><mj-body><mj-section><mj-column><mj-text>{{contact_line}}</mj-text></mj-column></mj-section></mj-body></mjml>",
  template_format: "mjml" as const,
  source: "builtin" as const,
};

const reminderRow = {
  id: "tpl-rem",
  name: "reminder",
  label: "Reminder",
  icon: null,
  description: null,
  template_format: "html" as const,
  subject_template: "Reminder subject",
  updated_at: "2026-01-02T00:00:00.000Z",
};

/** A registration mail the event has customised: the row `GET /templates` lists, as the server flags it. */
const confirmRow = {
  id: "tpl-confirm",
  name: "registration-confirm",
  label: "Registration: confirm email",
  icon: null,
  description: null,
  template_format: "html" as const,
  subject_template: "Please confirm {{event_name}}",
  updated_at: "2026-01-03T00:00:00.000Z",
  is_system: true,
};

const confirmDetail = {
  ...confirmRow,
  body_template: '<p>Hello <a href="{{confirm_url}}">confirm</a></p>',
  compiled_html_template: "<p></p>",
};

function renderTemplatesTab() {
  return renderWithToast(
    <MemoryRouter initialEntries={["/admin/events/evt-comm/communication?tab=templates"]}>
      <Routes>
        <Route path="/admin/events/:eventId/communication" element={<CommunicationPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const pickerTrigger = () => screen.getByRole("button", { name: /^Template,/ });

async function openTemplatesTab() {
  renderTemplatesTab();
  await waitFor(() => expect(pickerTrigger()).toBeTruthy());
}

async function selectTemplate(label: string) {
  fireEvent.click(pickerTrigger());
  fireEvent.click(await screen.findByRole("button", { name: label, exact: true }));
}

/** Opens a registration mail that runs on the default and waits for its source to be in the editor. */
async function openDefault(label: string, subject: string) {
  await openTemplatesTab();
  await selectTemplate(label);
  await waitFor(() => expect(screen.getByDisplayValue(subject)).toBeTruthy());
}

function chip(name: string): HTMLElement | null {
  return screen.queryByRole("button", { name: `{{${name}}}` });
}

/** The entries of the open picker, in order. */
async function pickerOptions(): Promise<(string | null)[]> {
  const buttons = await screen.findAllByRole("button");
  return buttons.filter((el) => el.classList.contains("searchable-select__option")).map((el) => el.getAttribute("aria-label"));
}

/** What the body editor flags, read from the lint state once its pass has run. */
async function lintMessages(view: EditorView): Promise<string[]> {
  forceLinting(view);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const messages: string[] = [];
  forEachDiagnostic(view.state, (d) => messages.push(d.message));
  return messages;
}

beforeEach(() => {
  outlet.event.archived_at = null;
  fetchEventOverview.mockResolvedValue({ email_bounced: 0, email_failed: 0, email_sent: 0, email_queued: 0 });
  fetchEventTemplate.mockResolvedValue(ticketDto);
  fetchEventTemplates.mockResolvedValue([reminderRow]);
  fetchEventTemplateById.mockImplementation(async (_eventId: string, id: string) =>
    id === "tpl-confirm"
      ? confirmDetail
      : { ...reminderRow, body_template: "<p>Reminder</p>", compiled_html_template: "<p>Reminder</p>" },
  );
  fetchEventSystemTemplate.mockImplementation(async (_eventId: string, name: string) =>
    name === "registration-confirm" ? BUILTIN_CONFIRM : BUILTIN_WAITLIST,
  );
  previewEventSystemTemplate.mockResolvedValue({ subject: "Preview subject", html: "<p>Preview</p>" });
  previewEventTemplateById.mockResolvedValue({ subject: "Saved preview subject", html: "<p>Saved</p>" });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("the registration mails in the picker", () => {
  it("come after the operator's own templates, one entry each, and the Send tab's picker never offers them", async () => {
    await openTemplatesTab();
    fireEvent.click(pickerTrigger());
    expect(await pickerOptions()).toEqual([
      "Ticket email",
      "Reminder",
      "Registration: confirm email",
      "Registration: received",
      "Registration: waiting list",
      "Registration: declined",
    ]);
  });

  it("show a saved row in the place of the entry for its default, and nowhere twice", async () => {
    fetchEventTemplates.mockResolvedValue([reminderRow, confirmRow]);
    await openTemplatesTab();
    fireEvent.click(pickerTrigger());
    // The saved row of the confirmation mail is among the four, not a fifth entry beside the entry for its default.
    expect(await pickerOptions()).toEqual([
      "Ticket email",
      "Reminder",
      "Registration: confirm email",
      "Registration: received",
      "Registration: waiting list",
      "Registration: declined",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Registration: confirm email", exact: true }));
    await waitFor(() => expect(fetchEventTemplateById).toHaveBeenCalledWith("evt-comm", "tpl-confirm"));
  });

  it("are not counted in the Templates tab, saved or not", async () => {
    await openTemplatesTab();
    // The ticket's entry and the Reminder: the four registration mails are the product's, and are always there.
    expect(screen.getByRole("tab", { name: /^Templates/ }).textContent).toBe("Templates2");
    cleanup();

    fetchEventTemplates.mockResolvedValue([reminderRow, confirmRow]);
    await openTemplatesTab();
    expect(screen.getByRole("tab", { name: /^Templates/ }).textContent).toBe("Templates2");
  });

  it("leave the Send tab's picker with the ticket email and the operator's own templates only", async () => {
    fetchEventTemplates.mockResolvedValue([reminderRow, confirmRow]);
    renderWithToast(
      <MemoryRouter initialEntries={["/admin/events/evt-comm/communication"]}>
        <Routes>
          <Route path="/admin/events/:eventId/communication" element={<CommunicationPage />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole("button", { name: /^Template,/ }));
    expect(await pickerOptions()).toEqual(["Ticket email", "Reminder"]);
  });
});

describe("opening a registration mail that runs on the default", () => {
  it("loads the built-in text by name, says it is the default and what the mail is for, and creates nothing", async () => {
    await openDefault("Registration: confirm email", BUILTIN_CONFIRM.subject_template);

    expect(fetchEventSystemTemplate).toHaveBeenCalledWith("evt-comm", "registration-confirm");
    expect(fetchEventTemplateById).not.toHaveBeenCalled();
    expect(screen.getByText("Default template")).toBeTruthy();
    expect(screen.getByText(/Asks a guest to confirm their email address\./)).toBeTruthy();
    expect(screen.getByText(/The guest's name stays empty in it\./)).toBeTruthy();
    expect(screen.getByText(/Sent automatically, and not listed in the Delivery log\./)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Revert to default" })).toBeNull();
    expect(bodyValue(getBodyView())).toBe(BUILTIN_CONFIRM.body_template);
  });

  it("shows the organization's text with the same badge when the event has none of its own", async () => {
    fetchEventSystemTemplate.mockResolvedValue({ ...BUILTIN_CONFIRM, subject_template: "Org wording", source: "organization" });
    await openDefault("Registration: confirm email", "Org wording");
    expect(screen.getByText("Default template")).toBeTruthy();
  });

  it("keeps the name, icon and description off limits, with the reason on the pencil", async () => {
    await openDefault("Registration: waiting list", BUILTIN_WAITLIST.subject_template);
    const pencil = screen.getByRole("button", { name: "Edit template" });
    expect(isOff(pencil)).toBe(true);
    expect(getTooltipText(pencil)).toBe("A system email keeps its name, icon and description.");
  });

  it("offers the confirmation link, marked as required, in the confirmation mail only", async () => {
    await openDefault("Registration: confirm email", BUILTIN_CONFIRM.subject_template);
    expect(chip("confirm_url")?.className).toContain("communication-chip--required");
    expect(chip("ticket_url")).toBeNull();
    expect(chip("qr_image_url")).toBeNull();
    expect(chip("apple_wallet_url")).toBeNull();
    expect(chip("ticket_type")).toBeNull();

    await selectTemplate("Registration: waiting list");
    await waitFor(() => expect(screen.getByDisplayValue(BUILTIN_WAITLIST.subject_template)).toBeTruthy());
    expect(chip("confirm_url")).toBeNull();
  });

  it.each([
    ["Registration: confirm email", BUILTIN_CONFIRM.subject_template],
    ["Registration: waiting list", BUILTIN_WAITLIST.subject_template],
  ])("offers the contact placeholders, under their own heading, in %s", async (label, subject) => {
    await openDefault(label, subject);
    for (const name of ["contact_name", "contact_email", "contact_line"]) {
      expect(chip(name), name).toBeTruthy();
      expect(chip(name)?.className).not.toContain("communication-chip--required");
    }
    expect(screen.getByText("Contact")).toBeTruthy();
    expect(screen.getByText("Event")).toBeTruthy();
  });

  it("offers neither the confirmation link nor the contact placeholders to the ticket email or the operator's own templates", async () => {
    await openTemplatesTab();
    await waitFor(() => expect(screen.getByDisplayValue(ticketDto.subject_template)).toBeTruthy());
    for (const name of ["confirm_url", "contact_name", "contact_email", "contact_line"]) expect(chip(name), name).toBeNull();
    expect(chip("ticket_url")?.className).toContain("communication-chip--required");

    await selectTemplate("Reminder");
    await waitFor(() => expect(screen.getByDisplayValue("Reminder subject")).toBeTruthy());
    for (const name of ["confirm_url", "contact_name", "contact_email", "contact_line"]) expect(chip(name), name).toBeNull();
  });

  it("describes the placeholders of a registration mail on hover instead of showing the bare token", async () => {
    await openDefault("Registration: confirm email", BUILTIN_CONFIRM.subject_template);
    expect(getTooltipText(chip("confirm_url")!)).toBe(
      "Required placeholder · The link the guest opens to confirm their email address.",
    );
    expect(getTooltipText(chip("contact_line")!)).toBe("A ready sentence naming that contact, or nothing when the event has none.");
  });

  it("previews the draft by name, with what the editor holds", async () => {
    await openDefault("Registration: confirm email", BUILTIN_CONFIRM.subject_template);
    await waitFor(() => expect(previewEventSystemTemplate).toHaveBeenCalled());
    expect(previewEventSystemTemplate).toHaveBeenLastCalledWith("evt-comm", "registration-confirm", {
      subject_template: BUILTIN_CONFIRM.subject_template,
      body_template: BUILTIN_CONFIRM.body_template,
      template_format: "mjml",
    });
    await waitFor(() => expect(screen.getByText("Preview subject")).toBeTruthy());
  });

  it("shows the error of a failed load as a toast and stays where it was", async () => {
    await openTemplatesTab();
    await waitFor(() => expect(screen.getByDisplayValue(ticketDto.subject_template)).toBeTruthy());
    fetchEventSystemTemplate.mockRejectedValue(new ApiError(500, "server error", "server error"));
    await selectTemplate("Registration: confirm email");
    expect(await screen.findByText("Something went wrong. Try again.")).toBeTruthy();
    expect(screen.getByDisplayValue(ticketDto.subject_template)).toBeTruthy();
  });
});

describe("the placeholder lint of a registration mail", () => {
  it("accepts the confirmation link and the contact placeholders, and flags a ticket link, in the confirmation mail", async () => {
    await openDefault("Registration: confirm email", BUILTIN_CONFIRM.subject_template);
    const view = getBodyView();
    setBodyValue(view, "<p>{{confirm_url}} {{contact_name}} {{contact_email}} {{contact_line}} {{event_name}}</p>");
    expect(await lintMessages(view)).toEqual([]);

    setBodyValue(view, "<p>{{ticket_url}} {{qr_image_url}} {{ticket_type}}</p>");
    expect(await lintMessages(view)).toEqual([
      "Unknown placeholder: ticket_url",
      "Unknown placeholder: qr_image_url",
      "Unknown placeholder: ticket_type",
    ]);
  });

  it("flags the confirmation link in every other registration mail, as the server refuses it there", async () => {
    await openDefault("Registration: waiting list", BUILTIN_WAITLIST.subject_template);
    const view = getBodyView();
    setBodyValue(view, "<p>{{confirm_url}} {{contact_line}}</p>");
    expect(await lintMessages(view)).toEqual(["Unknown placeholder: confirm_url"]);
  });

  it("flags the contact placeholders in the ticket email, as the server refuses them there, and still accepts its ticket link", async () => {
    await openTemplatesTab();
    await waitFor(() => expect(screen.getByDisplayValue(ticketDto.subject_template)).toBeTruthy());
    const view = getBodyView("HTML body");
    setBodyValue(view, "<p>{{contact_line}} {{confirm_url}} {{ticket_url}}</p>");
    expect(await lintMessages(view)).toEqual([
      "Unknown placeholder: contact_line",
      "Unknown placeholder: confirm_url",
    ]);
  });
});

describe("saving a registration mail for the first time", () => {
  async function editAndSave() {
    await openDefault("Registration: confirm email", BUILTIN_CONFIRM.subject_template);
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Please confirm {{event_name}}" } });
    fireEvent.click(screen.getByRole("button", { name: "Save *" }));
    return screen.findByRole("dialog", { name: "Create event template override" });
  }

  it("asks first, then creates the event's own row by name and swaps the entry for the row", async () => {
    saveEventSystemTemplate.mockResolvedValue(confirmDetail);
    const dialog = await editAndSave();
    expect(saveEventSystemTemplate).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(saveEventSystemTemplate).toHaveBeenCalledTimes(1));
    expect(saveEventSystemTemplate).toHaveBeenCalledWith("evt-comm", "registration-confirm", {
      subject_template: "Please confirm {{event_name}}",
      body_template: BUILTIN_CONFIRM.body_template,
      template_format: "mjml",
    });
    expect(await screen.findByText("Template saved.")).toBeTruthy();
    // It is the saved row now: last edited instead of default, the picker's entry is the row, and it can go back.
    expect(screen.queryByText("Default template")).toBeNull();
    expect(screen.getByText(/Last edited/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Revert to default" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Template, Registration: confirm email" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Saved" })).toBeTruthy();
    // From here on the mail is the row's: its next preview goes by the row's id, not by name.
    previewEventSystemTemplate.mockClear();
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Another subject" } });
    await waitFor(() =>
      expect(previewEventTemplateById).toHaveBeenLastCalledWith("evt-comm", "tpl-confirm", expect.objectContaining({ subject_template: "Another subject" })),
    );
    expect(previewEventSystemTemplate).not.toHaveBeenCalled();
  });

  it("saves by id from the second save on", async () => {
    saveEventSystemTemplate.mockResolvedValue(confirmDetail);
    saveEventTemplateById.mockResolvedValue({ ...confirmDetail, subject_template: "Second wording" });
    const dialog = await editAndSave();
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    await screen.findByText("Template saved.");

    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Second wording" } });
    fireEvent.click(screen.getByRole("button", { name: "Save *" }));
    await waitFor(() =>
      expect(saveEventTemplateById).toHaveBeenCalledWith("evt-comm", "tpl-confirm", expect.objectContaining({ subject_template: "Second wording" })),
    );
    // No second question: the event has its own text now.
    expect(screen.queryByRole("dialog", { name: "Create event template override" })).toBeNull();
    expect(saveEventSystemTemplate).toHaveBeenCalledTimes(1);
  });

  it("does not send the first save when the operator cancels", async () => {
    const dialog = await editAndSave();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(saveEventSystemTemplate).not.toHaveBeenCalled();
    expect(screen.getByText("Default template")).toBeTruthy();
  });

  it("shows what the server refuses next to the editor and keeps the entry for the default", async () => {
    const { TemplateValidationError } = await import("../../src/api/client.js");
    saveEventSystemTemplate.mockRejectedValue(new TemplateValidationError(["Missing required placeholder: confirm_url"]));
    const dialog = await editAndSave();
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("Missing required placeholder: confirm_url")).toBeTruthy();
    expect(screen.getByText("Default template")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Revert to default" })).toBeNull();
  });
});

describe("a registration mail the event has customised", () => {
  async function openSaved() {
    fetchEventTemplates.mockResolvedValue([confirmRow]);
    await openTemplatesTab();
    await selectTemplate("Registration: confirm email");
    await waitFor(() => expect(screen.getByDisplayValue(confirmRow.subject_template)).toBeTruthy());
  }

  it("opens by id, as any saved template, with the revert next to Save and the name locked", async () => {
    await openSaved();
    expect(fetchEventTemplateById).toHaveBeenCalledWith("evt-comm", "tpl-confirm");
    expect(fetchEventSystemTemplate).not.toHaveBeenCalled();
    expect(screen.getByText(/Last edited/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Revert to default" })).toBeTruthy();
    const pencil = screen.getByRole("button", { name: "Edit template" });
    expect(isOff(pencil)).toBe(true);
    expect(getTooltipText(pencil)).toBe("A system email keeps its name, icon and description.");
    expect(screen.getByText(/Asks a guest to confirm their email address\./)).toBeTruthy();
  });

  it("asks before it reverts, and does nothing when the operator cancels", async () => {
    await openSaved();
    const revert = screen.getByRole("button", { name: "Revert to default" });
    fireEvent.click(revert);
    const dialog = await screen.findByRole("dialog", { name: "Revert to the default text?" });
    expect(within(dialog).getByText(/discarded, unsaved changes included/)).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Revert to the default text?" })).toBeNull();
    expect(deleteEventTemplate).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(revert);
  });

  it("keeps the revert off while the text is being saved, so a late answer of the save cannot bring the row back", async () => {
    await openSaved();
    const pending = deferred<typeof confirmDetail>();
    saveEventTemplateById.mockReturnValue(pending.promise);
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Second wording" } });
    fireEvent.click(screen.getByRole("button", { name: "Save *" }));
    const revert = screen.getByRole("button", { name: "Revert to default" });
    await waitFor(() => expect(isOff(revert)).toBe(true));
    fireEvent.click(revert);
    expect(screen.queryByRole("dialog", { name: "Revert to the default text?" })).toBeNull();

    await act(async () => {
      pending.resolve({ ...confirmDetail, subject_template: "Second wording" });
    });
    await screen.findByText("Template saved.");
    expect(isOff(screen.getByRole("button", { name: "Revert to default" }))).toBe(false);
    expect(deleteEventTemplate).not.toHaveBeenCalled();
  });

  it("deletes the row, opens the default in its place, says so, and puts the focus on the picker, once it is on again", async () => {
    await openSaved();
    deleteEventTemplate.mockResolvedValue(undefined);
    fetchEventTemplates.mockResolvedValue([]);
    // The picker is off while the page is busy, and a browser does not focus an off control: record that it was on.
    const pickerWhenFocused: boolean[] = [];
    const focus = HTMLElement.prototype.focus;
    vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (this: HTMLElement, ...args) {
      if (this.id === "communication-templates-picker") pickerWhenFocused.push(!(this as HTMLButtonElement).disabled);
      return focus.apply(this, args);
    });
    fireEvent.click(screen.getByRole("button", { name: "Revert to default" }));
    const dialog = await screen.findByRole("dialog", { name: "Revert to the default text?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Revert to default" }));

    await waitFor(() => expect(deleteEventTemplate).toHaveBeenCalledWith("evt-comm", "tpl-confirm"));
    expect(await screen.findByText("Reverted to the default text.")).toBeTruthy();
    expect(fetchEventSystemTemplate).toHaveBeenCalledWith("evt-comm", "registration-confirm");
    await waitFor(() => expect(screen.getByDisplayValue(BUILTIN_CONFIRM.subject_template)).toBeTruthy());
    expect(screen.queryByRole("dialog", { name: "Revert to the default text?" })).toBeNull();
    expect(screen.getByText("Default template")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Revert to default" })).toBeNull();
    expect(screen.getByRole("button", { name: "Template, Registration: confirm email" })).toBeTruthy();
    expect(bodyValue(getBodyView())).toBe(BUILTIN_CONFIRM.body_template);
    await waitFor(() => expect(document.activeElement).toBe(pickerTrigger()));
    expect(pickerWhenFocused).toEqual([true]);
  });

  it("reverts text that was edited and not saved too, without a second question about it", async () => {
    await openSaved();
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Unsaved wording" } });
    deleteEventTemplate.mockResolvedValue(undefined);
    fetchEventTemplates.mockResolvedValue([]);
    fireEvent.click(screen.getByRole("button", { name: "Revert to default" }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "Revert to the default text?" })).getByRole("button", { name: "Revert to default" }));
    await waitFor(() => expect(screen.getByDisplayValue(BUILTIN_CONFIRM.subject_template)).toBeTruthy());
    expect(screen.queryByRole("dialog", { name: "Discard unsaved changes?" })).toBeNull();
    // Nothing is left to save: the editor holds exactly what was loaded.
    expect(screen.getByRole("button", { name: "Saved" })).toBeTruthy();
  });

  it("keeps the question open, busy while it works and with the reason in it when the delete fails", async () => {
    await openSaved();
    const pending = deferred<void>();
    deleteEventTemplate.mockReturnValue(pending.promise);
    fireEvent.click(screen.getByRole("button", { name: "Revert to default" }));
    const dialog = await screen.findByRole("dialog", { name: "Revert to the default text?" });
    const confirm = within(dialog).getByRole("button", { name: "Revert to default" });
    fireEvent.click(confirm);
    await waitFor(() => expect(isOff(confirm)).toBe(true));
    expect(isOff(within(dialog).getByRole("button", { name: "Cancel" }))).toBe(true);

    await act(async () => {
      pending.reject(new ApiError(404, "not_found", "not_found"));
    });
    expect(await within(dialog).findByText("The requested item was not found.")).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Revert to the default text?" })).toBeTruthy();
    expect(screen.queryByText("Reverted to the default text.")).toBeNull();
    expect(isOff(within(dialog).getByRole("button", { name: "Revert to default" }))).toBe(false);
    // Nothing moved: the saved text is still what the editor holds, and the row is still in the picker.
    expect(screen.getByDisplayValue(confirmRow.subject_template)).toBeTruthy();
    expect(fetchEventSystemTemplate).not.toHaveBeenCalled();
  });

  it("clears an earlier failure when the question is asked again", async () => {
    await openSaved();
    deleteEventTemplate.mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(screen.getByRole("button", { name: "Revert to default" }));
    const dialog = await screen.findByRole("dialog", { name: "Revert to the default text?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Revert to default" }));
    expect(await within(dialog).findByText("Revert failed.")).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Revert to default" }));
    const again = await screen.findByRole("dialog", { name: "Revert to the default text?" });
    expect(within(again).queryByText("Revert failed.")).toBeNull();
  });

  it("says the default is back, and asks for a reload, when only the refresh afterwards fails", async () => {
    await openSaved();
    deleteEventTemplate.mockResolvedValue(undefined);
    fetchEventTemplates.mockResolvedValue([]);
    fetchEventSystemTemplate.mockRejectedValue(new ApiError(500, "server error", "server error"));
    fireEvent.click(screen.getByRole("button", { name: "Revert to default" }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "Revert to the default text?" })).getByRole("button", { name: "Revert to default" }));

    expect(
      await screen.findByText("The default text is back, but this page could not be refreshed. Reload it."),
    ).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Revert to the default text?" })).toBeNull();
    expect(screen.queryByText("Reverted to the default text.")).toBeNull();
  });

  it("goes back to the organization's text, not the built-in one, when the organization has one", async () => {
    await openSaved();
    deleteEventTemplate.mockResolvedValue(undefined);
    fetchEventTemplates.mockResolvedValue([]);
    fetchEventSystemTemplate.mockResolvedValue({ ...BUILTIN_CONFIRM, subject_template: "Org wording", source: "organization" });
    fireEvent.click(screen.getByRole("button", { name: "Revert to default" }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "Revert to the default text?" })).getByRole("button", { name: "Revert to default" }));
    await waitFor(() => expect(screen.getByDisplayValue("Org wording")).toBeTruthy());
    expect(screen.getByText("Default template")).toBeTruthy();
  });

  it("says nothing about a revert that ends after the operator has moved to another event", async () => {
    fetchEventTemplates.mockResolvedValue([confirmRow]);
    renderWithToast(
      <MemoryRouter initialEntries={["/admin/events/evt-a/communication?tab=templates"]}>
        <Routes>
          <Route
            path="/admin/events/:eventId/communication"
            element={
              <>
                <Link to="/admin/events/evt-b/communication?tab=templates">Switch event</Link>
                <CommunicationPage />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(pickerTrigger()).toBeTruthy());
    await selectTemplate("Registration: confirm email");
    await waitFor(() => expect(screen.getByDisplayValue(confirmRow.subject_template)).toBeTruthy());

    const pending = deferred<void>();
    deleteEventTemplate.mockReturnValue(pending.promise);
    fireEvent.click(screen.getByRole("button", { name: "Revert to default" }));
    const dialog = await screen.findByRole("dialog", { name: "Revert to the default text?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Revert to default" }));
    await waitFor(() => expect(deleteEventTemplate).toHaveBeenCalledWith("evt-a", "tpl-confirm"));

    fireEvent.click(screen.getByRole("link", { name: "Switch event" }));
    await waitFor(() => expect(fetchEventTemplates).toHaveBeenCalledWith("evt-b", expect.anything()));
    await act(async () => {
      pending.resolve();
    });
    await waitFor(() => expect(fetchEventSystemTemplate).toHaveBeenCalledWith("evt-a", "registration-confirm"));

    // The page of the other event is on screen: nothing of the revert of the first one reaches it.
    expect(screen.queryByText("Reverted to the default text.")).toBeNull();
    expect(screen.queryByText(/The default text is back/)).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Revert to the default text?" })).toBeNull();
  });

  it("is saved by id, and a second mail's entry stays on its default", async () => {
    fetchEventTemplates.mockResolvedValue([confirmRow]);
    await openTemplatesTab();
    await selectTemplate("Registration: waiting list");
    await waitFor(() => expect(screen.getByDisplayValue(BUILTIN_WAITLIST.subject_template)).toBeTruthy());
    expect(screen.getByText("Default template")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Revert to default" })).toBeNull();
  });
});

describe("a registration mail on an archived event", () => {
  it("can be read, but not saved or reverted: the revert is off, with the reason", async () => {
    outlet.event.archived_at = "2026-09-01T00:00:00.000Z";
    fetchEventTemplates.mockResolvedValue([confirmRow]);
    await openTemplatesTab();
    await selectTemplate("Registration: confirm email");
    await waitFor(() => expect(screen.getByDisplayValue(confirmRow.subject_template)).toBeTruthy());
    const revert = screen.getByRole("button", { name: "Revert to default" });
    expect(isOff(revert)).toBe(true);
    expect(getTooltipText(revert)).toBe("This event is archived. Editing is disabled.");
    fireEvent.click(revert);
    expect(screen.queryByRole("dialog", { name: "Revert to the default text?" })).toBeNull();
    expect(deleteEventTemplate).not.toHaveBeenCalled();
  });
});

describe("sending a test of a registration mail", () => {
  async function sendTest() {
    fireEvent.change(screen.getByLabelText("Recipient"), { target: { value: "tester@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send test" }));
  }

  it("goes by name while the mail has no row, and names the mail in the result", async () => {
    testSendEventSystemTemplate.mockResolvedValue({ status: "sent" });
    await openDefault("Registration: confirm email", BUILTIN_CONFIRM.subject_template);
    await sendTest();
    await waitFor(() =>
      expect(testSendEventSystemTemplate).toHaveBeenCalledWith("evt-comm", "registration-confirm", { to: "tester@example.com" }),
    );
    expect(await screen.findByText("Test email sent.")).toBeTruthy();
    expect(screen.getByText("Registration: confirm email", { selector: "b" })).toBeTruthy();
  });

  it("goes by id once the mail has a row", async () => {
    testSendEventTemplateById.mockResolvedValue({ status: "sent" });
    fetchEventTemplates.mockResolvedValue([confirmRow]);
    await openTemplatesTab();
    await selectTemplate("Registration: confirm email");
    await waitFor(() => expect(screen.getByDisplayValue(confirmRow.subject_template)).toBeTruthy());
    await sendTest();
    await waitFor(() =>
      expect(testSendEventTemplateById).toHaveBeenCalledWith("evt-comm", "tpl-confirm", { to: "tester@example.com" }),
    );
    expect(testSendEventSystemTemplate).not.toHaveBeenCalled();
  });

  it("says why when the server could not send it", async () => {
    testSendEventSystemTemplate.mockResolvedValue({ status: "failed", error: "The mail server refused the message." });
    await openDefault("Registration: waiting list", BUILTIN_WAITLIST.subject_template);
    await sendTest();
    expect(await screen.findByText("The mail server refused the message.")).toBeTruthy();
  });

  it("labels a mail that has no row by its picker name", () => {
    expect(resolveTestSendTemplateLabel("virtual-registration-waitlist", [])).toBe("Registration: waiting list");
    expect(resolveTestSendTemplateLabel("virtual-ticket", [])).toBe("Ticket email");
    expect(resolveTestSendTemplateLabel("virtual-nothing", [])).toBe("Template");
  });
});

describe("the Send tab while a registration mail is open on the Templates tab", () => {
  it("shows the note instead of a preview or a send form, and fetches no preview of it", async () => {
    await openDefault("Registration: confirm email", BUILTIN_CONFIRM.subject_template);
    await waitFor(() => expect(previewEventSystemTemplate).toHaveBeenCalled());
    previewEventSystemTemplate.mockClear();

    fireEvent.click(screen.getByRole("tab", { name: /^Email/ }));
    expect(await screen.findByText(/cannot be sent in bulk/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Send email" })).toBeNull();
    expect(screen.queryByTitle("Email preview")).toBeNull();
    expect(screen.queryByText("Preview", { selector: "span" })).toBeNull();
    expect(previewEventSystemTemplate).not.toHaveBeenCalled();
    expect(sendEventBulk).not.toHaveBeenCalled();
  });

  it("goes back to the ordinary Send tab once a template that can be sent is picked", async () => {
    await openDefault("Registration: confirm email", BUILTIN_CONFIRM.subject_template);
    await selectTemplate("Reminder");
    await waitFor(() => expect(screen.getByDisplayValue("Reminder subject")).toBeTruthy());
    fireEvent.click(screen.getByRole("tab", { name: /^Email/ }));
    await waitFor(() => expect(screen.queryByText(/cannot be sent in bulk/)).toBeNull());
  });
});
