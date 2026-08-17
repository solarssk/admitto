import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/admin/admin-helpers.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/admin/admin-helpers.js")>();
  return {
    ...actual,
    adminAuditFromContext: vi.fn(),
    resolveClientTimezone: vi.fn(() => null),
  };
});

import { adminAuditFromContext } from "../../src/admin/admin-helpers.js";
import { enqueueWalletPushJob } from "../../src/admin/wallet-push-routes.js";

describe("enqueueWalletPushJob audit fields", () => {
  beforeEach(() => {
    vi.mocked(adminAuditFromContext).mockReset();
  });

  it("stores null actor_user_id and session_id when audit context omits them, matching handleExportAttendees's convention", async () => {
    vi.mocked(adminAuditFromContext).mockReturnValue({ ip: "127.0.0.1" });

    const create = vi.fn().mockResolvedValue({ id: "job-1" });
    const db = { adminJob: { create } };
    const c = { get: () => undefined };

    const jobId = await enqueueWalletPushJob(db as never, c as never, "evt-1", "org-1", ["att-1"]);

    expect(jobId).toBe("job-1");
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actor_user_id: null,
        session_id: null,
        client_timezone: null,
      }),
    });
  });
});
