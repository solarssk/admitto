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

function enqueueOk(jobId = "job-export-1") {
  return {
    ok: true,
    json: async () => ({ jobId }),
  };
}

function jobStatus(status: string, extras: { error?: string | null; filename?: string | null } = {}) {
  return {
    ok: true,
    json: async () => ({
      status,
      error: extras.error === undefined ? null : extras.error,
      filename: extras.filename === undefined ? null : extras.filename,
    }),
  };
}

function enqueueThenDownload(filename: string) {
  return vi
    .fn()
    .mockResolvedValueOnce(enqueueOk())
    .mockResolvedValueOnce(jobStatus("succeeded", { filename }))
    .mockResolvedValueOnce(csvResponse(filename));
}

describe("exportAttendees (client) — thin wrapper coverage", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("builds the export URL from filter params and triggers the browser download", async () => {
    const filename = "attendees-evt-1-2026-07-20.csv";
    const fetchMock = enqueueThenDownload(filename);
    vi.stubGlobal("fetch", fetchMock);
    const stub = stubBlobDownload();

    try {
      await exportAttendees(
        "evt-1",
        { q: "vip", status: "admitted", ticket_type: "vip", rsvp_status: "confirmed", mail_status: "sent" },
        "csv",
      );

      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe(
        "/api/admin/events/evt-1/attendees/export?format=csv&q=vip&status=admitted&ticket_type=vip&rsvp_status=confirmed&mail_status=sent",
      );
      expect(init).toMatchObject({ credentials: "same-origin" });
      expect(fetchMock.mock.calls[1]?.[0]).toBe(
        "/api/admin/events/evt-1/export/jobs/job-export-1",
      );
      expect(fetchMock.mock.calls[2]?.[0]).toBe(
        "/api/admin/events/evt-1/export/jobs/job-export-1/download",
      );
      expect(stub.createObjectURL).toHaveBeenCalledOnce();
      expect(stub.anchorClicks).toEqual([filename]);
      expect(stub.revokeObjectURL).toHaveBeenCalledWith("blob:mock-export");
    } finally {
      stub.restore();
    }
  });

  it("omits status=all and empty filters from the query string", async () => {
    const fetchMock = enqueueThenDownload("attendees.csv");
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
      statusText: "Bad Request",
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

  it("polls pending status then downloads when the job succeeds", async () => {
    vi.useFakeTimers();
    const filename = "attendees-evt-1.csv";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(enqueueOk("job-pending-1"))
      .mockResolvedValueOnce(jobStatus("pending"))
      .mockResolvedValueOnce(jobStatus("succeeded", { filename }))
      .mockResolvedValueOnce(csvResponse(filename));
    vi.stubGlobal("fetch", fetchMock);
    const stub = stubBlobDownload();

    try {
      const done = exportAttendees("evt-1", {}, "csv");
      await vi.advanceTimersByTimeAsync(2000);
      await done;

      expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
        "/api/admin/events/evt-1/attendees/export?format=csv",
        "/api/admin/events/evt-1/export/jobs/job-pending-1",
        "/api/admin/events/evt-1/export/jobs/job-pending-1",
        "/api/admin/events/evt-1/export/jobs/job-pending-1/download",
      ]);
      expect(stub.anchorClicks).toEqual([filename]);
    } finally {
      stub.restore();
    }
  });

  it("throws ApiError when the export job status is failed", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(enqueueOk())
      .mockResolvedValueOnce(jobStatus("failed", { error: "worker_boom" }));
    vi.stubGlobal("fetch", fetchMock);
    const stub = stubBlobDownload();

    try {
      await expect(exportAttendees("evt-1", {}, "csv")).rejects.toMatchObject({
        name: "ApiError",
        status: 500,
        message: "worker_boom",
      });
      expect(stub.createObjectURL).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      stub.restore();
    }
  });

  it("uses the default failed message when job error is null", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(enqueueOk())
      .mockResolvedValueOnce(jobStatus("failed", { error: null }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(exportAttendees("evt-1", {}, "csv")).rejects.toMatchObject({
      status: 500,
      message: "Export failed.",
    });
  });

  it("throws 504 after 90 pending polls", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(enqueueOk("job-slow"))
      .mockResolvedValue(jobStatus("pending"));
    vi.stubGlobal("fetch", fetchMock);

    const done = exportAttendees("evt-1", {}, "csv");
    const outcome = done.then(
      () => null,
      (err: unknown) => err,
    );
    await vi.runAllTimersAsync();
    const err = await outcome;

    expect(err).toMatchObject({
      name: "ApiError",
      status: 504,
      message: "Export is still running. Keep the worker running and try again.",
    });
    // enqueue + 90 status polls
    expect(fetchMock).toHaveBeenCalledTimes(91);
  });

  it("throws AbortError when the signal is already aborted before polling", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = vi.fn().mockResolvedValueOnce(enqueueOk());
    vi.stubGlobal("fetch", fetchMock);
    const stub = stubBlobDownload();

    try {
      await expect(exportAttendees("evt-1", {}, "csv", controller.signal)).rejects.toMatchObject({
        name: "AbortError",
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
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
