// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { uploadThemeFont } from "../../src/api/client.js";

describe("uploadThemeFont (client) — thin wrapper coverage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs the multipart form data to the theme-font-upload endpoint", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ url: "/uploads/default/theme/abc123.woff2" }) });
    vi.stubGlobal("fetch", fetchMock);

    const formData = new FormData();
    const result = await uploadThemeFont(formData);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/theme-font-upload",
      expect.objectContaining({ method: "POST", credentials: "same-origin", body: formData }),
    );
    expect(result).toEqual({ url: "/uploads/default/theme/abc123.woff2" });
  });

  it("propagates the error message from a JSON error body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 413,
      statusText: "Payload Too Large",
      json: async () => ({ error: "file_too_large" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(uploadThemeFont(new FormData())).rejects.toMatchObject({ status: 413, message: "file_too_large" });
  });
});
