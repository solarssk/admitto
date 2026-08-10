import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient } from "redis";
import { sseChannelName } from "@admitto/shared/sse-events";
import { closeSsePublishClientForTests, publishActivityChanged } from "../src/lib/sse-publish.js";

const redisUrl = process.env.REDIS_URL;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(assertion: () => void, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      assertion();
      return;
    } catch (err) {
      if (Date.now() >= deadline) throw err;
      await sleep(20);
    }
  }
}

describe("publishActivityChanged", () => {
  it("is a no-op without REDIS_URL configured", async () => {
    vi.stubEnv("REDIS_URL", "");
    await expect(publishActivityChanged(["evt-1"])).resolves.toBeUndefined();
    vi.unstubAllEnvs();
  });

  it("is a no-op with an empty event id list, even with REDIS_URL set", async () => {
    vi.stubEnv("REDIS_URL", "redis://localhost:1");
    await expect(publishActivityChanged([])).resolves.toBeUndefined();
    vi.unstubAllEnvs();
  });
});

describe.skipIf(!redisUrl)("publishActivityChanged (real Redis)", () => {
  const rawSub = createClient({ url: redisUrl! });

  beforeAll(async () => {
    await rawSub.connect();
  });

  afterAll(async () => {
    if (rawSub.isOpen) await rawSub.quit();
  });

  afterEach(async () => {
    await closeSsePublishClientForTests();
    vi.unstubAllEnvs();
  });

  it("publishes activity_changed on the event's SSE channel for every affected event id", async () => {
    vi.stubEnv("REDIS_URL", redisUrl!);

    const eventA = `evt-cli-sse-a-${Date.now()}`;
    const eventB = `evt-cli-sse-b-${Date.now()}`;
    const received: Array<{ channel: string; message: string }> = [];
    await rawSub.pSubscribe("admitto:sse:*", (message, channel) => {
      received.push({ channel, message });
    });
    await sleep(200);

    await publishActivityChanged([eventA, eventB]);

    await waitFor(() => {
      const channels = received.map((r) => r.channel).sort();
      expect(channels).toEqual([sseChannelName(eventA), sseChannelName(eventB)].sort());
      expect(received[0]?.message).toBe(JSON.stringify({ type: "activity_changed" }));
    });

    await rawSub.pUnsubscribe("admitto:sse:*");
  });
});
