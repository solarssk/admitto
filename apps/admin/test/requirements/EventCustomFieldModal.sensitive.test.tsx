// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/api/client.js";
import { CODE_MESSAGES } from "../../src/api/operator-api-error.js";
import type { EventCustomFieldDto } from "../../src/api/types.js";
import { EventCustomFieldModal } from "../../src/requirements/EventCustomFieldModal.js";
import { SENSITIVE_EFFECTS, SENSITIVE_OFF_VISIBLE, SENSITIVE_ON_EXPORTS } from "../../src/requirements/SensitiveFieldSwitch.js";
import { renderWithToast } from "../test-utils.js";
import { answerField } from "../attendees/answerTypeFixtures.js";

const api = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), usage: vi.fn() }));
vi.mock("../../src/api/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/api/client.js")>()),
  createEventCustomField: api.create,
  updateEventCustomField: api.update,
  fetchEventCustomFieldOptionUsage: api.usage,
}));

beforeEach(() => {
  api.usage.mockResolvedValue({});
  api.create.mockResolvedValue({});
  api.update.mockResolvedValue({});
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const ordinary = answerField("shirt", "Shirt size", "text", { show_on_form: true });
const sensitive = answerField("access", "Accessibility needs", "long_text", { show_on_form: true, sensitive: true });

async function openEditor(field: EventCustomFieldDto | null) {
  const onSaved = vi.fn();
  renderWithToast(<EventCustomFieldModal eventId="evt-1" field={field} fields={[ordinary, sensitive]} onClose={vi.fn()} onSaved={onSaved} />);
  await act(async () => {});
  return { onSaved };
}

const toggle = () => screen.getByRole("switch", { name: /Sensitive/ }) as HTMLInputElement;
const save = () => fireEvent.click(screen.getByRole("button", { name: /^(Save|Create field)$/ }));
const typeLabel = (label: string) => fireEvent.change(screen.getByLabelText("Display label"), { target: { value: label } });

describe("the Sensitive switch of the field editor", { timeout: 30_000 }, () => {
  it("is off for a new field and for an ordinary one, on for a sensitive one, with the effects written under it", async () => {
    await openEditor(null);
    expect(toggle().checked).toBe(false);
    expect(document.body.textContent).toContain(SENSITIVE_EFFECTS);
    cleanup();

    await openEditor(ordinary);
    expect(toggle().checked).toBe(false);
    cleanup();

    await openEditor(sensitive);
    expect(toggle().checked).toBe(true);
  });

  it("says in plain words where the answers are hidden, who sees them, that each Show is recorded and that deleting the question deletes them", () => {
    for (const phrase of ["lists", "search", "filters", "exports", "reports", "wallet", "emails", "operator card", "administrators", "Show", "audit log", "deletes its answers"]) {
      expect(SENSITIVE_EFFECTS).toContain(phrase);
    }
  });

  it("creates the field sensitive when the switch is on, and says nothing about sensitivity when it is off", async () => {
    const { onSaved } = await openEditor(null);
    typeLabel("Allergies");
    fireEvent.click(toggle());

    save();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());

    expect(api.create.mock.calls[0]![1]).toMatchObject({ source_field: "allergies", sensitive: true });
    cleanup();
    api.create.mockClear();
    await openEditor(null);
    typeLabel("Shoe size");
    save();
    await waitFor(() => expect(api.create).toHaveBeenCalled());
    expect(api.create.mock.calls[0]![1]).not.toHaveProperty("sensitive");
  });

  it("turning an existing question sensitive says that ready exports are cancelled, and sends sensitive: true", async () => {
    const { onSaved } = await openEditor(ordinary);
    expect(document.body.textContent).not.toContain(SENSITIVE_ON_EXPORTS);

    fireEvent.click(toggle());

    expect(document.body.textContent).toContain(SENSITIVE_ON_EXPORTS);
    expect(document.body.textContent).not.toContain(SENSITIVE_OFF_VISIBLE);
    save();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(api.update.mock.calls[0]![2]).toMatchObject({ sensitive: true });
  });

  it("turning a sensitive question off shows its own, separate warning that the answers become visible again, and sends sensitive: false", async () => {
    const { onSaved } = await openEditor(sensitive);
    expect(document.body.textContent).not.toContain(SENSITIVE_OFF_VISIBLE);

    fireEvent.click(toggle());

    expect(screen.getByText(SENSITIVE_OFF_VISIBLE)).toBeTruthy();
    expect(document.body.textContent).not.toContain(SENSITIVE_ON_EXPORTS);
    save();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(api.update.mock.calls[0]![2]).toMatchObject({ sensitive: false });
  });

  it("does not send sensitive for a save that leaves it as it is, and a switch put back is no change", async () => {
    await openEditor(sensitive);
    const saveButton = screen.getByRole("button", { name: "Save" });
    fireEvent.click(toggle());
    fireEvent.click(toggle());
    expect(saveButton.hasAttribute("disabled")).toBe(true);

    fireEvent.change(screen.getByLabelText("Display label"), { target: { value: "Access needs" } });
    save();

    await waitFor(() => expect(api.update).toHaveBeenCalled());
    expect(api.update.mock.calls[0]![2]).not.toHaveProperty("sensitive");
  });

  it("says in the editor, with the helper's words, that an item still shows the question (409 field_in_use), and the window stays open", async () => {
    api.update.mockRejectedValue(new ApiError(409, "field_in_use", "field_in_use"));
    const { onSaved } = await openEditor(ordinary);
    fireEvent.click(toggle());

    save();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(CODE_MESSAGES.field_in_use);
    expect(onSaved).not.toHaveBeenCalled();
    expect(toggle().checked).toBe(true);
    // Turning the switch back takes the refusal away.
    fireEvent.click(toggle());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("tells any other failure in a toast, not in the editor", async () => {
    api.update.mockRejectedValue(new ApiError(500, "boom"));
    await openEditor(ordinary);
    fireEvent.click(toggle());

    save();

    expect(await screen.findByText("Failed to save field.")).toBeTruthy();
  });
});
