// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  exportDeliveryLog,
  fetchEventDelivery,
  fetchEventDeliveries,
  fetchRenderedDelivery,
} from "../../src/api/client.js";

describe("fetchEventDeliveries (client) — query string building", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch() {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [], total: 0, page: 1, pageSize: 25 }),
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("omits the query string when no params are given", async () => {
    const fetchMock = stubFetch();

    await fetchEventDeliveries("evt-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt-1/deliveries",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("includes page/status/purpose when given", async () => {
    const fetchMock = stubFetch();

    await fetchEventDeliveries("evt-1", { page: 2, status: "failed", purpose: "ticket" });

    const [url] = fetchMock.mock.calls[0]!;
    // Filter params (status/purpose/search/templateId) are built by a helper shared with the CSV
    // export request, then page/pageSize are appended - hence filters preceding pagination here.
    expect(url).toBe("/api/admin/events/evt-1/deliveries?status=failed&purpose=ticket&page=2");
  });

  it("includes search and templateId, and omits templateId when it's \"all\"", async () => {
    const fetchMock = stubFetch();

    await fetchEventDeliveries("evt-1", { search: "guest", templateId: "tmpl-1" });
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/admin/events/evt-1/deliveries?search=guest&templateId=tmpl-1");

    await fetchEventDeliveries("evt-1", { templateId: "all" });
    expect(fetchMock.mock.calls[1]![0]).toBe("/api/admin/events/evt-1/deliveries");
  });
});

describe("fetchEventDelivery (client) — thin wrapper coverage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches the delivery-detail endpoint and returns the parsed DTO", async () => {
    const detail = { id: "dlv-1", attendee_id: "att-1", timeline: [] };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => detail });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchEventDelivery("evt-1", "dlv-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt-1/deliveries/dlv-1",
      expect.objectContaining({ credentials: "same-origin" }),
    );
    expect(result).toEqual(detail);
  });
});

describe("fetchRenderedDelivery (client) — thin wrapper coverage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches the /rendered endpoint and returns the redacted subject/html", async () => {
    const rendered = { subject: "Your ticket", html: "<p>Hi</p>" };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => rendered });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchRenderedDelivery("evt-1", "dlv-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt-1/deliveries/dlv-1/rendered",
      expect.objectContaining({ credentials: "same-origin" }),
    );
    expect(result).toEqual(rendered);
  });
});

describe("exportDeliveryLog (client) — thin wrapper coverage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubBlobDownload() {
    const createObjectURL = vi.fn(() => "blob:mock-delivery-export");
    const revokeObjectURL = vi.fn();
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    const anchorClicks: string[] = [];
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        anchorClicks.push(this.download);
      });

    return {
      createObjectURL,
      anchorClicks,
      restore: () => {
        clickSpy.mockRestore();
        URL.createObjectURL = originalCreate;
        URL.revokeObjectURL = originalRevoke;
      },
    };
  }

  it("builds the export URL from filters plus format=csv and triggers the download", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "Content-Disposition": 'attachment; filename="delivery-log.csv"' }),
      blob: async () => new Blob(["a,b\n1,2\n"], { type: "text/csv" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const stub = stubBlobDownload();

    try {
      await exportDeliveryLog("evt-1", { status: "failed", search: "guest" });

      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/admin/events/evt-1/deliveries/export?status=failed&search=guest&format=csv");
      expect(init).toMatchObject({ credentials: "same-origin" });
      expect(stub.createObjectURL).toHaveBeenCalledOnce();
      expect(stub.anchorClicks).toEqual(["delivery-log.csv"]);
    } finally {
      stub.restore();
    }
  });
});
