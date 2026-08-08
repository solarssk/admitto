// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { updateEventTemplateMetadata } from "../../src/api/client.js";

describe("updateEventTemplateMetadata", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("PATCHes identity fields to the event template endpoint", async () => {
    const body = {
      id: "tpl-1",
      name: "reminder",
      label: "Final reminder",
      icon: "bell",
      description: "Sent 1h before doors open.",
      template_format: "mjml",
      updated_at: "2026-01-03T00:00:00.000Z",
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => body });
    vi.stubGlobal("fetch", fetchMock);

    const result = await updateEventTemplateMetadata("evt 1", "tpl 1", {
      label: "Final reminder",
      icon: "bell",
      description: "Sent 1h before doors open.",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt%201/templates/tpl%201",
      expect.objectContaining({
        method: "PATCH",
        credentials: "same-origin",
        body: JSON.stringify({
          label: "Final reminder",
          icon: "bell",
          description: "Sent 1h before doors open.",
        }),
      }),
    );
    expect(result).toEqual(body);
  });
});
