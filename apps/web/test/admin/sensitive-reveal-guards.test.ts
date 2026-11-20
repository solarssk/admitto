/**
 * The guards of the two "Show" handlers (D-E6, 117b) that the real app never reaches: a route without its `:eventId` or its
 * `:id`, and a session that names no operator. The integration test (../integration/sensitive-reveal-routes.test.ts) drives the
 * routes as the app mounts them; here the helpers are faked so that each guard can be tried alone, and
 * `revealSensitiveAnswers` is a spy that must not be called when a guard refuses.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireEventId = vi.fn();
const assertEventManageAccess = vi.fn();
const requireAuditActor = vi.fn();
const requireManagedEventAttendee = vi.fn();
const revealSensitiveAnswers = vi.fn();

vi.mock("../../src/admin/admin-helpers.js", () => ({
  requireEventId: (...args: unknown[]) => requireEventId(...args),
  assertEventManageAccess: (...args: unknown[]) => assertEventManageAccess(...args),
  requireAuditActor: (...args: unknown[]) => requireAuditActor(...args),
}));
vi.mock("../../src/admin/attendees-api-routes.js", () => ({
  requireManagedEventAttendee: (...args: unknown[]) => requireManagedEventAttendee(...args),
}));
vi.mock("@admitto/tickets", () => ({
  revealSensitiveAnswers: (...args: unknown[]) => revealSensitiveAnswers(...args),
}));

import { handleRevealAttendeeAnswers, handleRevealRegistrationAnswers } from "../../src/admin/sensitive-reveal-routes.js";

const ACTOR = { operator: "admin@example.com", sessionId: "sess-1", ip: "127.0.0.1" };
const DB = {} as never;

function contextWith(params: Record<string, string | undefined>) {
  return {
    req: { param: (name: string) => params[name] },
    json: (body: unknown, status?: number) => new Response(JSON.stringify(body), { status: status ?? 200 }),
  } as never;
}

const refusal = (status: number) => new Response(JSON.stringify({ error: "refused" }), { status });
const REVEALED = { outcome: "revealed", answers: { guest: { allergy: "peanuts" }, companions: [] } };

beforeEach(() => {
  vi.resetAllMocks();
});

describe("handleRevealRegistrationAnswers", () => {
  it("returns the refusal of requireEventId and asks for nothing else", async () => {
    requireEventId.mockReturnValue(refusal(400));

    const res = await handleRevealRegistrationAnswers(contextWith({ id: "reg-1" }), DB);

    expect(res.status).toBe(400);
    expect(assertEventManageAccess).not.toHaveBeenCalled();
    expect(revealSensitiveAnswers).not.toHaveBeenCalled();
  });

  it("returns the refusal of the access check before it looks at the registration", async () => {
    requireEventId.mockReturnValue("evt-1");
    assertEventManageAccess.mockResolvedValue(refusal(403));

    const res = await handleRevealRegistrationAnswers(contextWith({ eventId: "evt-1", id: "reg-1" }), DB);

    expect(res.status).toBe(403);
    expect(requireAuditActor).not.toHaveBeenCalled();
    expect(revealSensitiveAnswers).not.toHaveBeenCalled();
  });

  it("answers 404 not_found for a route that has no :id, and reads nothing", async () => {
    requireEventId.mockReturnValue("evt-1");
    assertEventManageAccess.mockResolvedValue(null);

    const res = await handleRevealRegistrationAnswers(contextWith({ eventId: "evt-1" }), DB);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
    expect(revealSensitiveAnswers).not.toHaveBeenCalled();
  });

  it("returns the refusal of requireAuditActor (a session that names no operator) and reads nothing", async () => {
    requireEventId.mockReturnValue("evt-1");
    assertEventManageAccess.mockResolvedValue(null);
    requireAuditActor.mockReturnValue(refusal(401));

    const res = await handleRevealRegistrationAnswers(contextWith({ eventId: "evt-1", id: "reg-1" }), DB);

    expect(res.status).toBe(401);
    expect(revealSensitiveAnswers).not.toHaveBeenCalled();
  });

  it("hands the event, the registration and the actor to the reveal, and answers with what it returns", async () => {
    requireEventId.mockReturnValue("evt-1");
    assertEventManageAccess.mockResolvedValue(null);
    requireAuditActor.mockReturnValue(ACTOR);
    revealSensitiveAnswers.mockResolvedValue(REVEALED);

    const res = await handleRevealRegistrationAnswers(contextWith({ eventId: "evt-1", id: "reg-1" }), DB);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(REVEALED.answers);
    expect(revealSensitiveAnswers).toHaveBeenCalledWith(DB, {
      eventId: "evt-1",
      subject: { kind: "registration", id: "reg-1" },
      actor: ACTOR,
    });
  });
});

describe("handleRevealAttendeeAnswers", () => {
  it("returns the refusal of requireManagedEventAttendee and reads nothing", async () => {
    requireManagedEventAttendee.mockResolvedValue(refusal(403));

    const res = await handleRevealAttendeeAnswers(contextWith({}), DB);

    expect(res.status).toBe(403);
    expect(requireAuditActor).not.toHaveBeenCalled();
    expect(revealSensitiveAnswers).not.toHaveBeenCalled();
  });

  it("returns the refusal of requireAuditActor (a session that names no operator) and reads nothing", async () => {
    requireManagedEventAttendee.mockResolvedValue({ eventId: "evt-1", attendeeId: "att-1" });
    requireAuditActor.mockReturnValue(refusal(401));

    const res = await handleRevealAttendeeAnswers(contextWith({}), DB);

    expect(res.status).toBe(401);
    expect(revealSensitiveAnswers).not.toHaveBeenCalled();
  });

  it("hands the event, the attendee and the actor to the reveal, and answers with what it returns", async () => {
    requireManagedEventAttendee.mockResolvedValue({ eventId: "evt-1", attendeeId: "att-1" });
    requireAuditActor.mockReturnValue(ACTOR);
    revealSensitiveAnswers.mockResolvedValue(REVEALED);

    const res = await handleRevealAttendeeAnswers(contextWith({}), DB);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(REVEALED.answers);
    expect(revealSensitiveAnswers).toHaveBeenCalledWith(DB, {
      eventId: "evt-1",
      subject: { kind: "attendee", id: "att-1" },
      actor: ACTOR,
    });
  });

  it.each([
    ["attendee_gone", 409, { error: "attendee_erased" }],
    ["not_found", 404, { error: "not_found" }],
  ] as const)("answers a reveal that came to nothing (%s) with %i", async (outcome, status, body) => {
    requireManagedEventAttendee.mockResolvedValue({ eventId: "evt-1", attendeeId: "att-1" });
    requireAuditActor.mockReturnValue(ACTOR);
    revealSensitiveAnswers.mockResolvedValue({ outcome });

    const res = await handleRevealAttendeeAnswers(contextWith({}), DB);

    expect(res.status).toBe(status);
    expect(await res.json()).toEqual(body);
  });
});
