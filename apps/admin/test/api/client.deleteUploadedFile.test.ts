// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteUploadedFile } from "../../src/api/client.js";

describe("deleteUploadedFile (client)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("no-ops for non-/uploads URLs without calling fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await deleteUploadedFile("https://cdn.example.com/logo.png");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("DELETEs managed /uploads URLs", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await deleteUploadedFile("/uploads/default/a1b2c3d4-e5f6-7890-abcd-ef1234567890.png");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/uploads",
      expect.objectContaining({
        method: "DELETE",
        credentials: "same-origin",
        body: JSON.stringify({
          url: "/uploads/default/a1b2c3d4-e5f6-7890-abcd-ef1234567890.png",
        }),
      }),
    );
  });

  it("swallows fetch failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("network down")),
    );
    await expect(
      deleteUploadedFile("/uploads/default/a1b2c3d4-e5f6-7890-abcd-ef1234567890.png"),
    ).resolves.toBeUndefined();
  });
});
