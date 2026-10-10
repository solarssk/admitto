import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@admitto/db";
import type { WalletPassProvider } from "@admitto/wallet";
import { CliError } from "../src/lib/args.js";
import type { AttendeesEraseDeps } from "../src/commands/attendees-erase.js";

const eraseAttendees = vi.fn();
const scrubImportJobResults = vi.fn(async (..._args: unknown[]) => undefined);
const writeBulkActionLog = vi.fn(async (..._args: unknown[]) => undefined);
const writeAdminAuditLog = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock("@admitto/tickets", async (importActual) => ({
  ...(await importActual<typeof import("@admitto/tickets")>()),
  eraseAttendees,
  scrubImportJobResults,
  writeBulkActionLog,
  writeAdminAuditLog,
}));
const requireOperatorUserId = vi.fn(async (..._args: unknown[]) => "user-1");
vi.mock("../src/lib/audit.js", () => ({ requireOperatorUserId }));
const confirmYes = vi.fn(async (_prompt: string) => true);
vi.mock("../src/lib/confirm.js", () => ({ confirmYes }));
const purgeEventJobFiles = vi.fn(async (..._args: unknown[]) => ({ deleted: 0, failed: 0 }));
vi.mock("@admitto/storage", () => ({ getDefaultStorage: () => ({ name: "storage" }), purgeEventJobFiles }));

const { parseAttendeesEraseArgs, runAttendeesErase } = await import("../src/commands/attendees-erase.js");

const EVENT = {
  organization_id: "org-1",
  title: "Acme Summit",
  wallet_template_id: "tmpl-1",
  wallet_api_key_enc: "enc-1",
  wallet_field_mapping: null,
};
const COUNTS = { notes: 1, actionLogs: 2, emailDeliveries: 3, checkIns: 0, walletPasses: 1 };
const provider = { name: "provider" } as unknown as WalletPassProvider;

type AttendeeRow = { id: string; erased_at: Date | null };
type PassRow = { attendee_id: string; pending: boolean };

const argv = (...args: string[]) => ["node", "admitto", "attendees", "erase", ...args];
const BASE = ["--event", "evt-1", "--operator-email", "super@example.com"];

function fakeDb(options: { event?: typeof EVENT | null; attendees: AttendeeRow[]; passes?: PassRow[] }) {
  const passes = options.passes ?? [];
  const db = {
    event: { findUnique: vi.fn(async () => (options.event === undefined ? EVENT : options.event)) },
    attendee: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        options.attendees.filter((attendee) => where.id.in.includes(attendee.id)),
      ),
    },
    walletPass: {
      findMany: vi.fn(async ({ where }: { where: { attendee_id: { in: string[] } } }) =>
        passes.filter((pass) => pass.pending && where.attendee_id.in.includes(pass.attendee_id)).map((pass) => ({ attendee_id: pass.attendee_id })),
      ),
    },
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>, _options?: unknown) => callback(db)),
  };
  return { db: db as unknown as PrismaClient, raw: db, passes };
}

const erasedResult = (erasedIds: string[], alreadyErasedIds: string[] = [], notFoundIds: string[] = []) => ({
  erasedIds,
  alreadyErasedIds,
  notFoundIds,
  counts: COUNTS,
  walletTargets: [],
  jobIdsWithFiles: ["job-1", "job-2"],
  previousEmails: ["person@example.com"],
});

describe("parseAttendeesEraseArgs", () => {
  it("reads the event, the ids (trimmed, once each) and the flags", () => {
    expect(parseAttendeesEraseArgs(argv("--event", "evt-1", "--attendee-ids", " a, b ,a,,c", "--dry-run", "-y"))).toEqual({
      eventId: "evt-1",
      attendeeIds: ["a", "b", "c"],
      dryRun: true,
      yes: true,
    });
    expect(parseAttendeesEraseArgs(argv("--event", "evt-1", "--attendee-ids", "a"))).toMatchObject({ dryRun: false, yes: false });
  });

  it("asks for an event and at least one id", () => {
    expect(() => parseAttendeesEraseArgs(argv("--attendee-ids", "a"))).toThrow(/Usage: admitto attendees erase/);
    expect(() => parseAttendeesEraseArgs(argv("--event", "evt-1"))).toThrow(/Usage: admitto attendees erase/);
    expect(() => parseAttendeesEraseArgs(argv("--event", "evt-1", "--attendee-ids", " , ,"))).toThrow(/Usage: admitto attendees erase/);
  });

  it("refuses more ids than the bulk API takes, and an id that cannot be one", () => {
    const many = Array.from({ length: 501 }, (_, i) => `a${i}`).join(",");
    expect(() => parseAttendeesEraseArgs(argv("--event", "evt-1", "--attendee-ids", many))).toThrow("At most 500 attendees at a time.");
    expect(parseAttendeesEraseArgs(argv("--event", "evt-1", "--attendee-ids", many.split(",").slice(0, 500).join(","))).attendeeIds).toHaveLength(500);
    expect(() => parseAttendeesEraseArgs(argv("--event", "evt-1", "--attendee-ids", "x".repeat(129)))).toThrow("An attendee id is too long.");
    expect(parseAttendeesEraseArgs(argv("--event", "evt-1", "--attendee-ids", "x".repeat(128))).attendeeIds).toHaveLength(1);
  });
});

describe("admitto attendees erase", () => {
  let log: ReturnType<typeof vi.spyOn>;
  let errorLog: ReturnType<typeof vi.spyOn>;
  let deps: AttendeesEraseDeps;
  let deletePasses: ReturnType<typeof vi.fn>;
  let resolveProvider: ReturnType<typeof vi.fn>;
  let purgeJobFiles: ReturnType<typeof vi.fn>;
  let confirm: ReturnType<typeof vi.fn>;

  const output = () => log.mock.calls.map((call) => String(call[0])).join("\n");

  beforeEach(() => {
    log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (const mock of [eraseAttendees, scrubImportJobResults, writeBulkActionLog, writeAdminAuditLog, requireOperatorUserId, confirmYes, purgeEventJobFiles]) {
      mock.mockClear();
    }
    confirm = vi.fn(async (_prompt: string) => true);
    purgeJobFiles = vi.fn(async (..._args: unknown[]) => ({ deleted: 2, failed: 0 }));
    resolveProvider = vi.fn(() => provider);
    deletePasses = vi.fn(async () => ({ deleted: 0, failedAttendeeIds: [], failureCodes: [], notTried: 0 }));
    deps = {
      confirm: confirm as unknown as AttendeesEraseDeps["confirm"],
      purgeJobFiles: purgeJobFiles as unknown as AttendeesEraseDeps["purgeJobFiles"],
      resolveProvider: resolveProvider as unknown as AttendeesEraseDeps["resolveProvider"],
      deletePasses: deletePasses as unknown as AttendeesEraseDeps["deletePasses"],
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("says the event is not there", async () => {
    const { db } = fakeDb({ event: null, attendees: [] });

    await expect(runAttendeesErase(db, deps, argv(...BASE, "--attendee-ids", "att-1"))).rejects.toThrow("Event not found.");
  });

  it("fails, with the counts printed, when none of the ids is an attendee of the event", async () => {
    const { db, raw } = fakeDb({ attendees: [] });

    await expect(runAttendeesErase(db, deps, argv(...BASE, "--attendee-ids", "att-1,att-2"))).rejects.toThrow(
      "None of the given ids is an attendee of this event.",
    );
    expect(output()).toContain('Event "Acme Summit": 0 to erase, 0 already erased, 2 not found.');
    expect(raw.$transaction).not.toHaveBeenCalled();
  });

  it("only says what it would do with --dry-run, needs no operator and changes nothing", async () => {
    const { db, raw } = fakeDb({ attendees: [{ id: "att-1", erased_at: null }, { id: "att-2", erased_at: new Date() }] });

    await runAttendeesErase(db, deps, ["node", "admitto", "attendees", "erase", "--event", "evt-1", "--attendee-ids", "att-1,att-2,att-3", "--dry-run"]);

    expect(output()).toContain('Event "Acme Summit": 1 to erase, 1 already erased, 1 not found.');
    expect(output()).toContain("Dry run: nothing was changed.");
    expect(requireOperatorUserId).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    expect(raw.$transaction).not.toHaveBeenCalled();
    expect(eraseAttendees).not.toHaveBeenCalled();
  });

  it("erases one attendee after the operator confirms, and writes the same entries the API does, with source cli", async () => {
    const { db, raw } = fakeDb({ attendees: [{ id: "att-1", erased_at: null }] });
    eraseAttendees.mockResolvedValueOnce(erasedResult(["att-1"]));

    await runAttendeesErase(db, deps, argv(...BASE, "--attendee-ids", "att-1"));

    expect(requireOperatorUserId).toHaveBeenCalledWith(db, argv(...BASE, "--attendee-ids", "att-1"));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Erase the personal data of 1 attendee(s)? This cannot be undone."));
    expect(raw.$transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 60_000 });
    expect(eraseAttendees).toHaveBeenCalledWith(raw, { eventId: "evt-1", attendeeIds: ["att-1"] });
    expect(scrubImportJobResults).toHaveBeenCalledWith(raw, "evt-1", ["person@example.com"]);
    expect(writeBulkActionLog).toHaveBeenCalledWith(raw, {
      event_id: "evt-1",
      action_type: "attendee_erased",
      audit: { operator: "user-1", ip: "127.0.0.1" },
      metadata: { attendee_id: "att-1", method: "erase", source: "cli", removed: COUNTS },
    });
    expect(writeAdminAuditLog).toHaveBeenCalledWith(raw, {
      organizationId: "org-1",
      actorUserId: "user-1",
      ip: "127.0.0.1",
      actionType: "attendee_erased",
      metadata: { event_id: "evt-1", event_title: "Acme Summit", attendee_id: "att-1", method: "erase", source: "cli" },
    });
    expect(purgeJobFiles).toHaveBeenCalledWith(db, "evt-1", ["job-1", "job-2"]);
    // Nobody has a pass at the provider, so the provider is not called, and nothing is said about credentials.
    expect(deletePasses).not.toHaveBeenCalled();
    expect(errorLog).not.toHaveBeenCalled();
    expect(output()).toContain("Erased 1, already erased 0, not found 0. Export and import files deleted: 2. Wallet passes deleted at the provider: 0.");
  });

  it("never puts an address or a name in an audit entry or in what it prints", async () => {
    const { db } = fakeDb({ attendees: [{ id: "att-1", erased_at: null }] });
    eraseAttendees.mockResolvedValueOnce(erasedResult(["att-1"]));

    await runAttendeesErase(db, deps, argv(...BASE, "--attendee-ids", "att-1"));

    const written = JSON.stringify([writeBulkActionLog.mock.calls, writeAdminAuditLog.mock.calls, log.mock.calls, errorLog.mock.calls]);
    expect(written).not.toContain("person@example.com");
  });

  it("records a selection as one bulk entry with the ids and the count", async () => {
    const { db, raw } = fakeDb({
      attendees: [
        { id: "att-1", erased_at: null },
        { id: "att-2", erased_at: null },
      ],
    });
    eraseAttendees.mockResolvedValueOnce(erasedResult(["att-1", "att-2"]));

    await runAttendeesErase(db, deps, argv(...BASE, "--attendee-ids", "att-1,att-2", "--yes"));

    expect(writeBulkActionLog).toHaveBeenCalledWith(
      raw,
      expect.objectContaining({
        action_type: "attendees_bulk_erased",
        metadata: { attendee_ids: ["att-1", "att-2"], count: 2, method: "erase", source: "cli", removed: COUNTS },
      }),
    );
    expect(writeAdminAuditLog).toHaveBeenCalledWith(
      raw,
      expect.objectContaining({
        actionType: "attendees_bulk_erased",
        metadata: { event_id: "evt-1", event_title: "Acme Summit", attendee_ids: ["att-1", "att-2"], count: 2, method: "erase", source: "cli" },
      }),
    );
  });

  it("asks nothing with --yes, and changes nothing when the operator says no", async () => {
    const yes = fakeDb({ attendees: [{ id: "att-1", erased_at: null }] });
    eraseAttendees.mockResolvedValueOnce(erasedResult(["att-1"]));
    await runAttendeesErase(yes.db, deps, argv(...BASE, "--attendee-ids", "att-1", "-y"));
    expect(confirm).not.toHaveBeenCalled();
    expect(yes.raw.$transaction).toHaveBeenCalledTimes(1);

    const no = fakeDb({ attendees: [{ id: "att-1", erased_at: null }] });
    confirm.mockResolvedValueOnce(false);
    await expect(runAttendeesErase(no.db, deps, argv(...BASE, "--attendee-ids", "att-1"))).rejects.toThrow("Aborted: nothing was changed.");
    expect(no.raw.$transaction).not.toHaveBeenCalled();
    expect(purgeJobFiles).toHaveBeenCalledTimes(1);
  });

  it("only tries the wallet passes again for people who are already erased: no prompt, no audit entry, no export purge", async () => {
    const { db, passes } = fakeDb({
      attendees: [{ id: "att-1", erased_at: new Date() }],
      passes: [{ attendee_id: "att-1", pending: true }],
    });
    eraseAttendees.mockResolvedValueOnce(erasedResult([], ["att-1"]));
    deletePasses.mockImplementationOnce(async (_db: unknown, _event: string, ids: string[]) => {
      for (const pass of passes) if (ids.includes(pass.attendee_id)) pass.pending = false;
      return { deleted: ids.length, failedAttendeeIds: [], failureCodes: [], notTried: 0 };
    });

    await runAttendeesErase(db, deps, argv(...BASE, "--attendee-ids", "att-1"));

    expect(confirm).not.toHaveBeenCalled();
    expect(scrubImportJobResults).not.toHaveBeenCalled();
    expect(writeBulkActionLog).not.toHaveBeenCalled();
    expect(writeAdminAuditLog).not.toHaveBeenCalled();
    expect(purgeJobFiles).not.toHaveBeenCalled();
    expect(deletePasses).toHaveBeenCalledWith(db, "evt-1", ["att-1"], provider, { budgetMs: 600_000 });
    expect(output()).toContain("Erased 0, already erased 1, not found 0. Export and import files deleted: 0. Wallet passes deleted at the provider: 1.");
  });

  it("counts the passes it deleted, and exits with 2 saying how many are still at the provider", async () => {
    const { db, passes } = fakeDb({
      attendees: [
        { id: "att-1", erased_at: null },
        { id: "att-2", erased_at: null },
        { id: "att-3", erased_at: null },
      ],
      passes: [
        { attendee_id: "att-1", pending: true },
        { attendee_id: "att-2", pending: true },
        { attendee_id: "att-3", pending: true },
      ],
    });
    eraseAttendees.mockResolvedValueOnce(erasedResult(["att-1", "att-2", "att-3"]));
    deletePasses.mockImplementationOnce(async () => {
      passes[0]!.pending = false;
      return { deleted: 1, failedAttendeeIds: ["att-2", "att-3"], failureCodes: ["wallet_unauthorized"], notTried: 0 };
    });

    const run = runAttendeesErase(db, deps, argv(...BASE, "--attendee-ids", "att-1,att-2,att-3", "--yes"));

    await expect(run).rejects.toMatchObject({
      message: "2 wallet pass(es) are still at the provider. Run the same command again to try them again.",
      exitCode: 2,
    });
    expect(output()).toContain("Wallet passes deleted at the provider: 1.");
    expect(errorLog).toHaveBeenCalledWith("Wallet pass of attendee att-2 could not be deleted (wallet_unauthorized).");
    expect(errorLog).toHaveBeenCalledWith("Wallet pass of attendee att-3 could not be deleted (wallet_unauthorized).");
  });

  it("leaves the passes where they are, and says so, when the event has no wallet credentials", async () => {
    const { db } = fakeDb({
      attendees: [{ id: "att-1", erased_at: null }],
      passes: [{ attendee_id: "att-1", pending: true }],
    });
    eraseAttendees.mockResolvedValueOnce(erasedResult(["att-1"]));
    resolveProvider.mockReturnValueOnce(null);

    await expect(runAttendeesErase(db, deps, argv(...BASE, "--attendee-ids", "att-1", "-y"))).rejects.toMatchObject({ exitCode: 2 });
    expect(deletePasses).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledWith("The event has no usable wallet credentials, so its passes cannot be deleted at the provider.");
  });

  it("still reports the erasure, with the passes left, when the provider call throws", async () => {
    const { db } = fakeDb({
      attendees: [{ id: "att-1", erased_at: null }],
      passes: [{ attendee_id: "att-1", pending: true }],
    });
    eraseAttendees.mockResolvedValueOnce(erasedResult(["att-1"]));
    deletePasses.mockRejectedValueOnce(new Error("provider down"));

    await expect(runAttendeesErase(db, deps, argv(...BASE, "--attendee-ids", "att-1", "-y"))).rejects.toMatchObject({ exitCode: 2 });
    expect(errorLog).toHaveBeenCalledWith("Wallet pass deletion failed: provider down");
    expect(output()).toContain("Erased 1");
  });

  it("does not fail the command when the export and import files cannot be deleted: the erasure has committed", async () => {
    const { db } = fakeDb({ attendees: [{ id: "att-1", erased_at: null }] });
    eraseAttendees.mockResolvedValueOnce(erasedResult(["att-1"]));
    purgeJobFiles.mockRejectedValueOnce(new Error("disk full"));

    await runAttendeesErase(db, deps, argv(...BASE, "--attendee-ids", "att-1", "-y"));

    expect(errorLog).toHaveBeenCalledWith("Export and import files could not be deleted (disk full); the retention run will try again.");
    expect(output()).toContain("Erased 1");
  });

  it("reports a failure that is not an Error object the same way", async () => {
    const { db } = fakeDb({
      attendees: [{ id: "att-1", erased_at: null }],
      passes: [{ attendee_id: "att-1", pending: true }],
    });
    eraseAttendees.mockResolvedValueOnce(erasedResult(["att-1"]));
    purgeJobFiles.mockRejectedValueOnce("disk full");
    deletePasses.mockRejectedValueOnce("provider down");

    await expect(runAttendeesErase(db, deps, argv(...BASE, "--attendee-ids", "att-1", "-y"))).rejects.toMatchObject({ exitCode: 2 });

    expect(errorLog).toHaveBeenCalledWith("Export and import files could not be deleted (disk full); the retention run will try again.");
    expect(errorLog).toHaveBeenCalledWith("Wallet pass deletion failed: provider down");
  });

  it("copes with attendees that are gone by the time the transaction runs", async () => {
    const { db, raw } = fakeDb({ attendees: [{ id: "att-1", erased_at: null }] });
    eraseAttendees.mockResolvedValueOnce(erasedResult([], [], ["att-1"]));

    await runAttendeesErase(db, deps, argv(...BASE, "--attendee-ids", "att-1", "-y"));

    expect(output()).toContain("Erased 0, already erased 0, not found 1.");
    expect(raw.walletPass.findMany).toHaveBeenCalled();
    expect(deletePasses).not.toHaveBeenCalled();
  });

  it("says how many export and import files stayed", async () => {
    const { db } = fakeDb({ attendees: [{ id: "att-1", erased_at: null }] });
    eraseAttendees.mockResolvedValueOnce(erasedResult(["att-1"]));
    purgeJobFiles.mockResolvedValueOnce({ deleted: 1, failed: 2 });

    await runAttendeesErase(db, deps, argv(...BASE, "--attendee-ids", "att-1", "-y"));

    expect(output()).toContain("Export and import files deleted: 1 (2 could not be deleted; the retention run will try again).");
  });

  it("writes no entry when the erasure turned out to erase nobody (a request that ran at the same moment got there first)", async () => {
    const { db } = fakeDb({ attendees: [{ id: "att-1", erased_at: null }] });
    eraseAttendees.mockResolvedValueOnce(erasedResult([], ["att-1"]));

    await runAttendeesErase(db, deps, argv(...BASE, "--attendee-ids", "att-1", "-y"));

    expect(writeBulkActionLog).not.toHaveBeenCalled();
    expect(writeAdminAuditLog).not.toHaveBeenCalled();
    expect(purgeJobFiles).not.toHaveBeenCalled();
  });

  it("with its own prompt, storage and provider lookup, asks, purges the default storage and has no provider without credentials", async () => {
    const { db } = fakeDb({
      event: { ...EVENT, wallet_template_id: null, wallet_api_key_enc: null },
      attendees: [{ id: "att-1", erased_at: null }],
    });
    eraseAttendees.mockResolvedValueOnce(erasedResult(["att-1"]));

    await runAttendeesErase(db, undefined, argv(...BASE, "--attendee-ids", "att-1"));

    expect(confirmYes).toHaveBeenCalledWith(expect.stringContaining("Type \"yes\" to continue"));
    expect(purgeEventJobFiles).toHaveBeenCalledWith(db, { name: "storage" }, "evt-1", ["job-1", "job-2"]);
    // No credentials, but also no pass at the provider: nothing to complain about.
    expect(errorLog).not.toHaveBeenCalled();
  });

  it("is a CliError the entry point prints, not a stack trace", async () => {
    const { db } = fakeDb({ attendees: [] });

    await expect(runAttendeesErase(db, deps, argv(...BASE, "--attendee-ids", "att-1"))).rejects.toBeInstanceOf(CliError);
  });
});
