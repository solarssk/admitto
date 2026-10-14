/**
 * What an erasure does about copies of the person that are not on their own rows: the saved result
 * of an import (emails and CSV rows of skipped and unreadable entries) and the wallet pass at the
 * provider.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient, type Prisma } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { assertTestDatabaseUrl } from "@admitto/db/test-db-guard";
import type { WalletPassProvider } from "@admitto/wallet";
import { eraseAttendees } from "../src/erase-attendees.js";
import { scrubImportJobResults } from "../src/erase-job-results.js";
import {
  PASS_ROW_STILL_AT_PROVIDER,
  deleteErasedWalletPasses,
  erasedPassToDeleteWhere,
  passIsStillToDelete,
} from "../src/erase-wallet-passes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_ROOT = path.resolve(__dirname, "../../db");
const ORG_ID = "org_copies";
const EVENT_ID = "evt-erase-copies";
const OTHER_EVENT_ID = "evt-erase-copies-other";

let prisma: PrismaClient;

beforeAll(async () => {
  assertTestDatabaseUrl(process.env.DATABASE_URL ?? "");
  execSync("npx prisma db push --force-reset --accept-data-loss", {
    cwd: DB_ROOT,
    env: { ...process.env },
    stdio: "pipe",
  });
  prisma = createTestPrismaClient();
  await prisma.organization.create({ data: { id: ORG_ID, name: "Copies", slug: "copies-org" } });
  for (const id of [EVENT_ID, OTHER_EVENT_ID]) {
    await prisma.event.create({
      data: { id, title: id, slug: id, organization_id: ORG_ID, date: new Date("2026-09-01T09:00:00Z") },
    });
  }
});

afterAll(async () => {
  await prisma?.$disconnect();
});

const importJob = (eventId: string, resultJson: unknown) =>
  prisma.adminJob.create({
    data: { type: "import_commit", organization_id: ORG_ID, event_id: eventId, result_json: resultJson as never },
  });

describe("erasing an attendee: the previous address", () => {
  it("is returned in memory, lower-cased, for the attendees erased by this call only", async () => {
    await prisma.attendee.create({ data: { id: "copies-prev-1", event_id: EVENT_ID, email: "Mixed.Case@Example.com", name: "Prev One" } });
    await prisma.attendee.create({ data: { id: "copies-prev-2", event_id: EVENT_ID, email: "prev2@example.com", name: "Prev Two" } });
    await prisma.$transaction((tx) => eraseAttendees(tx, { eventId: EVENT_ID, attendeeIds: ["copies-prev-2"] }));

    const result = await prisma.$transaction((tx) =>
      eraseAttendees(tx, { eventId: EVENT_ID, attendeeIds: ["copies-prev-1", "copies-prev-2"] }),
    );

    expect(result.previousEmails).toEqual(["mixed.case@example.com"]);
  });
});

describe("erasing an attendee: addresses that are not the attendee's own row", () => {
  it("ignores an empty stored address and trims the others", async () => {
    await prisma.attendee.create({ data: { id: "copies-norm-empty", event_id: EVENT_ID, email: "", name: "Norm Empty" } });
    await prisma.attendee.create({ data: { id: "copies-norm-pad", event_id: EVENT_ID, email: "  Padded@Example.com ", name: "Norm Pad" } });

    const result = await prisma.$transaction((tx) =>
      eraseAttendees(tx, { eventId: EVENT_ID, attendeeIds: ["copies-norm-empty", "copies-norm-pad"] }),
    );

    expect(result.previousEmails).toEqual(["padded@example.com"]);
  });

  it("erases an attendee whose stored address is empty and has no address to clean up after", async () => {
    await prisma.attendee.create({ data: { id: "copies-only-empty", event_id: EVENT_ID, email: "", name: "Only Empty" } });

    const result = await prisma.$transaction((tx) => eraseAttendees(tx, { eventId: EVENT_ID, attendeeIds: ["copies-only-empty"] }));

    expect(result.erasedIds).toEqual(["copies-only-empty"]);
    expect(result.previousEmails).toEqual([]);
  });

  it("removes the address from another attendee's delivery that was sent to it as an override, and cancels it if waiting", async () => {
    await prisma.attendee.create({ data: { id: "copies-ovr-erased", event_id: EVENT_ID, email: "ovr.person@example.com", name: "Ovr Erased" } });
    await prisma.attendee.create({ data: { id: "copies-ovr-other", event_id: EVENT_ID, email: "ovr.other@example.com", name: "Ovr Other" } });
    const delivery = (status: string, recipient: string) =>
      prisma.emailDelivery.create({
        data: {
          organization_id: ORG_ID,
          event_id: EVENT_ID,
          attendee_id: "copies-ovr-other",
          provider: "smtp",
          status,
          recipient_email: recipient,
          rendered_subject: "s",
          rendered_html: "h",
        },
      });
    const waiting = await delivery("queued", "Ovr.Person@Example.com");
    const sent = await delivery("sent", "ovr.person@example.com");
    const ownAddress = await delivery("sent", "ovr.other@example.com");

    await prisma.$transaction((tx) => eraseAttendees(tx, { eventId: EVENT_ID, attendeeIds: ["copies-ovr-erased"] }));

    expect(await prisma.emailDelivery.findUniqueOrThrow({ where: { id: waiting.id } })).toMatchObject({ status: "cancelled", recipient_email: null });
    expect(await prisma.emailDelivery.findUniqueOrThrow({ where: { id: sent.id } })).toMatchObject({ status: "sent", recipient_email: null });
    expect(await prisma.emailDelivery.findUniqueOrThrow({ where: { id: ownAddress.id } })).toMatchObject({ recipient_email: "ovr.other@example.com" });
  });
});

describe("scrubImportJobResults", () => {
  it("blanks the entries that mention an erased address and keeps everything else, counts included", async () => {
    const job = await importJob(EVENT_ID, {
      importId: "imp-1",
      created: 3,
      skipped: [
        { email: "gone@example.com", reason: "Duplicate email" },
        { email: "stays@example.com", reason: "Duplicate email" },
      ],
      skippedCount: 2,
      invalidRows: [
        { rowIndex: 4, raw: { first_name: "G", last_name: "One", email: "Gone@Example.com" }, reason: 'Invalid ticket type for "gone@example.com"' },
        { rowIndex: 5, raw: { email: "other@example.com" }, reason: "Missing last_name" },
      ],
      invalidCount: 2,
    });

    const rewritten = await prisma.$transaction((tx) => scrubImportJobResults(tx, EVENT_ID, ["gone@example.com"]));

    expect(rewritten).toBe(1);
    const after = (await prisma.adminJob.findUniqueOrThrow({ where: { id: job.id } })).result_json as Record<string, unknown>;
    expect(after).toMatchObject({ created: 3, skippedCount: 2, invalidCount: 2 });
    expect(after.skipped).toEqual([
      { email: null, reason: expect.stringContaining("erased") },
      { email: "stays@example.com", reason: "Duplicate email" },
    ]);
    expect(after.invalidRows).toEqual([
      { rowIndex: 4, raw: null, reason: expect.stringContaining("erased") },
      { rowIndex: 5, raw: { email: "other@example.com" }, reason: "Missing last_name" },
    ]);
    expect(JSON.stringify(after).toLowerCase()).not.toContain("gone@example.com");
  });

  it("matches whole addresses only, ignores empty needles, and does not blank everything for them", async () => {
    const job = await importJob(EVENT_ID, {
      skipped: [
        { email: "banana@boundary.com", reason: "Duplicate email" },
        { email: "a@boundary.com", reason: "Duplicate email" },
      ],
    });

    await prisma.$transaction((tx) => scrubImportJobResults(tx, EVENT_ID, ["", "  "]));
    expect((await prisma.adminJob.findUniqueOrThrow({ where: { id: job.id } })).result_json).toEqual(job.result_json);

    await prisma.$transaction((tx) => scrubImportJobResults(tx, EVENT_ID, [" A@Boundary.com "]));
    const after = (await prisma.adminJob.findUniqueOrThrow({ where: { id: job.id } })).result_json as { skipped: unknown[] };
    expect(after.skipped).toEqual([
      { email: "banana@boundary.com", reason: "Duplicate email" },
      { email: null, reason: expect.stringContaining("erased") },
    ]);
  });

  it("blanks an entry that quotes the address at the end of a sentence or a word", async () => {
    const job = await importJob(EVENT_ID, {
      skipped: [
        { email: "other@punct.example.com", reason: "Duplicate of gone@punct.example.com." },
        { email: "keeps@punct.example.com", reason: "Duplicate email" },
      ],
      invalidRows: [{ rowIndex: 7, raw: { note: "see gone@punct.example.com-" }, reason: "Both first_name and last_name are required" }],
    });

    const rewritten = await prisma.$transaction((tx) => scrubImportJobResults(tx, EVENT_ID, ["gone@punct.example.com"]));

    expect(rewritten).toBe(1);
    const after = (await prisma.adminJob.findUniqueOrThrow({ where: { id: job.id } })).result_json as Record<string, unknown>;
    expect(after.skipped).toEqual([
      { email: null, reason: expect.stringContaining("erased") },
      { email: "keeps@punct.example.com", reason: "Duplicate email" },
    ]);
    expect(after.invalidRows).toEqual([{ rowIndex: 7, raw: null, reason: expect.stringContaining("erased") }]);
    expect(JSON.stringify(after)).not.toContain("gone@punct.example.com");
  });

  it("blanks an entry whose cell holds the address between stray quote marks", async () => {
    const job = await importJob(EVENT_ID, {
      invalidRows: [
        { rowIndex: 9, raw: { email: "'gone@quote.example.com'" }, reason: 'Invalid email: "\'gone@quote.example.com\'"' },
        { rowIndex: 10, raw: { note: "`gone@quote.example.com`" }, reason: "Missing last_name" },
        { rowIndex: 11, raw: { email: "keeps@quote.example.com" }, reason: "Missing last_name" },
      ],
    });

    const rewritten = await prisma.$transaction((tx) => scrubImportJobResults(tx, EVENT_ID, ["gone@quote.example.com"]));

    expect(rewritten).toBe(1);
    const after = (await prisma.adminJob.findUniqueOrThrow({ where: { id: job.id } })).result_json as { invalidRows: unknown[] };
    expect(after.invalidRows).toEqual([
      { rowIndex: 9, raw: null, reason: expect.stringContaining("erased") },
      { rowIndex: 10, raw: null, reason: expect.stringContaining("erased") },
      { rowIndex: 11, raw: { email: "keeps@quote.example.com" }, reason: "Missing last_name" },
    ]);
    expect(JSON.stringify(after)).not.toContain("gone@quote.example.com");
  });

  it("does not blank the entry of another address that only ends with the erased one", async () => {
    const result = {
      // Addresses this app's own validator accepts: other people, whatever stands before the name.
      skipped: [
        { email: "o'brien@tail.example.com", reason: "Duplicate email" },
        { email: "_brien@tail.example.com", reason: "Duplicate email" },
        { email: "+brien@tail.example.com", reason: "Duplicate email" },
      ],
      invalidRows: [
        { rowIndex: 3, raw: { email: "x!brien@tail.example.com" }, reason: 'Invalid email: "x!brien@tail.example.com"' },
        { rowIndex: 4, raw: { email: "x=brien@tail.example.com" }, reason: 'Invalid email: "x=brien@tail.example.com"' },
        { rowIndex: 5, raw: { email: "=brien@tail.example.com" }, reason: 'Invalid email: "=brien@tail.example.com"' },
      ],
    };
    const job = await importJob(EVENT_ID, result);

    const rewritten = await prisma.$transaction((tx) => scrubImportJobResults(tx, EVENT_ID, ["brien@tail.example.com"]));

    expect(rewritten).toBe(0);
    expect((await prisma.adminJob.findUniqueOrThrow({ where: { id: job.id } })).result_json).toEqual(result);
  });

  it("does not lose either blanking when two erasures rewrite the same job at once", async () => {
    const job = await importJob(EVENT_ID, {
      skipped: [
        { email: "race.one@example.com", reason: "x" },
        { email: "race.two@example.com", reason: "x" },
      ],
    });

    await Promise.all([
      prisma.$transaction((tx) => scrubImportJobResults(tx, EVENT_ID, ["race.one@example.com"])),
      prisma.$transaction((tx) => scrubImportJobResults(tx, EVENT_ID, ["race.two@example.com"])),
    ]);

    const text = JSON.stringify((await prisma.adminJob.findUniqueOrThrow({ where: { id: job.id } })).result_json);
    expect(text).not.toContain("race.one@example.com");
    expect(text).not.toContain("race.two@example.com");
  });

  it("leaves the jobs of other events, other kinds of jobs and jobs without a mention alone", async () => {
    const other = await importJob(OTHER_EVENT_ID, { skipped: [{ email: "shared@example.com", reason: "x" }] });
    const untouched = await importJob(EVENT_ID, { skipped: [{ email: "nobody@example.com", reason: "x" }] });
    const notImport = await prisma.adminJob.create({
      data: { type: "export", organization_id: ORG_ID, event_id: EVENT_ID, result_json: { skipped: [{ email: "shared@example.com" }] } },
    });

    const rewritten = await prisma.$transaction((tx) => scrubImportJobResults(tx, EVENT_ID, ["shared@example.com"]));

    expect(rewritten).toBe(0);
    for (const job of [other, untouched, notImport]) {
      expect((await prisma.adminJob.findUniqueOrThrow({ where: { id: job.id } })).result_json).toEqual(job.result_json);
    }
  });

  it("copes with results that are not shaped like an import result", async () => {
    const odd = [
      await importJob(EVENT_ID, "just a string"),
      await importJob(EVENT_ID, ["an", "array"]),
      await importJob(EVENT_ID, { skipped: "not a list", invalidRows: { not: "a list" } }),
      await importJob(EVENT_ID, {
        skipped: ["odd.entry@example.com"],
        invalidRows: ["odd.entry@example.com", { raw: "x,odd.entry@example.com", reason: "bad row" }],
      }),
    ];

    const rewritten = await prisma.$transaction((tx) => scrubImportJobResults(tx, EVENT_ID, ["odd.entry@example.com"]));

    expect(rewritten).toBe(1);
    expect((await prisma.adminJob.findUniqueOrThrow({ where: { id: odd[0]!.id } })).result_json).toBe("just a string");
    expect((await prisma.adminJob.findUniqueOrThrow({ where: { id: odd[1]!.id } })).result_json).toEqual(["an", "array"]);
    expect((await prisma.adminJob.findUniqueOrThrow({ where: { id: odd[3]!.id } })).result_json).toEqual({
      skipped: [{ email: null, reason: expect.stringContaining("erased") }],
      invalidRows: [
        { rowIndex: null, raw: null, reason: expect.stringContaining("erased") },
        { rowIndex: null, raw: null, reason: expect.stringContaining("erased") },
      ],
    });
  });

  it("does nothing for an empty list and tolerates jobs without a result", async () => {
    await prisma.adminJob.create({ data: { type: "import_commit", organization_id: ORG_ID, event_id: EVENT_ID } });
    expect(await prisma.$transaction((tx) => scrubImportJobResults(tx, EVENT_ID, []))).toBe(0);
    expect(await prisma.$transaction((tx) => scrubImportJobResults(tx, EVENT_ID, ["x@example.com"]))).toBe(0);
  });
});

describe("deleteErasedWalletPasses", () => {
  const stubProvider = (
    deletePass: ReturnType<typeof vi.fn> = vi.fn(async () => undefined),
    deletePassByUserProvidedId: ReturnType<typeof vi.fn> = vi.fn(async (_userProvidedId: string) => true),
  ) =>
    ({ deletePass, deletePassByUserProvidedId }) as unknown as WalletPassProvider & {
      deletePass: ReturnType<typeof vi.fn>;
      deletePassByUserProvidedId: ReturnType<typeof vi.fn>;
    };

  const attendeeWithPass = async (id: string, eventId = EVENT_ID, erase = true) => {
    await prisma.attendee.create({ data: { id, event_id: eventId, email: `${id}@example.com`, name: id } });
    await prisma.walletPass.create({
      data: { attendee_id: id, status: "active", provider_pass_id: `pc-${id}`, user_provided_id: `u-${id}`, apple_url: "https://pc/a" },
    });
    if (erase) await prisma.$transaction((tx) => eraseAttendees(tx, { eventId, attendeeIds: [id] }));
  };

  it("deletes each pass at the provider and marks it removed, then does nothing the second time", async () => {
    await attendeeWithPass("copies-wp-1");
    await attendeeWithPass("copies-wp-2");
    const provider = stubProvider();

    const first = await deleteErasedWalletPasses(prisma, EVENT_ID, ["copies-wp-1", "copies-wp-2"], provider);
    const second = await deleteErasedWalletPasses(prisma, EVENT_ID, ["copies-wp-1", "copies-wp-2"], provider);

    expect(first).toMatchObject({ deleted: 2, failedAttendeeIds: [] });
    expect(second).toMatchObject({ deleted: 0, failedAttendeeIds: [] });
    expect(provider.deletePass.mock.calls.map((call) => call[0]).sort()).toEqual(["pc-copies-wp-1", "pc-copies-wp-2"]);
    // A row with the provider's id is deleted by it, also when it holds the reserved id too.
    expect(provider.deletePassByUserProvidedId).not.toHaveBeenCalled();
    for (const id of ["copies-wp-1", "copies-wp-2"]) {
      expect((await prisma.walletPass.findUniqueOrThrow({ where: { attendee_id: id } })).provider_removed_at).not.toBeNull();
    }
  });

  it("keeps a pass whose delete failed marked as still to delete, and a retry finishes it", async () => {
    await attendeeWithPass("copies-wp-3");
    await attendeeWithPass("copies-wp-4");
    const failing = stubProvider(
      vi.fn(async (id: string) => {
        if (id === "pc-copies-wp-3") throw new Error("provider down");
      }),
    );

    const result = await deleteErasedWalletPasses(prisma, EVENT_ID, ["copies-wp-3", "copies-wp-4"], failing);

    expect(result).toMatchObject({ deleted: 1, failedAttendeeIds: ["copies-wp-3"] });
    expect((await prisma.walletPass.findUniqueOrThrow({ where: { attendee_id: "copies-wp-3" } })).provider_removed_at).toBeNull();

    const retry = await deleteErasedWalletPasses(prisma, EVENT_ID, ["copies-wp-3", "copies-wp-4"], stubProvider());
    expect(retry).toMatchObject({ deleted: 1, failedAttendeeIds: [] });
    expect((await prisma.walletPass.findUniqueOrThrow({ where: { attendee_id: "copies-wp-3" } })).provider_removed_at).not.toBeNull();
  });

  it("never touches the pass of an attendee who is not erased, or of another event", async () => {
    await attendeeWithPass("copies-wp-live", EVENT_ID, false);
    await attendeeWithPass("copies-wp-elsewhere", OTHER_EVENT_ID);
    const provider = stubProvider();

    const result = await deleteErasedWalletPasses(prisma, EVENT_ID, ["copies-wp-live", "copies-wp-elsewhere"], provider);

    expect(result).toMatchObject({ deleted: 0, failedAttendeeIds: [] });
    expect(provider.deletePass).not.toHaveBeenCalled();
  });

  it("does nothing for an empty list", async () => {
    const provider = stubProvider();
    expect(await deleteErasedWalletPasses(prisma, EVENT_ID, [], provider)).toEqual({
      deleted: 0,
      untrackedDeleted: 0,
      failedAttendeeIds: [],
      failureCodes: [],
      notTried: 0,
    });
  });

  it("reports why a delete failed by the provider's error code, never by the error text", async () => {
    await attendeeWithPass("copies-wp-code");
    const failing = stubProvider(
      vi.fn(async () => {
        throw Object.assign(new Error("secret text with an address"), { code: "wallet_provider_timeout" });
      }),
    );

    const result = await deleteErasedWalletPasses(prisma, EVENT_ID, ["copies-wp-code"], failing);

    expect(result.failureCodes).toEqual(["wallet_provider_timeout"]);
  });

  it("does not publish arbitrary exception codes in erasure failure summaries", async () => {
    await attendeeWithPass("copies-wp-private-code");
    const failing = stubProvider(vi.fn(async () => {
      throw Object.assign(new Error("private@example.com"), { code: "private@example.com" });
    }));
    const result = await deleteErasedWalletPasses(prisma, EVENT_ID, ["copies-wp-private-code"], failing);
    expect(result.failureCodes).toEqual(["unknown"]);
    expect(result.failedAttendeeIds).toEqual(["copies-wp-private-code"]);
  });

  it("reports a failure that is not an error object as an unknown code", async () => {
    await attendeeWithPass("copies-wp-string");
    const failing = stubProvider(
      vi.fn(async () => {
        throw "plain string";
      }),
    );

    const result = await deleteErasedWalletPasses(prisma, EVENT_ID, ["copies-wp-string"], failing);

    expect(result.failureCodes).toEqual(["unknown"]);
  });

  it("goes by attendee id, so that what it did not try is the end of the ids, whatever order the rows were written in", async () => {
    // Nine passes, written from the highest id to the lowest: one batch is eight, so one pass is left for the next call.
    const ids = Array.from({ length: 9 }, (_, i) => `copies-wp-ord-${9 - i}`);
    for (const id of ids) await attendeeWithPass(id);
    let elapsed = 0;
    const provider = stubProvider(vi.fn(async () => { elapsed = 2; return undefined; }));
    // Starting the first batch must not depend on whether the runner preempts us for 1ms.
    // Advance the budget only when a real provider call begins; database results stay real.
    const clock = vi.spyOn(Date, "now").mockImplementation(() => 1_700_000_000_000 + elapsed);
    try {
      const result = await deleteErasedWalletPasses(prisma, EVENT_ID, [...ids], provider, { budgetMs: 1 });

      expect(result).toMatchObject({ deleted: 8, notTried: 1 });
      expect(provider.deletePass.mock.calls.map((call) => call[0]).sort()).toEqual(
        [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `pc-copies-wp-ord-${n}`),
      );
      expect((await prisma.walletPass.findUniqueOrThrow({ where: { attendee_id: "copies-wp-ord-9" } })).provider_removed_at).toBeNull();
    } finally { clock.mockRestore(); }
  });

  it("stops starting batches when the time budget is used up and reports what it did not try", async () => {
    await attendeeWithPass("copies-wp-budget-1");
    await attendeeWithPass("copies-wp-budget-2");
    const provider = stubProvider();

    const result = await deleteErasedWalletPasses(prisma, EVENT_ID, ["copies-wp-budget-1", "copies-wp-budget-2"], provider, { budgetMs: 0 });

    expect(result).toMatchObject({ deleted: 0, notTried: 2 });
    expect(provider.deletePass).not.toHaveBeenCalled();
    expect((await prisma.walletPass.findUniqueOrThrow({ where: { attendee_id: "copies-wp-budget-1" } })).provider_removed_at).toBeNull();
  });

  describe("a pass the creating request could not record", () => {
    /** An attendee, erased unless `erase` is false, whose pass row holds only what a creating request wrote before it
     * called the provider: the id reserved for the pass (`reserved`, a different one than the deterministic id when
     * a string is given), no provider id. */
    const attendeeWithReservedId = async (
      id: string,
      options: { reserved?: string | false; status?: string; erase?: boolean; eventId?: string } = {},
    ) => {
      const eventId = options.eventId ?? EVENT_ID;
      await prisma.attendee.create({ data: { id, event_id: eventId, email: `${id}@example.com`, name: id } });
      const reserved = options.reserved ?? `admitto:${eventId}:${id}`;
      await prisma.walletPass.create({
        data: {
          attendee_id: id,
          status: options.status ?? "pending",
          ...(reserved === false ? {} : { user_provided_id: reserved }),
        },
      });
      if (options.erase !== false) await prisma.$transaction((tx) => eraseAttendees(tx, { eventId, attendeeIds: [id] }));
    };
    const removedAt = async (id: string) =>
      (await prisma.walletPass.findUniqueOrThrow({ where: { attendee_id: id } })).provider_removed_at;

    it("deletes it by the id reserved on the row, marks the row removed, and does nothing the second time", async () => {
      await attendeeWithReservedId("copies-wp-res-1", { reserved: "reserved-id-copies-wp-res-1" });
      const provider = stubProvider();

      const first = await deleteErasedWalletPasses(prisma, EVENT_ID, ["copies-wp-res-1"], provider);
      const second = await deleteErasedWalletPasses(prisma, EVENT_ID, ["copies-wp-res-1"], provider);

      expect(first).toMatchObject({ deleted: 1, untrackedDeleted: 1, failedAttendeeIds: [], notTried: 0 });
      expect(second).toMatchObject({ deleted: 0, untrackedDeleted: 0 });
      // The id that was written on the row is the one asked for, and the provider's own delete is not called for it.
      expect(provider.deletePassByUserProvidedId.mock.calls).toEqual([["reserved-id-copies-wp-res-1"]]);
      expect(provider.deletePass).not.toHaveBeenCalled();
      expect(await removedAt("copies-wp-res-1")).not.toBeNull();
    });

    it("counts it as deleted, but not as a pass it found, when the provider had none under that id", async () => {
      await attendeeWithReservedId("copies-wp-res-2");
      const provider = stubProvider(undefined, vi.fn(async (_userProvidedId: string) => false));

      const result = await deleteErasedWalletPasses(prisma, EVENT_ID, ["copies-wp-res-2"], provider);

      expect(result).toMatchObject({ deleted: 1, untrackedDeleted: 0, failedAttendeeIds: [] });
      expect(await removedAt("copies-wp-res-2")).not.toBeNull();
    });

    it("finds a failed creation from before ids were reserved (no id of any kind on the row) and deletes by the id built from the event and the attendee", async () => {
      await attendeeWithReservedId("copies-wp-res-3", { reserved: false, status: "failed" });
      const provider = stubProvider();

      const result = await deleteErasedWalletPasses(prisma, EVENT_ID, ["copies-wp-res-3"], provider);

      expect(result).toMatchObject({ deleted: 1, untrackedDeleted: 1 });
      expect(provider.deletePassByUserProvidedId.mock.calls).toEqual([[`admitto:${EVENT_ID}:copies-wp-res-3`]]);
      expect(await removedAt("copies-wp-res-3")).not.toBeNull();
    });

    it("sends each pass to the call that fits it, whichever order the rows were written in", async () => {
      await attendeeWithReservedId("copies-wp-mix-d", { reserved: false, status: "failed" });
      await attendeeWithPass("copies-wp-mix-c");
      await attendeeWithReservedId("copies-wp-mix-b");
      await attendeeWithPass("copies-wp-mix-a");
      const provider = stubProvider();

      const result = await deleteErasedWalletPasses(
        prisma,
        EVENT_ID,
        ["copies-wp-mix-a", "copies-wp-mix-b", "copies-wp-mix-c", "copies-wp-mix-d"],
        provider,
      );

      expect(result).toMatchObject({ deleted: 4, untrackedDeleted: 2, failedAttendeeIds: [] });
      expect(provider.deletePass.mock.calls.map((call) => call[0]).sort()).toEqual(["pc-copies-wp-mix-a", "pc-copies-wp-mix-c"]);
      expect(provider.deletePassByUserProvidedId.mock.calls.map((call) => call[0]).sort()).toEqual([
        `admitto:${EVENT_ID}:copies-wp-mix-b`,
        `admitto:${EVENT_ID}:copies-wp-mix-d`,
      ]);
    });

    it("keeps the row as still to delete when the provider fails, reports its code, and a retry finishes it", async () => {
      await attendeeWithReservedId("copies-wp-res-4");
      const failing = stubProvider(
        undefined,
        vi.fn(async (_userProvidedId: string) => {
          throw Object.assign(new Error("secret text"), { code: "wallet_provider_timeout" });
        }),
      );

      const result = await deleteErasedWalletPasses(prisma, EVENT_ID, ["copies-wp-res-4"], failing);

      expect(result).toMatchObject({
        deleted: 0,
        untrackedDeleted: 0,
        failedAttendeeIds: ["copies-wp-res-4"],
        failureCodes: ["wallet_provider_timeout"],
      });
      expect(await removedAt("copies-wp-res-4")).toBeNull();

      const retry = await deleteErasedWalletPasses(prisma, EVENT_ID, ["copies-wp-res-4"], stubProvider());
      expect(retry).toMatchObject({ deleted: 1, failedAttendeeIds: [] });
      expect(await removedAt("copies-wp-res-4")).not.toBeNull();
    });

    it("never touches the reserved id of a live attendee or of another event, nor a row that holds no id and no failure", async () => {
      await attendeeWithReservedId("copies-wp-res-live", { erase: false });
      await attendeeWithReservedId("copies-wp-res-elsewhere", { eventId: OTHER_EVENT_ID });
      await attendeeWithReservedId("copies-wp-res-bare", { reserved: false });
      const provider = stubProvider();

      const result = await deleteErasedWalletPasses(
        prisma,
        EVENT_ID,
        ["copies-wp-res-live", "copies-wp-res-elsewhere", "copies-wp-res-bare"],
        provider,
      );

      expect(result).toMatchObject({ deleted: 0, failedAttendeeIds: [], notTried: 0 });
      expect(provider.deletePass).not.toHaveBeenCalled();
      expect(provider.deletePassByUserProvidedId).not.toHaveBeenCalled();
    });

    it("leaves the row open, with the provider's id on it, when the creating request saved that id while the delete was under way", async () => {
      await attendeeWithReservedId("copies-wp-res-race");
      const racing = stubProvider(
        undefined,
        vi.fn(async (_userProvidedId: string) => {
          // The request that was creating the pass finishes meanwhile and saves the provider's id of what it made.
          await prisma.walletPass.update({ where: { attendee_id: "copies-wp-res-race" }, data: { provider_pass_id: "pc-late" } });
          return false;
        }),
      );

      await deleteErasedWalletPasses(prisma, EVENT_ID, ["copies-wp-res-race"], racing);

      expect(await prisma.walletPass.findUniqueOrThrow({ where: { attendee_id: "copies-wp-res-race" } })).toMatchObject({
        provider_pass_id: "pc-late",
        provider_removed_at: null,
      });
      // That pass is a tracked one now, and the next run deletes it by its own id.
      const next = stubProvider();
      await deleteErasedWalletPasses(prisma, EVENT_ID, ["copies-wp-res-race"], next);
      expect(next.deletePass.mock.calls).toEqual([["pc-late"]]);
      expect(await removedAt("copies-wp-res-race")).not.toBeNull();
    });

    describe("which rows are still to be deleted", () => {
      const removed = new Date("2026-10-01T10:00:00Z");
      // [name, the row, whether the pass is still to be deleted once the attendee is erased]
      const shapes: Array<[string, Omit<Prisma.WalletPassUncheckedCreateInput, "attendee_id">, boolean]> = [
        ["tracked", { status: "active", provider_pass_id: "pc-m-tracked", user_provided_id: "u-m-tracked" }, true],
        ["tracked, with no reserved id", { status: "active", provider_pass_id: "pc-m-bare" }, true],
        ["tracked and removed", { status: "active", provider_pass_id: "pc-m-gone", provider_removed_at: removed }, false],
        ["reserved id only", { status: "pending", user_provided_id: "u-m-reserved" }, true],
        ["reserved id only, and removed", { status: "pending", user_provided_id: "u-m-reserved-gone", provider_removed_at: removed }, false],
        ["failed, no id of any kind", { status: "failed", last_error_code: "wallet_provider_timeout" }, true],
        ["failed, no id of any kind, and removed", { status: "failed", provider_removed_at: removed }, false],
        ["pending, no id of any kind", { status: "pending" }, false],
        ["voided, no id of any kind", { status: "voided" }, false],
      ];
      const idOf = (index: number) => `copies-wp-shape-${index}`;

      it("is the same for the where that finds them and for the function that reads one row, and the where adds who the attendee is", async () => {
        for (const [index, [, data]] of shapes.entries()) {
          await prisma.attendee.create({ data: { id: idOf(index), event_id: EVENT_ID, email: `${idOf(index)}@example.com`, name: "Shape" } });
          await prisma.walletPass.create({ data: { attendee_id: idOf(index), ...data } });
        }
        await prisma.$transaction((tx) => eraseAttendees(tx, { eventId: EVENT_ID, attendeeIds: shapes.map((_, index) => idOf(index)) }));
        // A live attendee, and an erased one of another event, each with a row that would match.
        await prisma.attendee.create({ data: { id: "copies-wp-shape-live", event_id: EVENT_ID, email: "shape-live@example.com", name: "Shape" } });
        await prisma.walletPass.create({ data: { attendee_id: "copies-wp-shape-live", status: "active", provider_pass_id: "pc-m-live" } });
        await attendeeWithReservedId("copies-wp-shape-elsewhere", { eventId: OTHER_EVENT_ID });

        const found = new Set(
          (await prisma.walletPass.findMany({ where: erasedPassToDeleteWhere(EVENT_ID), select: { attendee_id: true } })).map(
            (row) => row.attendee_id,
          ),
        );
        for (const [index, [name, , expected]] of shapes.entries()) {
          const row = await prisma.walletPass.findUniqueOrThrow({ where: { attendee_id: idOf(index) } });
          expect(passIsStillToDelete(row), name).toBe(expected);
          expect(found.has(idOf(index)), name).toBe(expected);
        }
        // The function only reads the row, so it says yes for the live attendee's pass; the where is what keeps it out.
        expect(found.has("copies-wp-shape-live")).toBe(false);
        expect(found.has("copies-wp-shape-elsewhere")).toBe(false);
        // Narrowed to given attendees, it finds those and no others.
        const narrowed = await prisma.walletPass.findMany({
          where: erasedPassToDeleteWhere(EVENT_ID, [idOf(0), idOf(3), idOf(7)]),
          select: { attendee_id: true },
        });
        expect(narrowed.map((row) => row.attendee_id).sort()).toEqual([idOf(0), idOf(3)]);
      });

      it("is valid inside a relation filter too: an event with such a pass is found by it, and one with only rows that are not is not", async () => {
        const QUIET_EVENT_ID = "evt-erase-copies-quiet";
        await prisma.event.create({
          data: { id: QUIET_EVENT_ID, title: QUIET_EVENT_ID, slug: QUIET_EVENT_ID, organization_id: ORG_ID, date: new Date("2026-09-01T09:00:00Z") },
        });
        await attendeeWithReservedId("copies-wp-quiet-bare", { eventId: QUIET_EVENT_ID, reserved: false });
        await attendeeWithReservedId("copies-wp-quiet-removed", { eventId: QUIET_EVENT_ID });
        await prisma.walletPass.update({ where: { attendee_id: "copies-wp-quiet-removed" }, data: { provider_removed_at: removed } });
        await attendeeWithReservedId("copies-wp-loud", { eventId: OTHER_EVENT_ID });

        const events = await prisma.event.findMany({
          where: { attendees: { some: { erased_at: { not: null }, wallet_pass: { is: PASS_ROW_STILL_AT_PROVIDER } } } },
          select: { id: true },
        });

        expect(events.map((event) => event.id)).toContain(OTHER_EVENT_ID);
        expect(events.map((event) => event.id)).not.toContain(QUIET_EVENT_ID);
      });
    });
  });
});
