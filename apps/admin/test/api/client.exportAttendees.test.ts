// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { exportAttendees, exportSelectedAttendees } from "../../src/api/client.js";

function stubBlobDownload() {
  const createObjectURL = vi.fn(() => "blob:mock-export");
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
    revokeObjectURL,
    anchorClicks,
    restore: () => {
      clickSpy.mockRestore();
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    },
  };
}

function csvResponse(filename: string) {
  return {
    ok: true,
    headers: new Headers({ "Content-Disposition": `attachment; filename="${filename}"` }),
    blob: async () => new Blob(["a,b\n1,2\n"], { type: "text/csv" }),
  };
}

describe("exportAttendees (client) — thin wrapper coverage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds the export URL from filter params and triggers the browser download", async () => {
    const fetchMock = vi.fn().mockResolvedValue(csvResponse("attendees-evt-1-2026-07-20.csv"));
    vi.stubGlobal("fetch", fetchMock);
    const stub = stubBlobDownload();

    try {
      await exportAttendees(
        "evt-1",
        { q: "vip", status: "admitted", ticket_type: "vip", rsvp_status: "confirmed" },
        "csv",
      );

      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe(
        "/api/admin/events/evt-1/attendees/export?format=csv&q=vip&status=admitted&ticket_type=vip&rsvp_status=confirmed",
      );
      expect(init).toMatchObject({ credentials: "same-origin" });
      expect(stub.createObjectURL).toHaveBeenCalledOnce();
      expect(stub.anchorClicks).toEqual(["attendees-evt-1-2026-07-20.csv"]);
      expect(stub.revokeObjectURL).toHaveBeenCalledWith("blob:mock-export");
    } finally {
      stub.restore();
    }
  });

  it("omits status=all and empty filters from the query string", async () => {
    const fetchMock = vi.fn().mockResolvedValue(csvResponse("attendees.csv"));
    vi.stubGlobal("fetch", fetchMock);
    const stub = stubBlobDownload();

    try {
      await exportAttendees("evt-1", { status: "all" }, "xlsx");
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/events/evt-1/attendees/export?format=xlsx",
        expect.anything(),
      );
    } finally {
      stub.restore();
    }
  });

  it("propagates a failed export as an ApiError instead of downloading anything", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: "export_too_large" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const stub = stubBlobDownload();

    try {
      await expect(exportAttendees("evt-1", {}, "csv")).rejects.toMatchObject({
        status: 400,
        message: "export_too_large",
      });
      expect(stub.createObjectURL).not.toHaveBeenCalled();
    } finally {
      stub.restore();
    }
  });
});

describe("exportSelectedAttendees (client) — thin wrapper coverage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs the selected ids and format as a JSON body, not a query string, and downloads the result", async () => {
    const fetchMock = vi.fn().mockResolvedValue(csvResponse("attendees-selected.csv"));
    vi.stubGlobal("fetch", fetchMock);
    const stub = stubBlobDownload();

    try {
      await exportSelectedAttendees("evt-1", ["att-1", "att-2"], "csv");

      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/admin/events/evt-1/attendees/export-selected");
      expect(init).toMatchObject({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({ attendee_ids: ["att-1", "att-2"], format: "csv" }),
      });
      expect(stub.anchorClicks).toEqual(["attendees-selected.csv"]);
    } finally {
      stub.restore();
    }
  });

  it("propagates a failed selection export as an ApiError", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: "validation_failed" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const stub = stubBlobDownload();

    try {
      await expect(exportSelectedAttendees("evt-1", [], "csv")).rejects.toMatchObject({
        status: 400,
        message: "validation_failed",
      });
    } finally {
      stub.restore();
    }
  });
});
