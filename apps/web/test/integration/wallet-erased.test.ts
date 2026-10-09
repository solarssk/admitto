import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma, PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { encryptToString } from "@admitto/crypto";
import { eraseAttendees, generateToken, hashToken } from "@admitto/tickets";
import type { WalletPassInput, WalletPassProvider } from "@admitto/wallet";
import { PASSCREATOR_CAPABILITIES, PASSCREATOR_CONSISTENCY_POLICY, WalletProviderError } from "@admitto/wallet";
import { querySystemLogs, resetSystemLogBufferForTest } from "@admitto/shared/system-log";
import { createApp } from "../../src/app.js";
import { createRateLimitStore } from "../../src/rate-limit/index.js";
import { resolveWalletMessageAttendeeIds } from "../../src/admin/wallet-message-routes.js";
import { keepLiveWalletMessageTargets, loadWalletMessageTargets, reissueOneWalletPass } from "@admitto/tickets";

const ORG_ID = "org-wallet-erased";
const EVENT_ID = "evt-wallet-erased";

let prisma: PrismaClient;
let seq = 0;

type Stub = WalletPassProvider & {
  createPass: ReturnType<typeof vi.fn>;
  deletePass: ReturnType<typeof vi.fn>;
  updatePass: ReturnType<typeof vi.fn>;
};

function stubProvider(): Stub {
  return {
    provider: "stub",
    capabilities: PASSCREATOR_CAPABILITIES,
    consistencyPolicy: PASSCREATOR_CONSISTENCY_POLICY,
    createPass: vi.fn(async (input: WalletPassInput) => ({
      providerPassId: `pc-${input.userProvidedId}`,
      downloadUrl: "https://pc.test/p/x",
      appleUrl: "https://pc.test/apple/x",
      androidUrl: "https://pc.test/android/x",
    })),
    updatePass: vi.fn(),
    sendPushMessage: vi.fn(),
    voidPass: vi.fn(),
    restorePass: vi.fn(),
    deletePass: vi.fn(async () => undefined),
    findByUserProvidedId: vi.fn(async () => null),
    getPassSnapshot: vi.fn(async () => null),
  } as unknown as Stub;
}

function makeApp(walletPassProvider: WalletPassProvider) {
  return createApp({
    prisma,
    baseUrl: "https://tickets.example.com",
    rateLimitStore: createRateLimitStore(),
    skipCheckinBootValidation: true,
    walletPassProvider,
  });
}

async function createAttendee() {
  const n = ++seq;
  const token = generateToken();
  const attendee = await prisma.attendee.create({
    data: {
      id: `wallet-erased-att-${n}`,
      event_id: EVENT_ID,
      email: `walleterased${n}@example.com`,
      name: `Wallet Person ${n}`,
      token_hash: hashToken(token),
      token_enc: encryptToString(token),
      status: "registered",
    },
  });
  return { attendee, token };
}

const erase = (ids: string[]) => prisma.$transaction((tx) => eraseAttendees(tx, { eventId: EVENT_ID, attendeeIds: ids }));

beforeAll(async () => {
  prisma = createTestPrismaClient();
  await prisma.walletPass.deleteMany({ where: { attendee: { event_id: EVENT_ID } } });
  await prisma.attendee.deleteMany({ where: { event_id: EVENT_ID } });
  await prisma.event.deleteMany({ where: { id: EVENT_ID } });
  await prisma.organization.deleteMany({ where: { id: ORG_ID } });
  await prisma.organization.create({ data: { id: ORG_ID, name: "Org", slug: "wallet-erased-org" } });
  await prisma.event.create({
    data: {
      id: EVENT_ID,
      title: "Wallet Erased Gala",
      slug: "wallet-erased-gala",
      date: new Date("2099-09-01"),
      organization_id: ORG_ID,
      wallet_template_id: "tmpl-wallet-erased",
    },
  });
});

beforeEach(() => {
  resetSystemLogBufferForTest();
});

afterAll(async () => {
  await prisma?.$disconnect();
});

/** Starts an erasure and keeps its transaction open after the rows are written. `timeoutMs` is the
 * transaction's own limit (Prisma's default is 5 s; the erase API uses 60 s). `commit` ends it with
 * a commit, or, with `outcome: "rollback"`, with a rollback (the erasure then never happened). */
async function holdErasure(ids: string[], timeoutMs = 5_000, outcome: "commit" | "rollback" = "commit") {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let written!: () => void;
  const writtenPromise = new Promise<void>((resolve) => (written = resolve));
  const transaction = prisma
    .$transaction(
      async (tx) => {
        await eraseAttendees(tx, { eventId: EVENT_ID, attendeeIds: ids });
        written();
        await gate;
        if (outcome === "rollback") throw new Error("erasure rolled back");
      },
      { timeout: timeoutMs },
    )
    .catch((err: unknown) => {
      if (outcome !== "rollback") throw err;
    });
  await writtenPromise;
  return { commit: () => (release(), transaction) };
}

/** True when the promise is still unsettled after a short wait. */
async function staysPending(promise: Promise<unknown>, ms = 300): Promise<boolean> {
  let settled = false;
  promise.then(
    () => (settled = true),
    () => (settled = true),
  );
  await new Promise((resolve) => setTimeout(resolve, ms));
  return !settled;
}

describe("wallet pass creation racing an erasure", () => {
  it("waits for an erasure that is still open before saving, then saves no links and deletes the new pass", async () => {
    const { attendee, token } = await createAttendee();
    const provider = stubProvider();
    // The erasure has written but not committed when the provider returns the new pass.
    provider.createPass.mockImplementationOnce(async (input: WalletPassInput) => {
      const held = await holdErasure([attendee.id]);
      setTimeout(() => void held.commit(), 300);
      return {
        providerPassId: `pc-${input.userProvidedId}`,
        downloadUrl: "https://pc.test/p/x",
        appleUrl: "https://pc.test/apple/x",
        androidUrl: "https://pc.test/android/x",
      };
    });

    const res = await makeApp(provider).request(`/t/${token}/wallet/apple`, { redirect: "manual" });

    expect(res.headers.get("location")).not.toContain("pc.test");
    expect(provider.deletePass).toHaveBeenCalledTimes(1);
    const pass = await prisma.walletPass.findUniqueOrThrow({ where: { attendee_id: attendee.id } });
    expect(pass.apple_url).toBeNull();
    expect(pass.provider_removed_at).not.toBeNull();
  });

  it("deletes the new pass when the save fails while an erasure is still open, by waiting for that erasure", async () => {
    const { attendee, token } = await createAttendee();
    const provider = stubProvider();
    provider.createPass.mockImplementationOnce(async (input: WalletPassInput) => {
      const held = await holdErasure([attendee.id]);
      setTimeout(() => void held.commit(), 400);
      return {
        providerPassId: `pc-${input.userProvidedId}`,
        downloadUrl: "https://pc.test/p/x",
        appleUrl: "https://pc.test/apple/x",
        androidUrl: "https://pc.test/android/x",
      };
    });
    // The erasure above is the first transaction; the save is the second and gives up at once, as
    // one that failed behind the erasure would. A plain read would still show a live attendee.
    const realTransaction = prisma.$transaction.bind(prisma) as unknown as (...args: unknown[]) => Promise<unknown>;
    let calls = 0;
    const spy = vi.spyOn(prisma, "$transaction").mockImplementation(((...args: unknown[]) =>
      ++calls === 2 ? Promise.reject(new Error("Transaction API error: timeout")) : realTransaction(...args)) as never);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await makeApp(provider).request(`/t/${token}/wallet/apple`, { redirect: "manual" });
    spy.mockRestore();
    errSpy.mockRestore();

    expect(res.headers.get("location")).toBe(`/t/${token}`);
    expect(provider.deletePass).toHaveBeenCalledWith(`pc-admitto:${EVENT_ID}:${attendee.id}`);
    const pass = await prisma.walletPass.findUniqueOrThrow({ where: { attendee_id: attendee.id } });
    expect(pass.apple_url).toBeNull();
    expect(pass.provider_removed_at).not.toBeNull();
  });

  it("still saves the new pass when the erasure it waited longer than 5 s for is rolled back", async () => {
    const { attendee, token } = await createAttendee();
    const provider = stubProvider();
    provider.createPass.mockImplementationOnce(async (input: WalletPassInput) => {
      const held = await holdErasure([attendee.id], 30_000, "rollback");
      // Past Prisma's default 5 s: with that limit the save would lose its work at commit.
      setTimeout(() => void held.commit(), 5_500);
      return {
        providerPassId: `pc-${input.userProvidedId}`,
        downloadUrl: "https://pc.test/p/x",
        appleUrl: "https://pc.test/apple/x",
        androidUrl: "https://pc.test/android/x",
      };
    });

    const res = await makeApp(provider).request(`/t/${token}/wallet/apple`, { redirect: "manual" });

    expect(res.headers.get("location")).toBe("https://pc.test/apple/x");
    expect(provider.deletePass).not.toHaveBeenCalled();
    const pass = await prisma.walletPass.findUniqueOrThrow({ where: { attendee_id: attendee.id } });
    expect(pass).toMatchObject({ status: "active", apple_url: "https://pc.test/apple/x" });
  }, 30_000);

  it("deletes the new pass even when saving it failed after the erasure committed", async () => {
    const { attendee, token } = await createAttendee();
    const provider = stubProvider();
    provider.createPass.mockImplementationOnce(async (input: WalletPassInput) => {
      await erase([attendee.id]);
      return { providerPassId: `pc-${input.userProvidedId}`, downloadUrl: null, appleUrl: "https://pc.test/a", androidUrl: null };
    });
    // The erasure above is the first transaction; the second is the one that would save the pass.
    const realTransaction = prisma.$transaction.bind(prisma) as unknown as (...args: unknown[]) => Promise<unknown>;
    let calls = 0;
    const spy = vi.spyOn(prisma, "$transaction").mockImplementation(((...args: unknown[]) =>
      ++calls === 2 ? Promise.reject(new Error("transaction timed out")) : realTransaction(...args)) as never);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await makeApp(provider).request(`/t/${token}/wallet/apple`, { redirect: "manual" });
    spy.mockRestore();
    errSpy.mockRestore();

    expect(res.headers.get("location")).not.toContain("pc.test");
    expect(provider.deletePass).toHaveBeenCalledWith(`pc-admitto:${EVENT_ID}:${attendee.id}`);
    const pass = await prisma.walletPass.findUniqueOrThrow({ where: { attendee_id: attendee.id } });
    expect(pass).toMatchObject({ apple_url: null, provider_pass_id: `pc-admitto:${EVENT_ID}:${attendee.id}` });
    expect(pass.provider_removed_at).not.toBeNull();
  });

  it("does not send an attendee erased after the ticket was resolved to the provider", async () => {
    const { attendee, token } = await createAttendee();
    const provider = stubProvider();
    // The pass lookup runs twice before the provider call; the erasure lands between the two.
    const realFindUnique = prisma.walletPass.findUnique.bind(prisma.walletPass) as unknown as (...args: unknown[]) => Promise<unknown>;
    let lookups = 0;
    const spy = vi.spyOn(prisma.walletPass, "findUnique").mockImplementation(((...args: unknown[]) => {
      if (++lookups === 2) return erase([attendee.id]).then(() => realFindUnique(...args));
      return realFindUnique(...args);
    }) as never);

    const res = await makeApp(provider).request(`/t/${token}/wallet/apple`, { redirect: "manual" });
    spy.mockRestore();

    expect(provider.createPass).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toBe(`/t/${token}`);
  });

  it("sends a visitor whose attendee was erased just before back to the ticket page, not to the stored pass, and records no device", async () => {
    const { attendee, token } = await createAttendee();
    await prisma.walletPass.create({
      data: { attendee_id: attendee.id, status: "active", provider_pass_id: "pc-x", apple_url: "https://pc.test/apple/x" },
    });
    // The last transaction of this request (the pass already exists) is the check before the
    // redirect; the erasure commits just before it, after the request has read the stored pass.
    const realTransaction = prisma.$transaction.bind(prisma) as unknown as (...args: unknown[]) => Promise<unknown>;
    const spy = vi.spyOn(prisma, "$transaction").mockImplementationOnce(((...args: unknown[]) =>
      erase([attendee.id]).then(() => realTransaction(...args))) as never);

    const res = await makeApp(stubProvider()).request(`/t/${token}/wallet/apple`, {
      redirect: "manual",
      headers: { "user-agent": "TestBrowser/1.0" },
    });
    spy.mockRestore();

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`/t/${token}`);
    const pass = await prisma.walletPass.findUniqueOrThrow({ where: { attendee_id: attendee.id } });
    expect(pass.user_agent).toBeNull();
    expect(pass.user_agent_captured_at).toBeNull();
  });

  it("waits for an erasure that is still open, then sends the visitor back instead of to the stored pass", async () => {
    const { attendee, token } = await createAttendee();
    await prisma.walletPass.create({
      data: { attendee_id: attendee.id, status: "active", provider_pass_id: "pc-open", apple_url: "https://pc.test/apple/open" },
    });
    const held = await holdErasure([attendee.id]);

    const requesting = Promise.resolve(makeApp(stubProvider()).request(`/t/${token}/wallet/apple`, { redirect: "manual" }));
    expect(await staysPending(requesting)).toBe(true);
    await held.commit();
    const res = await requesting;

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`/t/${token}`);
  });

  it("still sends a live attendee to the stored active pass and records the device", async () => {
    const { attendee, token } = await createAttendee();
    await prisma.walletPass.create({
      data: { attendee_id: attendee.id, status: "active", provider_pass_id: "pc-live", apple_url: "https://pc.test/apple/live" },
    });

    const res = await makeApp(stubProvider()).request(`/t/${token}/wallet/apple`, {
      redirect: "manual",
      headers: { "user-agent": "TestBrowser/2.0" },
    });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://pc.test/apple/live");
    expect((await prisma.walletPass.findUniqueOrThrow({ where: { attendee_id: attendee.id } })).user_agent).toBe("TestBrowser/2.0");
  });

  it("treats a concurrent insert of the failed marker as a no-op (no error log)", async () => {
    const { attendee, token } = await createAttendee();
    const provider = stubProvider();
    provider.createPass.mockRejectedValueOnce(new WalletProviderError("wallet_provider_rejected", "boom"));
    const realTransaction = prisma.$transaction.bind(prisma) as unknown as (
      fn: (tx: PrismaClient) => Promise<unknown>,
    ) => Promise<unknown>;
    const spy = vi.spyOn(prisma, "$transaction").mockImplementationOnce((async (fn: (tx: PrismaClient) => Promise<unknown>) =>
      realTransaction(async (tx) => {
        vi.spyOn(tx.walletPass, "create").mockRejectedValueOnce(
          new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "test" }),
        );
        return fn(tx);
      })) as never);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await makeApp(provider).request(`/t/${token}/wallet/apple`, { redirect: "manual" });
    spy.mockRestore();
    errSpy.mockRestore();

    expect(res.headers.get("location")).toBe(`/t/${token}?walletError=1`);
    expect(querySystemLogs({ source: "api" })).not.toContainEqual(
      expect.objectContaining({ message: "wallet_pass_upsert_failed", fields: expect.objectContaining({ attendeeId: attendee.id }) }),
    );
  });

  it("saves no install links, sends the visitor back to the ticket page and deletes the new pass at the provider", async () => {
    const { attendee, token } = await createAttendee();
    const provider = stubProvider();
    // The erasure commits while the provider is creating the pass.
    provider.createPass.mockImplementationOnce(async (input: WalletPassInput) => {
      await erase([attendee.id]);
      return {
        providerPassId: `pc-${input.userProvidedId}`,
        downloadUrl: "https://pc.test/p/x",
        appleUrl: "https://pc.test/apple/x",
        androidUrl: "https://pc.test/android/x",
      };
    });

    const res = await makeApp(provider).request(`/t/${token}/wallet/apple`, { redirect: "manual" });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).not.toContain("pc.test");
    expect(provider.deletePass).toHaveBeenCalledWith(`pc-admitto:${EVENT_ID}:${attendee.id}`);
    const pass = await prisma.walletPass.findUniqueOrThrow({ where: { attendee_id: attendee.id } });
    expect(pass).toMatchObject({
      apple_url: null,
      android_url: null,
      download_url: null,
      user_agent: null,
      provider_pass_id: `pc-admitto:${EVENT_ID}:${attendee.id}`,
    });
    expect(pass.provider_removed_at).not.toBeNull();
  });

  it("keeps the provider ids, not yet marked removed, when deleting the new pass fails", async () => {
    const { attendee, token } = await createAttendee();
    const provider = stubProvider();
    provider.createPass.mockImplementationOnce(async (input: WalletPassInput) => {
      await erase([attendee.id]);
      return { providerPassId: `pc-${input.userProvidedId}`, downloadUrl: null, appleUrl: "https://pc.test/a", androidUrl: null };
    });
    provider.deletePass.mockRejectedValueOnce(new Error("provider down"));

    const res = await makeApp(provider).request(`/t/${token}/wallet/apple`, { redirect: "manual" });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).not.toContain("pc.test");
    const pass = await prisma.walletPass.findUniqueOrThrow({ where: { attendee_id: attendee.id } });
    expect(pass).toMatchObject({ apple_url: null, provider_removed_at: null });
    expect(pass.provider_pass_id).toBe(`pc-admitto:${EVENT_ID}:${attendee.id}`);
  });

  it("records no failed pass for an attendee erased while the provider call was failing", async () => {
    const { attendee, token } = await createAttendee();
    const provider = stubProvider();
    provider.createPass.mockImplementationOnce(async () => {
      await erase([attendee.id]);
      throw new WalletProviderError("wallet_provider_rejected", "rejected");
    });

    const res = await makeApp(provider).request(`/t/${token}/wallet/apple`, { redirect: "manual" });

    expect(res.status).toBe(302);
    expect(await prisma.walletPass.findUnique({ where: { attendee_id: attendee.id } })).toBeNull();
  });

  it("still creates the pass and saves the links for a live attendee", async () => {
    const { attendee, token } = await createAttendee();
    const provider = stubProvider();

    const res = await makeApp(provider).request(`/t/${token}/wallet/apple`, { redirect: "manual" });

    expect(res.headers.get("location")).toBe("https://pc.test/apple/x");
    expect(provider.deletePass).not.toHaveBeenCalled();
    expect((await prisma.walletPass.findUniqueOrThrow({ where: { attendee_id: attendee.id } })).apple_url).toBe(
      "https://pc.test/apple/x",
    );
  });
});

describe("wallet message audience", () => {
  it("does not load an erased attendee as a target of a message job queued before the erasure", async () => {
    const live = await createAttendee();
    const gone = await createAttendee();
    for (const a of [live.attendee, gone.attendee]) {
      await prisma.walletPass.create({
        data: { attendee_id: a.id, status: "active", provider_pass_id: `pc-msg-${a.id}`, apple_url: "https://pc.test/a" },
      });
    }
    await erase([gone.attendee.id]);

    const targets = await loadWalletMessageTargets(prisma, EVENT_ID, [live.attendee.id, gone.attendee.id]);

    expect(targets.map((t) => t.attendeeId)).toEqual([live.attendee.id]);
  });

  it("leaves an erased attendee out although their pass is still active at the provider", async () => {
    const live = await createAttendee();
    const gone = await createAttendee();
    for (const a of [live.attendee, gone.attendee]) {
      await prisma.walletPass.create({
        data: { attendee_id: a.id, status: "active", provider_pass_id: `pc-${a.id}`, apple_url: "https://pc.test/a" },
      });
    }
    await erase([gone.attendee.id]);

    const { ids } = await resolveWalletMessageAttendeeIds(prisma, EVENT_ID, { type: "all" });

    expect(ids).toContain(live.attendee.id);
    expect(ids).not.toContain(gone.attendee.id);
  });
});

describe("the last check before something is sent to the provider", () => {
  const audit = { operator: "user-1" };

  async function attendeeWithPass(passId: string) {
    const { attendee } = await createAttendee();
    await prisma.walletPass.create({
      data: { attendee_id: attendee.id, status: "active", provider_pass_id: passId, apple_url: "https://pc.test/a" },
    });
    return attendee;
  }

  it("a pass update waits for an erasure that is still open and then sends nothing to the provider", async () => {
    const attendee = await attendeeWithPass("pc-update-open");
    const provider = stubProvider();
    const held = await holdErasure([attendee.id]);

    // A plain read still sees the attendee as they were: only the row lock waits for the erasure.
    const updating = reissueOneWalletPass(prisma, EVENT_ID, { attendeeId: attendee.id, providerPassId: "pc-update-open" }, provider, audit);
    expect(await staysPending(updating)).toBe(true);
    await held.commit();

    expect(await updating).toBe("skipped");
    expect(provider.updatePass).not.toHaveBeenCalled();
  });

  it("still updates the pass of a live attendee", async () => {
    const attendee = await attendeeWithPass("pc-update-live");
    const provider = stubProvider();
    provider.updatePass.mockResolvedValueOnce({
      downloadUrl: "https://pc.test/p/y",
      appleUrl: "https://pc.test/apple/y",
      androidUrl: "https://pc.test/android/y",
    });

    const result = await reissueOneWalletPass(prisma, EVENT_ID, { attendeeId: attendee.id, providerPassId: "pc-update-live" }, provider, audit);

    expect(result).toBe("reissued");
    expect(provider.updatePass).toHaveBeenCalledTimes(1);
  });

  it("sends a visitor back with the retry notice, not to the pass, when the check before the redirect cannot be made", async () => {
    const { attendee, token } = await createAttendee();
    await prisma.walletPass.create({
      data: { attendee_id: attendee.id, status: "active", provider_pass_id: "pc-fail-closed", apple_url: "https://pc.test/apple/closed" },
    });
    // The transaction of the check gave up (for instance waiting behind an erasure), and so does
    // the second try with the lock alone.
    const spy = vi
      .spyOn(prisma, "$transaction")
      .mockRejectedValueOnce(new Error("Transaction API error: timeout"))
      .mockRejectedValueOnce(new Error("Transaction API error: timeout"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await makeApp(stubProvider()).request(`/t/${token}/wallet/apple`, { redirect: "manual" });
    spy.mockRestore();
    errSpy.mockRestore();

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`/t/${token}?walletError=1`);
  });

  it("still sends the visitor to the pass when only the device write fails and the attendee is live", async () => {
    const { attendee, token } = await createAttendee();
    await prisma.walletPass.create({
      data: { attendee_id: attendee.id, status: "active", provider_pass_id: "pc-write-fails", apple_url: "https://pc.test/apple/write" },
    });
    const spy = vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(new Error("write failed"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await makeApp(stubProvider()).request(`/t/${token}/wallet/apple`, { redirect: "manual" });
    spy.mockRestore();
    errSpy.mockRestore();

    expect(res.headers.get("location")).toBe("https://pc.test/apple/write");
  });

  it("sends the visitor back to the ticket page when the capture transaction fails and the second check finds the attendee erased", async () => {
    const { attendee, token } = await createAttendee();
    await prisma.walletPass.create({
      data: { attendee_id: attendee.id, status: "active", provider_pass_id: "pc-write-erased", apple_url: "https://pc.test/apple/we" },
    });
    // The erasure commits while the capture transaction fails; the lock-only check that follows sees it.
    const spy = vi
      .spyOn(prisma, "$transaction")
      .mockImplementationOnce((() =>
        erase([attendee.id]).then(() => Promise.reject(new Error("Transaction API error: timeout")))) as never);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await makeApp(stubProvider()).request(`/t/${token}/wallet/apple`, { redirect: "manual" });
    spy.mockRestore();
    errSpy.mockRestore();

    expect(res.headers.get("location")).toBe(`/t/${token}`);
  });

  it("a message batch waits for an erasure that is still open and leaves the erased attendee out", async () => {
    const gone = await attendeeWithPass("pc-msg-open-gone");
    const live = await attendeeWithPass("pc-msg-open-live");
    const held = await holdErasure([gone.id]);

    const checking = keepLiveWalletMessageTargets(prisma, [
      { attendeeId: gone.id, providerPassId: "pc-msg-open-gone" },
      { attendeeId: live.id, providerPassId: "pc-msg-open-live" },
    ]);
    expect(await staysPending(checking)).toBe(true);
    await held.commit();

    expect(await checking).toEqual([{ attendeeId: live.id, providerPassId: "pc-msg-open-live" }]);
  });
});
