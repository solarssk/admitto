import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const redisMock = vi.hoisted(() => ({ createClient: vi.fn() }));

vi.mock("redis", () => ({ createClient: redisMock.createClient }));

type FakeRedisClient = {
  destroy: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  publish: ReturnType<typeof vi.fn>;
  withAbortSignal: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  isReady: boolean;
};

function fakeClient(): FakeRedisClient {
  const client: FakeRedisClient = {
    destroy: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
    publish: vi.fn().mockResolvedValue(1),
    withAbortSignal: vi.fn(),
    on: vi.fn(),
    isReady: true,
  };
  client.withAbortSignal.mockReturnValue(client);
  return client;
}

describe("publishActivityChanged fail-open", () => {
  beforeEach(() => {
    vi.resetModules();
    redisMock.createClient.mockReset();
    vi.stubEnv("REDIS_URL", "redis://localhost:6379");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("publishes every event with a bounded command and reuses the connected client", async () => {
    const client = fakeClient();
    redisMock.createClient.mockReturnValue(client);
    const { closeSsePublishClient, publishActivityChanged } = await import("../src/lib/sse-publish.js");

    await publishActivityChanged(["evt-1", "evt-2"]);
    await publishActivityChanged(["evt-3"]);

    expect(redisMock.createClient).toHaveBeenCalledOnce();
    expect(client.withAbortSignal).toHaveBeenCalledTimes(3);
    expect(client.publish).toHaveBeenCalledTimes(3);
    await closeSsePublishClient();
    expect(client.destroy).toHaveBeenCalledOnce();
  });

  it("drops the client and resolves when a Redis command fails", async () => {
    const client = fakeClient();
    client.publish.mockRejectedValueOnce(new Error("Redis unavailable"));
    redisMock.createClient.mockReturnValue(client);
    const { publishActivityChanged } = await import("../src/lib/sse-publish.js");

    await expect(publishActivityChanged(["evt-1"])).resolves.toBeUndefined();
    expect(client.destroy).toHaveBeenCalledOnce();
    await expect(publishActivityChanged(["evt-2"])).resolves.toBeUndefined();
    expect(redisMock.createClient).toHaveBeenCalledOnce();
  });
});
