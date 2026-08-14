import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const redisMock = vi.hoisted(() => ({ createClient: vi.fn() }));

vi.mock("redis", () => ({ createClient: redisMock.createClient }));

type FakeRedisClient = {
  destroy: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  pSubscribe: ReturnType<typeof vi.fn>;
  publish: ReturnType<typeof vi.fn>;
  withAbortSignal: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  isReady: boolean;
};

function fakeClient(): FakeRedisClient {
  const client: FakeRedisClient = {
    destroy: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
    pSubscribe: vi.fn().mockResolvedValue(undefined),
    publish: vi.fn().mockResolvedValue(1),
    withAbortSignal: vi.fn(),
    on: vi.fn(),
    isReady: true,
  };
  client.withAbortSignal.mockReturnValue(client);
  return client;
}

describe("sse-channel Redis fail-open", () => {
  beforeEach(() => {
    vi.resetModules();
    redisMock.createClient.mockReset();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("REDIS_URL", "redis://localhost:6379");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("destroys both tentative clients when connecting fails", async () => {
    const sub = fakeClient();
    const pub = fakeClient();
    pub.connect.mockRejectedValueOnce(new Error("Redis unavailable"));
    redisMock.createClient.mockReturnValueOnce(sub).mockReturnValueOnce(pub);
    const { subscribe, waitForSseRedisReadyForTests } = await import("../src/admin/sse-channel.js");

    subscribe("evt-1", vi.fn());

    await expect(waitForSseRedisReadyForTests()).resolves.toBe(false);
    expect(sub.destroy).toHaveBeenCalledOnce();
    expect(pub.destroy).toHaveBeenCalledOnce();
  });

  it("delivers locally and drops both clients when a Redis publish fails", async () => {
    const sub = fakeClient();
    const pub = fakeClient();
    pub.publish.mockRejectedValueOnce(new Error("Redis unavailable"));
    redisMock.createClient.mockReturnValueOnce(sub).mockReturnValueOnce(pub);
    const { publish, subscribe, waitForSseRedisReadyForTests } = await import("../src/admin/sse-channel.js");
    const listener = vi.fn();

    subscribe("evt-1", listener);
    await expect(waitForSseRedisReadyForTests()).resolves.toBe(true);
    publish("evt-1", { type: "activity_changed" });
    await vi.waitFor(() => expect(listener).toHaveBeenCalledWith({ type: "activity_changed" }));

    expect(pub.withAbortSignal).toHaveBeenCalledOnce();
    expect(pub.destroy).toHaveBeenCalledOnce();
    expect(sub.destroy).toHaveBeenCalledOnce();
  });
});
