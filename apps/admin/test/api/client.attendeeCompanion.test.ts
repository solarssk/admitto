// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, removeAttendeeCompanion, updateAttendeeCompanion } from "../../src/api/client.js";

describe("the companion of an attendee (client)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("PATCHes the whole companion to the encoded address of the attendee, and returns the attendee as the server has it", async () => {
    const detail = { id: "att with space", companion: { slot: 1, name: "Anna Companion", custom_data: { diet: "Veg" } } };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => detail });
    vi.stubGlobal("fetch", fetchMock);

    await expect(updateAttendeeCompanion("evt with space", "att with space", { name: "Anna Companion", custom_data: { diet: "Veg" } })).resolves.toEqual(detail);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/admin/events/evt%20with%20space/attendees/att%20with%20space/companion");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ name: "Anna Companion", custom_data: { diet: "Veg" } });
  });

  it("DELETEs the companion at the same address, with no body", async () => {
    const detail = { id: "att-1", companion: null };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => detail });
    vi.stubGlobal("fetch", fetchMock);

    await expect(removeAttendeeCompanion("evt-1", "att-1")).resolves.toEqual(detail);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/admin/events/evt-1/attendees/att-1/companion");
    expect(init.method).toBe("DELETE");
    expect(init.body).toBeUndefined();
  });

  it.each([
    ["update", () => updateAttendeeCompanion("evt-1", "att-1", { name: "Anna" })],
    ["removal", () => removeAttendeeCompanion("evt-1", "att-1")],
  ])("turns a refusal of the server into an ApiError that carries its code (%s)", async (_name, call) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: "attendee_erased" }), headers: new Headers() }),
    );

    const error = await call().catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(409);
    expect((error as ApiError).code).toBe("attendee_erased");
  });
});
