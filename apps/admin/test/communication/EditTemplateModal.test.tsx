// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditTemplateModal } from "../../src/communication/EditTemplateModal.js";
import type { MailTemplateListItem } from "../../src/api/types.js";

const reminder: MailTemplateListItem = {
  id: "tpl-rem",
  name: "reminder",
  label: "Reminder",
  icon: "bell",
  description: "Sent 24h before the event.",
  template_format: "mjml",
  subject_template: "Reminder subject",
  updated_at: "2026-01-02T00:00:00.000Z",
};

afterEach(() => {
  cleanup();
});

describe("EditTemplateModal", () => {
  it("Escape dismisses only the nested delete confirmation, not the whole editor", () => {
    const onClose = vi.fn();
    const onDelete = vi.fn();
    render(
      <EditTemplateModal
        open
        template={reminder}
        busy={false}
        onClose={onClose}
        onSave={vi.fn()}
        onDelete={onDelete}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByRole("dialog", { name: "Delete template?" })).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "Delete template?" })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Edit template" })).toBeTruthy();
  });

  it("ignores Cancel while a save or delete is in flight", () => {
    const onClose = vi.fn();
    render(
      <EditTemplateModal
        open
        template={reminder}
        busy
        onClose={onClose}
        onSave={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("blocks a second Save click while the first submit is still pending busy", () => {
    const onSave = vi.fn();
    const { rerender } = render(
      <EditTemplateModal
        open
        template={reminder}
        busy={false}
        onClose={vi.fn()}
        onSave={onSave}
        onDelete={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledTimes(1);

    // Parent sets busy after the first click; submittingRef still guards a second click
    // before that re-render, and busy keeps subsequent clicks from re-entering.
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledTimes(1);

    rerender(
      <EditTemplateModal
        open
        template={reminder}
        busy
        onClose={vi.fn()}
        onSave={onSave}
        onDelete={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Saving…" }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("closes the nested delete confirm before calling onDelete", () => {
    const onDelete = vi.fn();
    render(
      <EditTemplateModal
        open
        template={reminder}
        busy={false}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onDelete={onDelete}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const confirm = screen.getByRole("dialog", { name: "Delete template?" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Delete" }));

    expect(onDelete).toHaveBeenCalledWith("tpl-rem");
    expect(screen.queryByRole("dialog", { name: "Delete template?" })).toBeNull();
  });
});
