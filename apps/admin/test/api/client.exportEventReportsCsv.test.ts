// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  eventReportsPrintUrl,
  eventWalletReportsPrintUrl,
  exportEventReportsCsv,
  exportEventWalletReportsCsv,
} from "../../src/api/client.js";

// Only ever exercised indirectly before this file, through ReportsPage.live.test.tsx's fully
// mocked client module - the real fetch/blob/anchor-click body of exportEventReportsCsv,
// exportEventWalletReportsCsv, and the downloadExportBlob helper they share never actually ran in
// any test. Same stubBlobDownload pattern as exportDeliveryLog's own test
// (client.fetchEventDeliveries.test.ts), since both go through downloadExportResponse.
function stubBlobDownload() {
  const createObjectURL = vi.fn(() => "blob:mock-reports-export");
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

describe("exportEventReportsCsv (client)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches the admissions export URL and triggers the download", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "Content-Disposition": 'attachment; filename="admissions-evt-1.csv"' }),
      blob: async () => new Blob(["a,b\n1,2\n"], { type: "text/csv" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const stub = stubBlobDownload();
    const controller = new AbortController();

    try {
      await exportEventReportsCsv("evt-1", controller.signal);

      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/events/evt-1/reports/export?format=csv",
        expect.objectContaining({ credentials: "same-origin", signal: controller.signal }),
      );
      expect(stub.createObjectURL).toHaveBeenCalledOnce();
      expect(stub.anchorClicks).toEqual(["admissions-evt-1.csv"]);
    } finally {
      stub.restore();
    }
  });

  it("falls back to admissions.csv when the response has no Content-Disposition filename", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers(),
      blob: async () => new Blob(["a,b\n1,2\n"], { type: "text/csv" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const stub = stubBlobDownload();

    try {
      await exportEventReportsCsv("evt-1");
      expect(stub.anchorClicks).toEqual(["admissions.csv"]);
    } finally {
      stub.restore();
    }
  });

  it("throws ApiError when the endpoint rejects", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      json: async () => ({ error: "forbidden" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(exportEventReportsCsv("evt-1")).rejects.toBeInstanceOf(ApiError);
  });
});

describe("exportEventWalletReportsCsv (client)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches the wallets export URL (report=wallets) and triggers the download", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "Content-Disposition": 'attachment; filename="wallets-evt-1.csv"' }),
      blob: async () => new Blob(["a,b\n1,2\n"], { type: "text/csv" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const stub = stubBlobDownload();
    const controller = new AbortController();

    try {
      await exportEventWalletReportsCsv("evt-1", controller.signal);

      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/events/evt-1/reports/export?format=csv&report=wallets",
        expect.objectContaining({ credentials: "same-origin", signal: controller.signal }),
      );
      expect(stub.createObjectURL).toHaveBeenCalledOnce();
      expect(stub.anchorClicks).toEqual(["wallets-evt-1.csv"]);
    } finally {
      stub.restore();
    }
  });

  it("falls back to wallets.csv when the response has no Content-Disposition filename", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers(),
      blob: async () => new Blob(["a,b\n1,2\n"], { type: "text/csv" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const stub = stubBlobDownload();

    try {
      await exportEventWalletReportsCsv("evt-1");
      expect(stub.anchorClicks).toEqual(["wallets.csv"]);
    } finally {
      stub.restore();
    }
  });

  it("throws ApiError when the endpoint rejects", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: async () => ({ error: "server_error" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(exportEventWalletReportsCsv("evt-1")).rejects.toBeInstanceOf(ApiError);
  });
});

describe("eventReportsPrintUrl / eventWalletReportsPrintUrl (client)", () => {
  it("builds the admissions PDF print URL", () => {
    expect(eventReportsPrintUrl("evt-1")).toBe("/api/admin/events/evt-1/reports/export?format=pdf");
  });

  it("builds the wallets PDF print URL (report=wallets)", () => {
    expect(eventWalletReportsPrintUrl("evt-1")).toBe(
      "/api/admin/events/evt-1/reports/export?format=pdf&report=wallets",
    );
  });

  it("URL-encodes the event id in both print URLs", () => {
    expect(eventReportsPrintUrl("evt with spaces")).toBe(
      "/api/admin/events/evt%20with%20spaces/reports/export?format=pdf",
    );
    expect(eventWalletReportsPrintUrl("evt with spaces")).toBe(
      "/api/admin/events/evt%20with%20spaces/reports/export?format=pdf&report=wallets",
    );
  });
});
