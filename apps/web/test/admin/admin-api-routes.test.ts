import { describe, expect, it, vi } from "vitest";
import { handleGetAdminEvent, pickFreeEventSlug } from "../../src/admin/admin-api-routes.js";

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

describe("pickFreeEventSlug", () => {
  const fakeDb = (taken: number) => {
    const asked: string[] = [];
    const findUnique = vi.fn(async ({ where }: { where: { slug: string } }) => {
      asked.push(where.slug);
      return asked.length <= taken ? { id: "evt" } : null;
    });
    return { asked, findUnique, db: { event: { findUnique } } as never };
  };

  it("returns the first random slug no event has", async () => {
    const { asked, db } = fakeDb(0);
    const slug = await pickFreeEventSlug(db);
    expect(slug).toMatch(/^[a-z2-7]{26}$/);
    expect(asked).toEqual([slug]);
  });

  it("draws again when the slug is taken", async () => {
    const { asked, db } = fakeDb(2);
    const slug = await pickFreeEventSlug(db);
    expect(asked).toHaveLength(3);
    expect(new Set(asked).size).toBe(3);
    expect(slug).toBe(asked[2]);
  });

  it("gives up after five taken draws", async () => {
    const { asked, db } = fakeDb(99);
    await expect(pickFreeEventSlug(db)).rejects.toThrow("event_slug_exhausted");
    expect(asked).toHaveLength(5);
  });
});
