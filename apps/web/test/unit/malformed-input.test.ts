import { Prisma } from "@admitto/db/client";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { rejectNulInRequestTarget, requestRejectionForError } from "../../src/malformed-input.js";

function knownError(code: string, meta?: Record<string, unknown>): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("database said no", {
    code,
    clientVersion: "test",
    ...(meta ? { meta } : {}),
  });
}

describe("rejectNulInRequestTarget", () => {
  const app = new Hono();
  app.use("*", rejectNulInRequestTarget);
  app.get("/items/:id", (c) => c.json({ id: c.req.param("id"), q: c.req.query("q") ?? null }));

  it("answers 400 for a percent-encoded U+0000 in a path segment", async () => {
    const res = await app.request("/items/a%00b");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_request" });
  });

  it("answers 400 for it in a query value or a query name", async () => {
    for (const target of ["/items/a?q=x%00y", "/items/a?q=%00", "/items/a?x%00=1", "/items/a?q=x%00"]) {
      const res = await app.request(target);
      expect(res.status, target).toBe(400);
    }
  });

  it("lets everything else through, including an escaped percent sign followed by 00 and other control characters", async () => {
    for (const [target, id] of [
      ["/items/abc", "abc"],
      ["/items/a%2500b", "a%00b"],
      ["/items/a%0Ab", "a\nb"],
      ["/items/%E2%82%AC", "€"],
      ["/items/a%20b", "a b"],
    ] as const) {
      const res = await app.request(target);
      expect(res.status, target).toBe(200);
      expect(((await res.json()) as { id: string }).id).toBe(id);
    }
  });
});

describe("requestRejectionForError", () => {
  it("maps a record or parent that is not there to 404 not_found", () => {
    expect(requestRejectionForError(knownError("P2025"))).toEqual({ status: 404, error: "not_found" });
    expect(requestRejectionForError(knownError("P2003"))).toEqual({ status: 404, error: "not_found" });
  });

  it("maps a value the database refuses as malformed to 400 invalid_request", () => {
    const refused = knownError("P2039", {
      driverAdapterError: { cause: { originalCode: "22021", kind: "postgres" } },
    });
    expect(requestRejectionForError(refused)).toEqual({ status: 400, error: "invalid_request" });
  });

  it("leaves every other error to the 500 handler", () => {
    expect(requestRejectionForError(knownError("P2002"))).toBeNull();
    expect(
      requestRejectionForError(knownError("P2039", { driverAdapterError: { cause: { originalCode: "57014" } } })),
    ).toBeNull();
    expect(requestRejectionForError(new Error("P2025"))).toBeNull();
    expect(requestRejectionForError({ code: "P2025" })).toBeNull();
    expect(requestRejectionForError(null)).toBeNull();
  });
});
