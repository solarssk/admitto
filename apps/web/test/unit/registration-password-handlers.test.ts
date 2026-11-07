import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@admitto/db";
import { handleDeleteRegistrationPassword, handlePutRegistrationPassword } from "../../src/admin/registration-password-routes.js";

/**
 * The two guards at the head of each handler of the event password: an event id the route did not carry (400), and a
 * session that names no user (401). The routes of the app never get there (the path has its parameter, and the staff gate
 * runs first), so they are tried on a bare router. Neither guard touches the database, which is why a stub stands in for it.
 */
const db = {} as PrismaClient;
const send = { password: "a long enough password" };

type Handler = typeof handlePutRegistrationPassword;

/** A router with the handler on a path that has no event id. */
function withoutEventId(method: "put" | "delete", handler: Handler): Hono {
  const app = new Hono();
  app[method]("/password", (c) => handler(c, db));
  return app;
}

/** A router with the handler on the real path, behind a session that names no user. */
function withoutUser(method: "put" | "delete", handler: Handler): Hono {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("auth", { userId: "", sessionId: "session-1" });
    await next();
  });
  app[method]("/events/:eventId/password", (c) => handler(c, db));
  return app;
}

const request = (method: "PUT" | "DELETE", path: string) =>
  new Request(`http://localhost${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(method === "PUT" ? { body: JSON.stringify(send) } : {}),
  });

describe("the handlers of the event password", () => {
  it.each([
    ["put", "PUT", handlePutRegistrationPassword],
    ["delete", "DELETE", handleDeleteRegistrationPassword],
  ] as const)("turn a %s request that names no event away with a 400", async (method, verb, handler) => {
    const res = await withoutEventId(method, handler).request(request(verb, "/password"));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "eventId required" });
  });

  it.each([
    ["put", "PUT", handlePutRegistrationPassword],
    ["delete", "DELETE", handleDeleteRegistrationPassword],
  ] as const)("turn a %s request of a session that names no user away with a 401", async (method, verb, handler) => {
    const res = await withoutUser(method, handler).request(request(verb, "/events/evt-1/password"));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });
});
