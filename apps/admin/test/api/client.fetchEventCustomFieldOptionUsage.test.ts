// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchEventCustomFieldOptionUsage } from "../../src/api/client.js";

describe("fetchEventCustomFieldOptionUsage (client)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(counts: Record<string, number>) {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ counts }),
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("requests the field's usage endpoint and returns the counts map", async () => {
    const fetchMock = stubFetch({ M: 42, S: 3 });

    const counts = await fetchEventCustomFieldOptionUsage("evt-1", "field-shirt");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt-1/custom-fields/field-shirt/option-usage",
      expect.objectContaining({ credentials: "same-origin" }),
    );
    expect(counts).toEqual({ M: 42, S: 3 });
  });

  it("encodes eventId/fieldId and forwards the abort signal", async () => {
    const fetchMock = stubFetch({});
    const controller = new AbortController();

    await fetchEventCustomFieldOptionUsage("evt one", "field/two", controller.signal);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/admin/events/evt%20one/custom-fields/field%2Ftwo/option-usage");
    expect(init).toEqual(expect.objectContaining({ signal: controller.signal }));
  });
});
