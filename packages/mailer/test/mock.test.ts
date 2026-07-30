import { describe, expect, it } from "vitest";
import { MockAdapter } from "../src/adapters/mock.js";

describe("MockAdapter", () => {
  it("defaults to the powerautomate provider when none is given", () => {
    const adapter = new MockAdapter();
    expect(adapter.provider).toBe("powerautomate");
  });

  it("records accepted sends and returns an incrementing providerMessageId", async () => {
    const adapter = new MockAdapter({ provider: "smtp" });
    const message = { to: "jan@example.com", subject: "Hi", html: "<p>x</p>", idempotencyKey: "k1" };

    const res = await adapter.send(message);

    expect(res.status).toBe("accepted");
    expect(res.provider).toBe("smtp");
    expect(res.providerMessageId).toBe("mock-1");
    expect(adapter.sent).toEqual([message]);
  });

  it("returns failed without recording the message when failOn matches", async () => {
    const adapter = new MockAdapter({ failOn: (m) => m.to === "blocked@example.com" });
    const message = { to: "blocked@example.com", subject: "S", html: "<p>x</p>" };

    const res = await adapter.send(message);

    expect(res.status).toBe("failed");
    expect(res.retryable).toBe(false);
    expect(adapter.sent).toEqual([]);
  });

  it("close() resolves (no persistent connection to release)", async () => {
    const adapter = new MockAdapter();
    await expect(adapter.close()).resolves.toBeUndefined();
  });
});
