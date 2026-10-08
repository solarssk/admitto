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
import { loadWalletMessageTargets } from "@admitto/tickets";

const ORG_ID = "org-wallet-erased";
const EVENT_ID = "evt-wallet-erased";

let prisma: PrismaClient;
let seq = 0;

type Stub = WalletPassProvider & { createPass: ReturnType<typeof vi.fn>; deletePass: ReturnType<typeof vi.fn> };

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

/** Starts an erasure and keeps its transaction open after the rows are written. */
async function holdErasure(ids: string[]) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let written!: () => void;
  const writtenPromise = new Promise<void>((resolve) => (written = resolve));
  const transaction = prisma.$transaction(async (tx) => {
    await eraseAttendees(tx, { eventId: EVENT_ID, attendeeIds: ids });
    written();
    await gate;
  });
  await writtenPromise;
  return { commit: () => (release(), transaction) };
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

  it("does not record the device of a visitor whose attendee was erased just before", async () => {
    const { attendee, token } = await createAttendee();
    await prisma.walletPass.create({
      data: { attendee_id: attendee.id, status: "active", provider_pass_id: "pc-x", apple_url: "https://pc.test/apple/x" },
    });
    // The device capture is the only transaction of this request (the pass already exists).
    const realTransaction = prisma.$transaction.bind(prisma) as unknown as (...args: unknown[]) => Promise<unknown>;
    const spy = vi.spyOn(prisma, "$transaction").mockImplementationOnce(((...args: unknown[]) =>
      erase([attendee.id]).then(() => realTransaction(...args))) as never);

    const res = await makeApp(stubProvider()).request(`/t/${token}/wallet/apple`, {
      redirect: "manual",
      headers: { "user-agent": "TestBrowser/1.0" },
    });
    spy.mockRestore();

    expect(res.status).toBe(302);
    const pass = await prisma.walletPass.findUniqueOrThrow({ where: { attendee_id: attendee.id } });
    expect(pass.user_agent).toBeNull();
    expect(pass.user_agent_captured_at).toBeNull();
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
