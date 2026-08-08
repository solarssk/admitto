import { describe, expect, it, vi } from "vitest";
import { updateMailTemplateMetadata } from "../src/mailTemplate.js";

describe("updateMailTemplateMetadata", () => {
  it("passes only provided identity fields through to prisma.update", async () => {
    const row = {
      id: "tpl-1",
      name: "reminder",
      label: "Final reminder",
      icon: "bell",
      description: "Sent 1h before doors open.",
      template_format: "mjml",
      subject_template: "Before {{event_name}}",
      updated_at: new Date("2026-01-03T00:00:00.000Z"),
    };
    const update = vi.fn().mockResolvedValue(row);
    const prisma = { mailTemplate: { update } };

    const result = await updateMailTemplateMetadata(
      "tpl-1",
      {
        label: "Final reminder",
        icon: "bell",
        description: "Sent 1h before doors open.",
      },
      prisma as never,
    );

    expect(update).toHaveBeenCalledWith({
      where: { id: "tpl-1" },
      data: {
        label: "Final reminder",
        icon: "bell",
        description: "Sent 1h before doors open.",
      },
      select: {
        id: true,
        name: true,
        label: true,
        icon: true,
        description: true,
        template_format: true,
        subject_template: true,
        updated_at: true,
      },
    });
    expect(result).toEqual(row);
  });

  it("omits unset fields and clears icon/description when null is passed", async () => {
    const update = vi.fn().mockResolvedValue({
      id: "tpl-1",
      name: "reminder",
      label: "Reminder",
      icon: null,
      description: null,
      template_format: "mjml",
      subject_template: "Hi",
      updated_at: new Date("2026-01-03T00:00:00.000Z"),
    });
    const prisma = { mailTemplate: { update } };

    await updateMailTemplateMetadata("tpl-1", { icon: null, description: null }, prisma as never);

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { icon: null, description: null },
      }),
    );
  });
});
