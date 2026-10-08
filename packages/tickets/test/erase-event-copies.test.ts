/**
 * What an erasure does about copies of the person that are not on their own rows: the saved result
 * of an import (emails and CSV rows of skipped and unreadable entries) and the wallet pass at the
 * provider.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { assertTestDatabaseUrl } from "@admitto/db/test-db-guard";
import type { WalletPassProvider } from "@admitto/wallet";
import { eraseAttendees } from "../src/erase-attendees.js";
import { scrubImportJobResults } from "../src/erase-job-results.js";
import { deleteErasedWalletPasses } from "../src/erase-wallet-passes.js";

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
      await importJob(EVENT_ID, { skipped: ["odd.entry@example.com"], invalidRows: ["odd.entry@example.com"] }),
    ];

    const rewritten = await prisma.$transaction((tx) => scrubImportJobResults(tx, EVENT_ID, ["odd.entry@example.com"]));

    expect(rewritten).toBe(1);
    expect((await prisma.adminJob.findUniqueOrThrow({ where: { id: odd[0]!.id } })).result_json).toBe("just a string");
    expect((await prisma.adminJob.findUniqueOrThrow({ where: { id: odd[1]!.id } })).result_json).toEqual(["an", "array"]);
    expect((await prisma.adminJob.findUniqueOrThrow({ where: { id: odd[3]!.id } })).result_json).toEqual({
      skipped: [{ email: null, reason: expect.stringContaining("erased") }],
      invalidRows: [{ rowIndex: null, raw: null, reason: expect.stringContaining("erased") }],
    });
  });

  it("does nothing for an empty list and tolerates jobs without a result", async () => {
    await prisma.adminJob.create({ data: { type: "import_commit", organization_id: ORG_ID, event_id: EVENT_ID } });
    expect(await prisma.$transaction((tx) => scrubImportJobResults(tx, EVENT_ID, []))).toBe(0);
    expect(await prisma.$transaction((tx) => scrubImportJobResults(tx, EVENT_ID, ["x@example.com"]))).toBe(0);
  });
});

describe("deleteErasedWalletPasses", () => {
  const stubProvider = (deletePass = vi.fn(async () => undefined)) =>
    ({ deletePass }) as unknown as WalletPassProvider & { deletePass: ReturnType<typeof vi.fn> };

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
      failedAttendeeIds: [],
      failureCodes: [],
      notTried: 0,
    });
  });

  it("reports why a delete failed by the provider's error code, never by the error text", async () => {
    await attendeeWithPass("copies-wp-code");
    const failing = stubProvider(
      vi.fn(async () => {
        throw Object.assign(new Error("secret text with an address"), { code: "wallet_provider_unavailable" });
      }),
    );

    const result = await deleteErasedWalletPasses(prisma, EVENT_ID, ["copies-wp-code"], failing);

    expect(result.failureCodes).toEqual(["wallet_provider_unavailable"]);
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

  it("stops starting batches when the time budget is used up and reports what it did not try", async () => {
    await attendeeWithPass("copies-wp-budget-1");
    await attendeeWithPass("copies-wp-budget-2");
    const provider = stubProvider();

    const result = await deleteErasedWalletPasses(prisma, EVENT_ID, ["copies-wp-budget-1", "copies-wp-budget-2"], provider, { budgetMs: 0 });

    expect(result).toMatchObject({ deleted: 0, notTried: 2 });
    expect(provider.deletePass).not.toHaveBeenCalled();
    expect((await prisma.walletPass.findUniqueOrThrow({ where: { attendee_id: "copies-wp-budget-1" } })).provider_removed_at).toBeNull();
  });
});
