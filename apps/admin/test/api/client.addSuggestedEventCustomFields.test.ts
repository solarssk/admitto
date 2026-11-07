// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, addSuggestedEventCustomFields } from "../../src/api/client.js";

describe("addSuggestedEventCustomFields (client)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs an empty object to the suggested endpoint of the event, with the same-origin proof, and returns what the server added", async () => {
    const answer = { added: ["parking", "travel"], skipped: [{ source_field: "arrival", reason: "exists" }] };
    const fetchMock = vi.fn(async (_input: string | URL, _init?: RequestInit) => ({ ok: true, json: async () => answer }));
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await addSuggestedEventCustomFields("evt-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt-1/custom-fields/suggested",
      expect.objectContaining({ method: "POST", credentials: "same-origin" }),
    );
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({});
    expect(init.headers).toMatchObject({ "Content-Type": "application/json", Origin: window.location.origin });
    expect(outcome).toEqual(answer);
  });

  it("encodes the event id", async () => {
    const fetchMock = vi.fn(async (_input: string | URL, _init?: RequestInit) => ({ ok: true, json: async () => ({ added: [], skipped: [] }) }));
    vi.stubGlobal("fetch", fetchMock);

    await addSuggestedEventCustomFields("evt one/2");

    expect(fetchMock.mock.calls[0]![0]).toBe("/api/admin/events/evt%20one%2F2/custom-fields/suggested");
  });

  it("fails with the status and the code of a refusal at the field limit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string | URL, _init?: RequestInit) => ({
        ok: false,
        status: 422,
        statusText: "Unprocessable Entity",
        json: async () => ({ error: "field_limit_reached", limit: 20, free: 2, needed: 5 }),
      })),
    );

    const failure = await addSuggestedEventCustomFields("evt-1").catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ status: 422, code: "field_limit_reached" });
  });
});
