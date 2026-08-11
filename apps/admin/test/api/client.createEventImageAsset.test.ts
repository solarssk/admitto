// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEventImageAsset } from "../../src/api/client.js";

describe("createEventImageAsset (client)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs multipart form with file and display name (server builds the token)", async () => {
    const created = {
      id: "asset-1",
      token: "sponsor_logo",
      filename: "sponsor.png",
      url: "/uploads/default/events/evt-1/sponsor.png",
      size_bytes: 12,
      mime_type: "image/png",
      created_at: "2026-01-15T00:00:00.000Z",
    };
    const fetchMock = vi
      .fn(async (_input: string | URL, _init?: RequestInit) => ({
        ok: true,
        json: async () => created,
      }))
      .mockName("fetch");
    vi.stubGlobal("fetch", fetchMock);

    const file = new File(["x"], "sponsor.png", { type: "image/png" });
    await expect(createEventImageAsset("evt-1", file, "Sponsor logo")).resolves.toEqual(created);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt-1/image-assets",
      expect.objectContaining({ method: "POST", credentials: "same-origin" }),
    );
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const body = init.body as FormData;
    expect(body.get("name")).toBe("Sponsor logo");
    expect(body.get("file")).toBeInstanceOf(File);
    expect(body.get("token")).toBeNull();
  });
});
