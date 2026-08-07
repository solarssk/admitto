// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { commitImport, fetchImportJobStatus } from "../../src/api/client.js";

describe("commitImport / fetchImportJobStatus (client)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs multipart commit and returns the 202 queue payload", async () => {
    const queued = { jobId: "job-1", status: "pending", importId: "imp-1" };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => queued,
    });
    vi.stubGlobal("fetch", fetchMock);

    const file = new File(["a,b\n1,2"], "attendees.csv", { type: "text/csv" });
    const result = await commitImport("evt with space", file, true);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt%20with%20space/import/commit",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: expect.any(FormData),
      }),
    );
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const fd = init.body as FormData;
    expect(fd.get("overwrite")).toBe("true");
    expect(result).toEqual(queued);
  });

  it("appends ?force=1 when force is set", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ jobId: "job-2", status: "pending", importId: "imp-2" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const file = new File(["a,b\n1,2"], "attendees.csv", { type: "text/csv" });
    await commitImport("evt-1", file, false, { force: true });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt-1/import/commit?force=1",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("propagates commit API errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      statusText: "Conflict",
      json: async () => ({
        error: "event full",
        code: "event_full",
        capacity: 10,
        current: 10,
        incoming: 2,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const file = new File(["a,b\n1,2"], "attendees.csv", { type: "text/csv" });
    await expect(commitImport("evt-1", file, false)).rejects.toMatchObject({
      status: 409,
      code: "event_full",
    });
  });

  it("GETs the encoded import job status endpoint", async () => {
    const status = {
      jobId: "job-1",
      status: "succeeded",
      importId: "imp-1",
      error: null,
      result: { importId: "imp-1", created: 1, updated: 0, skipped: [] },
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => status,
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchImportJobStatus("evt with space", "job with space");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt%20with%20space/import/jobs/job%20with%20space",
      expect.objectContaining({ credentials: "same-origin", signal: undefined }),
    );
    expect(result).toEqual(status);
  });

  it("forwards the abort signal on job status", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        jobId: "job-1",
        status: "pending",
        importId: "imp-1",
        error: null,
        result: null,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await fetchImportJobStatus("evt-1", "job-1", controller.signal);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt-1/import/jobs/job-1",
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it("propagates job status API errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      json: async () => ({ error: "not_found" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchImportJobStatus("evt-1", "missing")).rejects.toMatchObject({
      status: 404,
      message: "not_found",
    });
  });
});
