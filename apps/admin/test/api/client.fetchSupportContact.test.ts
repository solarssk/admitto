// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, fetchSupportContact, patchSupportContact } from "../../src/api/client.js";

describe("fetchSupportContact / patchSupportContact (client)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetchSupportContact requests the support-contact endpoint and returns the parsed body", async () => {
    const body = { support_contact_name: "Acme Events", support_contact_email: "support@acme.example.com" };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => body });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchSupportContact();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/setup/support-contact",
      expect.objectContaining({ credentials: "same-origin" }),
    );
    expect(result).toEqual(body);
  });

  it("patchSupportContact PATCHes the given fields and returns the parsed body", async () => {
    const body = { support_contact_name: "Acme Events", support_contact_email: null };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => body });
    vi.stubGlobal("fetch", fetchMock);

    const result = await patchSupportContact({ support_contact_name: "Acme Events" });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/admin/setup/support-contact");
    expect(init).toMatchObject({ method: "PATCH", body: JSON.stringify({ support_contact_name: "Acme Events" }) });
    expect(result).toEqual(body);
  });

  it("throws an ApiError when the server rejects the patch", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      json: async () => ({ error: "validation_error" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(patchSupportContact({ support_contact_email: "not-an-email" })).rejects.toBeInstanceOf(ApiError);
  });
});
