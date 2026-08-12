import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/admin/admin-helpers.js", () => ({
  requireEventId: vi.fn(),
  assertEventManageAccess: vi.fn(),
}));

import { assertEventManageAccess, requireEventId } from "../../src/admin/admin-helpers.js";
import { loadEventAdminJob } from "../../src/admin/admin-job-http.js";

describe("loadEventAdminJob", () => {
  beforeEach(() => {
    vi.mocked(requireEventId).mockReset().mockReturnValue("evt-1");
    vi.mocked(assertEventManageAccess).mockReset().mockResolvedValue(null);
  });

  it("propagates requireEventId Response errors", async () => {
    const denied = new Response("bad event", { status: 400 });
    vi.mocked(requireEventId).mockReturnValue(denied);
    const res = await loadEventAdminJob({} as never, {} as never, "export");
    expect(res).toBe(denied);
  });

  it("propagates assertEventManageAccess Response errors", async () => {
    const forbidden = new Response("nope", { status: 403 });
    vi.mocked(assertEventManageAccess).mockResolvedValue(forbidden);
    const res = await loadEventAdminJob({ req: { param: () => "job-1" } } as never, {} as never, "export");
    expect(res).toBe(forbidden);
  });

  it("returns 400 when jobId is blank after trim", async () => {
    const c = {
      req: { param: () => "   " },
      json: (body: unknown, status?: number) =>
        new Response(JSON.stringify(body), { status: status ?? 200 }),
    };
    const db = { adminJob: { findFirst: vi.fn() } };
    const res = await loadEventAdminJob(c as never, db as never, "export");
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(400);
    expect(await (res as Response).json()).toEqual({ error: "jobId required" });
    expect(db.adminJob.findFirst).not.toHaveBeenCalled();
  });

  it("returns 404 when the job is missing", async () => {
    const c = {
      req: { param: () => "job-missing" },
      json: (body: unknown, status?: number) =>
        new Response(JSON.stringify(body), { status: status ?? 200 }),
    };
    const db = { adminJob: { findFirst: vi.fn().mockResolvedValue(null) } };
    const res = await loadEventAdminJob(c as never, db as never, "export");
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(404);
  });

  it("returns the event id and job when found", async () => {
    const job = { id: "job-1", status: "pending" };
    const c = { req: { param: () => "job-1" } };
    const db = { adminJob: { findFirst: vi.fn().mockResolvedValue(job) } };
    await expect(loadEventAdminJob(c as never, db as never, "export")).resolves.toEqual({
      eventId: "evt-1",
      job,
    });
  });
});
