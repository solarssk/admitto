// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  TemplateValidationError,
  fetchEventSystemTemplate,
  previewEventSystemTemplate,
  saveEventSystemTemplate,
  testSendEventSystemTemplate,
} from "../../src/api/client.js";

const draft = {
  subject_template: "Confirm {{event_name}}",
  body_template: '<p><a href="{{confirm_url}}">Confirm</a></p>',
  template_format: "html" as const,
};

function stubFetch(response: { ok: boolean; status?: number; json: () => Promise<unknown> }) {
  const fetchMock = vi.fn(async (_input: string | URL, _init?: RequestInit) => response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the client calls of a registration mail (by name)", () => {
  it("fetchEventSystemTemplate reads the editor source from the encoded event and name, with the signal", async () => {
    const source = { subject_template: "S", body_template: "B", template_format: "mjml", source: "builtin" };
    const fetchMock = stubFetch({ ok: true, json: async () => source });
    const controller = new AbortController();

    await expect(fetchEventSystemTemplate("evt 1", "registration-confirm", controller.signal)).resolves.toEqual(source);

    expect(fetchMock).toHaveBeenCalledWith("/api/admin/events/evt%201/system-templates/registration-confirm", {
      credentials: "same-origin",
      signal: controller.signal,
    });
  });

  it("saveEventSystemTemplate PUTs the draft and returns the saved row", async () => {
    const saved = { id: "tpl-1", name: "registration-confirm", is_system: true };
    const fetchMock = stubFetch({ ok: true, json: async () => saved });

    await expect(saveEventSystemTemplate("evt-1", "registration-confirm", draft)).resolves.toEqual(saved);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt-1/system-templates/registration-confirm",
      expect.objectContaining({ method: "PUT", credentials: "same-origin", body: JSON.stringify(draft) }),
    );
  });

  it("previewEventSystemTemplate POSTs the draft to the preview of that name", async () => {
    const fetchMock = stubFetch({ ok: true, json: async () => ({ subject: "S", html: "<p></p>" }) });

    await expect(previewEventSystemTemplate("evt-1", "registration-waitlist", draft)).resolves.toEqual({
      subject: "S",
      html: "<p></p>",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt-1/system-templates/registration-waitlist/preview",
      expect.objectContaining({ method: "POST", body: JSON.stringify(draft) }),
    );
  });

  it("testSendEventSystemTemplate POSTs the address to the test send of that name", async () => {
    const fetchMock = stubFetch({ ok: true, json: async () => ({ status: "sent" }) });

    await expect(testSendEventSystemTemplate("evt-1", "registration-rejected", { to: "tester@example.com" })).resolves.toEqual({
      status: "sent",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt-1/system-templates/registration-rejected/test-send",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ to: "tester@example.com" }) }),
    );
  });

  it("turns the errors a save or a preview lists into a TemplateValidationError", async () => {
    stubFetch({
      ok: false,
      status: 400,
      json: async () => ({ error: "template_validation_failed", errors: ["Missing required placeholder: confirm_url"] }),
    });
    for (const call of [
      () => saveEventSystemTemplate("evt-1", "registration-confirm", draft),
      () => previewEventSystemTemplate("evt-1", "registration-confirm", draft),
    ]) {
      const error = await call().catch((err: unknown) => err);
      expect(error).toBeInstanceOf(TemplateValidationError);
      expect((error as TemplateValidationError).errors).toEqual(["Missing required placeholder: confirm_url"]);
    }
  });

  it("keeps the code of any other failure, for the one message the operator sees", async () => {
    stubFetch({ ok: false, status: 404, json: async () => ({ error: "not_found" }) });
    const error = await fetchEventSystemTemplate("evt-1", "registration-confirm").catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(404);
    expect((error as ApiError).code).toBe("not_found");

    const saveError = await saveEventSystemTemplate("evt-1", "registration-confirm", draft).catch((err: unknown) => err);
    expect(saveError).toBeInstanceOf(ApiError);
    expect((saveError as ApiError).code).toBe("not_found");
  });
});
