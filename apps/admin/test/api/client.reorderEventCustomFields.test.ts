// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, reorderEventCustomFields } from "../../src/api/client.js";

describe("reorderEventCustomFields (client)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const item = (id: string) => ({ id, source_field: id, label: id, show_on_form: true, display_order: 0 });

  it("PUTs the ids, in the order wanted, to the order endpoint and returns the fields in that order", async () => {
    const fetchMock = vi.fn(async (_input: string | URL, _init?: RequestInit) => ({
      ok: true,
      json: async () => ({ items: [item("b"), item("a")] }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const fields = await reorderEventCustomFields("evt-1", ["b", "a"]);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt-1/custom-fields/order",
      expect.objectContaining({ method: "PUT", credentials: "same-origin" }),
    );
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({ ids: ["b", "a"] });
    expect(fields.map((field) => field.id)).toEqual(["b", "a"]);
  });

  it("encodes the event id", async () => {
    const fetchMock = vi.fn(async (_input: string | URL, _init?: RequestInit) => ({ ok: true, json: async () => ({ items: [] }) }));
    vi.stubGlobal("fetch", fetchMock);

    await reorderEventCustomFields("evt one/2", []);

    expect(fetchMock.mock.calls[0]![0]).toBe("/api/admin/events/evt%20one%2F2/custom-fields/order");
  });

  it("fails with the status and the code of a list that is out of date", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string | URL, _init?: RequestInit) => ({
        ok: false,
        status: 409,
        statusText: "Conflict",
        json: async () => ({ error: "stale_write" }),
      })),
    );

    const failure = await reorderEventCustomFields("evt-1", ["a"]).catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ status: 409, code: "stale_write" });
  });
});
