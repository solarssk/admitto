import { describe, expect, it, vi } from "vitest";
import { createMailer, sendBatch, MockAdapter, configFromEnv } from "../src/index.js";
import type { MailMessage } from "../src/types.js";

describe("createMailer", () => {
  it("creates the correct adapter for each provider", () => {
    const pa = createMailer(
      { provider: "powerautomate", url: "https://example.com/flow" },
      { fetchFn: vi.fn() as unknown as typeof fetch },
    );
    expect(pa.provider).toBe("powerautomate");

    const smtp = createMailer({
      provider: "smtp",
      host: "smtp.example.com",
      user: "u",
      password: "p",
      from: "a@example.com",
    });
    expect(smtp.provider).toBe("smtp");
  });

  it("throws on invalid config", () => {
    expect(() => createMailer({ provider: "powerautomate", url: "not-a-url" })).toThrow();
    expect(() => createMailer({ provider: "unknown-provider" })).toThrow();
  });
});

describe("configFromEnv", () => {
  it("builds powerautomate config from env", () => {
    const cfg = configFromEnv({ MAILER_PROVIDER: "powerautomate", MAILER_PA_URL: "https://example.com/flow" } as NodeJS.ProcessEnv);
    expect(cfg.provider).toBe("powerautomate");
  });

  it("throws when MAILER_PROVIDER is missing", () => {
    expect(() => configFromEnv({} as NodeJS.ProcessEnv)).toThrow();
  });
});

describe("sendBatch", () => {
  it("sends all messages, preserves result order, and counts sent/failed", async () => {
    const adapter = new MockAdapter({ failOn: (m) => m.to.includes("bad") });
    const messages: MailMessage[] = [
      { to: "a@example.com", subject: "s", html: "<p>1</p>" },
      { to: "bad@example.com", subject: "s", html: "<p>2</p>" },
      { to: "c@example.com", subject: "s", html: "<p>3</p>" },
    ];
    const seen: number[] = [];
    const summary = await sendBatch(adapter, messages, {
      concurrency: 2,
      onResult: (_r, _m, i) => seen.push(i),
    });

    expect(summary.total).toBe(3);
    expect(summary.sent).toBe(2);
    expect(summary.failed).toBe(1);
    expect(summary.results[1]!.status).toBe("failed");
    expect(summary.results[0]!.status).toBe("sent");
    expect(seen.sort()).toEqual([0, 1, 2]);
    expect(adapter.sent.map((m) => m.to)).toEqual(["a@example.com", "c@example.com"]);
  });

  it("respects concurrency limit (no more than limit active at once)", async () => {
    let active = 0;
    let maxActive = 0;
    const adapter = {
      provider: "powerautomate" as const,
      send: async (m: MailMessage) => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 10));
        active--;
        return { status: "sent" as const, provider: "powerautomate" as const, idempotencyKey: m.idempotencyKey };
      },
    };
    const messages: MailMessage[] = Array.from({ length: 10 }, (_, i) => ({
      to: `u${i}@example.com`,
      subject: "s",
      html: "<p>x</p>",
    }));
    await sendBatch(adapter, messages, { concurrency: 3 });
    expect(maxActive).toBeLessThanOrEqual(3);
  });
});
