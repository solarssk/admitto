import { describe, expect, it, vi } from "vitest";
import { handleGetAdminEvent } from "../../src/admin/admin-api-routes.js";

describe("handleGetAdminEvent", () => {
  it("returns event_not_found when called without an event route parameter", async () => {
    const json = vi.fn((body: unknown, status?: number) =>
      new Response(JSON.stringify(body), { status: status ?? 200 }),
    );
    const context = {
      get: vi.fn(() => ({ userId: "user-1" })),
      req: { param: vi.fn(() => undefined) },
      json,
    };

    const response = await handleGetAdminEvent(context as never, {} as never);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "event_not_found" });
    expect(json).toHaveBeenCalledWith({ error: "event_not_found" }, 404);
  });
});
