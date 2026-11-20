import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@admitto/db";
import {
  handleGetEventRegistrationSettings,
  handlePutEventRegistrationSettings,
} from "../../src/admin/event-registration-settings-routes.js";

/**
 * The guards at the head of each handler of the registration settings: an event id the route did not carry (400), and, for
 * the write, a session that names no user (401). The routes of the app never get there (the path has its parameter, and the
 * staff gate runs first), so they are tried on a bare router. Neither guard touches the database, which is why a stub stands
 * in for it: a handler that reached it would throw on the first query.
 */
const db = {} as PrismaClient;

type Handler = typeof handleGetEventRegistrationSettings;

/** A router with the handler on a path that has no event id. */
function withoutEventId(method: "get" | "put", handler: Handler): Hono {
  const app = new Hono();
  app[method]("/settings", (c) => handler(c, db));
  return app;
}

/** A router with the handler on the real path, behind a session that names no user. */
function withoutUser(handler: Handler): Hono {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("auth", { userId: "", sessionId: "session-1" });
    await next();
  });
  app.put("/events/:eventId/settings", (c) => handler(c, db));
  return app;
}

const send = (method: "GET" | "PUT", path: string) =>
  new Request(`http://localhost${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(method === "PUT" ? { body: JSON.stringify({ waitlist_enabled: false }) } : {}),
  });

describe("the handlers of the registration settings", () => {
  it.each([
    ["get", "GET", handleGetEventRegistrationSettings],
    ["put", "PUT", handlePutEventRegistrationSettings],
  ] as const)("turn a %s request that names no event away with a 400", async (method, verb, handler) => {
    const res = await withoutEventId(method, handler).request(send(verb, "/settings"));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "eventId required" });
  });

  it("turns a write of a session that names no user away with a 401", async () => {
    const res = await withoutUser(handlePutEventRegistrationSettings).request(send("PUT", "/events/evt-1/settings"));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });
});
