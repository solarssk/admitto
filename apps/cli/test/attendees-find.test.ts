import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@admitto/db";
import { CliError } from "../src/lib/args.js";
import { parseAttendeesFindArgs, runAttendeesFind } from "../src/commands/attendees-find.js";

type AttendeeRow = {
  id: string;
  event_id: string;
  event: { title: string };
  name: string;
  email: string;
  ticket_type: string | null;
};

const argv = (...args: string[]) => ["node", "admitto", "attendees", "find", ...args];
const SCOPED = ["--event", "evt-1", "--query", "acme"];

const row = (n: number, overrides: Partial<AttendeeRow> = {}): AttendeeRow => ({
  id: `att-${String(n).padStart(3, "0")}`,
  event_id: "evt-1",
  event: { title: "Acme Summit" },
  name: `Person ${String(n).padStart(3, "0")}`,
  email: `person.${n}@acme.example.com`,
  ticket_type: "vip",
  ...overrides,
});

/** An archived event unless told otherwise: the point of the command is that it does not matter. */
function fakeDb(options: { event?: { id: string; archived_at: Date | null } | null; attendees: AttendeeRow[] }) {
  const event = options.event === undefined ? { id: "evt-1", archived_at: new Date("2026-01-01T00:00:00Z") } : options.event;
  const db = {
    event: { findUnique: vi.fn(async (..._args: unknown[]) => event) },
    attendee: { findMany: vi.fn(async (..._args: unknown[]) => options.attendees) },
  };
  return { db: db as unknown as PrismaClient, raw: db };
}

describe("parseAttendeesFindArgs", () => {
  it("reads the query (trimmed), the event if there is one, and the format, which is a table unless asked otherwise", () => {
    expect(parseAttendeesFindArgs(argv("--query", "  jan kowal  "))).toEqual({
      eventId: undefined,
      query: "jan kowal",
      format: "table",
    });
    expect(parseAttendeesFindArgs(argv(...SCOPED, "--format", "json"))).toEqual({
      eventId: "evt-1",
      query: "acme",
      format: "json",
    });
  });

  it("asks for a query that is not blank, and for a format it knows", () => {
    expect(() => parseAttendeesFindArgs(argv("--event", "evt-1"))).toThrow(/Usage: admitto attendees find/);
    expect(() => parseAttendeesFindArgs(argv("--query", "   "))).toThrow(CliError);
    expect(() => parseAttendeesFindArgs(argv(...SCOPED, "--format", "xml"))).toThrow(/--format must be table or json/);
  });
});

describe("admitto attendees find", () => {
  let logged: string[];
  let errors: string[];

  beforeEach(() => {
    logged = [];
    errors = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => void logged.push(args.join(" ")));
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => void errors.push(args.join(" ")));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists the event, id, name, address and ticket type of the people it finds, in an archived event too", async () => {
    const { db } = fakeDb({ attendees: [row(1), row(2, { ticket_type: null })] });
    await runAttendeesFind(db, argv(...SCOPED));
    const cells = logged[0]!.split("\n").map((line) => line.trim().split(/\s{2,}/));
    expect(cells).toEqual([
      ["eventId", "event", "attendeeId", "name", "email", "ticketType"],
      ["evt-1", "Acme Summit", "att-001", "Person 001", "person.1@acme.example.com", "vip"],
      ["evt-1", "Acme Summit", "att-002", "Person 002", "person.2@acme.example.com"],
    ]);
    expect(errors).toEqual([]);
  });

  it("asks only for people of that event who are not erased, whose name or address contains the text, one more than it lists", async () => {
    const { db, raw } = fakeDb({ attendees: [row(1)] });
    await runAttendeesFind(db, argv("--event", "evt-1", "--query", " Acme "));
    expect(raw.event.findUnique).toHaveBeenCalledWith({ where: { id: "evt-1" }, select: { id: true } });
    expect(raw.attendee.findMany).toHaveBeenCalledWith({
      where: {
        event_id: "evt-1",
        erased_at: null,
        OR: [{ name: { contains: "Acme", mode: "insensitive" } }, { email: { contains: "Acme", mode: "insensitive" } }],
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: 21,
      select: { id: true, event_id: true, event: { select: { title: true } }, name: true, email: true, ticket_type: true },
    });
  });

  it("without an event looks in every event, so that a request naming only a person finds the event id too", async () => {
    const other = row(1, { id: "att-900", event_id: "evt-2", event: { title: "Beta Ltd Forum" } });
    const { db, raw } = fakeDb({ attendees: [row(1), other] });
    await runAttendeesFind(db, argv("--query", "acme", "--format", "json"));
    expect(raw.event.findUnique).not.toHaveBeenCalled();
    const where = (raw.attendee.findMany.mock.calls[0]![0] as { where: Record<string, unknown> }).where;
    expect(where).not.toHaveProperty("event_id");
    expect(where["erased_at"]).toBeNull();
    expect(JSON.parse(logged[0]!)).toEqual([
      { eventId: "evt-1", event: "Acme Summit", attendeeId: "att-001", name: "Person 001", email: "person.1@acme.example.com", ticketType: "vip" },
      { eventId: "evt-2", event: "Beta Ltd Forum", attendeeId: "att-900", name: "Person 001", email: "person.1@acme.example.com", ticketType: "vip" },
    ]);
  });

  it("prints JSON, and nothing else on stdout, with --format json", async () => {
    const { db } = fakeDb({ attendees: [row(1), row(2, { ticket_type: null })] });
    await runAttendeesFind(db, argv(...SCOPED, "--format", "json"));
    expect(logged).toHaveLength(1);
    expect(JSON.parse(logged[0]!)).toEqual([
      { eventId: "evt-1", event: "Acme Summit", attendeeId: "att-001", name: "Person 001", email: "person.1@acme.example.com", ticketType: "vip" },
      { eventId: "evt-1", event: "Acme Summit", attendeeId: "att-002", name: "Person 002", email: "person.2@acme.example.com", ticketType: "" },
    ]);
  });

  it("says, apart from the list, when nobody matches and that people who are erased are not listed", async () => {
    const { db } = fakeDb({ attendees: [] });
    await runAttendeesFind(db, argv(...SCOPED));
    expect(logged).toEqual(["(no rows)"]);
    expect(errors).toEqual(["No attendee of this event matches. People who are already erased are not listed."]);

    logged.length = 0;
    errors.length = 0;
    await runAttendeesFind(db, argv("--query", "acme", "--format", "json"));
    expect(JSON.parse(logged[0]!)).toEqual([]);
    expect(errors).toEqual(["No attendee matches. People who are already erased are not listed."]);
  });

  it("lists the first 20 and says so when there are more, but says nothing when there are exactly 20", async () => {
    const twenty = Array.from({ length: 20 }, (_, i) => row(i + 1));
    const exactly = fakeDb({ attendees: twenty });
    await runAttendeesFind(exactly.db, argv(...SCOPED));
    expect(logged[0]!.split("\n")).toHaveLength(21);
    expect(errors).toEqual([]);

    logged.length = 0;
    const more = fakeDb({ attendees: [...twenty, row(21)] });
    await runAttendeesFind(more.db, argv(...SCOPED, "--format", "json"));
    const listed = JSON.parse(logged[0]!) as { attendeeId: string }[];
    expect(listed).toHaveLength(20);
    expect(listed.at(-1)!.attendeeId).toBe("att-020");
    expect(errors).toEqual(["Only the first 20 matches are listed. Narrow the query, for example to the whole address."]);
  });

  it("says the event is not there, and looks for nobody", async () => {
    const { db, raw } = fakeDb({ event: null, attendees: [row(1)] });
    await expect(runAttendeesFind(db, argv(...SCOPED))).rejects.toThrow("Event not found.");
    expect(raw.attendee.findMany).not.toHaveBeenCalled();
    expect(logged).toEqual([]);
  });

  it("is a CliError the entry point prints, not a stack trace, without a query", async () => {
    const { db, raw } = fakeDb({ attendees: [] });
    await expect(runAttendeesFind(db, argv("--event", "evt-1"))).rejects.toBeInstanceOf(CliError);
    expect(raw.event.findUnique).not.toHaveBeenCalled();
    expect(raw.attendee.findMany).not.toHaveBeenCalled();
  });
});
