import { afterEach, describe, expect, it, vi } from "vitest";

const findManyEvents = vi.fn();
const disconnect = vi.fn();
const subscribeWalletWebhooksBestEffort = vi.fn().mockResolvedValue(undefined);

// No real DB here (this file runs under the "web-unit" project, not "integration" - see
// vitest.unit.config.ts's exclude of test/integration/**) - both dependencies main() reaches
// through the real prisma singleton are mocked instead. walletPass.findMany always resolves to
// [] below, so backfillEvent's own candidate loop (already covered against a real DB by
// test/integration/backfill-wallet-first-confirmed.test.ts) never runs here - this only exercises
// main()'s own event query/filtering and per-event dispatch, which that file can't reach without
// spawning this script as a subprocess.
vi.mock("@admitto/db", () => ({
  prisma: {
    event: { findMany: findManyEvents },
    walletPass: { findMany: vi.fn().mockResolvedValue([]) },
    $disconnect: disconnect,
  },
}));

vi.mock("../../src/admin/event-settings-routes.js", () => ({
  subscribeWalletWebhooksBestEffort,
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("main", () => {
  it("queries wallet-enabled events with a configured template/API key, scoped to --event-id when given", async () => {
    findManyEvents.mockResolvedValue([]);
    const originalArgv = process.argv;
    process.argv = ["node", "backfill-wallet-first-confirmed.js", "--event-id", "evt-only"];
    try {
      const { main } = await import("../../src/scripts/backfill-wallet-first-confirmed.js");
      await main();
    } finally {
      process.argv = originalArgv;
    }

    expect(findManyEvents).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        where: expect.objectContaining({
          wallet_enabled: true,
          wallet_template_id: { not: null },
          wallet_api_key_enc: { not: null },
          id: "evt-only",
        }),
      }),
    );
  });

  it("backfills every matching event in dry-run mode without re-subscribing webhooks", async () => {
    findManyEvents.mockResolvedValue([
      { id: "evt-a", title: "Event A", wallet_template_id: "tmpl-a", wallet_api_key_enc: "enc-a" },
      { id: "evt-b", title: "Event B", wallet_template_id: "tmpl-b", wallet_api_key_enc: "enc-b" },
    ]);
    const originalArgv = process.argv;
    process.argv = ["node", "backfill-wallet-first-confirmed.js", "--dry-run"];
    try {
      const { main } = await import("../../src/scripts/backfill-wallet-first-confirmed.js");
      await main();
    } finally {
      process.argv = originalArgv;
    }

    expect(findManyEvents).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ where: expect.not.objectContaining({ id: expect.anything() }) }),
    );
    // dry-run mode never calls subscribeWalletWebhooksBestEffort (backfillEvent's own dryRun
    // gate) - matches the "does not write anything in dry-run mode" integration test's own
    // assertion for backfillEvent directly.
    expect(subscribeWalletWebhooksBestEffort).not.toHaveBeenCalled();
  });
});
