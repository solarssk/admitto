// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { updateEventImageAsset } from "../../src/api/client.js";

describe("updateEventImageAsset (client)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("PATCHes multipart form with the re-cropped file and crop framing", async () => {
    const updated = {
      id: "asset-1",
      token: "sponsor_logo",
      filename: "sponsor.png",
      url: "/uploads/default/events/evt-1/sponsor-v2.png",
      original_url: "/uploads/default/events/evt-1/sponsor-original.png",
      crop: { unit: "%", x: 4, y: 4, width: 92, height: 92, zoom: 1 },
      size_bytes: 34,
      mime_type: "image/png",
      created_at: "2026-01-15T00:00:00.000Z",
    };
    const fetchMock = vi
      .fn(async (_input: string | URL, _init?: RequestInit) => ({
        ok: true,
        json: async () => updated,
      }))
      .mockName("fetch");
    vi.stubGlobal("fetch", fetchMock);

    const file = new File(["x"], "sponsor.png", { type: "image/png" });
    await expect(
      updateEventImageAsset("evt-1", "asset-1", file, {
        unit: "%",
        x: 4,
        y: 4,
        width: 92,
        height: 92,
        zoom: 1,
      }),
    ).resolves.toEqual(updated);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt-1/image-assets/asset-1",
      expect.objectContaining({ method: "PATCH", credentials: "same-origin" }),
    );
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const body = init.body as FormData;
    expect(body.get("file")).toBeInstanceOf(File);
    expect(body.get("crop")).toBe(
      JSON.stringify({ unit: "%", x: 4, y: 4, width: 92, height: 92, zoom: 1 }),
    );
    expect(body.get("original_url")).toBeNull();
    expect(body.get("name")).toBeNull();
  });
});
